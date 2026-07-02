#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { TextDecoder } = require('util');

// =============================================================================
// JSON-RPC over stdio (MCP transport)
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
      // Pré-parse rápido para tentar capturar o ID caso o handleLine quebre de forma catastrófica
      try {
        const parsed = JSON.parse(raw);
        currentId = parsed?.id;
      } catch {}

      await handleLine(raw);
    } catch (err) {
      console.error(`[node-search] Erro fatal na fila: ${err?.stack || err}`);
      if (currentId !== null && currentId !== undefined) {
        try {
          writeError(currentId, -32603, `Internal error: ${err.message}`);
        } catch {}
      }
    }
  }

  processingQueue = false;
  maybeExit();
}

async function handleLine(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (err) {
    console.error(`[node-search] Parse error: ${err.message}`);
    writeError(null, -32700, `Parse error: ${err.message}`);
    return;
  }

  const id = msg.id;
  const method = msg.method;
  const params = msg.params || {};
  const isNotification = id === undefined;

  if (method === 'initialize') {
    writeResult(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'node-search', version: '5.2.0' }
    });
    return;
  }

  if (method === 'notifications/initialized') return;

  if (method === 'tools/list') {
    writeResult(id, { tools: TOOL_DEFINITIONS });
    return;
  }

  if (method === 'tools/call') {
    const toolName = params.name;
    const toolArgs = params.arguments || {};
    try {
      if (toolName === 'search_files') await executeSearch(id, toolArgs);
      else if (toolName === 'replace_in_files') await executeReplace(id, toolArgs);
      else if (toolName === 'read_lines') await executeReadLines(id, toolArgs);
      else if (toolName === 'fix_encoding') await executeFixEncoding(id, toolArgs);
      else if (toolName === 'fix_mojibake') await executeFixMojibake(id, toolArgs);
      else if (toolName === 'find_files') await executeFindFiles(id, toolArgs);
      else if (toolName === 'get_file_info') await executeGetFileInfo(id, toolArgs);
      else if (toolName === 'list_directory') await executeListDirectory(id, toolArgs);
      else writeToolError(id, `Tool not found: ${toolName}`);
    } catch (err) {
      writeToolError(id, `Erro ao executar ${toolName}: ${err.message}`);
    }
    return;
  }

  if (!isNotification) {
    writeError(id, -32601, `Method not found: ${method}`);
  }
}

// =============================================================================
// DEFINIÇÃO DOS TOOLS
// =============================================================================

