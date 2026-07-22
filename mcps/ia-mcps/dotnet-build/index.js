#!/usr/bin/env node

const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const readline = require('readline');
const os = require('os');

/* ======================================================
   CONFIGURAÇÃO
   ====================================================== */

const MCP_DIR = __dirname;
const LOGS_DIR = path.join(MCP_DIR, 'logs');
const HIST_PATH = path.join(MCP_DIR, 'builds.json');
const ACTIVE_PATH = path.join(MCP_DIR, 'active_builds.json');

const MAX_HISTORY = parseInt(process.env.MCP_MAX_HISTORY || '30', 10);
const BUILD_TIMEOUT_MS = parseInt(process.env.MCP_BUILD_TIMEOUT_MS || (5 * 60 * 1000).toString(), 10);
const ACTIVE_BUILD_RETENTION_MS = parseInt(process.env.MCP_ACTIVE_BUILD_RETENTION_MS || (5 * 60 * 1000).toString(), 10);
const MAX_CONCURRENT_BUILDS = parseInt(process.env.MCP_MAX_CONCURRENT_BUILDS || '2', 10);
const WATCHDOG_INTERVAL_MS = 15000;

if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const activeBuilds = {};
const buildQueue = [];
let historyCache = null;
let watchdogTimer = null;

/* ======================================================
   UTILITÁRIOS
   ====================================================== */

function generateTaskId() {
    return `build_${Date.now()}_${crypto.randomUUID()}`;
}

function writeResult(id, result) {
    try {
        process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id,
            result
        }) + '\n');
    } catch (err) {
        console.error('[MCP Error] Failed to write result:', err.message);
    }
}

function writeError(id, code, message) {
    try {
        process.stdout.write(
            JSON.stringify({
                jsonrpc: '2.0',
                id,
                error: { code, message }
            }) + '\n'
        );
    } catch (err) {
        console.error('[MCP Error] Failed to write error:', err.message);
    }
}

function addTail(tailBuffer, text) {
    tailBuffer.push(text);
    if (tailBuffer.length > 100) {
        tailBuffer.shift();
    }
}

/* ======================================================
   HISTÓRICO
   ====================================================== */

async function loadHistory() {
    if (historyCache) return historyCache;
    try {
        if (fs.existsSync(HIST_PATH)) {
            const raw = await fsPromises.readFile(HIST_PATH, 'utf8');
            historyCache = JSON.parse(raw);
        } else {
            historyCache = {};
        }
    } catch (err) {
        console.error('[MCP Warning] Failed to load history:', err.message);
        historyCache = {};
    }
    return historyCache;
}

async function saveHistory() {
    try {
        const builds = Object.values(historyCache);
        builds.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

        if (builds.length > MAX_HISTORY) {
            const remove = builds.slice(MAX_HISTORY);
            for (const build of remove) {
                if (build.logPath && fs.existsSync(build.logPath)) {
                    try { await fsPromises.unlink(build.logPath); } catch { }
                }
                delete historyCache[build.taskId];
            }
        }

        const tmp = HIST_PATH + '.tmp';
        await fsPromises.writeFile(tmp, JSON.stringify(historyCache, null, 2), 'utf8');
        await fsPromises.rename(tmp, HIST_PATH);
    } catch (err) {
        console.error('[MCP Error] Failed to save history:', err.message);
    }
}

/* ======================================================
   WATCHDOG: PERSISTÊNCIA DE ACTIVE BUILDS
   ====================================================== */

async function saveActiveBuilds() {
    const snapshot = {};
    for (const [taskId, build] of Object.entries(activeBuilds)) {
        snapshot[taskId] = {
            logPath: build.logPath,
            startedAt: build.startedAt,
            finished: build.finished,
            exitCode: build.exitCode,
            durationMs: build.durationMs,
            fastMode: build.fastMode,
            incremental: build.incremental,
            projects: build.projects,
            tailBuffer: build.tailBuffer ? build.tailBuffer.slice(-20) : []
        };
    }
    try {
        await fsPromises.writeFile(ACTIVE_PATH, JSON.stringify(snapshot, null, 2), 'utf8');
    } catch (err) {
        console.error('[MCP Warning] Failed to save active builds:', err.message);
    }
}

