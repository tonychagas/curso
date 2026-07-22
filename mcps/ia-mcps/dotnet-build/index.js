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

const MAX_HISTORY = parseInt(process.env.MCP_MAX_HISTORY || '5', 10);
const BUILD_TIMEOUT_MS = parseInt(process.env.MCP_BUILD_TIMEOUT_MS || (30 * 60 * 1000).toString(), 10);
const ACTIVE_BUILD_RETENTION_MS = parseInt(process.env.MCP_ACTIVE_BUILD_RETENTION_MS || (5 * 60 * 1000).toString(), 10);
const MAX_CONCURRENT_BUILDS = parseInt(process.env.MCP_MAX_CONCURRENT_BUILDS || '2', 10);

if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const activeBuilds = {};
const buildQueue = [];
let historyCache = null;

// Cache para referências do Roslyn
const referenceCache = new Map();

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
   HISTÓRICO E LIMPEZA DE LOGS
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
        
        // Remove histórico antigo e limpa os arquivos de log do disco
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
   ANÁLISE RÁPIDA COM ROSLYN (VIA ARQUIVO TEMPORÁRIO)
====================================================== */

async function getCachedReferences(projectPath) {
    if (!projectPath) return [];
    if (referenceCache.has(projectPath)) {
        return referenceCache.get(projectPath);
    }

    const refs = [];
    const projectDir = path.dirname(projectPath);
    const binDir = path.join(projectDir, 'bin', 'Debug', 'net10.0');

    if (fs.existsSync(binDir)) {
        try {
            const dlls = fs.readdirSync(binDir)
                .filter(f => f.endsWith('.dll'))
                .filter(f => {
                    const name = path.basename(f, '.dll');
                    return name.startsWith('Hotline') || 
                           name.startsWith('MudBlazor') ||
                           name.startsWith('Microsoft.') ||
                           name.startsWith('System.') ||
                           name.startsWith('Newtonsoft');
                })
                .map(f => path.join(binDir, f));

            for (const dll of dlls) {
                refs.push(dll);
            }
        } catch (err) {
            console.error('[MCP Warning] Error reading bin directory:', err.message);
        }
    }

    referenceCache.set(projectPath, refs);
    return refs;
}