const TOOL_DEFINITIONS = [
  {
    name: 'search_files',
    description: 'Busca padrões de texto/regex em arquivos com auto-detecção de encoding. Suporta múltiplos padrões com "||"',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Padrão de texto (regex ou literal). Use "||" para múltiplos padrões (OR)' },
        path: { type: 'string', description: 'Arquivo único OU diretório raiz para busca' },
        filePattern: { type: 'string', description: 'Extensões separadas por vírgula (ex: .cs,.razor). Default: todas' },
        excludePattern: { type: 'string', description: 'Extensões para excluir (ex: .min.js,.generated.cs)' },
        simpleMatch: { type: 'boolean', description: 'Usar match literal em vez de regex (default: false)' },
        context: { type: 'number', description: 'Linhas de contexto antes/depois do match (default: 0, máx 5)' },
        caseSensitive: { type: 'boolean', description: 'Diferenciar maiúsculas/minúsculas (default: false)' },
        maxResults: { type: 'number', description: 'Máximo de resultados (default: 500, máx 2000)' },
        concurrency: { type: 'number', description: 'Arquivos pesquisados em paralelo (default: 8, máx 32)' }
      },
      required: ['pattern', 'path']
    }
  },
  {
    name: 'replace_in_files',
    description: 'Busca e substitui texto/regex em um ou mais arquivos. Por padrão roda em modo dryRun (preview).',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Texto ou regex a buscar' },
        replacement: { type: 'string', description: 'Texto de substituição (suporta $1, $2 para grupos de captura)' },
        path: { type: 'string', description: 'Arquivo único ou diretório raiz' },
        filePattern: { type: 'string', description: 'Extensões separadas por vírgula (ex: .cs,.razor). Default: todas' },
        excludePattern: { type: 'string', description: 'Extensões para excluir' },
        simpleMatch: { type: 'boolean', description: 'Tratar pattern como texto literal (default: false)' },
        caseSensitive: { type: 'boolean', description: 'Diferenciar maiúsculas/minúsculas (default: false)' },
        dryRun: { type: 'boolean', description: 'Apenas preview sem alterar arquivos (default: true)' },
        maxFiles: { type: 'number', description: 'Máximo de arquivos a modificar (default: 200, máx 1000)' },
        encoding: { type: 'string', description: 'Forçar encoding de leitura (ex: windows-1252). Default: auto-detect' },
        backup: { type: 'boolean', description: 'Criar .bak.[timestamp] antes de sobrescrever (default: true)' },
        concurrency: { type: 'number', description: 'Arquivos analisados em paralelo (default: 8, máx 32)' }
      },
      required: ['pattern', 'replacement', 'path']
    }
  },
  {
    name: 'read_lines',
    description: 'Lê um intervalo específico de linhas de um arquivo (streaming — não carrega o arquivo inteiro).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho do arquivo' },
        startLine: { type: 'number', description: 'Primeira linha, 1-indexed (default: 1)' },
        endLine: { type: 'number', description: 'Última linha, inclusive (default: startLine + 49)' },
        encoding: { type: 'string', description: 'Forçar encoding de leitura. Default: auto-detect' }
      },
      required: ['path']
    }
  },
  {
    name: 'fix_encoding',
    description: 'Detecta e converte arquivos não-UTF-8 para UTF-8. Por padrão dryRun.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Arquivo único ou diretório raiz' },
        filePattern: { type: 'string', description: 'Extensões separadas por vírgula (ex: .resx,.config). Default: todas' },
        excludePattern: { type: 'string', description: 'Extensões para excluir' },
        dryRun: { type: 'boolean', description: 'Apenas relatar, sem converter (default: true)' },
        maxFiles: { type: 'number', description: 'Máximo de arquivos a verificar/converter (default: 200, máx 1000)' },
        assumeEncoding: { type: 'string', description: 'Forçar encoding de origem em vez de auto-detectar' },
        backup: { type: 'boolean', description: 'Criar .bak.[timestamp] antes de sobrescrever (default: true)' },
        concurrency: { type: 'number', description: 'Arquivos processados em paralelo (default: 8, máx 32)' }
      },
      required: ['path']
    }
  },
  {
    name: 'fix_mojibake',
    description: 'Detecta e corrige mojibake por DUPLA codificação (UTF-8 decodificado como Latin-1). Por padrão dryRun.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Arquivo único ou diretório raiz' },
        filePattern: { type: 'string', description: 'Extensões separadas por vírgula. Default: todas' },
        excludePattern: { type: 'string', description: 'Extensões para excluir' },
        dryRun: { type: 'boolean', description: 'Apenas relatar, sem converter (default: true)' },
        maxFiles: { type: 'number', description: 'Máximo de arquivos a verificar/converter (default: 200, máx 1000)' },
        minSuspiciousChars: { type: 'number', description: 'Mínimo de padrões suspeitos no arquivo (default: 2)' },
        backup: { type: 'boolean', description: 'Criar .bak.[timestamp] antes de sobrescrever (default: true)' },
        concurrency: { type: 'number', description: 'Arquivos processados em paralelo (default: 8, máx 32)' }
      },
      required: ['path']
    }
  },
  {
    name: 'find_files',
    description: 'Busca arquivos por nome (suporta wildcards como *.cs)',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Nome ou padrão do arquivo (ex: *.cs, Program.cs, test* )' },
        path: { type: 'string', description: 'Diretório raiz da busca (default: .)' },
        maxResults: { type: 'number', description: 'Máximo de resultados (default: 100, máx 1000)' },
        caseSensitive: { type: 'boolean', description: 'Diferenciar maiúsculas/minúsculas (default: false)' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'get_file_info',
    description: 'Obtém informações detalhadas de um arquivo (tamanho, datas, encoding, etc)',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho do arquivo' },
        includeContent: { type: 'boolean', description: 'Incluir preview do conteúdo (default: false)' }
      },
      required: ['path']
    }
  },
  {
    name: 'list_directory',
    description: 'Lista o conteúdo de um diretório com estrutura visual (árvore)',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Diretório a listar (default: .)' },
        recursive: { type: 'boolean', description: 'Listar subdiretórios recursivamente (default: false)' },
        maxDepth: { type: 'number', description: 'Profundidade máxima para recursão (default: 3, máx 10)' },
        showHidden: { type: 'boolean', description: 'Mostrar arquivos/diretórios ocultos (default: false)' }
      }
    }
  }
];

// =============================================================================
// CONFIG & HELPERS
// =============================================================================

const IGNORE_DIRS = new Set([
  'bin', 'obj', '.git', 'node_modules', 'dist',
  '.vs', '.idea', 'TestResults', 'packages', '__pycache__',
  '.venv', 'venv', 'env', '.env'
]);

const BINARY_EXT = new Set([
  '.dll', '.exe', '.pdb', '.png', '.jpg', '.jpeg', '.gif', '.ico',
  '.zip', '.pfx', '.bmp', '.webp', '.woff', '.woff2', '.ttf', '.eot',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'
]);

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_LINE_DISPLAY = 300;

const KNOWN_ENCODINGS = new Set([
  'utf-8', 'utf-16le', 'utf-16be', 'windows-1252', 'iso-8859-1', 'latin1', 'ascii'
]);

// Cache de arquivos (Otimizado para evitar alocações de arrays pesados)
const fileCache = new Map();
const MAX_CACHE_SIZE = 30;

async function getCachedFile(filePath, forceRead = false) {
  if (!forceRead && fileCache.has(filePath)) {
    return fileCache.get(filePath);
  }
  
  const buffer = await fs.promises.readFile(filePath);
  
  if (fileCache.size >= MAX_CACHE_SIZE) {
    const iterator = fileCache.keys();
    for (let i = 0; i < 10; i++) {
      const nextKey = iterator.next().value;
      if (!nextKey) break;
      fileCache.delete(nextKey);
    }
  }
  
  fileCache.set(filePath, buffer);
  return buffer;
}