async function loadActiveBuilds() {
    try {
        if (fs.existsSync(ACTIVE_PATH)) {
            const raw = await fsPromises.readFile(ACTIVE_PATH, 'utf8');
            const restored = JSON.parse(raw);
            for (const [taskId, data] of Object.entries(restored)) {
                if (!data.finished) {
                    // Build órfão (servidor caiu durante execução)
                    activeBuilds[taskId] = {
                        ...data,
                        proc: null,
                        finished: true,
                        exitCode: -1,
                        durationMs: Date.now() - new Date(data.startedAt).getTime(),
                        orphaned: true
                    };
                    // Registrar no histórico
                    const history = await loadHistory();
                    history[taskId] = {
                        taskId,
                        solutionPath: 'unknown',
                        startedAt: data.startedAt,
                        finishedAt: new Date().toISOString(),
                        durationMs: activeBuilds[taskId].durationMs,
                        exitCode: -1,
                        status: 'orphaned',
                        logPath: data.logPath,
                        fastMode: data.fastMode,
                        incremental: data.incremental,
                        projects: data.projects,
                        orphaned: true
                    };
                    await saveHistory();
                }
            }
            // Limpar o arquivo de restore
            await fsPromises.unlink(ACTIVE_PATH).catch(() => {});
        }
    } catch (err) {
        console.error('[MCP Warning] Failed to load active builds:', err.message);
    }
}

function startWatchdog() {
    if (watchdogTimer) return;
    watchdogTimer = setInterval(() => {
        if (Object.keys(activeBuilds).length > 0) {
            saveActiveBuilds();
        }
    }, WATCHDOG_INTERVAL_MS);
}

/* ======================================================
   GERENCIADOR DE BUILD COM FILA DE CONCORRÊNCIA
   ====================================================== */

function processBuildQueue() {
    const runningCount = Object.values(activeBuilds).filter(b => !b.finished).length;
    if (runningCount < MAX_CONCURRENT_BUILDS && buildQueue.length > 0) {
        const nextTask = buildQueue.shift();
        executeBuild(nextTask.id, nextTask.taskId, nextTask.args, nextTask.resolvedPath, nextTask.logPath);
    }
}

