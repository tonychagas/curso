#!/usr/bin/env node

const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const readline = require('readline'); // [FIX] Importação faltante causava crash imediato

/* ======================================================
   CONFIGURAÇÃO
====================================================== */

const MCP_DIR = __dirname;
const LOGS_DIR = path.join(MCP_DIR, 'logs');
const HIST_PATH = path.join(MCP_DIR, 'builds.json');

// Configurável via ENV para flexibilidade
const MAX_HISTORY = parseInt(process.env.MCP_MAX_HISTORY || '5', 10);
const BUILD_TIMEOUT_MS = parseInt(process.env.MCP_BUILD_TIMEOUT_MS || (30 * 60 * 1000).toString(), 10);
const ACTIVE_BUILD_RETENTION_MS = parseInt(process.env.MCP_ACTIVE_BUILD_RETENTION_MS || (5 * 60 * 1000).toString(), 10);

if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const activeBuilds = {};
let historyCache = null;

/* ======================================================
   UTILITÁRIOS
====================================================== */

function generateTaskId() {
    return `build_${Date.now()}_${crypto.randomUUID()}`;
}

function writeResult(id, result) {
    const response = {
        jsonrpc: '2.0',
        id,
        result
    };
    // Garante que a escrita não falhe silenciosamente
    try {
        process.stdout.write(JSON.stringify(response) + '\n');
    } catch (err) {
        console.error('[MCP Fatal] Failed to write result:', err.message);
        process.exit(1);
    }
}

function writeError(id, code, message) {
    try {
        process.stdout.write(
            JSON.stringify({
                jsonrpc: '2.0',
                id,
                error: {
                    code,
                    message
                }
            }) + '\n'
        );
    } catch (err) {
        console.error('[MCP Fatal] Failed to write error:', err.message);
        process.exit(1);
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
    if (historyCache) {
        return historyCache;
    }

    try {
        if (fs.existsSync(HIST_PATH)) {
            const raw = await fsPromises.readFile(HIST_PATH, 'utf8');
            historyCache = JSON.parse(raw);
        } else {
            historyCache = {};
        }
    } catch (err) {
        console.error('[MCP Warning] Failed to load history, starting fresh:', err.message);
        historyCache = {};
    }

    return historyCache;
}

async function saveHistory() {
    // [FIX] Try/Catch adicionado para evitar crash do servidor em erro de I/O
    try {
        const builds = Object.values(historyCache);

        builds.sort(
            (a, b) =>
                new Date(b.startedAt) -
                new Date(a.startedAt)
        );

        if (builds.length > MAX_HISTORY) {
            const remove = builds.slice(MAX_HISTORY);

            for (const build of remove) {
                try {
                    await fsPromises.unlink(build.logPath);
                } catch { }

                delete historyCache[build.taskId];
            }
        }

        const tmp = HIST_PATH + '.tmp';
        
        // Escrita atômica
        await fsPromises.writeFile(
            tmp,
            JSON.stringify(historyCache, null, 2),
            'utf8'
        );
        
        await fsPromises.rename(tmp, HIST_PATH);
    } catch (err) {
        console.error('[MCP Error] Critical failure saving history:', err.message);
        // Não fazemos process.exit aqui para permitir que o servidor continue operando, 
        // mas o histórico pode ficar dessincronizado até o próximo restart.
    }
}

/* ======================================================
   LIMPEZA DE LOGS ÓRFÃOS (Startup)
====================================================== */

(async () => {
    try {
        const files = await fsPromises.readdir(LOGS_DIR);
        const history = await loadHistory();
        
        const validLogs = new Set(
            Object.values(history)
                .map(x => path.basename(x.logPath))
        );

        // Adiciona logs de builds potencialmente ativas (se houver restart rápido)
        // Nota: Em um crash, activeBuilds estará vazio, então confiamos no history para limpeza segura.

        for (const file of files) {
            if (!validLogs.has(file)) {
                try {
                    await fsPromises.unlink(
                        path.join(LOGS_DIR, file)
                    );
                } catch { }
            }
        }
    } catch (err) {
        console.error('[MCP Warning] Startup cleanup failed:', err.message);
    }
})();

/* ======================================================
   TOOL DEFINITIONS
====================================================== */

const TOOLS = [
    {
        name: 'start_build',
        description: 'Inicia uma build .NET assíncrona. Retorna IMEDIATAMENTE um taskId. Use check_build para monitorar.',
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
                    description: 'Configuração da build. Padrão: Release.'
                }
            },
            required: ['solutionPath']
        }
    },
    {
        name: 'check_build',
        description: 'Verifica status de uma build. Retorna status, durationMs e tail do log.',
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
        inputSchema: {
            type: 'object',
            properties: {}
        }
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
    }
];

/* ======================================================
   BUILD LOGIC
====================================================== */