function normalizeEncoding(enc) {
  if (!enc) return null;
  const lower = enc.toLowerCase();
  return KNOWN_ENCODINGS.has(lower) ? lower : null;
}

const WIN1252_HIGH = {
  0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160,
  0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153,
  0x9E: 0x017E, 0x9F: 0x0178
};

function decodeWindows1252Fallback(buffer) {
  let out = '';
  for (const byte of buffer) {
    out += String.fromCharCode((byte >= 0x80 && byte < 0xA0) ? (WIN1252_HIGH[byte] || byte) : byte);
  }
  return out;
}

function detectEncoding(buffer, overrideEncoding) {
  if (overrideEncoding) return { encoding: overrideEncoding, bom: false };
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return { encoding: 'utf-8', bom: true };
  }
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return { encoding: 'utf-16le', bom: true };
  }
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    return { encoding: 'utf-16be', bom: true };
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return { encoding: 'utf-8', bom: false };
  } catch {
    return { encoding: 'windows-1252', bom: false };
  }
}

function decodeBuffer(buffer, overrideEncoding) {
  const { encoding, bom } = detectEncoding(buffer, overrideEncoding);
  const body = bom ? buffer.subarray(encoding === 'utf-8' ? 3 : 2) : buffer;
  let text;
  try {
    text = new TextDecoder(encoding).decode(body);
  } catch {
    text = encoding === 'windows-1252' ? decodeWindows1252Fallback(body) : body.toString('latin1');
  }
  return { text, encoding, hadBom: bom };
}

async function walk(dir, fileExts, excludeExts, onFileFound) {
  let dirents;
  try {
    dirents = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const dirent of dirents) {
    if (dirent.isSymbolicLink()) continue;
    const fullPath = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      if (!IGNORE_DIRS.has(dirent.name)) {
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

async function collectFiles(targetPath, fileExts, excludeExts) {
  const list = [];
  let stat;
  try {
    stat = await fs.promises.stat(targetPath);
  } catch {
    return list;
  }
  if (stat.isDirectory()) {
    await walk(targetPath, fileExts, excludeExts, (f) => list.push(f));
  } else {
    list.push(targetPath);
  }
  return list;
}

async function isLikelyBinary(filePath) {
  if (BINARY_EXT.has(path.extname(filePath).toLowerCase())) return true;
  let fd;
  try {
    fd = await fs.promises.open(filePath, 'r');
    const buf = Buffer.alloc(512);
    const { bytesRead } = await fd.read(buf, 0, 512, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } catch {
    return true;
  } finally {
    if (fd) await fd.close();
  }
}

function parseFileExts(filePattern) {
  return filePattern ? filePattern.split(',').map(e => e.trim()).filter(Boolean) : null;
}

function parseExcludeExts(excludePattern) {
  return excludePattern ? excludePattern.split(',').map(e => e.trim()).filter(Boolean) : null;
}

function truncateLine(line) {
  return line.length > MAX_LINE_DISPLAY ? line.slice(0, MAX_LINE_DISPLAY) + '…' : line;
}

function detectEol(text) {
  return /\r\n/.test(text) ? '\r\n' : '\n';
}

function normalizeEol(text) {
  return text.replace(/\r\n|\r/g, '\n');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildDiffPreview(original, updated, maxLines = 15) {
  const origLines = normalizeEol(original).split('\n');
  const newLines = normalizeEol(updated).split('\n');
  const diffs = [];
  const len = Math.max(origLines.length, newLines.length);
  for (let i = 0; i < len && diffs.length < maxLines; i++) {
    if (origLines[i] !== newLines[i]) {
      diffs.push(`  L${i + 1}: - ${origLines[i] ?? ''}\n  L${i + 1}: + ${newLines[i] ?? ''}`);
    }
  }
  if (diffs.length >= maxLines) diffs.push('  ... (mais alterações omitidas)');
  const origEol = detectEol(original);
  const newEol = detectEol(updated);
  let eolNote = '';
  if (origEol !== newEol) {
    eolNote = ` [EOL mudou: ${origEol === '\r\n' ? 'CRLF' : 'LF'} → ${newEol === '\r\n' ? 'CRLF' : 'LF'}]`;
  } else if (origEol === '\r\n') {
    eolNote = ' [CRLF]';
  }
  return { preview: diffs.join('\n'), eolNote };
}

function timestampStr() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function writeBackup(filePath, originalBuffer) {
  const bakPath = `${filePath}.bak.${timestampStr()}`;
  try {
    await fs.promises.writeFile(bakPath, originalBuffer);
    return { ok: true, bakPath };
  } catch (err) {
    console.error(`[node-search] Falha ao criar backup de ${filePath}: ${err.message}`);
    return { ok: false, error: err };
  }
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
      try {
        await worker(items[i], i);
      } catch (err) {
        console.error(`[node-search] Erro em worker: ${err.message}`);
      }
    }
  });
  await Promise.all(workers);
}

function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function sendProgress(id, current, total, message) {
  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    method: 'notifications/progress',
    params: { id, current, total, message }
  }) + '\n');
}