async function analyzeWithRoslyn(filePath, projectPath) {
    let tempScriptPath = null;
    return new Promise(async (resolve, reject) => {
        let targetPath = filePath;
        const ext = path.extname(filePath).toLowerCase();
        
        if (ext === '.razor' && projectPath) {
            const projectDir = path.dirname(projectPath);
            const fileName = path.basename(filePath);
            
            const candidates = [
                path.join(projectDir, 'obj', 'Debug', 'net10.0', 'generated', 'Microsoft.NET.Sdk.Razor.SourceGenerators', 'Microsoft.NET.Sdk.Razor.SourceGenerators.RazorSourceGenerator', `${fileName}.g.cs`),
                path.join(projectDir, 'obj', 'Debug', 'net10.0', 'Razor', 'Pages', `${fileName}.g.cs`),
                path.join(projectDir, 'obj', 'Debug', 'net10.0', 'Razor', `${fileName}.g.cs`)
            ];
            
            for (const candidate of candidates) {
                if (fs.existsSync(candidate)) {
                    targetPath = candidate;
                    break;
                }
            }
        }

        const scriptContent = `
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

class RoslynAnalyzer {
    public static void Main(string[] args) {
        var filePath = args[0];
        var projPath = args.Length > 1 ? args[1] : null;
        
        if (!File.Exists(filePath)) {
            Console.WriteLine("[]");
            return;
        }

        var code = File.ReadAllText(filePath);
        var tree = CSharpSyntaxTree.ParseText(code);
        var references = new List<MetadataReference>();
        
        try {
            references.Add(MetadataReference.CreateFromFile(typeof(object).Assembly.Location));
            references.Add(MetadataReference.CreateFromFile(typeof(Enumerable).Assembly.Location));
        } catch {}

        if (!string.IsNullOrEmpty(projPath)) {
            var binDir = Path.Combine(Path.GetDirectoryName(projPath), "bin", "Debug", "net10.0");
            if (Directory.Exists(binDir)) {
                var dlls = Directory.GetFiles(binDir, "*.dll")
                    .Where(d => {
                        var name = Path.GetFileName(d);
                        return name.StartsWith("Hotline") || 
                               name.StartsWith("MudBlazor") ||
                               name.StartsWith("Microsoft.") ||
                               name.StartsWith("System.") ||
                               name.StartsWith("Newtonsoft");
                    });
                
                foreach (var dll in dlls) {
                    try { 
                        references.Add(MetadataReference.CreateFromFile(dll)); 
                    } catch {}
                }
            }
        }
        
        var compilation = CSharpCompilation.Create("TempAnalyzer")
            .AddSyntaxTrees(tree)
            .AddReferences(references)
            .WithOptions(new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary)
                .WithOptimizationLevel(OptimizationLevel.Release)
                .WithPlatform(Platform.AnyCpu));
        
        var diagnostics = compilation.GetDiagnostics();
        
        var result = diagnostics
            .Where(d => d.Severity == DiagnosticSeverity.Error || d.Severity == DiagnosticSeverity.Warning)
            .Select(d => new {
                id = d.Id,
                severity = d.Severity.ToString(),
                message = d.GetMessage(),
                line = d.Location.GetLineSpan().StartLinePosition.Line + 1,
                character = d.Location.GetLineSpan().StartLinePosition.Character + 1
            })
            .ToList();
        
        Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(result));
    }
}
`;

        try {
            tempScriptPath = path.join(os.tmpdir(), `roslyn_analyzer_${Date.now()}.csx`);
            await fsPromises.writeFile(tempScriptPath, scriptContent, 'utf8');
        } catch (err) {
            return reject(new Error(`Falha ao criar arquivo de script temporário: ${err.message}`));
        }

        const argsList = [tempScriptPath, targetPath];
        if (projectPath) {
            argsList.push(projectPath);
        }

        const proc = spawn('dotnet-script', argsList, { timeout: 30000 });
        
        let output = '', error = '';

        proc.stdout.on('data', data => output += data.toString());
        proc.stderr.on('data', data => error += data.toString());

        proc.on('close', async code => {
            if (tempScriptPath && fs.existsSync(tempScriptPath)) {
                try { await fsPromises.unlink(tempScriptPath); } catch {}
            }

            if (code !== 0) {
                reject(new Error(error || 'Erro inesperado na análise rápida do Roslyn'));
            } else {
                try {
                    resolve(JSON.parse(output.trim() || '[]'));
                } catch (e) {
                    resolve([]);
                }
            }
        });

        proc.on('error', async err => {
            if (tempScriptPath && fs.existsSync(tempScriptPath)) {
                try { await fsPromises.unlink(tempScriptPath); } catch {}
            }
            reject(new Error(`Falha ao executar dotnet-script: ${err.message}`));
        });
    });
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
        writeResult(id, {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    taskId,
                    status: 'queued',
                    message: `Limite de builds simultâneas atingido (${MAX_CONCURRENT_BUILDS}). Adicionado à fila.`
                })
            }],
            structuredContent: { taskId, status: 'queued' }
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

    writeResult(id, {
        content: [{
            type: 'text',
            text: JSON.stringify({
                taskId,
                status: 'running',
                mode: fastMode ? 'fast' : incremental ? 'incremental' : 'full',
                projects: projects.length > 0 ? projects : 'all'
            })
        }],
        structuredContent: {
            taskId,
            status: 'running',
            mode: fastMode ? 'fast' : incremental ? 'incremental' : 'full'
        }
    });
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
        return writeResult(id, {
            taskId,
            status: active.finished ? (active.exitCode === 0 ? 'succeeded' : 'failed') : 'running',
            durationMs: active.durationMs || (Date.now() - new Date(active.startedAt).getTime()),
            tail: active.tailBuffer.slice(-20)
        });
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
   HANDLER PARA analyze_file
====================================================== */

async function analyzeFile(id, args = {}) {
    const { filePath, projectPath } = args;

    if (!filePath) {
        return writeError(id, -32602, 'filePath obrigatório');
    }

    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
        return writeError(id, -32602, 'Arquivo não encontrado');
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    if (!['.cs', '.razor'].includes(ext)) {
        return writeError(id, -32602, 'Apenas arquivos .cs ou .razor são suportados');
    }

    try {
        if (projectPath && !referenceCache.has(projectPath)) {
            await getCachedReferences(projectPath);
        }

        const startTime = Date.now();
        const diagnostics = await analyzeWithRoslyn(resolvedPath, projectPath);
        const durationMs = Date.now() - startTime;

        writeResult(id, {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    file: resolvedPath,
                    durationMs,
                    errors: diagnostics.filter(d => d.severity === 'Error'),
                    warnings: diagnostics.filter(d => d.severity === 'Warning'),
                    total: diagnostics.length
                }, null, 2)
            }],
            structuredContent: {
                file: resolvedPath,
                durationMs,
                errors: diagnostics.filter(d => d.severity === 'Error'),
                warnings: diagnostics.filter(d => d.severity === 'Warning'),
                total: diagnostics.length
            }
        });
    } catch (err) {
        writeError(id, -32603, `Erro na análise: ${err.message}`);
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
        name: 'analyze_file',
        description: 'ANÁLISE RÁPIDA: Usa Roslyn com cache para analisar .cs ou .razor em milissegundos (SEM BUILD).',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { 
                    type: 'string', 
                    description: 'Caminho ABSOLUTO para o arquivo .cs ou .razor.' 
                },
                projectPath: {
                    type: 'string',
                    description: 'Caminho ABSOLUTO para o .csproj (recomendado para cache e dependências)'
                }
            },
            required: ['filePath']
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
        writeResult(id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: {
                name: 'dotnet-build-mcp',
                version: '2.0.0'
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
            case 'analyze_file':
                await analyzeFile(id, args);
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
