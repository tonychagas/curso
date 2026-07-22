#!/usr/bin/env node

const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const readline = require('readline');

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
let historyPromise = null;
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

function addTail(tailBuffer, line) {
    tailBuffer.push(line);
    if (tailBuffer.length > 100) {
        tailBuffer.shift();
    }
}

function extractCompilerMessages(tailBuffer) {
    const errors = [];
    const warnings = [];

    const errorRegex = /:\s*error\s+([A-Z0-9]+):/i;
    const warningRegex = /:\s*warning\s+([A-Z0-9]+):/i;

    for (const line of tailBuffer) {
        if (errorRegex.test(line) || line.includes(': error ')) {
            errors.push(line.trim());
        } else if (warningRegex.test(line) || line.includes(': warning ')) {
            warnings.push(line.trim());
        }
    }

    return { errors, warnings };
}

/* ======================================================
   HISTÓRICO
   ====================================================== */

async function loadHistory() {
    if (historyCache) return historyCache;
    if (historyPromise) return historyPromise;

    historyPromise = (async () => {
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
        } finally {
            historyPromise = null;
        }
        return historyCache;
    })();

    return historyPromise;
}

async function saveHistory() {
    try {
        const history = await loadHistory();
        const builds = Object.values(history);
        builds.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

        if (builds.length > MAX_HISTORY) {
            const remove = builds.slice(MAX_HISTORY);
            for (const build of remove) {
                if (build.logPath && fs.existsSync(build.logPath)) {
                    try { await fsPromises.unlink(build.logPath); } catch { }
                }
                delete history[build.taskId];
            }
        }

        const tmp = HIST_PATH + '.tmp';
        await fsPromises.writeFile(tmp, JSON.stringify(history, null, 2), 'utf8');
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
                    activeBuilds[taskId] = {
                        ...data,
                        proc: null,
                        finished: true,
                        exitCode: -1,
                        durationMs: Date.now() - new Date(data.startedAt).getTime(),
                        orphaned: true
                    };
                    const history = await loadHistory();
                    history[taskId] = {
                        taskId,
                        solutionPath: 'desconhecido',
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
            await fsPromises.unlink(ACTIVE_PATH).catch(() => {});
        }
    } catch (err) {
        console.error('[MCP Warning] Failed to load active builds:', err.message);
    }
}

