#!/usr/bin/env node
'use strict';

/**
 * ============================================================================
 * NODE-SEARCH MCP SERVER — VERSÃO SUPER PERFORMÁTICA + COMPACTADORES
 * ============================================================================
 *
 * 🔥 NOVIDADES:
 * - search_content → busca conteúdo com ripgrep (super rápido)
 * - compact_command → executa comandos e retorna saída COMPACTADA (economiza tokens)
 * - TOOL_PROFILE → reduz o número de tools registradas (corta overhead fixo)
 * - write_file, edit_file, create_directory, move_file → substitui o filesystem
 * - find_symbol / get_symbol_source → navegação estrutural
 * - Cache inteligente + validação de path + limite de tamanho
 * - Limpeza automática de backups antigos
 *
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { execFile } = require('child_process');
const execFileAsync = promisify(execFile);
const os = require('os');

// =============================================================================
// PERFIL DE TOOLS (Item 5: reduz o overhead do tools/list)
// =============================================================================

const TOOL_PROFILE = process.env.TOOL_PROFILE || 'full';

const TOOL_PROFILES = {
  // Core: apenas as tools mais usadas
  core: [
    'find_symbol',
    'get_symbol_source',
    'search_content',
    'replace_in_files',
    'write_file',
    'edit_file',
    'read_lines'
  ],
  // Lean: core + arquivos
  lean: [
    'find_symbol',
    'get_symbol_source',
    'search_content',
    'replace_in_files',
    'write_file',
    'edit_file',
    'read_lines',
    'find_files',
    'get_file_info',
    'list_directory',
    'create_directory',
    'move_file'
  ],
  // Full: todas as tools
  full: [
    'find_symbol',
    'get_symbol_source',
    'search_content',
    'replace_in_files',
    'write_file',
    'edit_file',
    'read_lines',
    'find_files',
    'get_file_info',
    'list_directory',
    'create_directory',
    'move_file',
    'search_files',
    'generate_labels',
    'insert_translations',
    'get_translation_context',
    'get_existing_translations',
    'deduplicate_resx',
    'find_duplicates',
    'add_language',
    'compact_command'
  ]
};

const ACTIVE_TOOLS = TOOL_PROFILES[TOOL_PROFILE] || TOOL_PROFILES.full;

// =============================================================================
// DETECÇÃO DO RIPGREP
// =============================================================================

let ripgrepAvailable = null;
async function hasRipgrep() {
  if (ripgrepAvailable !== null) return ripgrepAvailable;
  try {
    await execFileAsync('rg', ['--version']);
    ripgrepAvailable = true;
  } catch {
    ripgrepAvailable = false;
  }
  return ripgrepAvailable;
}

// =============================================================================
// COMPACTADORES DE SAÍDA (Item 4)
// =============================================================================

function compactBuildOutput(output) {
  const lines = output.split('\n');
  const errors = [];
  const warnings = [];
  const errorCodes = new Set();
  const warningCodes = new Set();

  for (const line of lines) {
    // Erros: CS0108, CS8602, etc.
    const errorMatch = line.match(/error\s+(CS\d+)/);
    if (errorMatch) {
      errorCodes.add(errorMatch[1]);
      errors.push(line.trim());
    }
    const warningMatch = line.match(/warning\s+(CS\d+)/);
    if (warningMatch) {
      warningCodes.add(warningMatch[1]);
      warnings.push(line.trim());
    }
  }

  // Extrair arquivos com erro
  const errorFiles = errors.map(l => {
    const match = l.match(/([^:]+\.cs)/);
    return match ? match[1] : 'desconhecido';
  });

  return {
    summary: `Build: ${errors.length} erro(s), ${warnings.length} warning(s)`,
    errors: errors.slice(0, 10),
    errorCount: errors.length,
    errorCodes: [...errorCodes],
    warningCodes: [...warningCodes],
    errorFiles: [...new Set(errorFiles)].slice(0, 5),
    hasErrors: errors.length > 0,
    warningCount: warnings.length
  };
}

function compactGitStatus(output) {
  const lines = output.split('\n').filter(Boolean);
  const modified = lines.filter(l => l.startsWith(' M ') || l.startsWith('M  '));
  const added = lines.filter(l => l.startsWith(' A ') || l.startsWith('A  '));
  const deleted = lines.filter(l => l.startsWith(' D ') || l.startsWith('D  '));
  const untracked = lines.filter(l => l.startsWith('?? '));

  return {
    summary: `Git: ${modified.length} modificado(s), ${added.length} adicionado(s), ${deleted.length} deletado(s), ${untracked.length} não rastreado(s)`,
    modified: modified.map(l => l.replace(/^.{3}/, '').trim()),
    added: added.map(l => l.replace(/^.{3}/, '').trim()),
    deleted: deleted.map(l => l.replace(/^.{3}/, '').trim()),
    untracked: untracked.map(l => l.replace(/^.{3}/, '').trim()),
    hasChanges: modified.length > 0 || added.length > 0 || deleted.length > 0
  };
}

function compactGitDiff(output) {
  const lines = output.split('\n');
  const files = [];
  let currentFile = null;
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    const fileMatch = line.match(/^diff --git a\/(.+?) b\//);
    if (fileMatch) {
      if (currentFile) {
        files.push({ file: currentFile, additions, deletions });
      }
      currentFile = fileMatch[1];
      additions = 0;
      deletions = 0;
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  if (currentFile) {
    files.push({ file: currentFile, additions, deletions });
  }

  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);

  return {
    summary: `${files.length} arquivo(s) alterados, +${totalAdd}/-${totalDel}`,
    files: files.slice(0, 10),
    totalFiles: files.length,
    totalAdditions: totalAdd,
    totalDeletions: totalDel
  };
}

function compactGenericOutput(output, command) {
  const lines = output.split('\n').filter(Boolean);
  const firstLines = lines.slice(0, 5);
  const lastLines = lines.slice(-5);
  const totalLines = lines.length;

  return {
    summary: `Comando executado: ${command} — ${totalLines} linha(s) de saída`,
    preview: firstLines,
    tail: lastLines,
    totalLines: totalLines,
    hasOutput: totalLines > 0
  };
}

function compactOutput(command, stdout, stderr) {
  const fullOutput = stdout + '\n' + stderr;

  // Detectar tipo de comando
  if (command.includes('dotnet build') || command.includes('dotnet test')) {
    return compactBuildOutput(fullOutput);
  }
  if (command.includes('git status')) {
    return compactGitStatus(stdout);
  }
  if (command.includes('git diff')) {
    return compactGitDiff(stdout);
  }
  // Fallback: resumo genérico
  return compactGenericOutput(fullOutput, command);
}

// =============================================================================
// CONFIGURAÇÕES DE PERFORMANCE E SEGURANÇA
// =============================================================================

const CONFIG = {
  MAX_FILE_SIZE: 15 * 1024 * 1024,
  MAX_WRITE_SIZE: 10 * 1024 * 1024,
  MAX_RESULTS: 2000,
  MAX_FILES: 1000,
  MAX_READ_LINES: 1000,
  CONCURRENCY: Math.min(os.cpus().length * 2, 32),
  CACHE_TTL: 60000,
  DIR_CACHE_TTL: 5000,
  BACKUP_MAX_AGE: 7 * 24 * 60 * 60 * 1000,
  BINARY_EXT: new Set([
    '.dll', '.exe', '.pdb', '.png', '.jpg', '.jpeg', '.gif', '.ico',
    '.zip', '.pfx', '.bmp', '.webp', '.woff', '.woff2', '.ttf', '.eot',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'
  ])
};

// =============================================================================
// CONFIG EXTERNA (.mcp-config.json)
// =============================================================================

function loadMcpConfig() {
  const configPath = path.join(__dirname, '.mcp-config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const MCP_CONFIG = loadMcpConfig();
const ALLOWED_ROOTS = (MCP_CONFIG.allowedRoots || []).map(p => path.resolve(p));
const EXTRA_IGNORE_DIRS = new Set((MCP_CONFIG.excludeDirs || []).map(d => d.toLowerCase()));

function wildcardToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}
const EXCLUDE_FILE_PATTERNS = (MCP_CONFIG.excludeFilePatterns || []).map(wildcardToRegex);

const IGNORE_DIRS_LOWER = new Set([...['bin', 'obj', '.git', 'node_modules', 'dist', '.vs', '.idea', 'TestResults', 'packages', '__pycache__', '.venv', 'venv', 'env', '.env']].map(d => d.toLowerCase()));

function isIgnoredDir(name) {
  const lower = name.toLowerCase();
  return IGNORE_DIRS_LOWER.has(lower) || EXTRA_IGNORE_DIRS.has(lower);
}

function isExcludedFile(name) {
  return EXCLUDE_FILE_PATTERNS.some(re => re.test(name));
}

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

class DirCache {
  constructor(ttl = CONFIG.DIR_CACHE_TTL) {
    this.cache = new Map();
    this.ttl = ttl;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  clear() {
    this.cache.clear();
  }
}

const fileCache = new SmartCache(200, 30000);
const searchCache = new SmartCache(50, 10000);
const dirCache = new DirCache();

// =============================================================================
// LOGGER E SEGURANÇA
// =============================================================================

function logOperation(operation, filePath, user = 'cline') {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ${user} ${operation} ${filePath}`);
}

function validatePath(inputPath, baseDir = process.cwd()) {
  const resolved = path.resolve(baseDir, inputPath);
  const normalized = path.normalize(resolved);
  if (ALLOWED_ROOTS.length > 0) {
    const allowed = ALLOWED_ROOTS.some(root => normalized === root || normalized.startsWith(root + path.sep));
    if (!allowed) {
      throw new Error(`Caminho fora das pastas permitidas em .mcp-config.json (allowedRoots): ${normalized}`);
    }
  }
  return normalized;
}

// =============================================================================
// JSON-RPC SERVER
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
      serverInfo: { name: 'node-search', version: '7.0.0' }
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
        case 'write_file': await executeWriteFile(id, toolArgs); break;
        case 'edit_file': await executeEditFile(id, toolArgs); break;
        case 'create_directory': await executeCreateDirectory(id, toolArgs); break;
        case 'move_file': await executeMoveFile(id, toolArgs); break;
        case 'find_symbol': await executeFindSymbol(id, toolArgs); break;
        case 'get_symbol_source': await executeGetSymbolSource(id, toolArgs); break;
        case 'compact_command': await executeCompactCommand(id, toolArgs); break;
        case 'generate_labels': await executeGenerateLabels(id, toolArgs); break;
        case 'insert_translations': await executeInsertTranslations(id, toolArgs); break;
        case 'get_translation_context': await executeGetTranslationContext(id, toolArgs); break;
        case 'get_existing_translations': await executeGetExistingTranslations(id, toolArgs); break;
        case 'deduplicate_resx': await executeDeduplicateResx(id, toolArgs); break;
        case 'find_duplicates': await executeFindDuplicates(id, toolArgs); break;
        case 'add_language': await executeAddLanguage(id, toolArgs); break;
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
// TOOL DEFINITIONS (apenas as tools ativas no perfil)
// =============================================================================

const ALL_TOOL_DEFINITIONS = {
  find_symbol: {
    name: 'find_symbol',
    description: '💰 Busca DECLARAÇÃO de classe/método/propriedade em .cs/.razor.cs (não usos). ⚡ SEMPRE use esta tool ANTES de search_content para localizar onde algo é definido.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome exato do símbolo' },
        path: { type: 'string', description: 'Diretório para buscar (default: .)' },
        kind: { type: 'string', enum: ['class', 'method', 'property', 'constructor', 'field', 'enum', 'any'], description: 'Tipo de símbolo. Default: any' },
        maxResults: { type: 'number', description: 'Máximo de resultados. Default: 100' }
      },
      required: ['name']
    }
  },
  get_symbol_source: {
    name: 'get_symbol_source',
    description: '📖 Retorna o corpo COMPLETO de um símbolo (método, classe, propriedade) em UMA chamada. ⚡ Use DEPOIS de find_symbol.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome exato do símbolo' },
        path: { type: 'string', description: 'Arquivo específico (opcional)' },
        kind: { type: 'string', enum: ['class', 'method', 'property', 'constructor', 'field', 'enum', 'any'], description: 'Tipo de símbolo. Default: any' }
      },
      required: ['name']
    }
  },
  search_content: {
    name: 'search_content',
    description: '🔍 Busca conteúdo em arquivos usando ripgrep (SUPER RÁPIDO!). ⚠️ Use APENAS quando você NÃO sabe o nome exato do símbolo.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Texto ou regex para buscar' },
        path: { type: 'string', description: 'Diretório ou arquivo para buscar' },
        filePattern: { type: 'string', description: 'Extensões separadas por vírgula' },
        excludePattern: { type: 'string', description: 'Extensões para excluir' },
        simpleMatch: { type: 'boolean', description: 'Busca literal (não regex). Default: false' },
        caseSensitive: { type: 'boolean', description: 'Case sensitive. Default: false' },
        context: { type: 'number', description: 'Linhas de contexto (0-5). Default: 0' },
        maxResults: { type: 'number', description: 'Máximo de resultados. Default: 500, máx 2000' }
      },
      required: ['pattern', 'path']
    }
  },
  replace_in_files: {
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
  read_lines: {
    name: 'read_lines',
    description: 'Lê intervalo de linhas de um arquivo (streaming) — máximo 1000 linhas.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho do arquivo' },
        startLine: { type: 'number', description: 'Primeira linha (1-indexed). Default: 1' },
        endLine: { type: 'number', description: 'Última linha. Default: startLine + 49. Máx 1000.' }
      },
      required: ['path']
    }
  },
  find_files: {
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
  get_file_info: {
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
  list_directory: {
    name: 'list_directory',
    description: 'Lista diretório com estrutura visual (árvore) — cache de 5s para repetições.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Diretório (default: .)' },
        recursive: { type: 'boolean', description: 'Listar recursivamente. Default: false' },
        maxDepth: { type: 'number', description: 'Profundidade máxima. Default: 3, máx 10' }
      }
    }
  },
  write_file: {
    name: 'write_file',
    description: '📝 Cria ou sobrescreve um arquivo com o conteúdo especificado. Máx 10MB.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho do arquivo' },
        content: { type: 'string', description: 'Conteúdo a escrever' },
        encoding: { type: 'string', description: 'Encoding (default: utf-8)' },
        createDirs: { type: 'boolean', description: 'Criar diretórios se não existirem (default: true)' },
        overwrite: { type: 'boolean', description: 'Sobrescrever se existir (default: true)' },
        backup: { type: 'boolean', description: 'Fazer backup antes de sobrescrever (default: true)' }
      },
      required: ['path', 'content']
    }
  },
  edit_file: {
    name: 'edit_file',
    description: '✏️ Edita um arquivo com preview de diff antes de aplicar. Backup automático.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho do arquivo' },
        content: { type: 'string', description: 'Novo conteúdo' },
        dryRun: { type: 'boolean', description: 'Apenas preview (default: true)' },
        backup: { type: 'boolean', description: 'Criar backup (default: true)' }
      },
      required: ['path', 'content']
    }
  },
  create_directory: {
    name: 'create_directory',
    description: '📁 Cria um diretório (e subdiretórios se necessário).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho do diretório' },
        recursive: { type: 'boolean', description: 'Criar recursivamente (default: true)' }
      },
      required: ['path']
    }
  },
  move_file: {
    name: 'move_file',
    description: '📦 Move ou renomeia um arquivo com segurança (backup e overwrite controlado).',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Caminho do arquivo de origem' },
        destination: { type: 'string', description: 'Caminho de destino' },
        overwrite: { type: 'boolean', description: 'Sobrescrever se existir (default: true)' },
        backup: { type: 'boolean', description: 'Criar backup do destino (default: true)' }
      },
      required: ['source', 'destination']
    }
  },
  compact_command: {
    name: 'compact_command',
    description: '⚡ Executa um comando e retorna a saída COMPACTADA (resumida). Economiza ~90% de tokens em comandos longos como dotnet build, git diff, git status. Use SEMPRE para comandos que produzem saída longa.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Comando a executar (ex: dotnet build, git diff, git status)' },
        args: { type: 'string', description: 'Argumentos do comando (opcional)' },
        cwd: { type: 'string', description: 'Diretório de trabalho (default: .)' }
      },
      required: ['command']
    }
  },
  search_files: {
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
  generate_labels: {
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
  insert_translations: {
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
  get_translation_context: {
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
  get_existing_translations: {
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
  deduplicate_resx: {
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
  find_duplicates: {
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
  add_language: {
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
  }
};

function getToolDefinitions() {
  return ACTIVE_TOOLS.map(name => ALL_TOOL_DEFINITIONS[name]).filter(Boolean);
}

// =============================================================================
// FUNÇÃO: search_content (COM RIPGREP)
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

  if (!pattern) {
    return writeToolError(id, '❌ Parâmetro "pattern" é obrigatório.');
  }

  try {
    const stat = await fs.promises.stat(searchPath);
    if (!stat.isDirectory()) {
      return executeSearchInFile(id, searchPath, pattern, simpleMatch, caseSensitive, context);
    }
  } catch {
    return writeToolError(id, `❌ Caminho não encontrado: ${searchPath}`);
  }

  if (await hasRipgrep()) {
    return executeRipgrepSearch(id, searchPath, pattern, fileExts, excludeExts, simpleMatch, caseSensitive, context, maxResults);
  }

  const safePath = validatePath(searchPath);
  const files = await collectFiles(safePath, fileExts, excludeExts);
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
// RIPGREP SEARCH (COM AGRUPAMENTO)
// =============================================================================

async function executeRipgrepSearch(id, searchPath, pattern, fileExts, excludeExts, simpleMatch, caseSensitive, context, maxResults) {
  const rgArgs = ['--line-number', '--no-heading', '--color=never'];
  if (!caseSensitive) rgArgs.push('-i');
  if (simpleMatch) rgArgs.push('-F');
  if (context > 0) rgArgs.push('-C', String(context));
  if (fileExts) for (const ext of fileExts) rgArgs.push('-g', `*${ext}`);
  if (excludeExts) for (const ext of excludeExts) rgArgs.push('-g', `!*${ext}`);
  for (const dir of IGNORE_DIRS_LOWER) rgArgs.push('-g', `!${dir}/**`);
  for (const dir of EXTRA_IGNORE_DIRS) rgArgs.push('-g', `!${dir}/**`);
  rgArgs.push('-m', String(maxResults), '--', pattern, searchPath);

  try {
    const { stdout } = await execFileAsync('rg', rgArgs, { maxBuffer: 20 * 1024 * 1024 });
    const lines = stdout.split('\n').filter(Boolean);

    const grouped = new Map();
    for (const line of lines) {
      const firstColon = line.indexOf(':');
      if (firstColon === -1) continue;
      const file = line.substring(0, firstColon);
      const rest = line.substring(firstColon + 1);
      if (!grouped.has(file)) grouped.set(file, []);
      grouped.get(file).push(rest);
    }

    const output = [];
    let total = 0;
    for (const [file, matches] of grouped) {
      total += matches.length;
      const preview = matches.slice(0, 3).map(m => `  ${m}`).join('\n');
      const more = matches.length > 3 ? `\n  ... +${matches.length - 3} mais` : '';
      output.push(`📄 ${file} (${matches.length} ocorrência(s)):\n${preview}${more}`);
    }

    const truncated = lines.length > maxResults;
    const note = truncated ? `\n\n_(Truncado em ${maxResults} de ${total} resultados. Use filtro mais específico.)_` : '';

    writeResult(id, {
      content: [{
        type: 'text',
        text: `🔍⚡ Encontradas ${total} ocorrência(s) de "${pattern}" (ripgrep)\n\n${output.join('\n\n')}${note}`
      }]
    });
  } catch (err) {
    if (err.code === 1) {
      return writeResult(id, { content: [{ type: 'text', text: `📋 Nenhuma ocorrência de "${pattern}" encontrada.` }] });
    }
    return writeToolError(id, `❌ Erro ao executar ripgrep: ${err.message}`);
  }
}

// =============================================================================
// TOOL: search_files (alias)
// =============================================================================

async function executeSearchFiles(id, args) {
  const argsCopy = { ...args };
  await executeSearchContent(id, argsCopy);
}

// =============================================================================
// TOOL: compact_command (compacta saída de comandos — Item 4)
// =============================================================================

async function executeCompactCommand(id, args) {
  const command = args.command;
  const cmdArgs = args.args || '';
  const cwd = args.cwd || process.cwd();

  if (!command) {
    return writeToolError(id, '❌ "command" é obrigatório.');
  }

  const fullCommand = `${command} ${cmdArgs}`.trim();

  try {
    logOperation('compact_command', fullCommand);
    const { stdout, stderr } = await execAsync(fullCommand, { cwd, maxBuffer: 10 * 1024 * 1024 });
    const compacted = compactOutput(command, stdout, stderr);

    writeResult(id, {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'success',
          command: fullCommand,
          cwd: cwd,
          ...compacted
        }, null, 2)
      }]
    });
  } catch (err) {
    // Mesmo com erro, tentar compactar a saída
    const output = err.stdout || err.stderr || err.message || '';
    const compacted = compactOutput(command, output, '');

    writeResult(id, {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'error',
          command: fullCommand,
          cwd: cwd,
          exitCode: err.code || 1,
          ...compacted
        }, null, 2)
      }]
    });
  }
}

// =============================================================================
// TOOL: replace_in_files
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

  const safePath = validatePath(searchPath);
  const fileList = await collectFiles(safePath, fileExts, excludeExts);
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
// TOOL: read_lines
// =============================================================================

async function executeReadLines(id, args) {
  const filePath = args.path;
  if (!filePath) return writeToolError(id, '❌ "path" é obrigatório.');

  const startLine = Math.max(1, args.startLine || 1);
  let endLine = args.endLine || (startLine + 49);

  if (endLine - startLine > CONFIG.MAX_READ_LINES) {
    return writeToolError(id, `❌ Máximo de ${CONFIG.MAX_READ_LINES} linhas por vez.`);
  }

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
      content: [{
        type: 'text',
        text: `${filePath} — linhas ${startLine}-${Math.min(endLine, lineNum)}:\n\n${lines.join('\n')}`
      }]
    });
  } catch (err) {
    writeToolError(id, `❌ Erro: ${err.message}`);
  }
}

// =============================================================================
// TOOL: find_files
// =============================================================================

async function executeFindFiles(id, args) {
  const searchPath = args.path || '.';
  const pattern = args.pattern;
  const maxResults = Math.min(args.maxResults || 100, 1000);
  const caseSensitive = args.caseSensitive || false;

  if (!pattern) return writeToolError(id, '❌ "pattern" é obrigatório.');

  const safePath = validatePath(searchPath);
  const results = [];
  const hasWildcard = pattern.includes('*') || pattern.includes('?');
  const regexPattern = hasWildcard ? new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, caseSensitive ? '' : 'i') : null;

  await walk(safePath, null, null, (filePath) => {
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
// TOOL: find_symbol
// =============================================================================

function buildSymbolPatterns(name) {
  const n = escapeRegex(name);
  const mod = '(?:public|private|protected|internal|static|sealed|abstract|partial|virtual|override|async|readonly|\\s)*';
  return [
    ['class', new RegExp(`\\b${mod}\\b(?:class|interface|struct|record)\\s+${n}\\b`, 'i')],
    ['method', new RegExp(`\\b${mod}\\b(?:async\\s+)?(?:Task|void|\\w+)\\s+${n}\\s*\\(`, 'i')],
    ['property', new RegExp(`\\b${mod}\\b(?:\\w+)\\s+${n}\\s*\\{\\s*(?:get|set)?`, 'i')],
    ['constructor', new RegExp(`\\b(?:public|private|protected|internal)\\s+${n}\\s*\\(`, 'i')],
    ['field', new RegExp(`\\b(?:public|private|protected|internal|readonly)\\s+\\w+\\s+${n}\\s*(?:;|=)`, 'i')],
    ['enum', new RegExp(`\\benum\\s+${n}\\b`, 'i')]
  ];
}

async function executeFindSymbol(id, args) {
  const name = args.name;
  if (!name) return writeToolError(id, '❌ "name" é obrigatório.');
  const searchPath = args.path || '.';
  const kind = args.kind || 'any';
  const maxResults = Math.min(args.maxResults || 100, 500);

  const safePath = validatePath(searchPath);

  const files = await collectFiles(safePath, ['.cs', '.razor.cs', '.razor'], null);

  const relevantFiles = [];
  await runPool(files, CONFIG.CONCURRENCY, async (filePath) => {
    try {
      const buffer = await fs.promises.readFile(filePath);
      const { text } = decodeBuffer(buffer);
      if (text.toLowerCase().includes(name.toLowerCase())) {
        relevantFiles.push(filePath);
      }
    } catch {}
  });

  const allPatterns = buildSymbolPatterns(name).filter(([k]) => kind === 'any' || k === kind);
  const results = [];

  await runPool(relevantFiles, CONFIG.CONCURRENCY, async (filePath) => {
    if (results.length >= maxResults || shuttingDown) return;
    let buffer;
    try { buffer = await fs.promises.readFile(filePath); } catch { return; }
    if (buffer.length > CONFIG.MAX_FILE_SIZE) return;
    const { text } = decodeBuffer(buffer);
    const lines = text.split(/\r\n|\r|\n/);

    for (let i = 0; i < lines.length && results.length < maxResults; i++) {
      const line = lines[i];
      if (line.trim().startsWith('//') || line.trim().startsWith('/*')) continue;

      for (const [symbolKind, regex] of allPatterns) {
        if (regex.test(line)) {
          let fullText = line.trim();
          if (symbolKind === 'method' && line.includes('(') && !line.includes(')')) {
            let j = i + 1;
            let methodText = line;
            while (j < lines.length && !lines[j].includes(')')) {
              methodText += '\n' + lines[j];
              j++;
            }
            if (j < lines.length) methodText += '\n' + lines[j];
            fullText = methodText.trim();
          }
          results.push({
            file: filePath,
            line: i + 1,
            kind: symbolKind,
            text: truncateLine(fullText)
          });
          break;
        }
      }
    }
  });

  if (results.length === 0) {
    return writeResult(id, { content: [{ type: 'text', text: `📋 Nenhuma declaração de "${name}" encontrada em ${searchPath} (${relevantFiles.length} arquivos verificados)` }] });
  }

  const output = results.map(r => `${r.file}:${r.line} [${r.kind}] ${r.text}`);
  const note = results.length >= maxResults ? `\n\n_(Truncado em ${maxResults})_` : '';

  writeResult(id, {
    content: [{
      type: 'text',
      text: `💰 ${results.length} declaração(ões) de "${name}" (${relevantFiles.length} arquivos verificados):\n\n${output.join('\n')}${note}`
    }]
  });
}

// =============================================================================
// TOOL: get_symbol_source
// =============================================================================

async function executeGetSymbolSource(id, args) {
  const symbolName = args.name;
  if (!symbolName) return writeToolError(id, '❌ "name" é obrigatório.');
  const searchPath = args.path || '.';
  const kind = args.kind || 'any';

  const safePath = validatePath(searchPath);

  let filesToSearch;
  try {
    const stat = await fs.promises.stat(safePath);
    if (stat.isFile()) {
      filesToSearch = [safePath];
    } else {
      filesToSearch = await collectFiles(safePath, ['.cs', '.razor.cs', '.razor'], null);
    }
  } catch {
    filesToSearch = await collectFiles(safePath, ['.cs', '.razor.cs', '.razor'], null);
  }

  const allPatterns = buildSymbolPatterns(symbolName).filter(([k]) => kind === 'any' || k === kind);

  for (const filePath of filesToSearch) {
    let buffer;
    try { buffer = await fs.promises.readFile(filePath); } catch { continue; }
    if (buffer.length > CONFIG.MAX_FILE_SIZE) continue;
    const { text } = decodeBuffer(buffer);
    const lines = text.split(/\r\n|\r|\n/);

    let startLine = -1;
    let endLine = -1;
    let symbolKind = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const [kind, regex] of allPatterns) {
        if (regex.test(line)) {
          startLine = i;
          symbolKind = kind;
          if (kind === 'method' || kind === 'class' || kind === 'property') {
            let braceCount = 0;
            let foundBrace = false;
            for (let j = i; j < lines.length; j++) {
              const current = lines[j];
              const openBraces = (current.match(/{/g) || []).length;
              const closeBraces = (current.match(/}/g) || []).length;
              braceCount += openBraces - closeBraces;
              if (openBraces > 0) foundBrace = true;
              if (foundBrace && braceCount === 0) {
                endLine = j;
                break;
              }
            }
            if (endLine === -1) endLine = i + 10;
          } else {
            endLine = i;
          }
          break;
        }
      }
      if (startLine !== -1) break;
    }

    if (startLine !== -1) {
      const source = lines.slice(startLine, endLine + 1).join('\n');
      return writeResult(id, {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'success',
            symbol: symbolName,
            kind: symbolKind,
            file: filePath,
            startLine: startLine + 1,
            endLine: endLine + 1,
            lines: endLine - startLine + 1,
            source: source
          }, null, 2)
        }]
      });
    }
  }

  return writeResult(id, {
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'not_found',
        symbol: symbolName,
        message: `❌ Símbolo "${symbolName}" não encontrado em ${searchPath}`
      }, null, 2)
    }]
  });
}

// =============================================================================
// TOOL: get_file_info
// =============================================================================

async function executeGetFileInfo(id, args) {
  const filePath = args.path;
  if (!filePath) return writeToolError(id, '❌ "path" é obrigatório.');

  const safePath = validatePath(filePath);
  try {
    const stat = await fs.promises.stat(safePath);
    const info = {
      path: safePath,
      name: path.basename(safePath),
      ext: path.extname(safePath),
      size: stat.size,
      sizeHuman: formatSize(stat.size),
      modified: stat.mtime.toISOString(),
      created: stat.birthtime.toISOString(),
      isDirectory: stat.isDirectory(),
      isFile: stat.isFile()
    };

    if (args.includeContent && stat.isFile() && stat.size < CONFIG.MAX_FILE_SIZE) {
      const buffer = await fs.promises.readFile(safePath);
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

  const safePath = validatePath(searchPath);
  const cacheKey = `${safePath}:${recursive}:${maxDepth}`;
  const cached = dirCache.get(cacheKey);
  if (cached) {
    return writeResult(id, { content: [{ type: 'text', text: `📂 ${searchPath} (cached)\n\n${cached}` }] });
  }

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
      if (isIgnoredDir(dirent.name)) continue;
      const isDir = dirent.isDirectory();
      const icon = isDir ? '📁' : '📄';
      items.push(`${prefix}${icon} ${dirent.name}${isDir ? '/' : ''}`);
      if (isDir && recursive) {
        items.push(...await walkDir(path.join(dir, dirent.name), depth + 1, `${prefix}  `));
      }
    }
    return items;
  }

  const items = await walkDir(safePath);
  const result = items.join('\n') || '(vazio)';
  dirCache.set(cacheKey, result);

  writeResult(id, { content: [{ type: 'text', text: `📂 ${searchPath}\n\n${result}` }] });
}

// =============================================================================
// TOOL: write_file
// =============================================================================

async function executeWriteFile(id, args) {
  const filePath = args.path;
  const content = args.content;
  const encoding = args.encoding || 'utf8';
  const createDirs = args.createDirs !== false;
  const overwrite = args.overwrite !== false;
  const backup = args.backup !== false;

  if (!filePath) return writeToolError(id, '❌ "path" é obrigatório.');
  if (content === undefined) return writeToolError(id, '❌ "content" é obrigatório.');

  const size = Buffer.byteLength(content, encoding);
  if (size > CONFIG.MAX_WRITE_SIZE) {
    return writeToolError(id, `❌ Arquivo muito grande: ${formatSize(size)}. Máximo: ${formatSize(CONFIG.MAX_WRITE_SIZE)}`);
  }

  const safePath = validatePath(filePath);
  logOperation('write_file', safePath);

  try {
    let existingBuffer = null;
    try {
      existingBuffer = await fs.promises.readFile(safePath);
    } catch {}

    if (existingBuffer && !overwrite) {
      return writeToolError(id, `❌ Arquivo já existe: ${safePath}. Use overwrite:true para sobrescrever.`);
    }

    let backupPath = null;
    if (existingBuffer && backup) {
      const result = await writeBackup(safePath, existingBuffer);
      if (!result.ok) {
        return writeToolError(id, `❌ Falha no backup (arquivo existente não foi tocado): ${result.error.message}`);
      }
      backupPath = result.bakPath;
    }

    if (createDirs) {
      const dir = path.dirname(safePath);
      await fs.promises.mkdir(dir, { recursive: true });
    }

    await fs.promises.writeFile(safePath, content, encoding);
    const stat = await fs.promises.stat(safePath);
    cleanOldBackups(path.dirname(safePath)).catch(() => {});

    writeResult(id, {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'success',
          path: safePath,
          size: stat.size,
          backup: backupPath,
          message: `✅ Arquivo escrito com sucesso: ${safePath} (${formatSize(stat.size)})${backupPath ? ` (backup: ${backupPath})` : ''}`
        }, null, 2)
      }]
    });
  } catch (err) {
    writeToolError(id, `❌ Erro ao escrever arquivo: ${err.message}`);
  }
}

// =============================================================================
// TOOL: edit_file
// =============================================================================

async function executeEditFile(id, args) {
  const filePath = args.path;
  const newContent = args.content;
  const dryRun = args.dryRun !== false;
  const backup = args.backup !== false;

  if (!filePath) return writeToolError(id, '❌ "path" é obrigatório.');
  if (newContent === undefined) return writeToolError(id, '❌ "content" é obrigatório.');

  const safePath = validatePath(filePath);
  logOperation('edit_file', safePath);

  try {
    let originalContent = '';
    let exists = true;
    let originalBuffer = null;
    try {
      originalBuffer = await fs.promises.readFile(safePath);
      originalContent = originalBuffer.toString('utf8');
    } catch {
      exists = false;
      originalContent = '';
    }

    if (!exists && dryRun) {
      return writeResult(id, {
        content: [{
          type: 'text',
          text: `📋 Arquivo não existe: ${safePath}\n\n_(DryRun — seria criado com o novo conteúdo.)_`
        }]
      });
    }

    const diff = buildDiffPreview(originalContent, newContent);

    if (dryRun) {
      return writeResult(id, {
        content: [{
          type: 'text',
          text: `📋 Preview de edição: ${safePath}\n\n${diff.preview}\n\n_(DryRun — nenhuma alteração foi aplicada. Rode com dryRun:false para aplicar.)_`
        }]
      });
    }

    let backupPath = null;
    if (backup && exists && originalBuffer) {
      const result = await writeBackup(safePath, originalBuffer);
      if (!result.ok) {
        return writeToolError(id, `❌ Falha no backup: ${result.error.message}`);
      }
      backupPath = result.bakPath;
    }

    await fs.promises.writeFile(safePath, newContent, 'utf8');

    cleanOldBackups(path.dirname(safePath)).catch(() => {});

    writeResult(id, {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'success',
          path: safePath,
          backup: backupPath,
          diff: diff.preview,
          message: `✅ Arquivo editado com sucesso: ${safePath}${backupPath ? ` (backup: ${backupPath})` : ''}`
        }, null, 2)
      }]
    });
  } catch (err) {
    writeToolError(id, `❌ Erro ao editar arquivo: ${err.message}`);
  }
}

// =============================================================================
// TOOL: create_directory
// =============================================================================

async function executeCreateDirectory(id, args) {
  const dirPath = args.path;
  const recursive = args.recursive !== false;

  if (!dirPath) return writeToolError(id, '❌ "path" é obrigatório.');

  const safePath = validatePath(dirPath);
  logOperation('create_directory', safePath);

  try {
    try {
      const stat = await fs.promises.stat(safePath);
      if (stat.isDirectory()) {
        return writeResult(id, {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'exists',
              path: safePath,
              message: `📁 Diretório já existe: ${safePath}`
            }, null, 2)
          }]
        });
      }
    } catch {}

    await fs.promises.mkdir(safePath, { recursive });
    const stat = await fs.promises.stat(safePath);

    writeResult(id, {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'success',
          path: safePath,
          message: `✅ Diretório criado com sucesso: ${safePath}`
        }, null, 2)
      }]
    });
  } catch (err) {
    writeToolError(id, `❌ Erro ao criar diretório: ${err.message}`);
  }
}

// =============================================================================
// TOOL: move_file
// =============================================================================

async function executeMoveFile(id, args) {
  const source = args.source;
  const destination = args.destination;
  const overwrite = args.overwrite !== false;
  const backup = args.backup !== false;

  if (!source) return writeToolError(id, '❌ "source" é obrigatório.');
  if (!destination) return writeToolError(id, '❌ "destination" é obrigatório.');

  const safeSource = validatePath(source);
  const safeDest = validatePath(destination);

  logOperation('move_file', `${safeSource} → ${safeDest}`);

  try {
    await fs.promises.access(safeSource, fs.constants.F_OK);
    const stat = await fs.promises.stat(safeSource);

    let destExists = false;
    try {
      await fs.promises.access(safeDest, fs.constants.F_OK);
      destExists = true;
    } catch {}

    if (destExists && !overwrite) {
      return writeToolError(id, `❌ Arquivo de destino já existe: ${safeDest}. Use overwrite:true para sobrescrever.`);
    }

    const destDir = path.dirname(safeDest);
    await fs.promises.mkdir(destDir, { recursive: true });

    let backupPath = null;
    if (destExists && backup) {
      const destBuffer = await fs.promises.readFile(safeDest);
      const result = await writeBackup(safeDest, destBuffer);
      if (!result.ok) {
        return writeToolError(id, `❌ Falha no backup: ${result.error.message}`);
      }
      backupPath = result.bakPath;
    }

    await fs.promises.rename(safeSource, safeDest);

    writeResult(id, {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'success',
          source: safeSource,
          destination: safeDest,
          backup: backupPath,
          message: `✅ Arquivo movido com sucesso: ${safeSource} → ${safeDest}${backupPath ? ` (backup: ${backupPath})` : ''}`
        }, null, 2)
      }]
    });
  } catch (err) {
    writeToolError(id, `❌ Erro ao mover arquivo: ${err.message}`);
  }
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

  const safePath = validatePath(targetPath);
  const razorFiles = await collectFiles(safePath, ['.razor'], null);
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

  const resxBase = args.resxPath ? path.resolve(args.resxPath) : await findResxFolder(safePath);
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

  const safePath = validatePath(targetPath);
  const results = [];
  let totalInserted = 0;

  for (const [lang, keyValues] of Object.entries(translations)) {
    if (!RESX_LANGS.includes(lang)) continue;
    const filePath = path.join(safePath, `SharedResources.${lang}.resx`);
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
      await fs.promises.mkdir(safePath, { recursive: true });
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
  const safePath = validatePath(targetPath);
  const razorFiles = await collectFiles(safePath, ['.razor'], null);
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
  const safePath = validatePath(targetPath);
  const translations = {};
  const langs = language ? [language] : RESX_LANGS;
  for (const lang of langs) {
    const filePath = path.join(safePath, `SharedResources.${lang}.resx`);
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
  const safePath = validatePath(targetPath);
  const files = await collectFiles(safePath, ['.resx'], null);
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
  const safePath = validatePath(targetPath);
  const files = await collectFiles(safePath, ['.resx'], null);
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
  const safePath = validatePath(targetPath);
  const filePath = path.join(safePath, `SharedResources.${language}.resx`);
  try {
    await fs.promises.stat(filePath);
    return writeResult(id, { content: [{ type: 'text', text: `Idioma ${language} já existe` }] });
  } catch {}
  const sourceFilePath = path.join(safePath, `SharedResources.${sourceLanguage}.resx`);
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
    await fs.promises.mkdir(safePath, { recursive: true });
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
      if (!isIgnoredDir(dirent.name)) {
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
      if (matchesExt && !excluded && !isExcludedFile(dirent.name)) {
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
  try {
    await fs.promises.writeFile(bakPath, buffer);
    return { ok: true, bakPath };
  } catch (err) {
    return { ok: false, error: err };
  }
}

async function cleanOldBackups(dir, maxAge = CONFIG.BACKUP_MAX_AGE) {
  try {
    const files = await fs.promises.readdir(dir);
    const now = Date.now();
    for (const file of files) {
      if (/\.bak\.\d+$/.test(file)) {
        const fullPath = path.join(dir, file);
        try {
          const stat = await fs.promises.stat(fullPath);
          if (now - stat.mtimeMs > maxAge) {
            await fs.promises.unlink(fullPath);
          }
        } catch {}
      }
    }
  } catch {}
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