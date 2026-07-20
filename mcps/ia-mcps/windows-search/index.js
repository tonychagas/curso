#!/usr/bin/env node
'use strict';

/**
 * ============================================================================
 * NODE-SEARCH MCP SERVER - VERSÃO SUPER PERFORMÁTICA
 * ============================================================================
 * 
 * 🔥 NOVIDADES:
 * - search_content → busca conteúdo com findstr/grep (super rápido)
 * - Cache inteligente
 * - Parallel processing com pool de workers
 * - Progresso em tempo real
 * - Otimização de regex
 * 
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// =============================================================================
// CONFIGURAÇÕES DE PERFORMANCE
// =============================================================================

const CONFIG = {
  MAX_FILE_SIZE: 15 * 1024 * 1024,     // 15MB
  MAX_RESULTS: 2000,                   // Máximo de resultados
  MAX_FILES: 1000,                     // Máximo de arquivos por operação
  CONCURRENCY: 16,                     // Arquivos processados em paralelo
  CACHE_TTL: 60000,                    // 1 minuto de cache
  BINARY_EXT: new Set([
    '.dll', '.exe', '.pdb', '.png', '.jpg', '.jpeg', '.gif', '.ico',
    '.zip', '.pfx', '.bmp', '.webp', '.woff', '.woff2', '.ttf', '.eot',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'
  ]),
  IGNORE_DIRS: new Set([
    'bin', 'obj', '.git', 'node_modules', 'dist', '.vs', '.idea',
    'TestResults', 'packages', '__pycache__', '.venv', 'venv', 'env', '.env'
  ])
};

// =============================================================================
// CACHE INTELIGENTE
// =============================================================================

class SmartCache {
  constructor(maxSize = 100, ttl = CONFIG.CACHE_TTL) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttl;
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) { this.misses++; return null; }
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }
    this.hits++;
    return entry.value;
  }

  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  getStats() {
    return { hits: this.hits, misses: this.misses, size: this.cache.size };
  }

  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

const fileCache = new SmartCache(200, 30000);
const searchCache = new SmartCache(50, 10000);

// =============================================================================
// JSON-RPC SERVER (OTIMIZADO)
// =============================================================================

const rlInput = readline.createInterface({ input: process.stdin });
let stdinClosed = false;
let shuttingDown = false;
const queue = [];
let processingQueue = false;

function maybeExit() {
  if ((stdinClosed || shuttingDown) && queue.length === 0 && !processingQueue) {
    process.exit(0);
  }
}

rlInput.on('line', (raw) => {
  if (shuttingDown) return;
  queue.push(raw);
  processQueue();
});

rlInput.on('close', () => {
  stdinClosed = true;
  maybeExit();
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    shuttingDown = true;
    maybeExit();
  });
}

async function processQueue() {
  if (processingQueue) return;
  processingQueue = true;

  while (queue.length > 0) {
    const raw = queue.shift();
    let currentId = null;
    try {
      const parsed = JSON.parse(raw);
      currentId = parsed?.id;
      await handleLine(raw);
    } catch (err) {
      console.error(`[node-search] Erro: ${err?.stack || err}`);
      if (currentId !== null && currentId !== undefined) {
        writeError(currentId, -32603, `Internal error: ${err.message}`);
      }
    }
  }

  processingQueue = false;
  maybeExit();
}

async function handleLine(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch (err) {
    writeError(null, -32700, `Parse error: ${err.message}`);
    return;
  }

  const id = msg.id;
  const method = msg.method;
  const params = msg.params || {};

  if (method === 'initialize') {
    writeResult(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'node-search', version: '6.0.0' }
    });
    return;
  }

  if (method === 'notifications/initialized') return;

  if (method === 'tools/list') {
    writeResult(id, { tools: getToolDefinitions() });
    return;
  }

  if (method === 'tools/call') {
    const toolName = params.name;
    const toolArgs = params.arguments || {};
    try {
      switch (toolName) {
        case 'search_files': await executeSearchFiles(id, toolArgs); break;
        case 'search_content': await executeSearchContent(id, toolArgs); break;
        case 'replace_in_files': await executeReplaceInFiles(id, toolArgs); break;
        case 'read_lines': await executeReadLines(id, toolArgs); break;
        case 'find_files': await executeFindFiles(id, toolArgs); break;
        case 'get_file_info': await executeGetFileInfo(id, toolArgs); break;
        case 'list_directory': await executeListDirectory(id, toolArgs); break;
        case 'generate_labels': await executeGenerateLabels(id, toolArgs); break;
        case 'insert_translations': await executeInsertTranslations(id, toolArgs); break;
        case 'get_translation_context': await executeGetTranslationContext(id, toolArgs); break;
        case 'get_existing_translations': await executeGetExistingTranslations(id, toolArgs); break;
        case 'deduplicate_resx': await executeDeduplicateResx(id, toolArgs); break;
        case 'find_duplicates': await executeFindDuplicates(id, toolArgs); break;
        case 'add_language': await executeAddLanguage(id, toolArgs); break;
        case 'find_symbol': await executeFindSymbol(id, toolArgs); break;
        default: writeToolError(id, `Tool not found: ${toolName}`);
      }
    } catch (err) {
      writeToolError(id, `Erro: ${err.message}`);
    }
    return;
  }

  if (id !== undefined && id !== null) {
    writeError(id, -32601, `Method not found: ${method}`);
  }
}

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

function getToolDefinitions() {
  return [
    {
      name: 'search_content',
      description: '🔍 Busca conteúdo em arquivos usando findstr/grep (SUPER RÁPIDO!). Suporta regex, múltiplos padrões e busca em paralelo.',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Texto ou regex para buscar' },
          path: { type: 'string', description: 'Diretório ou arquivo para buscar' },
          filePattern: { type: 'string', description: 'Extensões separadas por vírgula (ex: .cs,.razor). Default: todos' },
          excludePattern: { type: 'string', description: 'Extensões para excluir (ex: .min.js)' },
          simpleMatch: { type: 'boolean', description: 'Busca literal (não regex). Default: false' },
          caseSensitive: { type: 'boolean', description: 'Case sensitive. Default: false' },
          context: { type: 'number', description: 'Linhas de contexto (0-5). Default: 0' },
          maxResults: { type: 'number', description: 'Máximo de resultados. Default: 500, máx 2000' },
          useFindstr: { type: 'boolean', description: 'Usar findstr (Windows) em vez de leitura manual. Default: true' }
        },
        required: ['pattern', 'path']
      }
    },
    {
      name: 'search_files',
      description: 'Busca padrões em arquivos com auto-detecção de encoding. Suporta múltiplos padrões com "||"',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Padrão (regex ou literal). Use "||" para múltiplos' },
          path: { type: 'string', description: 'Arquivo ou diretório' },
          filePattern: { type: 'string', description: 'Extensões separadas por vírgula' },
          excludePattern: { type: 'string', description: 'Extensões para excluir' },
          simpleMatch: { type: 'boolean', description: 'Busca literal. Default: false' },
          context: { type: 'number', description: 'Linhas de contexto (0-5). Default: 0' },
          caseSensitive: { type: 'boolean', description: 'Case sensitive. Default: false' },
          maxResults: { type: 'number', description: 'Máximo de resultados. Default: 500, máx 2000' }
        },
        required: ['pattern', 'path']
      }
    },
    {
      name: 'replace_in_files',
      description: 'Busca e substitui texto/regex em arquivos. Por padrão dryRun (preview).',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Texto ou regex a buscar' },
          replacement: { type: 'string', description: 'Texto de substituição' },
          path: { type: 'string', description: 'Arquivo ou diretório' },
          filePattern: { type: 'string', description: 'Extensões separadas por vírgula' },
          excludePattern: { type: 'string', description: 'Extensões para excluir' },
          simpleMatch: { type: 'boolean', description: 'Busca literal. Default: false' },
          caseSensitive: { type: 'boolean', description: 'Case sensitive. Default: false' },
          dryRun: { type: 'boolean', description: 'Preview sem alterar. Default: true' },
          maxFiles: { type: 'number', description: 'Máximo de arquivos. Default: 200, máx 1000' },
          backup: { type: 'boolean', description: 'Criar .bak. Default: true' }
        },
        required: ['pattern', 'replacement', 'path']
      }
    },
    {
      name: 'read_lines',
      description: 'Lê intervalo de linhas de um arquivo (streaming)',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Caminho do arquivo' },
          startLine: { type: 'number', description: 'Primeira linha (1-indexed). Default: 1' },
          endLine: { type: 'number', description: 'Última linha. Default: startLine + 49' }
        },
        required: ['path']
      }
    },
    {
      name: 'find_files',
      description: 'Busca arquivos por nome (suporta wildcards)',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Nome ou padrão (ex: *.cs, Program.cs)' },
          path: { type: 'string', description: 'Diretório (default: .)' },
          maxResults: { type: 'number', description: 'Máximo de resultados. Default: 100' },
          caseSensitive: { type: 'boolean', description: 'Case sensitive. Default: false' }
        },
        required: ['pattern']
      }
    },
    {
      name: 'get_file_info',
      description: 'Obtém informações detalhadas de um arquivo',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Caminho do arquivo' },
          includeContent: { type: 'boolean', description: 'Incluir preview. Default: false' }
        },
        required: ['path']
      }
    },
    {
      name: 'list_directory',
      description: 'Lista diretório com estrutura visual (árvore)',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Diretório (default: .)' },
          recursive: { type: 'boolean', description: 'Listar recursivamente. Default: false' },
          maxDepth: { type: 'number', description: 'Profundidade máxima. Default: 3, máx 10' }
        }
      }
    },
    {
      name: 'generate_labels',
      description: 'Escaneia .razor em busca de Loc["Chave"] e gera relatório de traduções',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Diretório dos .razor' },
          dryRun: { type: 'boolean', description: 'Apenas relatório. Default: true' },
          resxPath: { type: 'string', description: 'Pasta dos .resx (opcional)' }
        },
        required: ['path']
      }
    },
    {
      name: 'insert_translations',
      description: 'Insere traduções nos .resx (suporta 1000+ chaves)',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Diretório dos .resx' },
          translations: { type: 'object', description: 'Traduções: { "pt-BR": { "Key": "Valor" } }' },
          dryRun: { type: 'boolean', description: 'Preview. Default: true' },
          backup: { type: 'boolean', description: 'Criar backup. Default: true' }
        },
        required: ['path', 'translations']
      }
    },
    {
      name: 'get_translation_context',
      description: 'Mostra onde cada chave Loc["Chave"] é usada',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Diretório dos .razor' },
          keys: { type: 'array', description: 'Chaves específicas (opcional)', items: { type: 'string' } }
        },
        required: ['path']
      }
    },
    {
      name: 'get_existing_translations',
      description: 'Mostra traduções já existentes nos .resx',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Diretório dos .resx' },
          language: { type: 'string', description: 'Idioma específico (opcional)' },
          keys: { type: 'array', description: 'Chaves específicas (opcional)', items: { type: 'string' } }
        },
        required: ['path']
      }
    },
    {
      name: 'deduplicate_resx',
      description: 'Remove chaves duplicadas em .resx',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Arquivo .resx ou diretório' },
          dryRun: { type: 'boolean', description: 'Preview. Default: true' },
          backup: { type: 'boolean', description: 'Criar backup. Default: true' },
          keepFirst: { type: 'boolean', description: 'Manter primeira ocorrência. Default: true' }
        },
        required: ['path']
      }
    },
    {
      name: 'find_duplicates',
      description: 'Encontra duplicatas em .resx (rápido)',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Diretório dos .resx' },
          filePattern: { type: 'string', description: 'Filtrar arquivos (opcional)' }
        },
        required: ['path']
      }
    },
    {
      name: 'add_language',
      description: 'Adiciona suporte a novo idioma',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Diretório dos .resx' },
          language: { type: 'string', description: 'Código do idioma (ex: fr-FR)' },
          sourceLanguage: { type: 'string', description: 'Idioma fonte (default: pt-BR)' },
          dryRun: { type: 'boolean', description: 'Preview. Default: true' }
        },
        required: ['path', 'language']
      }
    },
    {
      name: 'find_symbol',
      description: '💰 Acha DECLARAÇÃO de classe/método/propriedade em .cs/.razor (não usos). Retorna só arquivo:linha, sem contexto — muito mais barato em tokens que search_content pra localizar onde algo é definido.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nome exato do símbolo (ex: NfeService, EmitirNota)' },
          path: { type: 'string', description: 'Diretório para buscar (default: .)' },
          kind: { type: 'string', enum: ['class', 'method', 'property', 'any'], description: 'Tipo de símbolo. Default: any' },
          maxResults: { type: 'number', description: 'Máximo de resultados. Default: 100' }
        },
        required: ['name']
      }
    }
  ];
}

// =============================================================================
// 🔥 NOVA FUNÇÃO: search_content (USANDO FINDSTR/ GREP)
// =============================================================================

async function executeSearchContent(id, args) {
  const searchPath = args.path || '.';
  const pattern = args.pattern;
  const fileExts = args.filePattern ? args.filePattern.split(',').map(e => e.trim()).filter(Boolean) : null;
  const excludeExts = args.excludePattern ? args.excludePattern.split(',').map(e => e.trim()).filter(Boolean) : null;
  const simpleMatch = args.simpleMatch || false;
  const caseSensitive = args.caseSensitive || false;
  const context = Math.min(args.context || 0, 5);
  const maxResults = Math.min(args.maxResults || 500, CONFIG.MAX_RESULTS);
  const useFindstr = args.useFindstr !== false;

  if (!pattern) {
    return writeToolError(id, '❌ Parâmetro "pattern" é obrigatório.');
  }

  // Verificar se é Windows ou Linux
  const isWindows = process.platform === 'win32';

  try {
    const stat = await fs.promises.stat(searchPath);
    if (!stat.isDirectory()) {
      // Buscar em um único arquivo
      return executeSearchInFile(id, searchPath, pattern, simpleMatch, caseSensitive, context);
    }
  } catch {
    return writeToolError(id, `❌ Caminho não encontrado: ${searchPath}`);
  }

  // Se for Windows e usar findstr, executar via terminal
  if (isWindows && useFindstr) {
    return executeFindstrSearch(id, searchPath, pattern, fileExts, excludeExts, simpleMatch, caseSensitive, context, maxResults);
  }

  // Busca manual (fallback) - paralelizada
  const files = await collectFiles(searchPath, fileExts, excludeExts);
  if (files.length === 0) {
    return writeResult(id, { content: [{ type: 'text', text: `📋 Nenhum arquivo encontrado em ${searchPath}` }] });
  }

  const results = [];
  let totalFound = 0;
  let isTruncated = false;

  const regex = simpleMatch ? new RegExp(escapeRegex(pattern), caseSensitive ? 'g' : 'gi') : new RegExp(pattern, caseSensitive ? 'g' : 'gi');

  await runPool(files, CONFIG.CONCURRENCY, async (filePath) => {
    if (isTruncated || shuttingDown) return;
    if (await isLikelyBinary(filePath)) return;

    let buffer = fileCache.get(filePath);
    if (!buffer) {
      try { buffer = await fs.promises.readFile(filePath); } catch { return; }
      if (buffer.length <= CONFIG.MAX_FILE_SIZE) fileCache.set(filePath, buffer);
    }
    if (buffer.length > CONFIG.MAX_FILE_SIZE) return;

    const { text } = decodeBuffer(buffer);
    const lines = text.split(/\r\n|\r|\n/);

    let lineNum = 0;
    let currentMatch = null;
    let afterContextCount = 0;
    const history = [];

    for (const rawLine of lines) {
      if (isTruncated || shuttingDown) break;
      lineNum++;
      const trimmed = truncateLine(rawLine.trim());

      regex.lastIndex = 0;
      if (regex.test(rawLine)) {
        if (totalFound >= maxResults) {
          isTruncated = true;
          break;
        }
        totalFound++;
        const preContext = context > 0 && history.length > 0 ? ` | before=[${history.join('│')}]` : '';
        currentMatch = {
          text: `${filePath}:${lineNum}:${trimmed}${preContext}`,
          after: []
        };
        results.push(currentMatch);
        afterContextCount = context;
      } else if (afterContextCount > 0 && currentMatch) {
        currentMatch.after.push(trimmed);
        afterContextCount--;
      }

      if (context > 0) {
        history.push(trimmed);
        if (history.length > context) history.shift();
      }
    }
  });

  if (results.length === 0) {
    return writeResult(id, { content: [{ type: 'text', text: `📋 Nenhuma ocorrência de "${pattern}" em ${files.length} arquivo(s)` }] });
  }

  const output = results.map(r => r.text + (r.after.length ? ` | after=[${r.after.join('│')}]` : ''));
  const note = isTruncated ? `\n\n_(Truncado em ${maxResults} resultados. Use filtro mais específico.)_` : '';

  writeResult(id, {
    content: [{
      type: 'text',
      text: `🔍 Encontradas ${totalFound} ocorrência(s) de "${pattern}" em ${searchPath} (${files.length} arquivos)\n\n${output.join('\n')}${note}`
    }]
  });
}

// =============================================================================
// 🔥 BUSCA COM FINDSTR (WINDOWS - SUPER RÁPIDO)
// =============================================================================

async function executeFindstrSearch(id, searchPath, pattern, fileExts, excludeExts, simpleMatch, caseSensitive, context, maxResults) {
  const cwd = process.cwd();
  const relPath = path.relative(cwd, searchPath) || '.';

  // Montar extensões para findstr
  let extFilter = '';
  if (fileExts && fileExts.length > 0) {
    const extPattern = fileExts.map(ext => `*${ext}`).join(' ');
    extFilter = `${extPattern}`;
  } else {
    extFilter = '*.*';
  }

  // Montar comando findstr
  let findstrArgs = '/s /n';
  if (!caseSensitive) findstrArgs += ' /i';
  if (simpleMatch) findstrArgs += ' /c:';
  else findstrArgs += ' /r /c:';

  // Escapar padrão para o findstr
  let escapedPattern = pattern;
  if (!simpleMatch) {
    // findstr usa regex básico, converter caracteres especiais
    escapedPattern = pattern.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  const cmd = `findstr ${findstrArgs}"${escapedPattern}" "${relPath}\\${extFilter}"`;

  try {
    const { stdout, stderr } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
    
    if (stderr && !stderr.includes('File not found')) {
      return writeToolError(id, `❌ Erro findstr: ${stderr}`);
    }

    const lines = stdout.split('\n').filter(Boolean);
    if (lines.length === 0) {
      return writeResult(id, { content: [{ type: 'text', text: `📋 Nenhuma ocorrência de "${pattern}" encontrada.` }] });
    }

    // Limitar resultados
    const truncated = lines.length > maxResults;
    const output = lines.slice(0, maxResults);

    const note = truncated ? `\n\n_(Truncado em ${maxResults} de ${lines.length} resultados. Use filtro mais específico.)_` : '';

    writeResult(id, {
      content: [{
        type: 'text',
        text: `🔍 Encontradas ${lines.length} ocorrência(s) de "${pattern}"\n\n${output.join('\n')}${note}`
      }]
    });
  } catch (err) {
    if (err.code === 1) {
      // findstr retorna 1 quando não encontra nada
      return writeResult(id, { content: [{ type: 'text', text: `📋 Nenhuma ocorrência de "${pattern}" encontrada.` }] });
    }
    return writeToolError(id, `❌ Erro ao executar findstr: ${err.message}`);
  }
}

// =============================================================================
// TOOL: search_files (MELHORADO COM CACHE)
// =============================================================================

async function executeSearchFiles(id, args) {
  const searchPath = args.path || '.';
  const patternStr = args.pattern;
  const fileExts = args.filePattern ? args.filePattern.split(',').map(e => e.trim()).filter(Boolean) : null;
  const excludeExts = args.excludePattern ? args.excludePattern.split(',').map(e => e.trim()).filter(Boolean) : null;
  const simpleMatch = args.simpleMatch || false;
  const contextLines = Math.min(args.context || 0, 5);
  const caseSensitive = args.caseSensitive || false;
  const maxResults = Math.min(args.maxResults || 500, CONFIG.MAX_RESULTS);

  // search_files é um alias de search_content (mesma engine, mesmo formato de saída).
  // Delega direto, com o MESMO id, e aguarda terminar — sem isso a chamada nunca respondia.
  const argsCopy = { ...args };
  if (argsCopy.useFindstr === undefined) argsCopy.useFindstr = process.platform === 'win32';
  await executeSearchContent(id, argsCopy);
}

// =============================================================================
// TOOL: replace_in_files (OTIMIZADO)
// =============================================================================

async function executeReplaceInFiles(id, args) {
  const searchPath = args.path;
  const patternStr = args.pattern;
  const replacement = args.replacement ?? '';

  if (!searchPath || !patternStr) {
    return writeToolError(id, '❌ Parâmetros "path" e "pattern" são obrigatórios.');
  }

  const fileExts = args.filePattern ? args.filePattern.split(',').map(e => e.trim()).filter(Boolean) : null;
  const excludeExts = args.excludePattern ? args.excludePattern.split(',').map(e => e.trim()).filter(Boolean) : null;
  const simpleMatch = args.simpleMatch || false;
  const caseSensitive = args.caseSensitive || false;
  const dryRun = args.dryRun !== false;
  const maxFiles = Math.min(args.maxFiles || 200, CONFIG.MAX_FILES);
  const backup = args.backup !== false;

  let regex;
  try {
    regex = simpleMatch ? new RegExp(escapeRegex(patternStr), caseSensitive ? 'g' : 'gi') : new RegExp(patternStr, caseSensitive ? 'g' : 'gi');
  } catch (err) {
    return writeToolError(id, `❌ Regex inválida: ${err.message}`);
  }

  const fileList = await collectFiles(searchPath, fileExts, excludeExts);
  if (fileList.length === 0) {
    return writeResult(id, { content: [{ type: 'text', text: `📋 Nenhum arquivo encontrado em ${searchPath}` }], isError: true });
  }

  const changes = [];
  let processed = 0;

  await runPool(fileList, CONFIG.CONCURRENCY, async (filePath) => {
    if (processed >= maxFiles || shuttingDown) return;
    if (await isLikelyBinary(filePath)) return;

    let buffer;
    try { buffer = await fs.promises.readFile(filePath); } catch { return; }
    if (buffer.length > CONFIG.MAX_FILE_SIZE) return;

    const { text: original } = decodeBuffer(buffer);
    const matchCount = (original.match(regex) || []).length;
    if (matchCount === 0) return;

    regex.lastIndex = 0;
    const updated = original.replace(regex, replacement);
    if (updated === original) return;

    const { preview, eolNote } = buildDiffPreview(original, updated);
    changes.push({ filePath, matchCount, preview, eolNote, updated, originalBuffer: buffer });
    processed++;
  });

  if (changes.length === 0) {
    return writeResult(id, { content: [{ type: 'text', text: `📋 Nenhuma ocorrência de "${patternStr}" encontrada.` }] });
  }

  if (dryRun) {
    const blocks = changes.map(c =>
      `${c.filePath} (${c.matchCount} ocorrência(s))${c.eolNote}:\n${c.preview}`
    );
    return writeResult(id, {
      content: [{
        type: 'text',
        text: `${changes.length} arquivo(s) com ocorrências:\n\n${blocks.join('\n\n')}\n\n_(DryRun — nenhum arquivo foi alterado. Rode com dryRun:false para aplicar.)_`
      }]
    });
  }

  // Executar substituição
  const results = [];
  await runPool(changes, CONFIG.CONCURRENCY, async (change) => {
    if (shuttingDown) { results.push(`${change.filePath}: SKIPPED`); return; }

    if (backup) {
      const bakResult = await writeBackup(change.filePath, change.originalBuffer);
      if (!bakResult.ok) {
        results.push(`${change.filePath}: ABORT (backup falhou)`);
        return;
      }
    }

    try {
      await fs.promises.writeFile(change.filePath, change.updated, 'utf8');
      results.push(`${change.filePath}: ✅ ${change.matchCount} substituição(ões)`);
    } catch (err) {
      results.push(`${change.filePath}: ❌ ERRO ${err.message}`);
    }
  });

  writeResult(id, {
    content: [{
      type: 'text',
      text: `✅ ${changes.length} arquivo(s) modificado(s):\n\n${results.join('\n')}`
    }]
  });
}

// =============================================================================
// TOOL: read_lines (STREAMING)
// =============================================================================

async function executeReadLines(id, args) {
  const filePath = args.path;
  if (!filePath) return writeToolError(id, '❌ "path" é obrigatório.');

  const startLine = Math.max(1, args.startLine || 1);
  const endLine = args.endLine || (startLine + 49);

  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > CONFIG.MAX_FILE_SIZE) {
      return writeToolError(id, `📋 Arquivo muito grande. Use search_content.`);
    }

    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    const lines = [];
    let lineNum = 0;

    for await (const line of rl) {
      lineNum++;
      if (lineNum >= startLine && lineNum <= endLine) {
        lines.push(`${lineNum}: ${truncateLine(line)}`);
      }
      if (lineNum >= endLine) break;
    }

    if (lines.length === 0) {
      return writeResult(id, { content: [{ type: 'text', text: `📋 Fora do range (${lineNum} linhas)` }] });
    }

    writeResult(id, {
      content: [{ type: 'text', text: `${filePath} — linhas ${startLine}-${Math.min(endLine, lineNum)}:\n\n${lines.join('\n')}` }]
    });
  } catch (err) {
    writeToolError(id, `❌ Erro: ${err.message}`);
  }
}

// =============================================================================
// TOOL: find_files (OTIMIZADO)
// =============================================================================

async function executeFindFiles(id, args) {
  const searchPath = args.path || '.';
  const pattern = args.pattern;
  const maxResults = Math.min(args.maxResults || 100, 1000);
  const caseSensitive = args.caseSensitive || false;

  if (!pattern) return writeToolError(id, '❌ "pattern" é obrigatório.');

  const results = [];
  const hasWildcard = pattern.includes('*') || pattern.includes('?');
  const regexPattern = hasWildcard ? new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, caseSensitive ? '' : 'i') : null;

  await walk(searchPath, null, null, (filePath) => {
    if (results.length >= maxResults || shuttingDown) return;
    const name = path.basename(filePath);
    let match = false;
    if (hasWildcard) {
      match = regexPattern.test(name);
    } else {
      match = caseSensitive ? name.includes(pattern) : name.toLowerCase().includes(pattern.toLowerCase());
    }
    if (match) results.push(filePath);
  });

  const text = results.length === 0
    ? `📋 Nenhum arquivo encontrado com "${pattern}"`
    : `📁 ${results.length} arquivo(s):\n\n${results.join('\n')}${results.length >= maxResults ? `\n\n_(Truncado em ${maxResults})_` : ''}`;

  writeResult(id, { content: [{ type: 'text', text }] });
}

// =============================================================================
// TOOL: find_symbol (busca de DECLARAÇÃO, não de uso — economia de tokens)
// =============================================================================

function buildSymbolPatterns(name) {
  const n = escapeRegex(name);
  const mod = '(?:public|private|protected|internal|static|sealed|abstract|partial|virtual|override|async|readonly|\\s)*';
  return [
    ['class', new RegExp(`\\b${mod}\\b(?:class|interface|struct|record)\\s+${n}\\b`)],
    ['method', new RegExp(`\\b${mod}\\b[\\w<>\\[\\],\\.\\?]+\\s+${n}\\s*\\(`)],
    ['property', new RegExp(`\\b${mod}\\b[\\w<>\\[\\],\\.\\?]+\\s+${n}\\s*\\{\\s*(get|set)?`)]
  ];
}

async function executeFindSymbol(id, args) {
  const name = args.name;
  if (!name) return writeToolError(id, '❌ "name" é obrigatório.');
  const searchPath = args.path || '.';
  const kind = args.kind || 'any';
  const maxResults = Math.min(args.maxResults || 100, 500);

  const allPatterns = buildSymbolPatterns(name).filter(([k]) => kind === 'any' || k === kind);
  const files = await collectFiles(searchPath, ['.cs', '.razor'], null);

  const results = [];
  await runPool(files, CONFIG.CONCURRENCY, async (filePath) => {
    if (results.length >= maxResults || shuttingDown) return;
    let buffer;
    try { buffer = await fs.promises.readFile(filePath); } catch { return; }
    if (buffer.length > CONFIG.MAX_FILE_SIZE) return;
    const { text } = decodeBuffer(buffer);
    const lines = text.split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length && results.length < maxResults; i++) {
      for (const [symbolKind, regex] of allPatterns) {
        if (regex.test(lines[i])) {
          results.push(`${filePath}:${i + 1} [${symbolKind}] ${truncateLine(lines[i].trim())}`);
          break;
        }
      }
    }
  });

  if (results.length === 0) {
    return writeResult(id, { content: [{ type: 'text', text: `📋 Nenhuma declaração de "${name}" encontrada em ${searchPath}` }] });
  }
  const note = results.length >= maxResults ? `\n\n_(Truncado em ${maxResults})_` : '';
  writeResult(id, { content: [{ type: 'text', text: `💰 ${results.length} declaração(ões) de "${name}":\n\n${results.join('\n')}${note}` }] });
}

// =============================================================================
// TOOL: get_file_info
// =============================================================================

async function executeGetFileInfo(id, args) {
  const filePath = args.path;
  if (!filePath) return writeToolError(id, '❌ "path" é obrigatório.');

  try {
    const stat = await fs.promises.stat(filePath);
    const info = {
      path: filePath,
      name: path.basename(filePath),
      ext: path.extname(filePath),
      size: stat.size,
      sizeHuman: formatSize(stat.size),
      modified: stat.mtime.toISOString(),
      created: stat.birthtime.toISOString(),
      isDirectory: stat.isDirectory(),
      isFile: stat.isFile()
    };

    if (args.includeContent && stat.isFile() && stat.size < CONFIG.MAX_FILE_SIZE) {
      const buffer = await fs.promises.readFile(filePath);
      const { encoding } = decodeBuffer(buffer);
      info.encoding = encoding;
      info.preview = buffer.toString('utf8', 0, 500) + (stat.size > 500 ? '...' : '');
    }

    writeResult(id, { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] });
  } catch (err) {
    writeToolError(id, `❌ Erro: ${err.message}`);
  }
}

// =============================================================================
// TOOL: list_directory
// =============================================================================

async function executeListDirectory(id, args) {
  const searchPath = args.path || '.';
  const recursive = args.recursive || false;
  const maxDepth = Math.min(args.maxDepth || 3, 10);

  async function walkDir(dir, depth = 0, prefix = '') {
    if (depth > maxDepth || shuttingDown) return [];
    let dirents;
    try { dirents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return [`${prefix}⚠️ Erro`]; }

    const items = [];
    const sorted = dirents
      .filter(d => !d.name.startsWith('.'))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

    for (const dirent of sorted) {
      if (CONFIG.IGNORE_DIRS.has(dirent.name)) continue;
      const isDir = dirent.isDirectory();
      const icon = isDir ? '📁' : '📄';
      items.push(`${prefix}${icon} ${dirent.name}${isDir ? '/' : ''}`);
      if (isDir && recursive) {
        items.push(...await walkDir(path.join(dir, dirent.name), depth + 1, `${prefix}  `));
      }
    }
    return items;
  }

  const items = await walkDir(searchPath);
  writeResult(id, { content: [{ type: 'text', text: `📂 ${searchPath}\n\n${items.join('\n') || '(vazio)'}` }] });
}

// =============================================================================
// TOOLS DE TRADUÇÃO (RESX) - VERSÃO COMPACTA
// =============================================================================

const RESX_LANGS = ['pt-BR', 'en-US', 'es-ES'];
const LOC_KEY_REGEX = /Loc\[\s*"([^"]*)"\s*\]/g;
const RESX_DATA_NAME_REGEX = /<data\s+name="([^"]*)"/g;

function escapeXml(str) { return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
function unescapeXml(str) { return String(str).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }

function parseResxKeysWithValues(text) {
  const keys = new Map();
  const regex = /<data\s+name="([^"]*)"\s+xml:space="preserve">\s*<value>([^<]*)<\/value>/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    const key = unescapeXml(m[1]);
    const value = unescapeXml(m[2]).trim();
    keys.set(key, { exists: true, hasValue: value.length > 0, value });
  }
  return keys;
}

function buildResxEntries(keys, indent) {
  const lines = [];
  for (const key of keys) {
    const esc = escapeXml(key);
    lines.push(`${indent}<data name="${esc}" xml:space="preserve">`);
    lines.push(`${indent}  <value>${esc}</value>`);
    lines.push(`${indent}</data>`);
  }
  return lines;
}

function createResxTemplate(lang, keys) {
  const indent = '  ';
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<root>',
    `  <resheader name="resmimetype"><value>text/microsoft-resx</value></resheader>`,
    `  <resheader name="version"><value>2.0</value></resheader>`,
    `  <resheader name="reader"><value>System.Resources.ResXResourceReader, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089</value></resheader>`,
    `  <resheader name="writer"><value>System.Resources.ResXResourceWriter, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089</value></resheader>`,
    ...buildResxEntries(keys, indent),
    '</root>'
  ];
  return lines.join('\n');
}

function findDuplicateKeysWithPositions(text) {
  const lines = text.split(/\r\n|\n/);
  const keyPositions = new Map();
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/<data\s+name="([^"]*)"/);
    if (match) {
      const key = unescapeXml(match[1]);
      if (!keyPositions.has(key)) keyPositions.set(key, []);
      keyPositions.get(key).push(i);
    }
  }
  const duplicates = [];
  let total = 0;
  for (const [key, positions] of keyPositions) {
    if (positions.length > 1) { duplicates.push(key); total += positions.length - 1; }
  }
  return { duplicates, totalDuplicateOccurrences: total };
}

function removeDuplicates(text, keepFirst = true) {
  const lines = text.split(/\r\n|\n/);
  const seenKeys = new Set();
  const newLines = [];
  let removed = 0;
  const removedKeys = [];
  for (const line of lines) {
    const match = line.match(/<data\s+name="([^"]*)"/);
    if (match) {
      const key = unescapeXml(match[1]);
      if (seenKeys.has(key)) { removed++; removedKeys.push(key); continue; }
      seenKeys.add(key);
    }
    newLines.push(line);
  }
  return { cleanedText: newLines.join('\n'), removed, removedKeys };
}

function safeInsertKeys(lines, keysToInsert, indent) {
  const existingKeys = new Set();
  for (const line of lines) {
    const match = line.match(/<data\s+name="([^"]*)"/);
    if (match) existingKeys.add(match[1]);
  }
  const insertedKeys = new Set();
  const validKeys = keysToInsert.filter(key => {
    if (existingKeys.has(key) || insertedKeys.has(key)) return false;
    insertedKeys.add(key);
    return true;
  });
  if (validKeys.length === 0) return { lines, inserted: 0, skipped: keysToInsert.length };
  const sortedKeys = validKeys.sort();
  const closeIdx = lines.findIndex(l => l.includes('</root>'));
  if (closeIdx === -1) throw new Error('</root> não encontrado');
  let insertIdx = closeIdx;
  for (let i = closeIdx - 1; i >= 0; i--) {
    const match = lines[i].match(/<data\s+name="([^"]*)"/);
    if (match && match[1] < sortedKeys[0]) { insertIdx = i + 1; break; }
  }
  const entries = buildResxEntries(sortedKeys, indent);
  const result = [...lines];
  result.splice(insertIdx, 0, ...entries);
  return { lines: result, inserted: sortedKeys.length, skipped: keysToInsert.length - sortedKeys.length };
}

async function findResxFolder(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'Resources');
    try {
      const entries = await fs.promises.readdir(candidate);
      if (entries.some(f => /^SharedResources\..+\.resx$/i.test(f))) return candidate;
    } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(path.resolve(startDir), 'Resources');
}

async function extractKeyContext(filePath, text) {
  const lines = text.split(/\r\n|\r|\n/);
  const keys = new Map();
  LOC_KEY_REGEX.lastIndex = 0;
  let m;
  while ((m = LOC_KEY_REGEX.exec(text)) !== null) {
    const key = m[1];
    let lineNum = 0;
    for (const line of lines) {
      lineNum++;
      if (line.includes(`Loc["${key}"]`)) {
        const start = Math.max(0, lineNum - 3);
        const end = Math.min(lines.length, lineNum + 3);
        const snippet = lines.slice(start, end).join('\n');
        keys.set(key, { context: snippet, lineNum, file: filePath });
        break;
      }
    }
  }
  return keys;
}

async function executeGenerateLabels(id, args) {
  const targetPath = args.path;
  if (!targetPath) return writeToolError(id, '❌ "path" é obrigatório.');

  const razorFiles = await collectFiles(targetPath, ['.razor'], null);
  if (razorFiles.length === 0) {
    return writeResult(id, { content: [{ type: 'text', text: `📋 Nenhum .razor em ${targetPath}` }] });
  }

  const allKeys = new Set();
  const keysWithContext = new Map();

  for (const file of razorFiles) {
    let buffer;
    try { buffer = await fs.promises.readFile(file); } catch { continue; }
    if (buffer.length > CONFIG.MAX_FILE_SIZE) continue;
    const { text } = decodeBuffer(buffer);
    LOC_KEY_REGEX.lastIndex = 0;
    let m;
    while ((m = LOC_KEY_REGEX.exec(text)) !== null) {
      if (m[1]) allKeys.add(m[1]);
    }
    const context = await extractKeyContext(file, text);
    for (const [key, info] of context) {
      if (!keysWithContext.has(key)) keysWithContext.set(key, []);
      keysWithContext.get(key).push(info);
    }
  }

  if (allKeys.size === 0) {
    return writeResult(id, { content: [{ type: 'text', text: `📋 Nenhuma Loc["..."] encontrada.` }] });
  }

  const resxBase = args.resxPath ? path.resolve(args.resxPath) : await findResxFolder(targetPath);
  const resxData = {};
  for (const lang of RESX_LANGS) {
    const filePath = path.join(resxBase, `SharedResources.${lang}.resx`);
    try {
      const buffer = await fs.promises.readFile(filePath);
      const { text } = decodeBuffer(buffer);
      resxData[lang] = { exists: true, keys: parseResxKeysWithValues(text), text, filePath };
    } catch {
      resxData[lang] = { exists: false, keys: new Map(), text: '', filePath };
    }
  }

  const missing = {};
  for (const lang of RESX_LANGS) {
    missing[lang] = [];
    const existingKeys = resxData[lang].exists ? new Set(resxData[lang].keys.keys()) : new Set();
    for (const key of allKeys) {
      if (!existingKeys.has(key)) missing[lang].push(key);
    }
  }

  const totalMissing = Object.values(missing).reduce((sum, arr) => sum + arr.length, 0);
  const output = [
    `📋 ${razorFiles.length} .razor escaneados, ${allKeys.size} chaves únicas`,
    `📝 ${totalMissing} chaves pendentes de tradução`,
    `📂 Resx em: ${resxBase}`
  ];

  if (totalMissing > 0) {
    output.push(`\n📝 Traduções pendentes:`);
    for (const lang of RESX_LANGS) {
      if (missing[lang].length > 0) {
        output.push(`  ${lang}: ${missing[lang].length} chaves`);
        output.push(`     ${missing[lang].slice(0, 5).join(', ')}${missing[lang].length > 5 ? ' ...' : ''}`);
      }
    }
  }

  writeResult(id, { content: [{ type: 'text', text: output.join('\n') }] });
}

async function executeInsertTranslations(id, args) {
  const { path: targetPath, translations, dryRun = true, backup = true } = args;
  if (!translations || typeof translations !== 'object') {
    return writeToolError(id, '❌ "translations" é obrigatório.');
  }

  const results = [];
  let totalInserted = 0;

  for (const [lang, keyValues] of Object.entries(translations)) {
    if (!RESX_LANGS.includes(lang)) continue;
    const filePath = path.join(targetPath, `SharedResources.${lang}.resx`);
    let fileExists = false;
    let text = '';
    let buffer = null;
    let keys = new Map();

    try {
      buffer = await fs.promises.readFile(filePath);
      const decoded = decodeBuffer(buffer);
      text = decoded.text;
      keys = parseResxKeysWithValues(text);
      fileExists = true;
    } catch {}

    const newKeys = [];
    const emptyKeys = [];
    const existingKeys = new Set(keys.keys());

    for (const [key, value] of Object.entries(keyValues)) {
      if (!value || value.trim() === '') continue;
      if (existingKeys.has(key)) {
        const info = keys.get(key);
        if (info && (!info.hasValue || info.value.trim() === '')) {
          emptyKeys.push({ key, value });
        }
      } else {
        newKeys.push({ key, value });
      }
    }

    const allKeys = [...newKeys, ...emptyKeys];
    if (allKeys.length === 0) {
      results.push({ lang, status: 'no_changes', message: 'Nenhuma chave nova' });
      continue;
    }

    let newContent = '';
    let inserted = 0;

    if (!fileExists) {
      const keysList = allKeys.map(k => k.key);
      newContent = createResxTemplate(lang, keysList);
      const valueMap = Object.fromEntries(allKeys.map(({ key, value }) => [key, value]));
      for (const [key, value] of Object.entries(valueMap)) {
        const escapedKey = escapeXml(key);
        const escapedValue = escapeXml(value);
        newContent = newContent.replace(`<value>${escapedKey}</value>`, `<value>${escapedValue}</value>`);
      }
      inserted = allKeys.length;
    } else {
      const lines = text.split(/\r\n|\n/);
      const indent = '  ';
      const keysToAdd = allKeys.map(k => k.key);
      const safeResult = safeInsertKeys(lines, keysToAdd, indent);
      inserted = safeResult.inserted;
      newContent = safeResult.lines.join('\n');
      const valueMap = Object.fromEntries(allKeys.map(({ key, value }) => [key, value]));
      for (const [key, value] of Object.entries(valueMap)) {
        const escapedKey = escapeXml(key);
        const escapedValue = escapeXml(value);
        const regex = new RegExp(`<data name="${escapedKey}"[^>]*>\\s*<value>([^<]*)<\\/value>`, 'g');
        newContent = newContent.replace(regex, (match, currentVal) => match.replace(currentVal, escapedValue));
      }
    }

    totalInserted += inserted;
    results.push({ lang, status: 'updated', keysInserted: inserted });

    if (!dryRun) {
      if (backup && buffer) await writeBackup(filePath, buffer);
      await fs.promises.mkdir(targetPath, { recursive: true });
      await fs.promises.writeFile(filePath, newContent, 'utf8');
      results[results.length - 1].written = true;
    }
  }

  writeResult(id, {
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'success',
        summary: { totalInserted, dryRun, details: results }
      }, null, 2)
    }]
  });
}

async function executeGetTranslationContext(id, args) {
  const { path: targetPath, keys: specificKeys } = args;
  const razorFiles = await collectFiles(targetPath, ['.razor'], null);
  const context = {};
  for (const file of razorFiles) {
    let buffer;
    try { buffer = await fs.promises.readFile(file); } catch { continue; }
    const { text } = decodeBuffer(buffer);
    const extracted = await extractKeyContext(file, text);
    for (const [key, info] of extracted) {
      if (specificKeys && !specificKeys.includes(key)) continue;
      if (!context[key]) context[key] = [];
      context[key].push(info);
    }
  }
  writeResult(id, { content: [{ type: 'text', text: JSON.stringify(context, null, 2) }] });
}

async function executeGetExistingTranslations(id, args) {
  const { path: targetPath, language, keys: specificKeys } = args;
  const translations = {};
  const langs = language ? [language] : RESX_LANGS;
  for (const lang of langs) {
    const filePath = path.join(targetPath, `SharedResources.${lang}.resx`);
    try {
      const buffer = await fs.promises.readFile(filePath);
      const { text } = decodeBuffer(buffer);
      const keys = parseResxKeysWithValues(text);
      translations[lang] = {};
      for (const [key, info] of keys) {
        if (specificKeys && !specificKeys.includes(key)) continue;
        if (info.hasValue) translations[lang][key] = info.value;
      }
    } catch {}
  }
  writeResult(id, { content: [{ type: 'text', text: JSON.stringify(translations, null, 2) }] });
}

async function executeDeduplicateResx(id, args) {
  const { path: targetPath, dryRun = true, backup = true, keepFirst = true } = args;
  const files = await collectFiles(targetPath, ['.resx'], null);
  const results = [];
  for (const filePath of files) {
    let buffer;
    try { buffer = await fs.promises.readFile(filePath); } catch { continue; }
    const { text } = decodeBuffer(buffer);
    const dupInfo = findDuplicateKeysWithPositions(text);
    if (dupInfo.duplicates.length === 0) continue;
    if (!dryRun) {
      if (backup) await writeBackup(filePath, buffer);
      const clean = removeDuplicates(text, keepFirst);
      await fs.promises.writeFile(filePath, clean.cleanedText, 'utf8');
      results.push({ file: filePath, removed: clean.removed, keys: clean.removedKeys });
    } else {
      results.push({ file: filePath, duplicates: dupInfo.duplicates, count: dupInfo.totalDuplicateOccurrences, dryRun: true });
    }
  }
  writeResult(id, { content: [{ type: 'text', text: JSON.stringify({ status: 'success', results, dryRun }, null, 2) }] });
}

async function executeFindDuplicates(id, args) {
  const { path: targetPath } = args;
  const files = await collectFiles(targetPath, ['.resx'], null);
  const results = [];
  for (const filePath of files) {
    try {
      const buffer = await fs.promises.readFile(filePath);
      const { text } = decodeBuffer(buffer);
      const dupInfo = findDuplicateKeysWithPositions(text);
      if (dupInfo.duplicates.length > 0) {
        results.push({ file: filePath, duplicates: dupInfo.duplicates, count: dupInfo.totalDuplicateOccurrences });
      }
    } catch {}
  }
  writeResult(id, { content: [{ type: 'text', text: JSON.stringify({ status: 'success', results }, null, 2) }] });
}

async function executeAddLanguage(id, args) {
  const { path: targetPath, language, sourceLanguage = 'pt-BR', dryRun = true } = args;
  if (!/^[a-z]{2}-[A-Z]{2}$/.test(language)) {
    return writeToolError(id, 'Formato inválido. Use: pt-BR, en-US, etc.');
  }
  const filePath = path.join(targetPath, `SharedResources.${language}.resx`);
  try {
    await fs.promises.stat(filePath);
    return writeResult(id, { content: [{ type: 'text', text: `Idioma ${language} já existe` }] });
  } catch {}
  const sourceFilePath = path.join(targetPath, `SharedResources.${sourceLanguage}.resx`);
  let keys = [];
  try {
    const buffer = await fs.promises.readFile(sourceFilePath);
    const { text } = decodeBuffer(buffer);
    const parsed = parseResxKeysWithValues(text);
    for (const [key, info] of parsed) {
      if (info.hasValue) keys.push(key);
    }
  } catch {
    return writeToolError(id, `Idioma fonte ${sourceLanguage} não encontrado`);
  }
  if (!dryRun) {
    const template = createResxTemplate(language, keys);
    await fs.promises.mkdir(targetPath, { recursive: true });
    await fs.promises.writeFile(filePath, template, 'utf8');
  }
  writeResult(id, { content: [{ type: 'text', text: JSON.stringify({ status: dryRun ? 'preview' : 'created', language, keysCount: keys.length, dryRun }, null, 2) }] });
}

// =============================================================================
// HELPERS
// =============================================================================

async function collectFiles(dir, fileExts, excludeExts) {
  const list = [];
  await walk(dir, fileExts, excludeExts, (f) => list.push(f));
  return list;
}

async function walk(dir, fileExts, excludeExts, onFileFound) {
  let dirents;
  try { dirents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const dirent of dirents) {
    if (dirent.isSymbolicLink()) continue;
    const fullPath = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      if (!CONFIG.IGNORE_DIRS.has(dirent.name)) {
        await walk(fullPath, fileExts, excludeExts, onFileFound);
      }
    } else if (dirent.isFile()) {
      let matchesExt = true;
      if (fileExts && fileExts.length > 0) {
        matchesExt = fileExts.some(ext => dirent.name.endsWith(ext));
      }
      let excluded = false;
      if (excludeExts && excludeExts.length > 0) {
        excluded = excludeExts.some(ext => dirent.name.endsWith(ext));
      }
      if (matchesExt && !excluded) {
        onFileFound(fullPath);
      }
    }
  }
}

async function isLikelyBinary(filePath) {
  if (CONFIG.BINARY_EXT.has(path.extname(filePath).toLowerCase())) return true;
  try {
    const buffer = await fs.promises.readFile(filePath, { length: 512 });
    return buffer.includes(0);
  } catch { return true; }
}

function decodeBuffer(buffer, overrideEncoding = null) {
  let encoding = overrideEncoding || 'utf-8';
  let hadBom = false;
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    hadBom = true;
    buffer = buffer.subarray(3);
  }
  return { text: buffer.toString(encoding), encoding, hadBom };
}

function truncateLine(line) {
  return line.length > 500 ? line.slice(0, 500) + '…' : line;
}

function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) { size /= 1024; unitIndex++; }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildDiffPreview(original, updated) {
  const origLines = original.split('\n');
  const newLines = updated.split('\n');
  const diffs = [];
  const len = Math.max(origLines.length, newLines.length);
  for (let i = 0; i < len && i < 15; i++) {
    if (origLines[i] !== newLines[i]) {
      diffs.push(`  L${i+1}: - ${origLines[i] || ''}\n  L${i+1}: + ${newLines[i] || ''}`);
    }
  }
  const hasCRLF = original.includes('\r\n');
  const eolNote = hasCRLF ? ' [CRLF]' : '';
  return { preview: diffs.join('\n'), eolNote };
}

async function writeBackup(filePath, buffer) {
  const bakPath = `${filePath}.bak.${Date.now()}`;
  await fs.promises.writeFile(bakPath, buffer);
  return { ok: true, bakPath };
}

async function runPool(items, limit, worker) {
  if (items.length === 0) return;
  let idx = 0;
  const count = Math.min(Math.max(limit, 1), items.length);
  const workers = Array.from({ length: count }, async () => {
    while (true) {
      if (shuttingDown) return;
      const i = idx++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  });
  await Promise.all(workers);
}

function writeResult(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function writeError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

function writeToolError(id, message) {
  writeResult(id, { content: [{ type: 'text', text: message }], isError: true });
}