async function startBuild(id, args = {}) {
    const { solutionPath } = args;

    if (!solutionPath) {
        return writeError(id, -32602, 'solutionPath obrigatório');
    }

    const resolvedPath = path.resolve(solutionPath);
    if (!fs.existsSync(resolvedPath)) {
        return writeError(id, -32602, 'Arquivo não encontrado');
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const validExtensions = ['.sln', '.slnx', '.csproj', '.fsproj'];
    if (!validExtensions.includes(ext)) {
        return writeError(id, -32602, 'Arquivo inválido. Use .sln, .slnx, .csproj ou .fsproj');
    }

    const taskId = generateTaskId();
    const logPath = path.join(LOGS_DIR, `${taskId}.log`);

    const runningCount = Object.values(activeBuilds).filter(b => !b.finished).length;

    if (runningCount >= MAX_CONCURRENT_BUILDS) {
        buildQueue.push({ id, taskId, args, resolvedPath, logPath });
        writeResult(id, { taskId, status: 'queued' });
        return;
    }

    executeBuild(id, taskId, args, resolvedPath, logPath);
}

function executeBuild(id, taskId, args, resolvedPath, logPath) {
    const { configuration = 'Release', fastMode = false, incremental = false, projects = [] } = args;

    let logStream;
    try {
        logStream = fs.createWriteStream(logPath);
    } catch (err) {
        return writeError(id, -32603, `Falha ao criar log: ${err.message}`);
    }

    const tailBuffer = [];
    const startTime = Date.now();

    let buildArgs = ['build', resolvedPath, '-c', configuration];

    if (fastMode) {
        buildArgs.push('--no-restore', '--no-incremental', '--disable-build-servers');
    }

    if (incremental) {
        buildArgs.push('--no-restore', '--use-current-runtime');
    }

    if (projects && projects.length > 0) {
        buildArgs = ['build', '-c', configuration, '--no-restore'];
        for (const project of projects) {
            buildArgs.push(path.resolve(project));
        }
    }

    const proc = spawn('dotnet', buildArgs, {
        cwd: path.dirname(resolvedPath),
        windowsHide: true,
        detached: process.platform !== 'win32',
        env: {
            ...process.env,
            DOTNET_CLI_TELEMETRY_OPTOUT: '1',
            DOTNET_NOLOGO: '1',
            MSBUILDENABLEALLPROPERTYFUNCTIONS: '1'
        }
    });

    activeBuilds[taskId] = {
        proc,
        logPath,
        tailBuffer,
        startedAt: new Date().toISOString(),
        finished: false,
        fastMode,
        incremental,
        projects
    };

    // Iniciar watchdog quando primeira build começa
    startWatchdog();

    proc.stdout.on('data', data => {
        const text = data.toString();
        addTail(tailBuffer, text);
        logStream.write(data);
    });

    proc.stderr.on('data', data => {
        const text = data.toString();
        addTail(tailBuffer, text);
        logStream.write(data);
    });

    proc.on('error', err => {
        delete activeBuilds[taskId];
        logStream.end();
        fsPromises.unlink(logPath).catch(() => {});
        writeError(id, -32603, `Falha ao iniciar dotnet: ${err.message}`);
        processBuildQueue();
    });

    const timeoutHandle = setTimeout(() => {
        try {
            if (process.platform === 'win32') {
                spawn('taskkill', ['/pid', proc.pid, '/f', '/t']);
            } else {
                process.kill(-proc.pid, 'SIGKILL');
            }
        } catch { }
    }, BUILD_TIMEOUT_MS);

    proc.on('close', async code => {
        clearTimeout(timeoutHandle);
        const durationMs = Date.now() - startTime;

        if (activeBuilds[taskId]) {
            activeBuilds[taskId].finished = true;
            activeBuilds[taskId].exitCode = code;
            activeBuilds[taskId].durationMs = durationMs;
        }

        logStream.end();

        try {
            const history = await loadHistory();
            history[taskId] = {
                taskId,
                solutionPath: resolvedPath,
                startedAt: activeBuilds[taskId]?.startedAt || new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                durationMs,
                exitCode: code,
                status: code === 0 ? 'succeeded' : 'failed',
                logPath,
                fastMode,
                incremental,
                projects
            };
            await saveHistory();
        } catch (err) {
            console.error(`[MCP Error] History save failed for ${taskId}:`, err.message);
        }

        setTimeout(() => {
            delete activeBuilds[taskId];
        }, ACTIVE_BUILD_RETENTION_MS);

        processBuildQueue();
    });

    writeResult(id, { taskId, status: 'running' });
}

/* ======================================================
   HANDLERS AUXILIARES DE BUILD
   ====================================================== */

async function checkBuild(id, args = {}) {
    const { taskId } = args;
    if (!taskId) {
        return writeError(id, -32602, 'taskId obrigatório');
    }

    const active = activeBuilds[taskId];
    if (active) {
        const result = {
            taskId,
            status: active.finished ? (active.exitCode === 0 ? 'succeeded' : 'failed') : 'running',
            durationMs: active.durationMs || (Date.now() - new Date(active.startedAt).getTime()),
            tail: active.tailBuffer.slice(-20)
        };
        if (active.orphaned) {
            result.orphaned = true;
            result.message = 'Build órfã (servidor reiniciou durante execução)';
        }
        return writeResult(id, result);
    }

    const inQueue = buildQueue.find(b => b.taskId === taskId);
    if (inQueue) {
        return writeResult(id, { taskId, status: 'queued' });
    }

    const history = await loadHistory();
    const past = history[taskId];
    if (past) {
        return writeResult(id, past);
    }

    writeError(id, -32602, `Build não encontrada com taskId: ${taskId}`);
}

async function listBuilds(id) {
    const history = await loadHistory();
    writeResult(id, {
        active: Object.keys(activeBuilds),
        queued: buildQueue.map(b => b.taskId),
        history: Object.values(history)
    });
}

function serverStatus(id) {
    const running = Object.values(activeBuilds).filter(b => !b.finished);
    const memUsage = process.memoryUsage();
    writeResult(id, {
        status: 'ok',
        uptime: process.uptime(),
        activeBuilds: running.length,
        queuedBuilds: buildQueue.length,
        totalActive: Object.keys(activeBuilds).length,
        memory: {
            rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB'
        },
        config: {
            maxHistory: MAX_HISTORY,
            buildTimeoutMs: BUILD_TIMEOUT_MS,
            maxConcurrent: MAX_CONCURRENT_BUILDS
        }
    });
}

function cancelBuild(id, args = {}) {
    const { taskId } = args;
    if (!taskId) {
        return writeError(id, -32602, 'taskId obrigatório');
    }

    const queueIndex = buildQueue.findIndex(b => b.taskId === taskId);
    if (queueIndex !== -1) {
        buildQueue.splice(queueIndex, 1);
        return writeResult(id, { taskId, status: 'cancelled_from_queue' });
    }

    const build = activeBuilds[taskId];
    if (!build || build.finished) {
        return writeError(id, -32602, 'Build não está em andamento ou não existe');
    }

    try {
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', build.proc.pid, '/f', '/t']);
        } else {
            process.kill(-build.proc.pid, 'SIGKILL');
        }
        delete activeBuilds[taskId];
        writeResult(id, { taskId, status: 'cancelled' });
    } catch (err) {
        writeError(id, -32603, `Erro ao cancelar build: ${err.message}`);
    }
}