// Compila múltiplos padrões em uma Regex ÚNICA combinada para performance massiva no V8
function parsePatternsToSingleRegex(patternStr, simpleMatch, caseSensitive) {
  const patterns = patternStr.split('||').map(p => p.trim()).filter(Boolean);
  if (patterns.length === 0) {
    throw new Error('Nenhum padrão válido');
  }
  const unified = patterns.map(p => simpleMatch ? escapeRegex(p) : p).join('|');
  return new RegExp(unified, caseSensitive ? '' : 'i');
}

// =============================================================================
// MOJIBAKE ENGINE
// =============================================================================

const MOJIBAKE_PATTERN = /Ã[\x80-\xBF]|Â[\x80-\xBF]|â€[\x80-\x9F]/g;

function countSuspicious(text) {
  const matches = text.match(MOJIBAKE_PATTERN);
  return matches ? matches.length : 0;
}

function isLikelyMojibakeCandidate(text) {
  const nonAscii = text.match(/[\u0080-\uFFFF]/g) || [];
  if (nonAscii.length === 0) return false;
  const outOfLatin1Range = nonAscii.filter(c => c.codePointAt(0) > 0xFF).length;
  return (outOfLatin1Range / nonAscii.length) < 0.05;
}

function tryFixMojibake(text) {
  const before = countSuspicious(text);
  if (before === 0) return null;
  if (!isLikelyMojibakeCandidate(text)) return null;
  const bytes = Buffer.from(text, 'latin1');
  let repaired;
  try {
    repaired = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  const after = countSuspicious(repaired);
  if (after < before) return { repaired, before, after };
  return null;
}

// =============================================================================
// TOOL: search_files
// =============================================================================

async function executeSearch(id, args) {
  const searchPath = args.path || '.';
  const patternStr = args.pattern;
  const fileExts = parseFileExts(args.filePattern);
  const excludeExts = parseExcludeExts(args.excludePattern);
  const simpleMatch = args.simpleMatch || false;
  const contextLines = Math.min(args.context || 0, 5);
  const caseSensitive = args.caseSensitive || false;
  const maxResults = Math.min(args.maxResults ?? 500, 2000);
  const concurrency = Math.min(Math.max(args.concurrency || 8, 1), 32);

  let combinedRegex;
  try {
    combinedRegex = parsePatternsToSingleRegex(patternStr, simpleMatch, caseSensitive);
  } catch (err) {
    return writeToolError(id, `Erro no padrão: ${err.message}`);
  }

  const results = [];
  let totalFound = 0;
  let isTruncated = false;
  let scanned = 0;

  async function searchInFile(filePath) {
    if (await isLikelyBinary(filePath)) return;
    let buffer;
    try {
      buffer = await getCachedFile(filePath);
    } catch {
      return;
    }
    if (buffer.length > MAX_FILE_SIZE) return;
    scanned++;

    const { text } = decodeBuffer(buffer);
    const lines = text.split(/\r\n|\r|\n/);

    const history = [];
    let lineNum = 0;
    let currentMatch = null;
    let afterContextCount = 0;

    for (const rawLine of lines) {
      if (isTruncated) break;
      lineNum++;
      const trimmed = truncateLine(rawLine.trim());
      
      if (combinedRegex.test(rawLine)) {
        if (totalFound >= maxResults) {
          isTruncated = true;
          break;
        }
        totalFound++;
        const preContextStr = (contextLines > 0 && history.length > 0)
          ? ` | before=[${history.join('│')}]` : '';
        currentMatch = {
          text: `${filePath}:${lineNum}:${trimmed}${preContextStr}`,
          after: []
        };
        results.push(currentMatch);
        afterContextCount = contextLines;
      } else if (afterContextCount > 0 && currentMatch) {
        currentMatch.after.push(trimmed);
        afterContextCount--;
      }

      if (contextLines > 0) {
        history.push(trimmed);
        if (history.length > contextLines) history.shift();
      }
    }
  }

  try {
    const fileList = await collectFiles(searchPath, fileExts, excludeExts);
    if (fileList.length === 0) {
      return writeResult(id, {
        content: [{ type: 'text', text: `Nenhum arquivo encontrado em ${searchPath}` }],
        isError: true
      });
    }

    await runPool(fileList, concurrency, async (filePath) => {
      await searchInFile(filePath);
      if (scanned % 10 === 0 && scanned > 0) {
        sendProgress(id, scanned, fileList.length, `Processando ${scanned}/${fileList.length} arquivos`);
      }
    });

    if (results.length === 0) {
      return writeResult(id, {
        content: [{ type: 'text', text: `Nenhum resultado encontrado para "${patternStr}" em ${searchPath}` }]
      });
    }

    const lines = results.map(r =>
      r.text + (r.after.length ? ` | after=[${r.after.join('│')}]` : '')
    );
    const note = isTruncated
      ? `\n\n_(Resultados truncados em ${maxResults}. Use um filtro mais específico.)_`
      : '';

    writeResult(id, {
      content: [{
        type: 'text',
        text: `Encontradas ${totalFound} ocorrência(s) para "${patternStr}" em ${searchPath} (${scanned} arquivo(s) verificado(s))\n\n${lines.join('\n')}${note}`
      }]
    });
  } catch (err) {
    writeToolError(id, `Erro interno durante a busca: ${err.message}`);
  }
}

// =============================================================================
// TOOL: replace_in_files
// =============================================================================

async function executeReplace(id, args) {
  const searchPath = args.path;
  const patternStr = args.pattern;
  const replacement = args.replacement ?? '';

  if (!searchPath || !patternStr) {
    return writeToolError(id, 'Parâmetros "path" e "pattern" são obrigatórios.');
  }

  const fileExts = parseFileExts(args.filePattern);
  const excludeExts = parseExcludeExts(args.excludePattern);
  const simpleMatch = args.simpleMatch || false;
  const caseSensitive = args.caseSensitive || false;
  const dryRun = args.dryRun !== false;
  const maxFiles = Math.min(args.maxFiles || 200, 1000);
  const backup = args.backup !== false;
  const concurrency = Math.min(Math.max(args.concurrency || 8, 1), 32);

  const validatedEncoding = normalizeEncoding(args.encoding);
  if (args.encoding && !validatedEncoding) {
    return writeToolError(id, `Encoding desconhecido: "${args.encoding}". Válidos: ${[...KNOWN_ENCODINGS].join(', ')}`);
  }

  let regex;
  try {
    if (simpleMatch) {
      regex = new RegExp(escapeRegex(patternStr), caseSensitive ? 'g' : 'gi');
    } else {
      regex = new RegExp(patternStr, caseSensitive ? 'g' : 'gi');
    }
  } catch (err) {
    return writeToolError(id, `Regex inválida: ${err.message}`);
  }

  const fileList = await collectFiles(searchPath, fileExts, excludeExts);
  if (fileList.length === 0) {
    return writeResult(id, { content: [{ type: 'text', text: `Nenhum arquivo encontrado em ${searchPath}` }], isError: true });
  }

  const analyzed = new Array(fileList.length);
  let processed = 0;
  
  await runPool(fileList, concurrency, async (filePath, i) => {
    if (processed >= maxFiles) return;
    if (await isLikelyBinary(filePath)) return;
    let fStat;
    try { fStat = await fs.promises.stat(filePath); } catch { return; }
    if (fStat.size > MAX_FILE_SIZE) return;

    let buffer;
    try { buffer = await fs.promises.readFile(filePath); } catch { return; }

    const { text: original } = decodeBuffer(buffer, validatedEncoding);
    regex.lastIndex = 0;
    const matchCount = (original.match(regex) || []).length;
    if (matchCount === 0) return;

    regex.lastIndex = 0;
    const updated = original.replace(regex, replacement);
    if (updated === original) return;

    const { preview, eolNote } = buildDiffPreview(original, updated);
    analyzed[i] = { filePath, matchCount, preview, eolNote, updated, originalBuffer: buffer };
    processed++;
  });

  const changes = analyzed.filter(Boolean);

  if (changes.length === 0) {
    return writeResult(id, {
      content: [{ type: 'text', text: `Nenhuma ocorrência de "${patternStr}" encontrada em ${fileList.length} arquivo(s) verificado(s).` }]
    });
  }

  const writeReport = new Array(changes.length);
  let abortedByBackup = false;

  // Escrita física e geração de backups otimizados em paralelo com runPool
  if (!dryRun) {
    await runPool(changes, concurrency, async (changeItem, index) => {
      if (shuttingDown) {
        writeReport[index] = `${changeItem.filePath}: SKIPPED (shutdown em andamento)`;
        return;
      }
      if (abortedByBackup) {
        writeReport[index] = `${changeItem.filePath}: SKIPPED (abortado por falha anterior)`;
        return;
      }

      if (backup) {
        const result = await writeBackup(changeItem.filePath, changeItem.originalBuffer);
        if (!result.ok) {
          writeReport[index] = `${changeItem.filePath}: ABORT (backup falhou: ${result.error.message})`;
          abortedByBackup = true;
          return;
        }
        changeItem.bakPath = result.bakPath;
      }

      try {
        await fs.promises.writeFile(changeItem.filePath, changeItem.updated, 'utf8');
        writeReport[index] = changeItem.bakPath ? `${changeItem.filePath} (backup: ${path.basename(changeItem.bakPath)})` : changeItem.filePath;
      } catch (err) {
        writeReport[index] = `${changeItem.filePath}: ERRO (${err.message})`;
      }
    });
  }

  const totalMatches = changes.reduce((sum, c) => sum + c.matchCount, 0);
  const blocks = changes.map(c => `${c.filePath} (${c.matchCount} ocorrência(s))${c.eolNote}:\n${c.preview}`);

  let summary;
  if (dryRun) {
    summary = `\n\n_(Modo dryRun — nenhum arquivo foi alterado. Rode novamente com dryRun:false para aplicar.)_`;
  } else if (abortedByBackup) {
    summary = `\n\n⚠️ Escrita PARCIALMENTE ABORTADA por falha de backup. Verifique o log abaixo.`;
  } else {
    summary = `\n\n${changes.length} arquivo(s) modificado(s), ${totalMatches} ocorrência(s) substituída(s) no total.${backup ? ' Backups .bak.[timestamp] criados.' : ''}`;
  }

  writeResult(id, {
    content: [{
      type: 'text',
      text: `${changes.length} arquivo(s) com ocorrências de "${patternStr}" (${totalMatches} no total):\n\n${blocks.join('\n\n')}${summary}${writeReport.length ? `\n\nLog de escrita:\n${writeReport.filter(Boolean).join('\n')}` : ''}`
    }]
  });
}

// =============================================================================
// TOOL: read_lines
// =============================================================================

async function executeReadLines(id, args) {
  const filePath = args.path;
  if (!filePath) return writeToolError(id, 'Parâmetro "path" é obrigatório.');

  const validatedEncoding = normalizeEncoding(args.encoding);
  if (args.encoding && !validatedEncoding) {
    return writeToolError(id, `Encoding desconhecido: "${args.encoding}". Válidos: ${[...KNOWN_ENCODINGS].join(', ')}`);
  }

  const startLine = Math.max(1, args.startLine || 1);
  const endLine = args.endLine || (startLine + 49);
  const MAX_RANGE = 1000;

  if (endLine < startLine) return writeToolError(id, '"endLine" deve ser >= "startLine".');
  if (endLine - startLine > MAX_RANGE) {
    return writeToolError(id, `Range máximo de ${MAX_RANGE} linhas excedido.`);
  }

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return writeResult(id, { content: [{ type: 'text', text: `Arquivo não encontrado: ${filePath}` }], isError: true });
  }

  if (stat.size > MAX_FILE_SIZE) {
    return writeResult(id, {
      content: [{ type: 'text', text: `Arquivo muito grande para leitura direta. Use search_files.` }],
      isError: true
    });
  }

  if (await isLikelyBinary(filePath)) {
    return writeResult(id, {
      content: [{ type: 'text', text: `Arquivo aparenta ser binário. Não é possível ler linhas.` }],
      isError: true
    });
  }

  const probeSize = Math.min(4096, stat.size);
  const probe = Buffer.alloc(probeSize);
  if (probeSize > 0) {
    let fd;
    try {
      fd = await fs.promises.open(filePath, 'r');
      await fd.read(probe, 0, probeSize, 0);
    } catch (err) {
      return writeResult(id, {
        content: [{ type: 'text', text: `Não foi possível ler ${filePath}: ${err.message}` }],
        isError: true
      });
    } finally {
      if (fd) await fd.close();
    }
  }
  const { encoding } = detectEncoding(probe, validatedEncoding);

  const fileStream = fs.createReadStream(filePath);
  const rlFile = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const collected = [];
  let lineNum = 0;
  let hitUpperBound = false;

  try {
    for await (const line of rlFile) {
      lineNum++;
      if (lineNum >= startLine && lineNum <= endLine) {
        collected.push(`${lineNum}: ${truncateLine(line)}`);
      }
      if (lineNum >= endLine) {
        hitUpperBound = true;
        rlFile.close(); // Fecha com segurança a interface de leitura e libera o arquivo
        break;
      }
    }
  } catch (err) {
    return writeResult(id, { content: [{ type: 'text', text: `Erro lendo ${filePath}: ${err.message}` }], isError: true });
  }

  if (collected.length === 0) {
    return writeResult(id, {
      content: [{ type: 'text', text: `Arquivo tem apenas ${lineNum} linha(s). Fora do range.` }],
      isError: true
    });
  }

  const endLineShown = Math.min(endLine, lineNum);
  const totalText = hitUpperBound ? `${endLine}+ (arquivo continua além)` : `${lineNum} total`;
  const encodingNote = encoding !== 'utf-8' ? `\n\n_(Aviso: arquivo lido como ${encoding})_` : '';

  writeResult(id, {
    content: [{
      type: 'text',
      text: `${filePath} — linhas ${startLine}-${endLineShown} de ${totalText}\n\n${collected.join('\n')}${encodingNote}`
    }]
  });
}