function startWatchdog() {
    if (watchdogTimer) return;
    watchdogTimer = setInterval(() => {
        const activeKeys = Object.keys(activeBuilds);
        if (activeKeys.length > 0) {
            saveActiveBuilds();
        } else {
            clearInterval(watchdogTimer);
            watchdogTimer = null;
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
    const { solutionPath, projects = [] } = args;

    if (!solutionPath) {
        return writeError(id, -32602, 'solutionPath é obrigatório.');
    }

    const resolvedPath = path.resolve(solutionPath);
    if (!fs.existsSync(resolvedPath)) {
        return writeError(id, -32602, `Arquivo não encontrado no caminho: ${resolvedPath}`);
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const validExtensions = ['.sln', '.slnx', '.csproj', '.fsproj'];
    if (!validExtensions.includes(ext)) {
        return writeError(id, -32602, 'Extensão de arquivo inválida. Use .sln, .slnx, .csproj ou .fsproj');
    }

    if (projects && Array.isArray(projects)) {
        for (const proj of projects) {
            const resProj = path.resolve(proj);
            const pExt = path.extname(resProj).toLowerCase();
            if (!['.csproj', '.fsproj'].includes(pExt)) {
                return writeError(id, -32602, `Projeto inválido na lista: ${proj}. Use apenas .csproj ou .fsproj`);
            }
        }
    }

    const taskId = generateTaskId();
    const logPath = path.join(LOGS_DIR, `${taskId}.log`);

    const runningCount = Object.values(activeBuilds).filter(b => !b.finished).length;

    if (runningCount >= MAX_CONCURRENT_BUILDS) {
        buildQueue.push({ id, taskId, args, resolvedPath, logPath });
        writeResult(id, { 
            taskId, 
            status: 'queued', 
            message: 'Build adicionada à fila. Aguarde o término das builds ativas.' 
        });
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
        return writeError(id, -32603, `Falha ao criar arquivo de log: ${err.message}`);
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

    startWatchdog();

    const stdoutRl = readline.createInterface({ input: proc.stdout });
    stdoutRl.on('line', line => {
        addTail(tailBuffer, line);
        if (!logStream.destroyed) logStream.write(line + '\n');
    });

    const stderrRl = readline.createInterface({ input: proc.stderr });
    stderrRl.on('line', line => {
        addTail(tailBuffer, line);
        if (!logStream.destroyed) logStream.write(line + '\n');
    });

    proc.on('error', err => {
        delete activeBuilds[taskId];
        if (!logStream.destroyed) logStream.end();
        fsPromises.unlink(logPath).catch(() => {});
        writeError(id, -32603, `Falha ao executar o comando 'dotnet': ${err.message}`);
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

        if (!logStream.destroyed) logStream.end();

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
            console.error(`[MCP Error] Failed to save history for ${taskId}:`, err.message);
        }

        setTimeout(() => {
            delete activeBuilds[taskId];
        }, ACTIVE_BUILD_RETENTION_MS);

        processBuildQueue();
    });

    writeResult(id, { 
        taskId, 
        status: 'running',
        message: 'Build iniciada com sucesso em segundo plano.',
        recommendedPollIntervalMs: 3000
    });
}

/* ======================================================
   HANDLERS AUXILIARES
   ====================================================== */

async function checkBuild(id, args = {}) {
    const { taskId } = args;
    if (!taskId) {
        return writeError(id, -32602, 'taskId é obrigatório.');
    }

    const active = activeBuilds[taskId];
    if (active) {
        const isFinished = active.finished;
        const status = isFinished ? (active.exitCode === 0 ? 'succeeded' : 'failed') : 'running';
        const parsedLogs = extractCompilerMessages(active.tailBuffer);

        const result = {
            taskId,
            status,
            durationMs: active.durationMs || (Date.now() - new Date(active.startedAt).getTime()),
            compilerSummary: {
                errorsCount: parsedLogs.errors.length,
                warningsCount: parsedLogs.warnings.length,
                errors: parsedLogs.errors
            },
            tail: active.tailBuffer.slice(-20)
        };

        if (!isFinished) {
            result.recommendedPollIntervalMs = 3000;
            result.message = 'Build ainda em execução. Aguarde alguns segundos antes de verificar novamente.';
        }

        if (active.orphaned) {
            result.orphaned = true;
            result.message = 'Build órfã (servidor foi reiniciado durante a execução).';
        }

        return writeResult(id, result);
    }

    const inQueue = buildQueue.find(b => b.taskId === taskId);
    if (inQueue) {
        return writeResult(id, { 
            taskId, 
            status: 'queued',
            message: 'Build está na fila de espera.' 
        });
    }

    const history = await loadHistory();
    const past = history[taskId];
    if (past) {
        return writeResult(id, past);
    }

    writeError(id, -32602, `Nenhuma build encontrada com o taskId: ${taskId}`);
}

async function getBuildLog(id, args = {}) {
    const { taskId, maxLines = 100 } = args;
    if (!taskId) {
        return writeError(id, -32602, 'taskId é obrigatório.');
    }

    const history = await loadHistory();
    const build = activeBuilds[taskId] || history[taskId];

    if (!build || !build.logPath) {
        return writeError(id, -32602, `Logs não encontrados para o taskId: ${taskId}`);
    }

    try {
        if (!fs.existsSync(build.logPath)) {
            return writeError(id, -32602, 'O arquivo de log no disco foi excluído ou expirou.');
        }

        const raw = await fsPromises.readFile(build.logPath, 'utf8');
        const lines = raw.split(/\r?\n/);
        const sliced = lines.slice(-maxLines);

        writeResult(id, {
            taskId,
            totalLines: lines.length,
            returnedLines: sliced.length,
            logs: sliced.join('\n')
        });
    } catch (err) {
        writeError(id, -32603, `Erro ao ler o log: ${err.message}`);
    }
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
        uptimeSeconds: Math.round(process.uptime()),
        activeBuildsCount: running.length,
        queuedBuildsCount: buildQueue.length,
        memory: {
            rssMB: Math.round(memUsage.rss / 1024 / 1024),
            heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
            heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024)
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
        return writeError(id, -32602, 'taskId é obrigatório.');
    }

    const queueIndex = buildQueue.findIndex(b => b.taskId === taskId);
    if (queueIndex !== -1) {
        buildQueue.splice(queueIndex, 1);
        return writeResult(id, { taskId, status: 'cancelled_from_queue' });
    }

    const build = activeBuilds[taskId];
    if (!build || build.finished) {
        return writeError(id, -32602, 'Build não está em andamento ou não existe.');
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
        writeError(id, -32603, `Erro ao cancelar a build: ${err.message}`);
    }
}

/* ======================================================
   DEFINIÇÃO DAS FERRAMENTAS
   ====================================================== */

const TOOLS = [
    {
        name: 'start_build',
        description: 'Inicia uma compilação do projeto .NET (.sln, .slnx, .csproj) em segundo plano e retorna um taskId.',
        inputSchema: {
            type: 'object',
            properties: {
                solutionPath: {
                    type: 'string',
                    description: 'Caminho ABSOLUTO e completo para o arquivo .sln, .slnx ou .csproj.'
                },
                configuration: {
                    type: 'string',
                    enum: ['Debug', 'Release'],
                    default: 'Release',
                    description: 'Configuração da compilação.'
                },
                fastMode: {
                    type: 'boolean',
                    default: false,
                    description: 'Ativa modo ultra-rápido: passa --no-restore --no-incremental --disable-build-servers'
                },
                incremental: {
                    type: 'boolean',
                    default: false,
                    description: 'Ativa build incremental: passa --no-restore --use-current-runtime'
                },
                projects: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Lista de caminhos absolutos para .csproj específicos se não quiser compilar a solução inteira.'
                }
            },
            required: ['solutionPath']
        }
    },
    {
        name: 'check_build',
        description: 'Verifica o status de uma tarefa de build em andamento ou concluída, retornando resumo de erros do compilador.',
        inputSchema: {
            type: 'object',
            properties: {
                taskId: { type: 'string', description: 'ID da tarefa retornado por start_build.' }
            },
            required: ['taskId']
        }
    },
    {
        name: 'get_build_log',
        description: 'Obtém as linhas do log detalhado de uma build para analisar erros do compilador .NET.',
        inputSchema: {
            type: 'object',
            properties: {
                taskId: { type: 'string', description: 'ID da tarefa de build.' },
                maxLines: { type: 'number', default: 100, description: 'Quantidade máxima de linhas do final do log a serem retornadas.' }
            },
            required: ['taskId']
        }
    },
    {
        name: 'list_builds',
        description: 'Lista o histórico recente e as compilações ativas/em fila.',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'cancel_build',
        description: 'Cancela imediatamente uma build que esteja executando.',
        inputSchema: {
            type: 'object',
            properties: {
                taskId: { type: 'string', description: 'ID da tarefa a cancelar.' }
            },
            required: ['taskId']
        }
    },
    {
        name: 'server_status',
        description: 'Retorna estatísticas de uso, memória e status de integridade do servidor MCP.',
        inputSchema: { type: 'object', properties: {} }
    }
];

/* ======================================================
   PROTOCOL HANDLER
   ====================================================== */

const rl = readline.createInterface({
    input: process.stdin,
    terminal: false
});

rl.on('line', async line => {
    if (!line.trim()) return;

    let request;
    try {
        request = JSON.parse(line);
    } catch {
        writeError(null, -32700, 'Parse error: JSON inválido.');
        return;
    }

    const { id, method, params } = request;

    if (method === 'initialize') {
        await loadActiveBuilds();
        writeResult(id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: {
                name: 'dotnet-build-mcp',
                version: '2.2.0'
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
        const { name, arguments: args } = params || {};

        switch (name) {
            case 'start_build':
                await startBuild(id, args);
                break;
            case 'check_build':
                await checkBuild(id, args);
                break;
            case 'get_build_log':
                await getBuildLog(id, args);
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
                writeError(id, -32601, `Método não encontrado: ${name}`);
        }
        return;
    }

    writeError(id, -32601, `Método não encontrado: ${method}`);
});

rl.on('close', () => {
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.error('[MCP Error] Uncaught Exception:', err.stack || err.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[MCP Error] Unhandled Rejection:', promise, 'reason:', reason);
});