function startBuild(id, args = {}) {
    const {
        solutionPath,
        configuration = 'Release'
    } = args;

    if (!solutionPath) {
        return writeError(id, -32602, 'solutionPath obrigatório');
    }

    // Normaliza caminho para evitar problemas relativos
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
    
    let logStream;
    try {
        logStream = fs.createWriteStream(logPath);
    } catch (err) {
        return writeError(id, -32603, `Falha ao criar log: ${err.message}`);
    }

    const tailBuffer = [];
    const startTime = Date.now();

    const proc = spawn(
        'dotnet',
        ['build', resolvedPath, '-c', configuration],
        {
            cwd: path.dirname(resolvedPath),
            windowsHide: true,
            detached: process.platform !== 'win32'
        }
    );

    // Registra imediatamente
    activeBuilds[taskId] = {
        proc,
        logPath,
        tailBuffer,
        startedAt: new Date().toISOString(),
        finished: false
    };

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
        // [FIX] Limpeza correta em caso de falha de spawn
        delete activeBuilds[taskId];
        logStream.end();
        fsPromises.unlink(logPath).catch(() => {});
        
        writeError(id, -32603, `Falha ao iniciar dotnet: ${err.message}`);
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
                logPath
            };
            await saveHistory();
        } catch (err) {
            console.error(`[MCP Error] History save failed for ${taskId}:`, err.message);
        }

        // Mantém na memória ativa por um curto período
        setTimeout(() => {
            delete activeBuilds[taskId];
        }, ACTIVE_BUILD_RETENTION_MS);
    });

    writeResult(id, {
        content: [{
            type: 'text',
            text: JSON.stringify({
                taskId,
                status: 'running'
            })
        }],
        structuredContent: {
            taskId,
            status: 'running'
        }
    });
}

/* ======================================================
   STATUS & LOGS
====================================================== */

async function checkBuild(id, args = {}) {
    const { taskId } = args;
    const active = activeBuilds[taskId];

    if (active) {
        const currentDurationMs = Date.now() - new Date(active.startedAt).getTime();
        
        return writeResult(id, {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    status: active.finished ? 'succeeded' : 'running',
                    durationMs: currentDurationMs,
                    tail: active.tailBuffer.join('')
                })
            }],
            structuredContent: {
                status: active.finished ? 'succeeded' : 'running',
                durationMs: currentDurationMs,
                tail: active.tailBuffer.join('')
            }
        });
    }

    const history = await loadHistory();
    const build = history[taskId];

    if (!build) {
        return writeError(id, -32602, 'Build não encontrada');
    }

    writeResult(id, {
        content: [{
            type: 'text',
            text: JSON.stringify(build)
        }],
        structuredContent: build
    });
}

/* ======================================================
   LISTAGEM & CANCELAMENTO
====================================================== */

async function listBuilds(id) {
    const history = await loadHistory();
    const list = Object.values(history).sort(
        (a, b) => new Date(b.startedAt) - new Date(a.startedAt)
    );

    writeResult(id, {
        content: [{
            type: 'text',
            text: JSON.stringify(list, null, 2)
        }]
    });
}

function cancelBuild(id, args = {}) {
    const { taskId } = args;
    const build = activeBuilds[taskId];

    if (!build) {
        // Verifica se já finalizou
        loadHistory().then(history => {
            if (history[taskId]) {
                writeError(id, -32602, 'Build já finalizada');
            } else {
                writeError(id, -32602, 'Build não encontrada');
            }
        }).catch(err => {
            writeError(id, -32603, 'Erro ao verificar histórico');
        });
        return;
    }

    try {
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', build.proc.pid, '/f', '/t']);
        } else {
            process.kill(-build.proc.pid, 'SIGKILL');
        }
        
        writeResult(id, {
            content: [{
                type: 'text',
                text: JSON.stringify({ status: 'cancelling' })
            }]
        });

    } catch (err) {
        writeError(id, -32603, `Falha ao cancelar: ${err.message}`);
    }
}

/* ======================================================
   PROTOCOL HANDLER (STDIN)
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
        writeResult(id, {
            protocolVersion: '2024-11-05',
            capabilities: {
                tools: {}
            },
            serverInfo: {
                name: 'dotnet-build-mcp',
                version: '1.2.1' // Versão atualizada com fixes
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
                startBuild(id, args);
                break;
            case 'check_build':
                checkBuild(id, args);
                break;
            case 'list_builds':
                listBuilds(id);
                break;
            case 'cancel_build':
                cancelBuild(id, args);
                break;
            default:
                writeError(id, -32601, `Method not found: ${name}`);
        }
        return;
    }

    writeError(id, -32601, `Method not found: ${method}`);
});

// [FIX] Tratamento de erros não capturados para evitar crash silencioso
process.on('uncaughtException', (err) => {
    console.error('[MCP Fatal] Uncaught Exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[MCP Fatal] Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});