// =============================================================================
// TOOL: fix_encoding
// =============================================================================

async function executeFixEncoding(id, args) {
  const targetPath = args.path;
  if (!targetPath) return writeToolError(id, 'Parâmetro "path" é obrigatório.');

  const dryRun = args.dryRun !== false;
  const fileExts = parseFileExts(args.filePattern);
  const excludeExts = parseExcludeExts(args.excludePattern);
  const maxFiles = Math.min(args.maxFiles || 200, 1000);
  const overrideEncoding = normalizeEncoding(args.assumeEncoding);
  if (args.assumeEncoding && !overrideEncoding) {
    return writeToolError(id, `Encoding desconhecido: "${args.assumeEncoding}". Válidos: ${[...KNOWN_ENCODINGS].join(', ')}`);
  }
  const backup = args.backup !== false;
  const concurrency = Math.min(Math.max(args.concurrency || 8, 1), 32);

  const fileList = await collectFiles(targetPath, fileExts, excludeExts);
  if (fileList.length === 0) {
    return writeResult(id, { content: [{ type: 'text', text: `Nenhum arquivo encontrado em ${targetPath}` }], isError: true });
  }

  const report = [];
  let processed = 0;

  await runPool(fileList, concurrency, async (filePath) => {
    if (processed >= maxFiles) return;
    if (await isLikelyBinary(filePath)) return;
    let fStat;
    try { fStat = await fs.promises.stat(filePath); } catch { return; }
    if (fStat.size > MAX_FILE_SIZE) return;

    let buffer;
    try { buffer = await fs.promises.readFile(filePath); } catch { return; }

    const { text, encoding, hadBom } = decodeBuffer(buffer, overrideEncoding);
    if (encoding === 'utf-8' && !hadBom) return;

    processed++;
    if (dryRun) {
      report.push(`${filePath}: seria convertido (${encoding}${hadBom ? ' com BOM' : ''} → utf-8)`);
      return;
    }
    if (shuttingDown) {
      report.push(`${filePath}: SKIPPED (shutdown)`);
      return;
    }
    if (backup) {
      const result = await writeBackup(filePath, buffer);
      if (!result.ok) {
        report.push(`${filePath}: ERRO (backup falhou: ${result.error.message})`);
        return;
      }
    }
    try {
      await fs.promises.writeFile(filePath, text, 'utf8');
      report.push(`${filePath}: convertido (${encoding}${hadBom ? ' com BOM' : ''} → utf-8)`);
    } catch (err) {
      report.push(`${filePath}: ERRO (${err.message})`);
    }
  });

  if (report.length === 0) {
    return writeResult(id, {
      content: [{ type: 'text', text: `Verificados ${fileList.length} arquivo(s). Todos já estão em UTF-8.` }]
    });
  }

  const summary = dryRun ? `\n\n_(Modo dryRun — nenhum arquivo foi alterado.)_` : `\n\n${report.length} arquivo(s) convertido(s) para UTF-8.`;

  writeResult(id, {
    content: [{
      type: 'text',
      text: `${report.length} arquivo(s) detectados de ${fileList.length} verificado(s):\n\n${report.join('\n')}${summary}`
    }]
  });
}