/* ======================================================
   TOOL DEFINITIONS
   ====================================================== */

const TOOLS = [
    {
        name: 'start_build',
        description: 'Inicia uma build .NET 10 otimizada. Pode ser rápida (fast), incremental ou completa.',
        inputSchema: {
            type: 'object',
            properties: {
                solutionPath: {
                    type: 'string',
                    description: 'Caminho ABSOLUTO para .sln, .slnx, .csproj ou .fsproj.'
                },
                configuration: {
                    type: 'string',
                    enum: ['Debug', 'Release'],
                    default: 'Release',
                    description: 'Configuração da build.'
                },
                fastMode: {
                    type: 'boolean',
                    default: false,
                    description: 'Modo rápido: --no-restore --no-incremental --disable-build-servers'
                },
                incremental: {
                    type: 'boolean',
                    default: false,
                    description: 'Build incremental: --no-restore --use-current-runtime'
                },
                projects: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Projetos específicos para build (caminhos para .csproj). Se vazio, build toda a solução.'
                }
            },
            required: ['solutionPath']
        }
    },
    {
        name: 'check_build',
        description: 'Verifica status de uma build.',
        inputSchema: {
            type: 'object',
            properties: {
                taskId: { type: 'string', description: 'ID retornado por start_build' }
            },
            required: ['taskId']
        }
    },
    {
        name: 'list_builds',
        description: 'Lista as últimas builds do histórico.',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'cancel_build',
        description: 'Cancela uma build em andamento.',
        inputSchema: {
            type: 'object',
            properties: {
                taskId: { type: 'string', description: 'ID da tarefa a cancelar' }
            },
            required: ['taskId']
        }
    },
    {
        name: 'server_status',
        description: 'Retorna status do servidor: conectado, builds ativos, memória, configuração.',
        inputSchema: { type: 'object', properties: {} }
    }
];

/* ======================================================
   PROTOCOL HANDLER
   ====================================================== */

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
});

rl.on('line', async line => {
    if (!line.trim()) return;

    let request;
    try {
        request = JSON.parse(line);
    } catch {
        writeError(null, -32700, 'Parse error');
        return;
    }

    const { id, method, params } = request;

    if (method === 'initialize') {
        // Restaurar builds órfãos no startup
        await loadActiveBuilds();
        writeResult(id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: {
                name: 'dotnet-build-mcp',
                version: '2.1.0'
            }
        });
        return;
    }

    if (method === 'notifications/initialized') {
        return;
    }

    if (method === 'tools/list') {
        writeResult(id, { tools: TOOLS });
        return;
    }

    if (method === 'tools/call') {
        const { name, arguments: args } = params;

        switch (name) {
            case 'start_build':
                await startBuild(id, args);
                break;
            case 'check_build':
                await checkBuild(id, args);
                break;
            case 'list_builds':
                await listBuilds(id);
                break;
            case 'cancel_build':
                cancelBuild(id, args);
                break;
            case 'server_status':
                serverStatus(id);
                break;
            default:
                writeError(id, -32601, `Method not found: ${name}`);
        }
        return;
    }

    writeError(id, -32601, `Method not found: ${method}`);
});

// Tratamento de erros globais (sem encerrar o processo)
process.on('uncaughtException', (err) => {
    console.error('[MCP Error] Uncaught Exception:', err.stack || err.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[MCP Error] Unhandled Rejection at:', promise, 'reason:', reason);
});