// =============================================================================
// TOOL: fix_mojibake
// =============================================================================

async function executeFixMojibake(id, args) {
  const targetPath = args.path;
  if (!targetPath) return writeToolError(id, 'Parâmetro "path" é obrigatório.');

  const dryRun = args.dryRun !== false;
  const fileExts = parseFileExts(args.filePattern);
  const excludeExts = parseExcludeExts(args.excludePattern);
  const maxFiles = Math.min(args.maxFiles || 200, 1000);
  const minSuspicious = args.minSuspiciousChars ?? 2;
  const backup = args.backup !== false;
  const concurrency = Math.min(Math.max(args.concurrency || 8, 1), 32);

  const fileList = await collectFiles(targetPath, fileExts, excludeExts);
  if (fileList.length === 0) {
    return writeResult(id, { content: [{ type: 'text', text: `Nenhum arquivo encontrado em ${targetPath}` }], isError: true });
  }

  const report = [];
  let processed = 0;

  await runPool(fileList, concurrency, async (filePath) => {
    if (processed >= maxFiles) return;
    if (await isLikelyBinary(filePath)) return;
    let fStat;
    try { fStat = await fs.promises.stat(filePath); } catch { return; }
    if (fStat.size > MAX_FILE_SIZE) return;

    let buffer;
    try { buffer = await fs.promises.readFile(filePath); } catch { return; }

    const { text } = decodeBuffer(buffer);
    const fix = tryFixMojibake(text);
    if (!fix || fix.before < minSuspicious) return;

    processed++;
    if (dryRun) {
      report.push(`${filePath}: ${fix.before} padrão(ões) suspeito(s) → ${fix.after} após correção`);
      return;
    }
    if (shuttingDown) {
      report.push(`${filePath}: SKIPPED (shutdown)`);
      return;
    }
    if (backup) {
      const result = await writeBackup(filePath, buffer);
      if (!result.ok) {
        report.push(`${filePath}: ERRO (backup falhou: ${result.error.message})`);
        return;
      }
    }
    try {
      await fs.promises.writeFile(filePath, fix.repaired, 'utf8');
      report.push(`${filePath}: corrigido (${fix.before} → ${fix.after} padrão(ões) suspeito(s))`);
    } catch (err) {
      report.push(`${filePath}: ERRO (${err.message})`);
    }
  });

  if (report.length === 0) {
    return writeResult(id, {
      content: [{ type: 'text', text: `Verificados ${fileList.length} arquivo(s). Nenhum mojibake detectado.` }]
    });
  }

  const summary = dryRun ? `\n\n_(Modo dryRun — nenhum arquivo foi alterado.)_` : `\n\n${report.length} arquivo(s) corrigido(s).`;

  writeResult(id, {
    content: [{
      type: 'text',
      text: `${report.length} arquivo(s) com possível mojibake de ${fileList.length} verificado(s):\n\n${report.join('\n')}${summary}`
    }]
  });
}

// =============================================================================
// TOOL: find_files
// =============================================================================

async function executeFindFiles(id, args) {
  const searchPath = args.path || '.';
  const pattern = args.pattern;
  const maxResults = Math.min(args.maxResults || 100, 1000);
  const caseSensitive = args.caseSensitive || false;
  
  if (!pattern) {
    return writeToolError(id, 'Parâmetro "pattern" é obrigatório.');
  }
  
  const results = [];
  let regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.');
  const hasWildcard = pattern.includes('*') || pattern.includes('?');
  const searchRegex = hasWildcard ? new RegExp(`^${regexPattern}$`, caseSensitive ? '' : 'i') : null;
  
  async function walkFind(dir) {
    let dirents;
    try {
      dirents = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    
    for (const dirent of dirents) {
      if (shuttingDown || results.length >= maxResults) break;
      if (dirent.isSymbolicLink()) continue;
      
      const fullPath = path.join(dir, dirent.name);
      
      if (dirent.isDirectory()) {
        if (!IGNORE_DIRS.has(dirent.name)) {
          await walkFind(fullPath);
        }
      } else if (dirent.isFile()) {
        let match;
        if (hasWildcard) {
          match = searchRegex.test(dirent.name);
        } else {
          match = caseSensitive 
            ? dirent.name.includes(pattern)
            : dirent.name.toLowerCase().includes(pattern.toLowerCase());
        }
        
        if (match) {
          results.push(fullPath);
        }
      }
    }
  }
  
  try {
    await walkFind(searchPath);
    if (results.length === 0) {
      return writeResult(id, {
        content: [{ type: 'text', text: `Nenhum arquivo encontrado com padrão "${pattern}" em ${searchPath}` }]
      });
    }
    
    const truncated = results.length >= maxResults;
    const text = `Encontrados ${results.length} arquivo(s):\n\n${results.join('\n')}${truncated ? `\n\n_(Truncado em ${maxResults} resultados)_` : ''}`;
    
    writeResult(id, { content: [{ type: 'text', text }] });
  } catch (err) {
    writeToolError(id, `Erro na busca: ${err.message}`);
  }
}

// =============================================================================
// TOOL: get_file_info
// =============================================================================

async function executeGetFileInfo(id, args) {
  const filePath = args.path;
  const includeContent = args.includeContent || false;
  
  if (!filePath) {
    return writeToolError(id, 'Parâmetro "path" é obrigatório.');
  }
  
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
      isFile: stat.isFile(),
      permissions: stat.mode.toString(8)
    };
    
    if (includeContent && stat.isFile() && stat.size < MAX_FILE_SIZE) {
      const buffer = await fs.promises.readFile(filePath);
      const { encoding } = detectEncoding(buffer);
      const { text } = decodeBuffer(buffer);
      info.encoding = encoding;
      info.contentLength = text.length;
      info.preview = text.slice(0, 500) + (text.length > 500 ? '...' : '');
      
      const suspicious = countSuspicious(text);
      if (suspicious > 0) {
        info.mojibakeDetected = suspicious;
        const fix = tryFixMojibake(text);
        if (fix) {
          info.mojibakeFixable = true;
          info.mojibakeBefore = fix.before;
          info.mojibakeAfter = fix.after;
        }
      }
    }
    
    writeResult(id, { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] });
  } catch (err) {
    writeToolError(id, `Erro ao ler arquivo: ${err.message}`);
  }
}

// =============================================================================
// TOOL: list_directory
// =============================================================================

async function executeListDirectory(id, args) {
  const searchPath = args.path || '.';
  const recursive = args.recursive || false;
  const maxDepth = Math.min(args.maxDepth || 3, 10);
  const showHidden = args.showHidden || false;
  
  async function walkDir(dir, depth = 0, prefix = '') {
    if (depth > maxDepth) return [];
    if (shuttingDown) return [];
    
    let dirents;
    try {
      dirents = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err) {
      return [`${prefix}⚠️ Erro ao ler diretório: ${err.message}`];
    }
    
    const items = [];
    const sorted = dirents
      .filter(d => showHidden || !d.name.startsWith('.'))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });
    
    for (const dirent of sorted) {
      if (IGNORE_DIRS.has(dirent.name)) continue;
      
      const fullPath = path.join(dir, dirent.name);
      const isDir = dirent.isDirectory();
      const icon = isDir ? '📁' : '📄';
      const display = `${prefix}${icon} ${dirent.name}${isDir ? '/' : ''}`;
      items.push(display);
      
      if (isDir && recursive) {
        const subItems = await walkDir(fullPath, depth + 1, `${prefix}  `);
        items.push(...subItems);
      }
    }
    
    return items;
  }
  
  try {
    const items = await walkDir(searchPath);
    if (items.length === 0) {
      return writeResult(id, { content: [{ type: 'text', text: `📂 ${searchPath}\n\n(Diretório vazio)` }] });
    }
    
    writeResult(id, { content: [{ type: 'text', text: `📂 ${searchPath}\n\n${items.join('\n')}` }] });
  } catch (err) {
    writeToolError(id, `Erro ao listar diretório: ${err.message}`);
  }
}

// =============================================================================
// PROTOCOL WRITERS
// =============================================================================

function writeResult(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function writeError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

function writeToolError(id, message) {
  writeResult(id, {
    content: [{ type: 'text', text: message }],
    isError: true
  });
}