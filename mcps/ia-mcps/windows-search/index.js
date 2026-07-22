#!/usr/bin/env node
'use strict';

/**
 * ============================================================================
 * NODE-SEARCH MCP SERVER — VERSÃO v8.5.0 COMPLETA
 * ============================================================================
 *
 * 🔥 44 TOOLS IMPLEMENTADAS:
 * 
 * Busca/Símbolos (6):
 *   - find_symbol, get_symbol_source, search_content, find_references, 
 *     find_in_project, search_files
 * 
 * Edição/Arquivos (8):
 *   - replace_in_files, write_file, edit_file, move_file, create_directory,
 *     read_lines, find_files, list_directory
 * 
 * Análise (8):
 *   - code_outline, get_code_smells, get_diagnostics, project_info,
 *     analyze_dependencies, compare_files, get_symbol_usage, analyze_complexity
 * 
 * Refatoração (4):
 *   - rename_symbol, extract_interface, get_type_info, find_unused_code
 * 
 * Estrutura (1):
 *   - get_call_hierarchy
 * 
 * Comandos (1):
 *   - compact_command
 * 
 * Utilidades (4):
 *   - undo_last_change, get_metrics, get_cache_stats, code_completion
 * 
 * i18n/Resx (7):
 *   - generate_labels, insert_translations, get_translation_context,
 *     get_existing_translations, deduplicate_resx, find_duplicates, add_language
 * 
 * Informações (1):
 *   - get_file_info
 * 
 * ✅ Zero dependências externas!
 * ✅ Suporte a .NET 10, C# 13, Blazor
 * ✅ Economia de 90-99% de tokens
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
const crypto = require('crypto');

// =============================================================================
// PERFIL DE TOOLS
// =============================================================================

const TOOL_PROFILE = process.env.TOOL_PROFILE || 'full';

const TOOL_PROFILES = {
  core: [
    'find_symbol',
    'get_symbol_source',
    'search_content',
    'replace_in_files',
    'write_file',
    'edit_file',
    'read_lines',
    'undo_last_change',
    'code_outline',
    'find_references',
    'find_in_project',
    'rename_symbol',
    'get_cache_stats'
  ],
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
    'move_file',
    'undo_last_change',
    'code_outline',
    'find_references',
    'find_in_project',
    'rename_symbol',
    'get_code_smells',
    'get_diagnostics',
    'project_info',
    'analyze_complexity',
    'get_cache_stats'
  ],
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
    'delete_translations',
    'find_unused_translations',
    'find_missing_loc_keys',
    'resolve_case_duplicates',
    'get_translation_context',
    'get_existing_translations',
    'deduplicate_resx',
    'find_duplicates',
    'add_language',
    'fix_mojibake',
    'get_file_history',
    'analyze_i18n_health',
    'analyze_migration_readiness',
    'compact_command',
    'undo_last_change',
    'code_outline',
    'find_references',
    'find_in_project',
    'rename_symbol',
    'get_code_smells',
    'get_diagnostics',
    'project_info',
    'analyze_dependencies',
    'compare_files',
    'get_symbol_usage',
    'code_completion',
    'analyze_complexity',
    'get_type_info',
    'get_call_hierarchy',
    'find_unused_code',
    'extract_interface',
    'get_metrics',
    'get_cache_stats'
  ]
};

const ACTIVE_TOOLS = TOOL_PROFILES[TOOL_PROFILE] || TOOL_PROFILES.full;

// =============================================================================
// MÉTRICAS
// =============================================================================

const METRICS = {
  operations: {},
  tokensSaved: 0,
  startTime: Date.now(),
  commands: {
    total: 0,
    successes: 0,
    errors: 0,
    timeouts: 0
  }
};

function trackOperation(operation, duration, tokensBefore = 0, tokensAfter = 0) {
  if (!METRICS.operations[operation]) {
    METRICS.operations[operation] = { 
      total: 0, 
      avgTime: 0, 
      maxTime: 0, 
      minTime: Infinity,
      errors: 0,
      tokensSaved: 0
    };
  }
  const op = METRICS.operations[operation];
  op.total++;
  op.avgTime = (op.avgTime * (op.total - 1) + duration) / op.total;
  op.maxTime = Math.max(op.maxTime, duration);
  op.minTime = Math.min(op.minTime, duration);
  const saved = tokensBefore - tokensAfter;
  if (saved > 0) {
    op.tokensSaved += saved;
    METRICS.tokensSaved += saved;
  }
}

function trackError(operation) {
  if (METRICS.operations[operation]) {
    METRICS.operations[operation].errors++;
  }
  METRICS.commands.errors++;
}

function trackCommand(success = true) {
  METRICS.commands.total++;
  if (success) METRICS.commands.successes++;
  else METRICS.commands.errors++;
}

function trackTimeout() {
  METRICS.commands.timeouts++;
}

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
// COMPACTADORES DE SAÍDA
// =============================================================================

function compactBuildOutput(output) {
  const lines = output.split('\n');
  const errors = [];
  const warnings = [];
  const errorCodes = new Set();
  const warningCodes = new Set();

  // Formato padrão do MSBuild/dotnet: caminho(linha,coluna): error CSxxxx: mensagem [projeto]
  const msbuildLineRegex = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(CS\d+):\s*(.+?)(?:\s*\[.+\])?$/;

  for (const line of lines) {
    const trimmed = line.trim();
    const errorMatch = trimmed.match(/error\s+(CS\d+)/);
    if (errorMatch) {
      errorCodes.add(errorMatch[1]);
      errors.push(trimmed);
    }
    const warningMatch = trimmed.match(/warning\s+(CS\d+)/);
    if (warningMatch) {
      warningCodes.add(warningMatch[1]);
      warnings.push(trimmed);
    }
  }

  const errorFiles = errors.map(l => {
    const match = l.match(/([^:\\/]+\.cs)/);
    return match ? match[1] : 'desconhecido';
  });

  // Agrupa por arquivo+código de erro, pra ver rápido "esse arquivo tem 6x CS0103"
  // em vez de rolar uma lista plana de 6 linhas quase idênticas.
  const errorGroups = {};
  for (const line of errors) {
    const match = line.match(msbuildLineRegex);
    if (!match) continue;
    const [, file, lineNum, , , code, message] = match;
    const shortFile = file.split(/[\\/]/).pop();
    const key = `${shortFile} [${code}]`;
    if (!errorGroups[key]) errorGroups[key] = { file: shortFile, code, count: 0, occurrences: [] };
    errorGroups[key].count++;
    if (errorGroups[key].occurrences.length < 5) {
      errorGroups[key].occurrences.push({ line: Number(lineNum), message: message.trim() });
    }
  }
  const groupedErrors = Object.values(errorGroups).sort((a, b) => b.count - a.count);

  return {
    summary: `Build: ${errors.length} erro(s), ${warnings.length} warning(s)`,
    errors: errors.slice(0, 10),
    errorCount: errors.length,
    errorCodes: [...errorCodes],
    warningCodes: [...warningCodes],
    errorFiles: [...new Set(errorFiles)].slice(0, 5),
    errorGroups: groupedErrors.slice(0, 15),
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

// =============================================================================
// COMPACTAÇÃO PARA TESTES
// =============================================================================

function compactTestOutput(output, framework) {
  const lines = output.split('\n');
  let total = 0, passed = 0, failed = 0, skipped = 0;
  const failures = [];
  
  if (framework.includes('dotnet test') || framework.includes('test')) {
    for (const line of lines) {
      const totalMatch = line.match(/Total:\s*(\d+)/);
      if (totalMatch) total = parseInt(totalMatch[1]);
      const failedMatch = line.match(/Failed:\s*(\d+)/);
      if (failedMatch) failed = parseInt(failedMatch[1]);
      const passedMatch = line.match(/Passed:\s*(\d+)/);
      if (passedMatch) passed = parseInt(passedMatch[1]);
      const skippedMatch = line.match(/Skipped:\s*(\d+)/);
      if (skippedMatch) skipped = parseInt(skippedMatch[1]);
      
      if (line.includes('[FAIL]') || line.includes('Failed')) {
        const testMatch = line.match(/(\w+\.\w+)\s+\[FAIL\]/);
        if (testMatch) {
          failures.push({
            test: testMatch[1],
            error: line
          });
        } else {
          const altMatch = line.match(/Failed\s+([\w.]+)/);
          if (altMatch) {
            failures.push({
              test: altMatch[1],
              error: line
            });
          }
        }
      }
    }
  } else if (framework.includes('jest') || framework.includes('vitest')) {
    for (const line of lines) {
      const summaryMatch = line.match(/Tests:\s*(\d+)\s+passed,\s*(\d+)\s+total/);
      if (summaryMatch) {
        passed = parseInt(summaryMatch[1]);
        total = parseInt(summaryMatch[2]);
      }
      const altSummary = line.match(/Tests:\s*(\d+)\s+failed,\s*(\d+)\s+passed,\s*(\d+)\s+total/);
      if (altSummary) {
        failed = parseInt(altSummary[1]);
        passed = parseInt(altSummary[2]);
        total = parseInt(altSummary[3]);
      }
      if (line.includes('●')) {
        const testMatch = line.match(/●\s+(.+)$/);
        if (testMatch) {
          failures.push({
            test: testMatch[1].trim(),
            error: line
          });
        }
      }
    }
  } else if (framework.includes('pytest')) {
    for (const line of lines) {
      const summaryMatch = line.match(/(\d+)\s+passed,\s*(\d+)\s+failed/);
      if (summaryMatch) {
        passed = parseInt(summaryMatch[1]);
        failed = parseInt(summaryMatch[2]);
        total = passed + failed;
      }
      if (line.includes('FAILED') || line.includes('ERROR')) {
        const testMatch = line.match(/(\S+)\s+(FAILED|ERROR)/);
        if (testMatch) {
          failures.push({
            test: testMatch[1],
            error: line
          });
        }
      }
    }
  } else {
    for (const line of lines) {
      if (line.includes('FAIL') || line.includes('ERROR') || line.includes('✕')) {
        failures.push({
          test: line.substring(0, 50),
          error: line
        });
      }
      const stats = line.match(/(\d+)\s+passed?/i);
      if (stats) passed += parseInt(stats[1]);
      const fails = line.match(/(\d+)\s+failed?/i);
      if (fails) failed += parseInt(fails[1]);
    }
    total = passed + failed;
  }
  
  return {
    summary: `Tests: ${total} total, ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`,
    total,
    passed,
    failed,
    skipped,
    failures: failures.slice(0, 10),
    hasFailures: failed > 0 || failures.length > 0,
    framework: framework.split(' ')[0]
  };
}

// =============================================================================
// COMPACTAÇÃO PARA BUILD/NPM
// =============================================================================

function compactNpmBuildOutput(output, command) {
  const lines = output.split('\n');
  const errors = [];
  const warnings = [];
  const errorFiles = new Set();
  let hasTypeScriptErrors = false;
  
  for (const line of lines) {
    if (line.includes('TS') && line.includes('error')) {
      hasTypeScriptErrors = true;
      const match = line.match(/([^:]+\.tsx?):(\d+)/);
      if (match) errorFiles.add(match[1]);
      errors.push(line.trim());
    }
    
    if (line.includes('Module not found') || line.includes('Module build failed')) {
      errors.push(line.trim());
      const match = line.match(/'(.*?)'/);
      if (match) errorFiles.add(match[1]);
    }
    
    if (line.includes('error') || line.includes('Error') || line.includes('ERROR')) {
      errors.push(line.trim());
      const fileMatch = line.match(/([^:]+\.(ts|js|tsx|jsx|css|scss))/);
      if (fileMatch) errorFiles.add(fileMatch[1]);
    }
    
    if (line.includes('warning') || line.includes('Warning') || line.includes('WARNING')) {
      warnings.push(line.trim());
    }
  }
  
  return {
    summary: `Build: ${errors.length} erro(s), ${warnings.length} warning(s)${hasTypeScriptErrors ? ' 🔴 TypeScript errors detected' : ''}`,
    errors: errors.slice(0, 10),
    errorCount: errors.length,
    warningCount: warnings.length,
    errorFiles: [...errorFiles].slice(0, 5),
    hasErrors: errors.length > 0,
    hasTypeScriptErrors,
    isBuild: true
  };
}

function compactEslintOutput(output) {
  const lines = output.split('\n');
  const problems = [];
  let errorCount = 0;
  let warningCount = 0;
  
  for (const line of lines) {
    const match = line.match(/([^:]+):(\d+):(\d+)\s+(error|warning)\s+(.+)/);
    if (match) {
      const [, file, lineNum, col, severity, message] = match;
      problems.push({
        file: path.basename(file),
        line: parseInt(lineNum),
        column: parseInt(col),
        severity,
        message: message.trim()
      });
      if (severity === 'error') errorCount++;
      if (severity === 'warning') warningCount++;
    }
  }
  
  return {
    summary: `ESLint: ${errorCount} error(s), ${warningCount} warning(s)`,
    problems: problems.slice(0, 10),
    errorCount,
    warningCount,
    hasErrors: errorCount > 0,
    totalProblems: problems.length
  };
}

function compactDotnetPublish(output) {
  const lines = output.split('\n');
  const errors = [];
  let published = false;
  let publishPath = '';
  
  for (const line of lines) {
    if (line.includes('error') || line.includes('Error')) {
      errors.push(line.trim());
    }
    if (line.includes('Published to')) {
      published = true;
      const match = line.match(/Published to\s+(.+)/);
      if (match) publishPath = match[1].trim();
    }
    if (line.includes('Publish succeeded')) {
      published = true;
    }
  }
  
  return {
    summary: `Publish: ${errors.length} erro(s)${published ? ' ✅ Sucesso' : ''}`,
    errors: errors.slice(0, 10),
    errorCount: errors.length,
    hasErrors: errors.length > 0,
    published,
    publishPath,
    isPublish: true
  };
}

function compactNpmAuditOutput(output) {
  const lines = output.split('\n');
  let vulnerabilities = 0;
  let critical = 0, high = 0, moderate = 0, low = 0;
  let packages = [];
  
  for (const line of lines) {
    const match = line.match(/(\d+)\s+(critical|high|moderate|low)/i);
    if (match) {
      const count = parseInt(match[1]);
      const severity = match[2].toLowerCase();
      vulnerabilities += count;
      if (severity === 'critical') critical = count;
      else if (severity === 'high') high = count;
      else if (severity === 'moderate') moderate = count;
      else if (severity === 'low') low = count;
    }
    const pkgMatch = line.match(/Package\s+(\S+)\s+.*\s+(\S+)\s+-\s+(critical|high|moderate|low)/i);
    if (pkgMatch) {
      packages.push({
        name: pkgMatch[1],
        severity: pkgMatch[3],
        version: pkgMatch[2]
      });
    }
  }
  
  return {
    summary: `npm audit: ${vulnerabilities} vulnerabilidade(s)`,
    vulnerabilities: { critical, high, moderate, low, total: vulnerabilities },
    packages: packages.slice(0, 5),
    hasVulnerabilities: vulnerabilities > 0,
    isAudit: true
  };
}

function compactRestoreOutput(output) {
  const lines = output.split('\n');
  const restored = [];
  const errors = [];
  let totalPackages = 0;
  
  for (const line of lines) {
    if (line.includes('Restored') || line.includes('restored')) {
      const match = line.match(/Restored\s+(\d+)/i);
      if (match) totalPackages = parseInt(match[1]);
      restored.push(line.trim());
    }
    if (line.includes('error') || line.includes('Error')) {
      errors.push(line.trim());
    }
  }
  
  return {
    summary: `dotnet restore: ${totalPackages || restored.length} pacote(s) restaurados${errors.length > 0 ? `, ${errors.length} erro(s)` : ''}`,
    restored: restored.slice(0, 5),
    errors: errors.slice(0, 5),
    hasErrors: errors.length > 0,
    isRestore: true
  };
}

function compactInstallOutput(output) {
  const lines = output.split('\n');
  let added = 0;
  let removed = 0;
  const packages = [];
  
  for (const line of lines) {
    const addedMatch = line.match(/added\s+(\d+)/i);
    if (addedMatch) added = parseInt(addedMatch[1]);
    const removedMatch = line.match(/removed\s+(\d+)/i);
    if (removedMatch) removed = parseInt(removedMatch[1]);
    
    const pkgMatch = line.match(/\+ (\S+@\S+)/);
    if (pkgMatch) packages.push(pkgMatch[1]);
  }
  
  return {
    summary: `Installed: ${added} pacote(s) adicionado${added > 0 ? `, ${removed} removido` : ''}`,
    packages: packages.slice(0, 10),
    added,
    removed,
    isInstall: true
  };
}

function compactFormatOutput(output) {
  const lines = output.split('\n');
  const formatted = [];
  const errors = [];
  
  for (const line of lines) {
    if (line.includes('Formatting') || line.includes('formatted')) {
      formatted.push(line.trim());
    }
    if (line.includes('error') || line.includes('Error')) {
      errors.push(line.trim());
    }
  }
  
  return {
    summary: `Format: ${formatted.length} arquivo(s)${errors.length > 0 ? `, ${errors.length} erro(s)` : ''}`,
    formatted: formatted.slice(0, 5),
    errors: errors.slice(0, 5),
    hasErrors: errors.length > 0,
    isFormat: true
  };
}

function compactOutput(command, stdout, stderr) {
  const fullOutput = stdout + '\n' + stderr;
  const startTokens = fullOutput.length / 4;
  
  if (command.includes('dotnet test') || command.includes('jest') || 
      command.includes('vitest') || command.includes('pytest') ||
      command.includes('npm test') || command.includes('yarn test') ||
      command.includes('npx test')) {
    return compactTestOutput(fullOutput, command);
  }
  
  if (command.includes('npm run build') || command.includes('yarn build') ||
      command.includes('tsc') || command.includes('webpack') ||
      command.includes('vite build') || command.includes('rollup')) {
    return compactNpmBuildOutput(fullOutput, command);
  }
  
  if (command.includes('eslint') || command.includes('npx eslint')) {
    return compactEslintOutput(fullOutput);
  }
  
  if (command.includes('dotnet publish')) {
    return compactDotnetPublish(fullOutput);
  }
  
  if (command.includes('npm audit') || command.includes('yarn audit')) {
    return compactNpmAuditOutput(fullOutput);
  }
  
  if (command.includes('dotnet restore')) {
    return compactRestoreOutput(fullOutput);
  }
  
  if (command.includes('npm install') || command.includes('yarn install') || 
      command.includes('npm i') || command.includes('yarn add')) {
    return compactInstallOutput(fullOutput);
  }
  
  if (command.includes('dotnet format')) {
    return compactFormatOutput(fullOutput);
  }
  
  if (command.includes('dotnet build') || command.includes('dotnet test')) {
    return compactBuildOutput(fullOutput);
  }
  
  if (command.includes('git status')) {
    return compactGitStatus(stdout);
  }
  if (command.includes('git diff')) {
    return compactGitDiff(stdout);
  }
  
  const result = compactGenericOutput(fullOutput, command);
  const endTokens = JSON.stringify(result).length / 4;
  METRICS.tokensSaved += Math.max(0, startTokens - endTokens);
  return result;
}

// =============================================================================
// CONFIGURAÇÕES DE PERFORMANCE E SEGURANÇA
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

const PERFORMANCE_CONFIG = {
  concurrency: MCP_CONFIG.performance?.concurrency || Math.min(os.cpus().length * 2, 32),
  maxResults: MCP_CONFIG.performance?.maxResults || 2000,
  maxFiles: MCP_CONFIG.performance?.maxFiles || 1000,
  maxReadLines: MCP_CONFIG.performance?.maxReadLines || 1000,
  maxFileSize: MCP_CONFIG.performance?.maxFileSize || 15 * 1024 * 1024,
  maxWriteSize: MCP_CONFIG.performance?.maxWriteSize || 10 * 1024 * 1024,
  commandTimeout: MCP_CONFIG.performance?.commandTimeout || 60000
};

const BACKUP_CONFIG = {
  maxAge: MCP_CONFIG.backup?.maxAge || 7 * 24 * 60 * 60 * 1000,
  autoCleanup: MCP_CONFIG.backup?.autoCleanup !== false
};

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
  constructor(maxSize = 200, ttl = 30000) {
    if (MCP_CONFIG.cache) {
      maxSize = MCP_CONFIG.cache.fileCacheSize || maxSize;
      ttl = MCP_CONFIG.cache.fileCacheTTL || ttl;
    }
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
    // LRU real: Map preserva ordem de inserção, então mover a chave pro fim
    // faz com que set() (que remove sempre a primeira chave) descarte a
    // menos recentemente usada, não a mais antiga por inserção.
    this.cache.delete(key);
    this.cache.set(key, entry);
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

// Cache de .resx já parseado (reaproveita a SmartCache/LRU já existente). Evita reparsear
// o mesmo arquivo repetidas vezes numa sessão de tradução que consulta os 3 idiomas várias
// vezes seguidas. Confere o mtime do arquivo em disco além do TTL: se alguém editar o .resx
// por fora (Visual Studio, git pull, etc.) dentro da janela de 60s, o cache não serve dado velho.
const resxCache = new SmartCache(20, 60000);

async function getParsedResx(filePath) {
  const stat = await fs.promises.stat(filePath); // deixa propagar erro se não existir

  const cached = resxCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached;
  }

  const buffer = await fs.promises.readFile(filePath);
  const { text } = decodeBuffer(buffer);
  const keys = parseResxKeysWithValues(text);
  const data = { text, keys, mtimeMs: stat.mtimeMs };
  resxCache.set(filePath, data);
  return data;
}

class DirCache {
  constructor(ttl = 5000) {
    if (MCP_CONFIG.cache) {
      ttl = MCP_CONFIG.cache.dirCacheTTL || ttl;
    }
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

const fileCache = new SmartCache();
const searchCache = new SmartCache(50, 10000);
const dirCache = new DirCache();

// =============================================================================
// INVALIDAÇÃO DE CACHE
// =============================================================================

function invalidateCachePaths(targetPath) {
    const normalized = path.normalize(targetPath);
    
    for (const [key] of fileCache.cache) {
        if (key.startsWith(normalized) || key === normalized) {
            fileCache.cache.delete(key);
        }
    }
    
    for (const [key] of dirCache.cache) {
        if (key.startsWith(normalized) || key === normalized) {
            dirCache.cache.delete(key);
        }
    }

    for (const [key] of searchCache.cache) {
        if (key.startsWith(normalized) || key === normalized) {
            searchCache.cache.delete(key);
        }
    }

    for (const [key] of resxCache.cache) {
        if (key.startsWith(normalized) || key === normalized) {
            resxCache.cache.delete(key);
        }
    }
}

// =============================================================================
// LOGGER E SEGURANÇA
// =============================================================================

function logOperation(operation, filePath, user = 'cline') {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ${user} ${operation} ${filePath}`);
}

function validatePath(inputPath, baseDir = process.cwd()) {
  const normalizedInput = path.normalize(inputPath);
  const resolved = path.resolve(baseDir, normalizedInput);
  const normalized = path.normalize(resolved);
  if (ALLOWED_ROOTS.length > 0) {
    // Comparação case-insensitive: NTFS/Windows não diferencia maiúscula/minúscula em
    // caminhos, então "C:\Tony\..." e "c:\tony\..." são o MESMO arquivo de verdade —
    // uma comparação sensível a caso podia rejeitar um caminho válido só por causa de
    // como alguma ferramenta upstream normalizou as letras.
    const normalizedLower = normalized.toLowerCase();
    const allowed = ALLOWED_ROOTS.some(root => {
      const rootLower = root.toLowerCase();
      return normalizedLower === rootLower || normalizedLower.startsWith(rootLower + path.sep);
    });
    if (!allowed) {
      throw new Error(`Caminho fora das pastas permitidas em .mcp-config.json (allowedRoots): ${normalized}`);
    }
  }
  return normalized;
}

async function checkWritePermission(filePath) {
  try {
    const dir = path.dirname(filePath);
    await fs.promises.access(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
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
      serverInfo: { name: 'node-search', version: '8.5.0' }
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
    const startTime = Date.now();
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
        case 'undo_last_change': await executeUndoLastChange(id, toolArgs); break;
        case 'code_outline': await executeCodeOutline(id, toolArgs); break;
        case 'find_references': await executeFindReferences(id, toolArgs); break;
        case 'find_in_project': await executeFindInProject(id, toolArgs); break;
        case 'rename_symbol': await executeRenameSymbol(id, toolArgs); break;
        case 'get_code_smells': await executeCodeSmells(id, toolArgs); break;
        case 'get_diagnostics': await executeGetDiagnostics(id, toolArgs); break;
        case 'project_info': await executeProjectInfo(id, toolArgs); break;
        case 'analyze_dependencies': await executeAnalyzeDependencies(id, toolArgs); break;
        case 'compare_files': await executeCompareFiles(id, toolArgs); break;
        case 'get_symbol_usage': await executeGetSymbolUsage(id, toolArgs); break;
        case 'code_completion': await executeCodeCompletion(id, toolArgs); break;
        case 'analyze_complexity': await executeAnalyzeComplexity(id, toolArgs); break;
        case 'get_type_info': await executeGetTypeInfo(id, toolArgs); break;
        case 'get_call_hierarchy': await executeCallHierarchy(id, toolArgs); break;
        case 'find_unused_code': await executeFindUnusedCode(id, toolArgs); break;
        case 'extract_interface': await executeExtractInterface(id, toolArgs); break;
        case 'get_metrics': await executeGetMetrics(id, toolArgs); break;
        case 'get_cache_stats': await executeGetCacheStats(id, toolArgs); break;
        case 'generate_labels': await executeGenerateLabels(id, toolArgs); break;
        case 'insert_translations': await executeInsertTranslations(id, toolArgs); break;
        case 'delete_translations': await executeDeleteTranslations(id, toolArgs); break;
        case 'find_unused_translations': await executeFindUnusedTranslations(id, toolArgs); break;
        case 'find_missing_loc_keys': await executeFindMissingLocKeys(id, toolArgs); break;
        case 'resolve_case_duplicates': await executeResolveCaseDuplicates(id, toolArgs); break;
        case 'get_translation_context': await executeGetTranslationContext(id, toolArgs); break;
        case 'get_existing_translations': await executeGetExistingTranslations(id, toolArgs); break;
        case 'deduplicate_resx': await executeDeduplicateResx(id, toolArgs); break;
        case 'find_duplicates': await executeFindDuplicates(id, toolArgs); break;
        case 'add_language': await executeAddLanguage(id, toolArgs); break;
        case 'fix_mojibake': await executeFixMojibake(id, toolArgs); break;
        case 'get_file_history': await executeGetFileHistory(id, toolArgs); break;
        case 'analyze_i18n_health': await executeAnalyzeI18nHealth(id, toolArgs); break;
        case 'analyze_migration_readiness': await executeAnalyzeMigrationReadiness(id, toolArgs); break;
        default: writeToolError(id, `Tool not found: ${toolName}`);
      }
      const duration = Date.now() - startTime;
      trackOperation(toolName, duration);
      trackCommand(true);
    } catch (err) {
      const duration = Date.now() - startTime;
      trackOperation(toolName, duration);
      trackCommand(false);
      trackError(toolName);
      writeToolError(id, `Erro: ${err.message}`);
    }
    return;
  }

  if (id !== undefined && id !== null) {
    writeError(id, -32601, `Method not found: ${method}`);
  }
}

// =============================================================================
// TOOL DEFINITIONS - COMPLETO (44 TOOLS)
// =============================================================================

const ALL_TOOL_DEFINITIONS = {
  // =========================================================================
  // BUSCA E SÍMBOLOS (6)
  // =========================================================================
  
  find_symbol: {
    name: 'find_symbol',
    description: '💰 Busca DECLARAÇÃO de classe/método/propriedade em .cs/.razor.cs/.razor. Suporta C# 13/.NET 10 (primary constructors, required, interceptors).',
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
    description: '📖 Retorna o corpo COMPLETO de um símbolo (método, classe, propriedade). Use DEPOIS de find_symbol.',
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
    description: '🔍 Busca conteúdo em arquivos usando ripgrep (SUPER RÁPIDO!). Use quando NÃO sabe o nome exato do símbolo.',
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
        maxResults: { type: 'number', description: 'Máximo de resultados. Default: 500, máx 2000' },
        noCache: { type: 'boolean', description: 'Ignora e não grava no cache de 10s (força busca fresca). Default: false' }
      },
      required: ['pattern', 'path']
    }
  },
  
  find_references: {
    name: 'find_references',
    description: '🔍 Encontra todos os usos de um símbolo no projeto (busca textual)',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome do símbolo' },
        path: { type: 'string', description: 'Diretório para buscar (default: .)' },
        filePattern: { type: 'string', description: 'Extensões (default: .cs,.razor)' },
        maxResults: { type: 'number', description: 'Máximo de resultados. Default: 100' }
      },
      required: ['name']
    }
  },
  
  find_in_project: {
    name: 'find_in_project',
    description: '🔍 Busca inteligente em todo o projeto com relevância e contexto. Economiza ~95% de tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Padrão a buscar' },
        path: { type: 'string', description: 'Diretório (default: .)' },
        filePattern: { type: 'string', description: 'Extensões (default: .cs,.razor)' },
        includeComments: { type: 'boolean', description: 'Incluir comentários. Default: false' },
        maxResults: { type: 'number', description: 'Máx resultados. Default: 50' },
        minRelevance: { type: 'number', description: 'Relevância mínima (0-100). Default: 30' }
      },
      required: ['pattern']
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

  // =========================================================================
  // ARQUIVOS E EDIÇÃO (8)
  // =========================================================================
  
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
    description: '✏️ Substitui o CONTEÚDO INTEIRO de um arquivo (não é find-and-replace — não existe oldText/newText aqui). Para trocar um trecho específico sem reescrever o arquivo todo, use replace_in_files. Mostra preview de diff antes de aplicar. Backup automático.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho do arquivo' },
        content: { type: 'string', description: 'Conteúdo NOVO e COMPLETO do arquivo (substitui tudo, não é um patch)' },
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

  // =========================================================================
  // ANÁLISE (8)
  // =========================================================================
  
  code_outline: {
    name: 'code_outline',
    description: '📋 Mostra estrutura do arquivo (classes, métodos, propriedades, campos, enums)',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho do arquivo .cs ou .razor' },
        maxDepth: { type: 'number', description: 'Profundidade máxima. Default: 3' }
      },
      required: ['path']
    }
  },
  
  get_code_smells: {
    name: 'get_code_smells',
    description: '🔍 Detecta code smells (métodos longos, classes grandes, aninhamento profundo). Economiza ~95% de tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Arquivo ou diretório' },
        thresholds: { type: 'object', description: 'Limites personalizados' },
        suggestions: { type: 'boolean', description: 'Incluir sugestões. Default: true' }
      },
      required: ['path']
    }
  },
  
  get_diagnostics: {
    name: 'get_diagnostics',
    description: '🔍 Obtém erros e warnings do projeto (dotnet build, tsc, eslint). Economiza ~95% de tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Diretório do projeto' },
        type: { type: 'string', enum: ['dotnet', 'typescript', 'eslint', 'all'], description: 'Tipo de diagnóstico. Default: all' }
      },
      required: ['path']
    }
  },
  
  project_info: {
    name: 'project_info',
    description: '📋 Mostra informações do projeto (.csproj, package.json, etc). Economiza ~98% de tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Diretório do projeto' }
      },
      required: ['path']
    }
  },
  
  analyze_dependencies: {
    name: 'analyze_dependencies',
    description: '📦 Analisa dependências entre arquivos/projetos. Economiza ~99% de tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Diretório' },
        output: { type: 'string', enum: ['graph', 'list', 'stats'], description: 'Tipo de saída. Default: stats' }
      },
      required: ['path']
    }
  },
  
  compare_files: {
    name: 'compare_files',
    description: '📊 Compara dois arquivos e mostra diferenças. Economiza ~98% de tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        file1: { type: 'string', description: 'Primeiro arquivo' },
        file2: { type: 'string', description: 'Segundo arquivo' },
        format: { type: 'string', enum: ['unified', 'side-by-side', 'json'], description: 'Formato de saída. Default: unified' }
      },
      required: ['file1', 'file2']
    }
  },
  
  get_symbol_usage: {
    name: 'get_symbol_usage',
    description: '📊 Estatísticas de uso de um símbolo (frequência, arquivos, etc). Economiza ~94% de tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome do símbolo' },
        path: { type: 'string', description: 'Diretório (default: .)' },
        filePattern: { type: 'string', description: 'Extensões (default: .cs,.razor)' }
      },
      required: ['name']
    }
  },
  
  analyze_complexity: {
    name: 'analyze_complexity',
    description: '📊 Análise de complexidade ciclomática e cognitiva. Economiza ~99% de tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Arquivo ou diretório' },
        threshold: { type: 'number', description: 'Limite de complexidade. Default: 10' }
      },
      required: ['path']
    }
  },

  // =========================================================================
  // REFATORAÇÃO (4)
  // =========================================================================
  
  rename_symbol: {
    name: 'rename_symbol',
    description: '✏️ Renomeia um símbolo em todo o projeto (inclui referências)',
    inputSchema: {
      type: 'object',
      properties: {
        oldName: { type: 'string', description: 'Nome atual do símbolo' },
        newName: { type: 'string', description: 'Novo nome' },
        path: { type: 'string', description: 'Diretório (default: .)' },
        filePattern: { type: 'string', description: 'Extensões (default: .cs,.razor)' },
        dryRun: { type: 'boolean', description: 'Preview. Default: true' }
      },
      required: ['oldName', 'newName']
    }
  },
  
  extract_interface: {
    name: 'extract_interface',
    description: '📤 Extrai uma interface de uma classe existente',
    inputSchema: {
      type: 'object',
      properties: {
        classPath: { type: 'string', description: 'Caminho da classe' },
        className: { type: 'string', description: 'Nome da classe' },
        methods: { type: 'array', description: 'Métodos para incluir (opcional)' },
        dryRun: { type: 'boolean', description: 'Preview. Default: true' }
      },
      required: ['classPath', 'className']
    }
  },
  
  get_type_info: {
    name: 'get_type_info',
    description: '📋 Informações detalhadas de um tipo (propriedades, métodos, herança)',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome do tipo' },
        path: { type: 'string', description: 'Diretório (default: .)' }
      },
      required: ['name', 'path']
    }
  },
  
  find_unused_code: {
    name: 'find_unused_code',
    description: '🔍 Encontra código não utilizado (métodos, propriedades, classes)',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Diretório (default: .)' },
        filePattern: { type: 'string', description: 'Extensões (default: .cs,.razor)' },
        includeTests: { type: 'boolean', description: 'Incluir arquivos de teste. Default: false' }
      },
      required: ['path']
    }
  },

  // =========================================================================
  // ESTRUTURA (1)
  // =========================================================================
  
  get_call_hierarchy: {
    name: 'get_call_hierarchy',
    description: '🌳 Mostra quem chama um método e quem é chamado por ele',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome do método' },
        path: { type: 'string', description: 'Diretório (default: .)' },
        direction: { type: 'string', enum: ['incoming', 'outgoing', 'both'], description: 'Direção da análise. Default: both' },
        maxDepth: { type: 'number', description: 'Profundidade máxima. Default: 3' }
      },
      required: ['name', 'path']
    }
  },

  // =========================================================================
  // COMANDOS (1)
  // =========================================================================
  
  compact_command: {
    name: 'compact_command',
    description: '⚡ Executa um comando e retorna a saída COMPACTADA. Economiza ~90% de tokens. Suporta: dotnet build, dotnet test, dotnet publish, dotnet restore, dotnet format, npm run build, npm audit, npm install, tsc, webpack, eslint, jest, vitest, pytest, git diff, git status.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Comando a executar' },
        args: { type: 'string', description: 'Argumentos do comando (opcional)' },
        cwd: { type: 'string', description: 'Diretório de trabalho (default: .)' }
      },
      required: ['command']
    }
  },

  // =========================================================================
  // UTILIDADES (4)
  // =========================================================================
  
  undo_last_change: {
    name: 'undo_last_change',
    description: '↩️ Restaura um arquivo a partir do backup .bak mais recente (rollback)',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho do arquivo a restaurar' },
        timestamp: { type: 'string', description: 'Timestamp específico do backup (opcional)' },
        dryRun: { type: 'boolean', description: 'Preview sem restaurar. Default: true' }
      },
      required: ['path']
    }
  },
  
  get_metrics: {
    name: 'get_metrics',
    description: '📊 Mostra métricas de uso do servidor (operações, tokens economizados, uptime)',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  
  get_cache_stats: {
    name: 'get_cache_stats',
    description: '📊 Mostra estatísticas do cache (hits/misses/tamanho) para diagnóstico',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  
  code_completion: {
    name: 'code_completion',
    description: '💡 Sugere completações de código baseado no contexto. Economiza ~99% de tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Arquivo atual' },
        line: { type: 'number', description: 'Linha atual' },
        column: { type: 'number', description: 'Coluna atual' },
        context: { type: 'string', description: 'Texto ao redor do cursor' },
        maxSuggestions: { type: 'number', description: 'Número de sugestões. Default: 5' }
      },
      required: ['file']
    }
  },

  // =========================================================================
  // I18N / RESX (7)
  // =========================================================================
  
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

  delete_translations: {
    name: 'delete_translations',
    description: '🗑️ Remove chaves de todos os idiomas de uma vez (simétrico ao insert_translations). Antes de usar, confirme com find_references/get_symbol_usage que a chave não é mais referenciada em nenhum .cs/.razor — o tool não checa isso sozinho.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Diretório dos .resx' },
        keys: { type: 'array', description: 'Nomes das chaves a remover', items: { type: 'string' } },
        languages: { type: 'array', description: 'Idiomas a processar (default: pt-BR, en-US, es-ES)', items: { type: 'string' } },
        dryRun: { type: 'boolean', description: 'Preview. Default: true' },
        backup: { type: 'boolean', description: 'Criar backup. Default: true' }
      },
      required: ['path', 'keys']
    }
  },

  find_unused_translations: {
    name: 'find_unused_translations',
    description: '🔍 Acha chaves declaradas no .resx que não aparecem em nenhum .cs/.razor — candidatas a delete_translations. Varre o código uma vez só (não uma busca por chave), então funciona bem mesmo com milhares de chaves. Heurística: confira uma amostra antes de excluir de verdade.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Diretório dos .resx' },
        codePath: { type: 'string', description: 'Raiz do código a varrer, se for diferente de "path" (default: mesmo valor de path)' },
        languages: { type: 'array', description: 'Idiomas a considerar (default: pt-BR, en-US, es-ES)', items: { type: 'string' } },
        extensions: { type: 'array', description: 'Extensões de código a varrer (default: [".cs",".razor"])', items: { type: 'string' } }
      },
      required: ['path']
    }
  },

  find_missing_loc_keys: {
    name: 'find_missing_loc_keys',
    description: '🔍 O inverso do find_unused_translations: acha Loc["Chave"] usado no código que não existe em NENHUM .resx — pega erro de digitação na chave e tradução esquecida (hardcode que criou a chave sem passar por generate_labels/insert_translations).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Diretório dos .resx' },
        codePath: { type: 'string', description: 'Raiz do código a varrer, se for diferente de "path" (default: mesmo valor de path)' },
        languages: { type: 'array', description: 'Idiomas a considerar (default: pt-BR, en-US, es-ES)', items: { type: 'string' } },
        extensions: { type: 'array', description: 'Extensões de código a varrer (default: [".cs",".razor"])', items: { type: 'string' } }
      },
      required: ['path']
    }
  },

  resolve_case_duplicates: {
    name: 'resolve_case_duplicates',
    description: '🧹 Cruza duplicatas de chave por maiúscula/minúscula (LabelCEP vs LabelCep) com o uso real de Loc["..."] no código, pra decidir com segurança qual variante manter. Loc[...] é lookup em runtime, não checado em compilação — excluir a variante errada nunca quebra o build, só deixa de traduzir aquele texto. Só marca "seguro pra remover" quando o uso é inequívoco (exatamente 1 variante referenciada); o resto vai pra needsReview.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Diretório dos .resx' },
        codePath: { type: 'string', description: 'Raiz do código a varrer, se for diferente de "path" (default: mesmo valor de path)' },
        languages: { type: 'array', description: 'Idiomas a considerar (default: pt-BR, en-US, es-ES)', items: { type: 'string' } },
        extensions: { type: 'array', description: 'Extensões de código a varrer (default: [".cs",".razor"])', items: { type: 'string' } }
      },
      required: ['path']
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
  },

  fix_mojibake: {
    name: 'fix_mojibake',
    description: 'Detecta e corrige mojibake (acentos corrompidos por double-encoding UTF-8, ex: "Ã§Ã£o" em vez de "ção") em .resx e outros arquivos de texto. Só corrige quando confirma que reduz o número de sequências suspeitas e não introduz caracteres inválidos — se não tiver certeza, não mexe no arquivo.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Arquivo ou diretório a verificar' },
        extensions: { type: 'array', description: 'Extensões a verificar (default: [".resx"])', items: { type: 'string' } },
        dryRun: { type: 'boolean', description: 'Preview sem alterar. Default: true' },
        backup: { type: 'boolean', description: 'Criar backup antes de corrigir. Default: true' }
      },
      required: ['path']
    }
  },

  get_file_history: {
    name: 'get_file_history',
    description: '📜 Lista os backups (.bak.*) de um arquivo, mais recente primeiro — útil pra ver o histórico de alterações antes de decidir se usa undo_last_change.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho do arquivo (não do backup)' }
      },
      required: ['path']
    }
  },

  analyze_i18n_health: {
    name: 'analyze_i18n_health',
    description: '🌍 Compara as chaves entre os .resx de vários idiomas: aponta chave faltando em algum idioma e tradução vazia no idioma primário quando outros já têm valor.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Pasta com os SharedResources.<lang>.resx' },
        languages: { type: 'array', description: 'Idiomas a comparar (default: pt-BR, en-US, es-ES)', items: { type: 'string' } },
        primaryLanguage: { type: 'string', description: 'Idioma fonte pra checar valores vazios (default: pt-BR)' }
      },
      required: ['path']
    }
  },

  analyze_migration_readiness: {
    name: 'analyze_migration_readiness',
    description: '🚦 Classifica arquivos .cs/.razor por criticidade pra migração Blazor Server -> Auto, baseado em assinaturas de código reais (DbContext, certificado digital, SEFAZ, HttpContext, etc.), não em interpretação do LLM. Categoria C = nunca pode virar WASM puro; A = seguro pra mover (DTO/asset); B = revisar manualmente.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Pasta raiz a analisar' },
        extensions: { type: 'array', description: 'Extensões a verificar (default: [".cs",".razor",".css",".js"])', items: { type: 'string' } }
      },
      required: ['path']
    }
  }
};

function getToolDefinitions() {
  return ACTIVE_TOOLS.map(name => ALL_TOOL_DEFINITIONS[name]).filter(Boolean);
}

// =============================================================================
// FUNÇÕES DE BUSCA - search_content, search_in_file, ripgrep
// =============================================================================

async function executeSearchInFile(id, filePath, pattern, simpleMatch, caseSensitive, context) {
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size === 0) {
      return writeResult(id, { 
        content: [{ type: 'text', text: `📋 Arquivo vazio: ${filePath}` }] 
      });
    }
    if (stat.size > PERFORMANCE_CONFIG.maxFileSize) {
      return writeToolError(id, `📋 Arquivo muito grande. Use search_content com diretório.`);
    }

    const buffer = await fs.promises.readFile(filePath);
    const { text } = decodeBuffer(buffer);
    const lines = text.split(/\r\n|\r|\n/);
    
    const regex = simpleMatch ? new RegExp(escapeRegex(pattern), caseSensitive ? 'g' : 'gi') : new RegExp(pattern, caseSensitive ? 'g' : 'gi');
    const results = [];
    let totalFound = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      regex.lastIndex = 0;
      if (regex.test(line)) {
        totalFound++;
        const trimmed = truncateLine(line.trim());
        const contextLines = context > 0 ? getLineContext(lines, i, context) : '';
        results.push({
          line: i + 1,
          text: trimmed,
          context: contextLines
        });
      }
    }

    if (results.length === 0) {
      return writeResult(id, { 
        content: [{ type: 'text', text: `📋 Nenhuma ocorrência de "${pattern}" em ${filePath}` }] 
      });
    }

    const output = results.map(r => 
      `L${r.line}: ${r.text}${r.context ? `\n  Contexto: ${r.context}` : ''}`
    ).join('\n');

    writeResult(id, {
      content: [{
        type: 'text',
        text: `🔍 Encontradas ${totalFound} ocorrência(s) de "${pattern}" em ${filePath}:\n\n${output}`
      }]
    });
  } catch (err) {
    writeToolError(id, `❌ Erro ao buscar no arquivo: ${err.message}`);
  }
}

async function executeSearchContent(id, args) {
  const searchPath = args.path || '.';
  const pattern = args.pattern;
  const fileExts = args.filePattern ? args.filePattern.split(',').map(e => e.trim()).filter(Boolean) : null;
  const excludeExts = args.excludePattern ? args.excludePattern.split(',').map(e => e.trim()).filter(Boolean) : null;
  const simpleMatch = args.simpleMatch || false;
  const caseSensitive = args.caseSensitive || false;
  const context = Math.min(args.context || 0, 5);
  const maxResults = Math.min(args.maxResults || 500, PERFORMANCE_CONFIG.maxResults);
  const noCache = args.noCache || false;

  if (!pattern) {
    return writeToolError(id, '❌ Parâmetro "pattern" é obrigatório.');
  }

  // Cache de resultado de busca (TTL curto de 10s — searchCache já existia mas nunca era usado).
  // A chave começa com o path normalizado pra invalidateCachePaths conseguir limpar em writes.
  // noCache:true pula tanto a leitura quanto a gravação — útil pra debug quando o resultado
  // parece "desatualizado" e você quer forçar uma varredura fresca sem esperar o TTL de 10s.
  let cacheKey = null;
  if (!noCache) {
    try {
      const normalizedForCache = path.normalize(path.resolve(searchPath));
      cacheKey = `${normalizedForCache}|${pattern}|${fileExts || ''}|${excludeExts || ''}|${simpleMatch}|${caseSensitive}|${context}|${maxResults}`;
      const cached = searchCache.get(cacheKey);
      if (cached) {
        return writeResult(id, { content: [{ type: 'text', text: `${cached}\n\n_(cache)_` }] });
      }
    } catch { /* se der erro montando a chave, só segue sem cache */ }
  }

  try {
    const stat = await fs.promises.stat(searchPath);
    if (stat.isFile() && stat.size === 0) {
      return writeResult(id, { 
        content: [{ type: 'text', text: `📋 Arquivo vazio: ${searchPath}` }] 
      });
    }
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
  const seenResults = new Set();

  const regex = simpleMatch ? new RegExp(escapeRegex(pattern), caseSensitive ? 'g' : 'gi') : new RegExp(pattern, caseSensitive ? 'g' : 'gi');

  let processedFiles = 0;
  const totalFiles = files.length;
  const startTime = Date.now();

  await runPool(files, PERFORMANCE_CONFIG.concurrency, async (filePath) => {
    processedFiles++;
    if (processedFiles % Math.max(1, Math.floor(totalFiles / 10)) === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(`📊 ${searchPath}: ${processedFiles}/${totalFiles} arquivos (${elapsed}s)`);
    }
    
    if (isTruncated || shuttingDown) return;
    if (await isLikelyBinary(filePath)) return;

    let buffer = fileCache.get(filePath);
    if (!buffer) {
      try { buffer = await fs.promises.readFile(filePath); } catch { return; }
      if (buffer.length <= PERFORMANCE_CONFIG.maxFileSize) fileCache.set(filePath, buffer);
    }
    if (buffer.length > PERFORMANCE_CONFIG.maxFileSize) return;

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
        
        const resultKey = `${filePath}:${lineNum}`;
        if (seenResults.has(resultKey)) continue;
        seenResults.add(resultKey);
        
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
    const emptyText = `📋 Nenhuma ocorrência de "${pattern}" em ${files.length} arquivo(s)`;
    if (cacheKey) searchCache.set(cacheKey, emptyText);
    return writeResult(id, { content: [{ type: 'text', text: emptyText }] });
  }

  const output = results.map(r => r.text + (r.after.length ? ` | after=[${r.after.join('│')}]` : ''));
  const note = isTruncated ? `\n\n_(Truncado em ${maxResults} resultados. Use filtro mais específico.)_` : '';
  const finalText = `🔍 Encontradas ${totalFound} ocorrência(s) de "${pattern}" em ${searchPath} (${files.length} arquivos)\n\n${output.join('\n')}${note}`;

  if (cacheKey) searchCache.set(cacheKey, finalText);

  writeResult(id, { content: [{ type: 'text', text: finalText }] });
}

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

async function executeSearchFiles(id, args) {
  const argsCopy = { ...args };
  await executeSearchContent(id, argsCopy);
}

// =============================================================================
// FUNÇÕES DE SÍMBOLOS - find_symbol, get_symbol_source
// =============================================================================

function buildSymbolPatterns(name) {
  const n = escapeRegex(name);
  const mod = '(?:public|private|protected|internal|static|sealed|abstract|partial|virtual|override|async|readonly|\\s)*';
  
  return [
    // C# 13/.NET 10: Primary Constructor
    ['class', new RegExp(`\\b${mod}\\b(?:class|interface|struct|record)\\s+${n}\\s*(?:<[^>]*>)?\\s*\\([^)]*\\)`, 'i')],
    ['class', new RegExp(`\\b${mod}\\b(?:class|interface|struct|record)\\s+${n}\\b`, 'i')],
    // C# 11+: Required modifier
    ['property', new RegExp(`\\b(?:public|private|protected|internal)\\s+required\\s+\\w+\\s+${n}\\s*\\{`, 'i')],
    // C# 12+: Interceptors
    ['method', new RegExp(`\\b(?:public|private|protected|internal)?\\s*(?:static\\s+)?\\w+\\s+${n}\\s*\\(\\s*this\\s+`, 'i')],
    // Métodos normais
    ['method', new RegExp(`\\b${mod}\\b(?:async\\s+)?(?:Task|void|\\w+)\\s+${n}\\s*\\(`, 'i')],
    // Propriedades normais
    ['property', new RegExp(`\\b${mod}\\b(?:\\w+)\\s+${n}\\s*\\{\\s*(?:get|set)?`, 'i')],
    // Construtores
    ['constructor', new RegExp(`\\b(?:public|private|protected|internal)\\s+${n}\\s*\\(`, 'i')],
    // Campos (o lookahead (?!>) evita casar 'Total => 5' como campo, deixando pro padrão de property abaixo)
    ['field', new RegExp(`\\b(?:public|private|protected|internal|readonly)\\s+\\w+\\s+${n}\\s*(?:;|=(?!>))`, 'i')],
    // Enums
    ['enum', new RegExp(`\\benum\\s+${n}\\b`, 'i')],
    // Expression-bodied members: public int Total => items.Count;
    ['method', new RegExp(`\\b${mod}\\b(?:async\\s+)?\\w+\\s+${n}\\s*\\([^)]*\\)\\s*=>`, 'i')],
    ['property', new RegExp(`\\b${mod}\\b\\w+\\s+${n}\\s*=>`, 'i')]
  ];
}

function extractRazorCodeBlocks(text) {
  const blocks = [];
  
  // @code : BaseClass (com herança)
  const codeRegex = /@code\s*(?::\s*(\w+))?\s*{([^}]*)}/g;
  let match;
  while ((match = codeRegex.exec(text)) !== null) {
    const baseClass = match[1] || null;
    const content = match[2];
    blocks.push({ content, baseClass });
  }
  
  // @functions { ... } (legado)
  const funcRegex = /@functions\s*{([^}]*)}/g;
  while ((match = funcRegex.exec(text)) !== null) {
    blocks.push({ content: match[1], baseClass: null });
  }
  
  return blocks;
}

async function executeFindSymbol(id, args) {
  const name = args.name;
  if (!name) return writeToolError(id, '❌ "name" é obrigatório.');
  const searchPath = args.path || '.';
  const kind = args.kind || 'any';
  const maxResults = Math.min(args.maxResults || 100, 500);

  const safePath = validatePath(searchPath);

  // Suporte completo a Blazor
  const blazorExts = ['.cs', '.razor.cs', '.razor', '.razor.css', '.razor.js', '.cshtml'];
  const files = await collectFiles(safePath, blazorExts, null);

  const relevantFiles = [];
  await runPool(files, PERFORMANCE_CONFIG.concurrency, async (filePath) => {
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
  const seenSymbols = new Set();

  await runPool(relevantFiles, PERFORMANCE_CONFIG.concurrency, async (filePath) => {
    if (results.length >= maxResults || shuttingDown) return;
    let buffer;
    try { buffer = await fs.promises.readFile(filePath); } catch { return; }
    if (buffer.length > PERFORMANCE_CONFIG.maxFileSize) return;
    const { text } = decodeBuffer(buffer);
    const lines = text.split(/\r\n|\r|\n/);

    let razorCodeBlocks = [];
    if (filePath.endsWith('.razor')) {
      razorCodeBlocks = extractRazorCodeBlocks(text);
    }

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
          
          const symbolKey = `${filePath}:${i + 1}:${symbolKind}`;
          if (!seenSymbols.has(symbolKey)) {
            seenSymbols.add(symbolKey);
            results.push({
              file: filePath,
              line: i + 1,
              kind: symbolKind,
              text: truncateLine(fullText)
            });
          }
          break;
        }
      }
    }

    // Verificar símbolos dentro de @code/@functions (com herança)
    if (razorCodeBlocks.length > 0) {
      for (const block of razorCodeBlocks) {
        // Adicionar informação de herança se disponível
        if (block.baseClass) {
          const symbolKey = `${filePath}:@code:base:${block.baseClass}`;
          if (!seenSymbols.has(symbolKey)) {
            seenSymbols.add(symbolKey);
            results.push({
              file: filePath,
              line: -1,
              kind: 'class',
              text: `@code : ${block.baseClass} (componente herda de ${block.baseClass})`
            });
          }
        }
        
        const blockLines = block.content.split('\n');
        for (let i = 0; i < blockLines.length && results.length < maxResults; i++) {
          const line = blockLines[i];
          for (const [symbolKind, regex] of allPatterns) {
            if (regex.test(line)) {
              const symbolKey = `${filePath}:@code:${i + 1}:${symbolKind}`;
              if (!seenSymbols.has(symbolKey)) {
                seenSymbols.add(symbolKey);
                results.push({
                  file: filePath,
                  line: -1,
                  kind: symbolKind,
                  text: truncateLine(`@code { ... } -> ${line.trim()}`)
                });
              }
              break;
            }
          }
        }
      }
    }
  });

  if (results.length === 0) {
    let suggestions = [];
    
    if (searchPath.includes('.razor')) {
      suggestions.push('Verifique se o símbolo está dentro de @code { } ou @functions { }');
    }
    
    suggestions.push('Use search_content para encontrar usos do símbolo');
    
    if (name !== name.toLowerCase()) {
      suggestions.push('A busca é case-insensitive, mas o símbolo pode ter capitalização diferente');
    }
    
    suggestions.push('Verifique se o arquivo está em .cs, .razor.cs ou .razor');
    suggestions.push('Para C# 13/.NET 10: verifique primary constructors, required modifiers ou interceptors');
    
    return writeResult(id, { 
      content: [{ 
        type: 'text', 
        text: `📋 Nenhuma declaração de "${name}" encontrada em ${searchPath}.\n\n💡 Sugestões:\n${suggestions.map(s => `  • ${s}`).join('\n')}` 
      }] 
    });
  }

  const output = results.map(r => {
    const lineInfo = r.line === -1 ? '[@code]' : `:${r.line}`;
    return `${r.file}${lineInfo} [${r.kind}] ${r.text}`;
  });
  const note = results.length >= maxResults ? `\n\n_(Truncado em ${maxResults})_` : '';

  writeResult(id, {
    content: [{
      type: 'text',
      text: `💰 ${results.length} declaração(ões) de "${name}" (${relevantFiles.length} arquivos verificados):\n\n${output.join('\n')}${note}\n\n💡 Suporta C# 13/.NET 10: primary constructors, required, interceptors.`
    }]
  });
}

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
      if (stat.size === 0) {
        return writeResult(id, { 
          content: [{ type: 'text', text: `📋 Arquivo vazio: ${safePath}` }] 
        });
      }
      filesToSearch = [safePath];
    } else {
      const blazorExts = ['.cs', '.razor.cs', '.razor', '.razor.css', '.razor.js', '.cshtml'];
      filesToSearch = await collectFiles(safePath, blazorExts, null);
    }
  } catch {
    const blazorExts = ['.cs', '.razor.cs', '.razor', '.razor.css', '.razor.js', '.cshtml'];
    filesToSearch = await collectFiles(safePath, blazorExts, null);
  }

  const allPatterns = buildSymbolPatterns(symbolName).filter(([k]) => kind === 'any' || k === kind);

  for (const filePath of filesToSearch) {
    let buffer;
    try { buffer = await fs.promises.readFile(filePath); } catch { continue; }
    if (buffer.length > PERFORMANCE_CONFIG.maxFileSize) continue;
    const { text } = decodeBuffer(buffer);
    const lines = text.split(/\r\n|\r|\n/);

    let razorCodeBlocks = [];
    if (filePath.endsWith('.razor')) {
      razorCodeBlocks = extractRazorCodeBlocks(text);
    }

    let startLine = -1;
    let endLine = -1;
    let symbolKind = '';
    let foundInRazorCode = false;

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

    if (startLine === -1 && razorCodeBlocks.length > 0) {
      for (const block of razorCodeBlocks) {
        const blockLines = block.content.split('\n');
        for (let i = 0; i < blockLines.length; i++) {
          const line = blockLines[i];
          for (const [kind, regex] of allPatterns) {
            if (regex.test(line)) {
              foundInRazorCode = true;
              symbolKind = kind;
              let braceCount = 0;
              let foundBrace = false;
              let endIdx = i;
              for (let j = i; j < blockLines.length; j++) {
                const current = blockLines[j];
                const openBraces = (current.match(/{/g) || []).length;
                const closeBraces = (current.match(/}/g) || []).length;
                braceCount += openBraces - closeBraces;
                if (openBraces > 0) foundBrace = true;
                if (foundBrace && braceCount === 0) {
                  endIdx = j;
                  break;
                }
              }
              const source = blockLines.slice(i, endIdx + 1).join('\n');
              const baseInfo = block.baseClass ? ` (herda de ${block.baseClass})` : '';
              return writeResult(id, {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    status: 'success',
                    symbol: symbolName,
                    kind: symbolKind,
                    file: filePath,
                    startLine: -1,
                    endLine: -1,
                    lines: endIdx - i + 1,
                    source: `@code { ... }${baseInfo} -> ${source}`,
                    foundInRazorCode: true,
                    baseClass: block.baseClass || null
                  }, null, 2)
                }]
              });
            }
          }
        }
      }
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
            source: source,
            foundInRazorCode: false
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
// FUNÇÕES DE ARQUIVO - read_lines, find_files, get_file_info, list_directory
// =============================================================================

async function executeReadLines(id, args) {
  const filePath = args.path;
  if (!filePath) return writeToolError(id, '❌ "path" é obrigatório.');

  const startLine = Math.max(1, args.startLine || 1);
  let endLine = args.endLine || (startLine + 49);

  if (endLine - startLine > PERFORMANCE_CONFIG.maxReadLines) {
    return writeToolError(id, `❌ Máximo de ${PERFORMANCE_CONFIG.maxReadLines} linhas por vez.`);
  }

  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size === 0) {
      return writeResult(id, { content: [{ type: 'text', text: `📋 Arquivo vazio: ${filePath}` }] });
    }
    if (stat.size > PERFORMANCE_CONFIG.maxFileSize) {
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
      isFile: stat.isFile(),
      isEmpty: stat.size === 0
    };

    if (args.includeContent && stat.isFile() && stat.size < PERFORMANCE_CONFIG.maxFileSize) {
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
// FUNÇÕES DE EDIÇÃO - write_file, edit_file, create_directory, move_file, replace_in_files
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
  if (size > PERFORMANCE_CONFIG.maxWriteSize) {
    return writeToolError(id, `❌ Arquivo muito grande: ${formatSize(size)}. Máximo: ${formatSize(PERFORMANCE_CONFIG.maxWriteSize)}`);
  }

  const safePath = validatePath(filePath);
  
  if (!await checkWritePermission(safePath)) {
    return writeToolError(id, `❌ Sem permissão de escrita no diretório: ${path.dirname(safePath)}`);
  }
  
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
    
    invalidateCachePaths(safePath);
    invalidateCachePaths(path.dirname(safePath));
    
    const stat = await fs.promises.stat(safePath);
    if (BACKUP_CONFIG.autoCleanup) {
      cleanOldBackups(path.dirname(safePath)).catch(() => {});
    }

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

async function executeEditFile(id, args) {
  const filePath = args.path;
  const newContent = args.content;
  const dryRun = args.dryRun !== false;
  const backup = args.backup !== false;

  if (!filePath) return writeToolError(id, '❌ "path" é obrigatório.');
  if (newContent === undefined) return writeToolError(id, '❌ "content" é obrigatório.');

  const safePath = validatePath(filePath);
  
  if (!await checkWritePermission(safePath)) {
    return writeToolError(id, `❌ Sem permissão de escrita no diretório: ${path.dirname(safePath)}`);
  }
  
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
    
    invalidateCachePaths(safePath);

    if (BACKUP_CONFIG.autoCleanup) {
      cleanOldBackups(path.dirname(safePath)).catch(() => {});
    }

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

async function executeCreateDirectory(id, args) {
  const dirPath = args.path;
  const recursive = args.recursive !== false;

  if (!dirPath) return writeToolError(id, '❌ "path" é obrigatório.');

  const safePath = validatePath(dirPath);
  
  if (!await checkWritePermission(safePath)) {
    return writeToolError(id, `❌ Sem permissão de escrita no diretório pai: ${path.dirname(safePath)}`);
  }
  
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

async function executeMoveFile(id, args) {
  const source = args.source;
  const destination = args.destination;
  const overwrite = args.overwrite !== false;
  const backup = args.backup !== false;

  if (!source) return writeToolError(id, '❌ "source" é obrigatório.');
  if (!destination) return writeToolError(id, '❌ "destination" é obrigatório.');

  const safeSource = validatePath(source);
  const safeDest = validatePath(destination);
  
  if (!await checkWritePermission(safeDest)) {
    return writeToolError(id, `❌ Sem permissão de escrita no diretório: ${path.dirname(safeDest)}`);
  }

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
    
    invalidateCachePaths(safeSource);
    invalidateCachePaths(path.dirname(safeDest));

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
  const maxFiles = Math.min(args.maxFiles || 200, PERFORMANCE_CONFIG.maxFiles);
  const backup = args.backup !== false;

  let regex;
  try {
    if (simpleMatch) {
      // Quebra de linha real no pattern deve casar tanto \n quanto \r\n do arquivo —
      // sem isso, um pattern multi-linha digitado com LF nunca casa num arquivo CRLF
      // (padrão comum em projetos Windows/.NET), mesmo o texto sendo "igual" visualmente.
      const escaped = escapeRegex(patternStr).replace(/\n/g, '\\r?\\n');
      regex = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
    } else {
      regex = new RegExp(patternStr, caseSensitive ? 'g' : 'gi');
    }
  } catch (err) {
    return writeToolError(id, `❌ Regex inválida: ${err.message}`);
  }

  const safePath = validatePath(searchPath);
  
  try {
    const stat = await fs.promises.stat(safePath);
    if (stat.isFile() && stat.size === 0) {
      return writeResult(id, { 
        content: [{ type: 'text', text: `📋 Arquivo vazio: ${safePath}` }] 
      });
    }
  } catch {}

  let fileList;
  try {
    const stat = await fs.promises.stat(safePath);
    fileList = stat.isDirectory() ? await collectFiles(safePath, fileExts, excludeExts) : [safePath];
  } catch (err) {
    // Não esconder o erro real atrás de uma mensagem genérica -- em Windows/OneDrive
    // (Files On-Demand, arquivo ainda sincronizando) o motivo real do stat falhar pode
    // não ser "não existe", e sem o código/mensagem original é impossível diagnosticar.
    return writeResult(id, {
      content: [{ type: 'text', text: `📋 Não consegui acessar "${searchPath}": ${err.code || ''} ${err.message}` }],
      isError: true
    });
  }
  if (fileList.length === 0) {
    return writeResult(id, { content: [{ type: 'text', text: `📋 Nenhum arquivo encontrado em ${searchPath}` }], isError: true });
  }

  const changes = [];
  let processed = 0;

  await runPool(fileList, PERFORMANCE_CONFIG.concurrency, async (filePath) => {
    if (processed >= maxFiles || shuttingDown) return;
    if (await isLikelyBinary(filePath)) return;

    let buffer;
    try { buffer = await fs.promises.readFile(filePath); } catch { return; }
    if (buffer.length > PERFORMANCE_CONFIG.maxFileSize) return;

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
  await runPool(changes, PERFORMANCE_CONFIG.concurrency, async (change) => {
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
      invalidateCachePaths(change.filePath);
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
// FUNÇÕES DE ANÁLISE - code_outline, find_references, compact_command, 
// undo_last_change, get_metrics, get_cache_stats
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
    
    // ✅ TIMEOUT REMOVIDO - Espera o comando terminar naturalmente
    const { stdout, stderr } = await execAsync(fullCommand, { 
      cwd, 
      maxBuffer: 50 * 1024 * 1024  // Aumentado para 50MB para logs grandes
    });
    
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
    // ✅ Sem timeout - apenas erro real do comando
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



async function executeUndoLastChange(id, args) {
    const filePath = args.path;
    const timestamp = args.timestamp || null;
    const dryRun = args.dryRun !== false;
    
    if (!filePath) return writeToolError(id, '❌ "path" é obrigatório.');
    
    const safePath = validatePath(filePath);
    const dir = path.dirname(safePath);
    const basename = path.basename(safePath);
    
    let backups = [];
    try {
        const files = await fs.promises.readdir(dir);
        const backupPattern = new RegExp(`^${escapeRegex(basename)}\\.bak\\.(\\d+)$`);
        for (const file of files) {
            const match = file.match(backupPattern);
            if (match) {
                backups.push({
                    path: path.join(dir, file),
                    timestamp: parseInt(match[1])
                });
            }
        }
    } catch (err) {
        return writeToolError(id, `❌ Erro ao listar backups: ${err.message}`);
    }
    
    if (backups.length === 0) {
        return writeResult(id, {
            content: [{ type: 'text', text: `📋 Nenhum backup encontrado para ${safePath}` }]
        });
    }
    
    backups.sort((a, b) => b.timestamp - a.timestamp);
    
    let selectedBackup = backups[0];
    if (timestamp) {
        const ts = parseInt(timestamp);
        const found = backups.find(b => b.timestamp === ts);
        if (found) selectedBackup = found;
    }
    
    let backupContent;
    let backupBuffer;
    try {
        backupBuffer = await fs.promises.readFile(selectedBackup.path);
        backupContent = backupBuffer.toString('utf8');
    } catch (err) {
        return writeToolError(id, `❌ Erro ao ler backup: ${err.message}`);
    }
    
    let currentExists = false;
    let currentContent = '';
    try {
        const currentBuffer = await fs.promises.readFile(safePath);
        currentContent = currentBuffer.toString('utf8');
        currentExists = true;
    } catch {}
    
    const diff = buildDiffPreview(currentContent, backupContent);
    
    if (dryRun) {
        return writeResult(id, {
            content: [{
                type: 'text',
                text: `↩️ Preview de rollback: ${safePath}\n\nBackup: ${path.basename(selectedBackup.path)}\nTimestamp: ${new Date(Math.floor(selectedBackup.timestamp / 1000)).toISOString()}\n\n${diff.preview}\n\n_(DryRun — nenhuma alteração foi aplicada. Rode com dryRun:false para restaurar.)_`
            }]
        });
    }
    
    try {
        if (currentExists) {
            await writeBackup(safePath, await fs.promises.readFile(safePath));
        }
        
        await fs.promises.writeFile(safePath, backupContent, 'utf8');
        invalidateCachePaths(safePath);
        
        writeResult(id, {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    status: 'success',
                    path: safePath,
                    restoredFrom: selectedBackup.path,
                    timestamp: selectedBackup.timestamp,
                    message: `✅ Arquivo restaurado com sucesso: ${safePath} (de ${path.basename(selectedBackup.path)})`
                }, null, 2)
            }]
        });
    } catch (err) {
        writeToolError(id, `❌ Erro ao restaurar: ${err.message}`);
    }
}

async function executeCodeOutline(id, args) {
  const filePath = args.path;
  const maxDepth = args.maxDepth || 3;
  
  if (!filePath) return writeToolError(id, '❌ "path" é obrigatório.');
  
  const safePath = validatePath(filePath);
  
  try {
    const stat = await fs.promises.stat(safePath);
    if (stat.isDirectory()) {
      return writeToolError(id, '❌ Caminho é um diretório. Forneça um arquivo específico.');
    }
    if (stat.size === 0) {
      return writeResult(id, { 
        content: [{ type: 'text', text: `📋 Arquivo vazio: ${safePath}` }] 
      });
    }
    
    const buffer = await fs.promises.readFile(safePath);
    const { text } = decodeBuffer(buffer);
    
    const outline = {
      file: safePath,
      classes: [],
      interfaces: [],
      enums: [],
      methods: [],
      properties: [],
      fields: [],
      constructors: []
    };
    
    const lines = text.split(/\r\n|\r|\n/);
    
    // Detectar classes (incluindo primary constructors - C# 12+)
    const classRegex = /(?:public|private|protected|internal)?\s*(?:static|sealed|abstract|partial)?\s*(?:class|interface|struct|record)\s+(\w+)(?:\s*<[^>]*>)?(?:\s*\([^)]*\))?/g;
    let match;
    while ((match = classRegex.exec(text)) !== null) {
      const lineNum = text.substring(0, match.index).split('\n').length;
      const type = match[0].includes('interface') ? 'interface' : 
                   match[0].includes('struct') ? 'struct' :
                   match[0].includes('record') ? 'record' : 'class';
      
      const hasPrimaryConstructor = match[0].includes('(');
      
      outline.classes.push({
        name: match[1],
        type: type,
        line: lineNum,
        hasPrimaryConstructor,
        fullDeclaration: match[0].trim()
      });
    }
    
    // Detectar enums
    const enumRegex = /(?:public|private|protected|internal)?\s*enum\s+(\w+)/g;
    while ((match = enumRegex.exec(text)) !== null) {
      const lineNum = text.substring(0, match.index).split('\n').length;
      outline.enums.push({
        name: match[1],
        line: lineNum
      });
    }
    
    // Detectar métodos (incluindo interceptors - C# 12+)
    const methodRegex = /(?:public|private|protected|internal)?\s*(?:static|async|override|virtual)?\s*(?:(\w+)\s+)?(\w+)\s*\(/g;
    const skipMethods = ['if', 'for', 'while', 'switch', 'using', 'foreach', 'lock', 'fixed', 'unsafe'];
    while ((match = methodRegex.exec(text)) !== null) {
      if (!skipMethods.includes(match[2]) && match[2] !== 'get' && match[2] !== 'set') {
        const lineNum = text.substring(0, match.index).split('\n').length;
        const isInterceptor = match[0].includes('this');
        
        outline.methods.push({
          name: match[2],
          returnType: match[1] || 'void',
          line: lineNum,
          isInterceptor,
          fullDeclaration: match[0].trim()
        });
      }
    }
    
    // Detectar propriedades (incluindo required - C# 11+)
    const propRegex = /(?:public|private|protected|internal)?\s*(?:required\s+)?(?:static\s+)?(\w+)\s+(\w+)\s*\{/g;
    while ((match = propRegex.exec(text)) !== null) {
      const lineNum = text.substring(0, match.index).split('\n').length;
      const isRequired = match[0].includes('required');
      outline.properties.push({
        name: match[2],
        type: match[1],
        line: lineNum,
        isRequired,
        fullDeclaration: match[0].trim()
      });
    }
    
    // Detectar campos
    const fieldRegex = /(?:public|private|protected|internal)?\s*(?:static|readonly|const)?\s*(\w+)\s+(\w+)\s*[=;]/g;
    while ((match = fieldRegex.exec(text)) !== null) {
      const lineNum = text.substring(0, match.index).split('\n').length;
      if (!['if', 'for', 'while', 'switch'].includes(match[2])) {
        outline.fields.push({
          name: match[2],
          type: match[1],
          line: lineNum
        });
      }
    }
    
    // Detectar construtores
    const ctorRegex = /(?:public|private|protected|internal)?\s+(\w+)\s*\(/g;
    while ((match = ctorRegex.exec(text)) !== null) {
      const lineNum = text.substring(0, match.index).split('\n').length;
      if (outline.classes.some(c => c.name === match[1])) {
        outline.constructors.push({
          name: match[1],
          line: lineNum,
          fullDeclaration: match[0].trim()
        });
      }
    }
    
    // Adicionar @code do .razor
    if (safePath.endsWith('.razor')) {
      const codeBlocks = extractRazorCodeBlocks(text);
      if (codeBlocks.length > 0) {
        outline.razorCodeBlocks = codeBlocks.map((block, index) => ({
          index: index + 1,
          baseClass: block.baseClass || null,
          hasContent: block.content.trim().length > 0,
          contentPreview: block.content.trim().substring(0, 100) + (block.content.length > 100 ? '...' : '')
        }));
      }
    }
    
    outline.summary = {
      totalClasses: outline.classes.length,
      totalMethods: outline.methods.length,
      totalProperties: outline.properties.length,
      totalFields: outline.fields.length,
      totalEnums: outline.enums.length,
      totalConstructors: outline.constructors.length
    };
    
    writeResult(id, {
      content: [{
        type: 'text',
        text: JSON.stringify(outline, null, 2)
      }]
    });
  } catch (err) {
    writeToolError(id, `❌ Erro ao analisar arquivo: ${err.message}`);
  }
}

async function executeFindReferences(id, args) {
  const name = args.name;
  const searchPath = args.path || '.';
  const filePattern = args.filePattern || '.cs,.razor';
  const maxResults = Math.min(args.maxResults || 100, 500);
  
  if (!name) return writeToolError(id, '❌ "name" é obrigatório.');
  
  const safePath = validatePath(searchPath);
  const exts = filePattern.split(',').map(e => e.trim());
  const files = await collectFiles(safePath, exts, null);
  
  if (files.length === 0) {
    return writeResult(id, { 
      content: [{ type: 'text', text: `📋 Nenhum arquivo encontrado em ${searchPath}` }] 
    });
  }
  
  const results = [];
  const seen = new Set();
  let processedFiles = 0;
  const totalFiles = files.length;
  const startTime = Date.now();
  
  await runPool(files, PERFORMANCE_CONFIG.concurrency, async (filePath) => {
    processedFiles++;
    if (processedFiles % Math.max(1, Math.floor(totalFiles / 10)) === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(`📊 ${searchPath}: ${processedFiles}/${totalFiles} arquivos (${elapsed}s)`);
    }
    
    if (results.length >= maxResults || shuttingDown) return;
    
    try {
      const buffer = await fs.promises.readFile(filePath);
      const { text } = decodeBuffer(buffer);
      const lines = text.split(/\r\n|\r|\n/);
      
      const isDeclaration = lines.some(line => 
        /class|interface|struct|record|enum/.test(line) && line.includes(name)
      );
      
      if (isDeclaration) return;
      
      const regex = new RegExp(`\\b${escapeRegex(name)}\\b`, 'g');
      for (let i = 0; i < lines.length && results.length < maxResults; i++) {
        const line = lines[i];
        if (regex.test(line)) {
          const key = `${filePath}:${i + 1}`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push({
              file: filePath,
              line: i + 1,
              text: truncateLine(line.trim()),
              context: getLineContext(lines, i)
            });
          }
        }
      }
    } catch {}
  });
  
  if (results.length === 0) {
    return writeResult(id, {
      content: [{ 
        type: 'text', 
        text: `📋 Nenhum uso de "${name}" encontrado em ${searchPath}. Verifique se o nome está correto ou use search_content para busca mais ampla.` 
      }]
    });
  }
  
  const output = results.map(r => {
    const context = r.context ? `\n  Contexto: ${r.context}` : '';
    return `${r.file}:${r.line} ${r.text}${context}`;
  });
  
  const note = results.length >= maxResults ? `\n\n_(Truncado em ${maxResults} resultados)_` : '';
  
  writeResult(id, {
    content: [{
      type: 'text',
      text: `🔍 ${results.length} usos de "${name}" em ${files.length} arquivos:\n\n${output.join('\n\n')}${note}\n\n💡 Dica: Use search_content para busca mais ampla.`
    }]
  });
}

async function executeGetMetrics(id, args) {
  const uptime = ((Date.now() - METRICS.startTime) / 1000);
  const uptimeFormatted = uptime > 3600 
    ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`
    : uptime > 60 
      ? `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`
      : `${Math.floor(uptime)}s`;
  
  const totalOperations = Object.values(METRICS.operations).reduce((sum, op) => sum + op.total, 0);
  const totalErrors = Object.values(METRICS.operations).reduce((sum, op) => sum + op.errors, 0);
  const totalTokensSaved = METRICS.tokensSaved;
  
  const errorRate = totalOperations > 0 ? (totalErrors / totalOperations * 100).toFixed(1) : '0.0';
  
  const sortedOps = Object.entries(METRICS.operations)
    .sort((a, b) => b[1].avgTime - a[1].avgTime)
    .slice(0, 10);
  
  const operationsSummary = {};
  for (const [name, stats] of sortedOps) {
    operationsSummary[name] = {
      total: stats.total,
      avgTime: `${stats.avgTime.toFixed(0)}ms`,
      maxTime: `${stats.maxTime.toFixed(0)}ms`,
      minTime: stats.minTime === Infinity ? 'N/A' : `${stats.minTime.toFixed(0)}ms`,
      errors: stats.errors,
      tokensSaved: stats.tokensSaved || 0
    };
  }
  
  writeResult(id, {
    content: [{
      type: 'text',
      text: JSON.stringify({
        uptime: uptimeFormatted,
        totalOperations,
        totalErrors,
        errorRate: `${errorRate}%`,
        totalTokensSaved: totalTokensSaved,
        tokensSavedHuman: totalTokensSaved > 1000 ? `${(totalTokensSaved / 1000).toFixed(1)}k` : `${totalTokensSaved}`,
        commands: METRICS.commands,
        topOperations: operationsSummary,
        cacheStats: {
          fileCache: fileCache.getStats(),
          searchCache: searchCache.getStats(),
          dirCacheSize: dirCache.cache.size
        },
        recommendations: errorRate > 10 ? '⚠️ Alta taxa de erro. Verifique logs.' : '✅ Sistema saudável.'
      }, null, 2)
    }]
  });
}

async function executeGetCacheStats(id, args) {
  const fileStats = fileCache.getStats();
  const searchStats = searchCache.getStats();
  const resxStats = resxCache.getStats();
  const totalHits = fileStats.hits + searchStats.hits + resxStats.hits;
  const totalMisses = fileStats.misses + searchStats.misses + resxStats.misses;
  const hitRate = totalHits + totalMisses > 0 
    ? (totalHits / (totalHits + totalMisses) * 100).toFixed(1)
    : 'N/A';
  
  writeResult(id, {
    content: [{
      type: 'text',
      text: JSON.stringify({
        fileCache: fileStats,
        searchCache: searchStats,
        resxCache: resxStats,
        dirCache: { size: dirCache.cache.size },
        totalHits,
        totalMisses,
        hitRate: `${hitRate}%`,
        status: hitRate > 70 ? '✅ Eficiente' : '⚠️ Considere aumentar fileCacheSize no .mcp-config.json',
        recommendations: hitRate < 70 ? [
          'Aumente fileCacheSize (ex: 300)',
          'Aumente fileCacheTTL (ex: 60000)',
          'Verifique se os arquivos estão sendo lidos repetidamente'
        ] : []
      }, null, 2)
    }]
  });
}

// =============================================================================
// GET_FILE_HISTORY — lista os backups (.bak.*) de um arquivo, mais recente primeiro.
// Útil pra "o que mudou aqui antes de quebrar" sem precisar restaurar nada ainda.
// =============================================================================

async function executeGetFileHistory(id, args) {
  const targetPath = args.path;
  if (!targetPath) return writeToolError(id, '❌ Parâmetro "path" é obrigatório.');

  const safePath = validatePath(targetPath);
  const dir = path.dirname(safePath);
  const basename = path.basename(safePath);

  // Nome de backup é "<arquivo>.bak.<timestamp><contador3digitos>" (ver writeBackup).
  // O contador é só pra evitar colisão no mesmo milissegundo — pra exibir a data de
  // verdade, precisa descartar esses 3 dígitos finais antes de converter, senão dá
  // uma data no futuro distante (timestamp x1000 maior do que deveria).
  const backupPattern = new RegExp(`^${escapeRegex(basename)}\\.bak\\.(\\d+)$`);

  let files;
  try {
    files = await fs.promises.readdir(dir);
  } catch {
    return writeToolError(id, `❌ Diretório não encontrado: ${dir}`);
  }

  const backups = [];
  for (const file of files) {
    const match = file.match(backupPattern);
    if (!match) continue;
    const rawTimestamp = match[1];
    const realEpochMs = Math.floor(Number(rawTimestamp) / 1000);
    let stat;
    try {
      stat = await fs.promises.stat(path.join(dir, file));
    } catch { continue; }

    backups.push({
      path: path.join(dir, file),
      timestamp: realEpochMs,
      date: new Date(realEpochMs).toISOString(),
      size: stat.size,
      sizeHuman: formatSize(stat.size)
    });
  }

  backups.sort((a, b) => b.timestamp - a.timestamp);

  let currentSize = null;
  try {
    currentSize = (await fs.promises.stat(safePath)).size;
  } catch { /* arquivo atual pode ter sido apagado/movido */ }

  writeResult(id, {
    content: [{
      type: 'text',
      text: JSON.stringify({
        file: safePath,
        currentSize,
        currentSizeHuman: currentSize !== null ? formatSize(currentSize) : null,
        totalBackups: backups.length,
        backups: backups.slice(0, 20),
        latest: backups[0] || null,
        oldest: backups[backups.length - 1] || null
      }, null, 2)
    }]
  });
}



// =============================================================================
// ANALYZE_I18N_HEALTH — compara as chaves entre os idiomas de .resx e aponta
// o que falta, o que sobrou (órfã) e traduções vazias. Usa getParsedResx, então
// se você já rodou get_existing_translations/get_translation_context antes na
// mesma sessão, essa chamada reaproveita o cache em vez de reparsear tudo.
// =============================================================================

async function executeAnalyzeI18nHealth(id, args) {
  const targetPath = args.path;
  if (!targetPath) return writeToolError(id, '❌ Parâmetro "path" é obrigatório.');

  const safePath = validatePath(targetPath);
  const langs = (args.languages && args.languages.length) ? args.languages : RESX_LANGS;
  const primaryLang = args.primaryLanguage || 'pt-BR';

  const langData = {};
  const allKeys = new Set();

  for (const lang of langs) {
    const filePath = path.join(safePath, `SharedResources.${lang}.resx`);
    try {
      const { keys } = await getParsedResx(filePath);
      langData[lang] = { keys, count: keys.size, missing: false };
      for (const key of keys.keys()) allKeys.add(key);
    } catch {
      langData[lang] = { keys: new Map(), count: 0, missing: true };
    }
  }

  // Chaves "borked": o NOME da chave é idêntico ao VALOR de alguma outra entrada no
  // mesmo arquivo. É a assinatura de quando um valor foi inserido como nome de chave
  // por engano (bug que existia no insert_translations, já corrigido — mas arquivos
  // que foram corrompidos ANTES do fix continuam com isso até serem limpos). Excluídas
  // do cálculo de "chave faltando" abaixo, senão poluem o diagnóstico com falso positivo.
  const borkedKeysByLang = {};
  for (const lang of langs) {
    const keys = langData[lang].keys;
    const allValuesInFile = new Set();
    for (const info of keys.values()) {
      if (info.hasValue && info.value) allValuesInFile.add(info.value);
    }
    borkedKeysByLang[lang] = [...keys.keys()].filter(key => allValuesInFile.has(key));
  }
  const allBorkedKeys = new Set(Object.values(borkedKeysByLang).flat());

  const missingKeys = [];
  const orphanInAllButOne = [];
  const emptyValues = [];

  for (const key of allKeys) {
    if (allBorkedKeys.has(key)) continue; // não é uma chave de verdade, é lixo do bug de insert

    const present = [];
    const missing = [];
    for (const lang of langs) {
      if (langData[lang].keys.has(key)) present.push(lang);
      else missing.push(lang);
    }
    if (missing.length > 0 && present.length > 0) {
      missingKeys.push({ key, present, missing });
    }

    // Vazia no idioma primário mas preenchida em pelo menos um outro -> provável tradução esquecida
    const primaryInfo = langData[primaryLang]?.keys.get(key);
    if (primaryInfo && primaryInfo.hasValue === false) {
      const filledElsewhere = langs.some(lang => {
        if (lang === primaryLang) return false;
        const info = langData[lang].keys.get(key);
        return info && info.hasValue && info.value.trim() !== '';
      });
      if (filledElsewhere) {
        emptyValues.push({ key, emptyIn: primaryLang });
      }
    }
  }

  const summary = {
    status: 'success',
    path: safePath,
    totalUniqueKeys: allKeys.size,
    languages: Object.fromEntries(
      langs.map(l => [l, { count: langData[l].count, fileMissing: langData[l].missing }])
    ),
    missingKeysCount: missingKeys.length,
    missingKeys: missingKeys.slice(0, 30),
    emptyValuesCount: emptyValues.length,
    emptyValues: emptyValues.slice(0, 30),
    borkedKeysCount: allBorkedKeys.size,
    borkedKeysByLang: Object.fromEntries(Object.entries(borkedKeysByLang).filter(([, v]) => v.length > 0)),
    health: missingKeys.length === 0 && emptyValues.length === 0 && allBorkedKeys.size === 0
      ? '✅ Todos os idiomas sincronizados'
      : `⚠️ ${missingKeys.length} chave(s) faltando, ${emptyValues.length} tradução(ões) vazia(s), ${allBorkedKeys.size} chave(s) "borked" (valor inserido como nome de chave — provavelmente sobra de antes do fix do insert_translations)`
  };

  writeResult(id, { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] });
}

// =============================================================================
// ANALYZE_MIGRATION_READINESS — classifica arquivos .cs/.razor por criticidade
// pra migração Blazor Server -> Auto, baseado em ASSINATURAS DE CÓDIGO REAIS
// (regex), não em "achismo" do LLM. Cada classificação vem com o motivo exato
// que a gerou, pra ser auditável — importante em código fiscal/jurídico onde
// um erro de categorização pode significar mover algo crítico pro client.
//
// Categoria C (crítico): nunca pode virar Interactive WebAssembly. Precisa
// ficar rodando no servidor (Auto cobre isso naturalmente se o componente for
// deixado como está ou InteractiveServer — só NÃO force pra WASM).
// Categoria A (seguro): DTO/Model/Enum puro ou asset estático — pode mover
// pra Shared/wwwroot sem risco de lógica quebrar.
// Categoria B (padrão/revisar): tudo que não bateu em C nem teve evidência
// clara de A. É a categoria mais populosa de propósito — não assume "seguro"
// sem prova.
// =============================================================================

const MIGRATION_CRITICAL_SIGNATURES = [
  { pattern: /\w*DbContext\b/, reason: 'Acesso direto a DbContext (EF Core) — nunca roda no client' },
  { pattern: /I?HttpContext\w*/, reason: 'Depende de HttpContext — só existe no servidor' },
  { pattern: /\bX509Certificate2\b/, reason: 'Manipula certificado digital — nunca no client' },
  { pattern: /\.pfx\b/i, reason: 'Referência a arquivo de certificado .pfx' },
  { pattern: /(?:System\.IO\.)?File\.(?:ReadAll|WriteAll|Open|Exists|Delete|Copy|Move)\w*\s*\(/, reason: 'Acesso a sistema de arquivos — não existe em WASM' },
  { pattern: /\bIWebHostEnvironment\b/, reason: 'Depende do ambiente de hospedagem do servidor' },
  { pattern: /\[ApiController\]/, reason: 'Controller ASP.NET Core — é server-side por natureza, mesmo sem tocar DbContext/HttpContext explicitamente no corpo' },
  { pattern: /:\s*ControllerBase\b/, reason: 'Herda de ControllerBase — Controller ASP.NET Core, server-side por natureza' },
  { pattern: /\bCircuitHandler\b/, reason: 'API específica de Blazor Server (circuito SignalR)' },
  { pattern: /:\s*Hub\b/, reason: 'Hub de SignalR — roda no servidor' },
  { pattern: /\bSEFAZ/i, reason: 'Palavra-chave fiscal SEFAZ', compound: true },
  { pattern: /certificado\s*digital/i, reason: 'Menção a certificado digital' },
  { pattern: /\bboleto/i, reason: 'Integração bancária/pagamento (boleto)', compound: true },
  { pattern: /\bpix/i, reason: 'Integração bancária/pagamento (Pix)', compound: true },
  { pattern: /\bAddDbContext\b/, reason: 'Registro de DbContext no DI (Program.cs do servidor)' },
  { pattern: /\bZeusFiscal\b|\bHercules\.NET\b/i, reason: 'Biblioteca fiscal (transmissão NF-e/SEFAZ)' }
];

const MIGRATION_MEDIUM_SIGNATURES = [
  { pattern: /@inject\s+I\w*Service\b/i, reason: 'Injeta um serviço de aplicação — avaliar se o serviço em si é crítico' },
  { pattern: /\bHttpClient\b/, reason: 'Já usa HttpClient — pode já estar preparado pra rodar no client' }
];

const MIGRATION_ASSET_EXT = new Set(['.css', '.js', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.gif', '.woff', '.woff2', '.map']);

// Testa se 'word' aparece em 'text' sozinha (fim de palavra) OU como prefixo de um
// identificador PascalCase (ex: "SefazService", "PixService"). Não usa [A-Z] dentro
// de regex com flag /i porque isso casaria minúscula também (case folding do JS) —
// daria falso positivo em "pixels" tentando detectar "pix". Aqui a checagem de
// maiúscula é feita fora do regex, sem esse problema.
function hasCompoundWordMatch(text, wordRegex) {
  const re = new RegExp(wordRegex.source, 'gi');
  let m;
  while ((m = re.exec(text)) !== null) {
    const nextChar = text[m.index + m[0].length];
    if (!nextChar || !/[a-z]/.test(nextChar)) return true; // fim de string, não-letra, ou maiúscula = fronteira válida
    if (m.index === re.lastIndex) re.lastIndex++; // evita loop infinito em match vazio
  }
  return false;
}

function classifyMigrationFile(filePath, text) {
  const ext = path.extname(filePath).toLowerCase();

  if (MIGRATION_ASSET_EXT.has(ext)) {
    return { category: 'A', reasons: ['Asset estático (css/js/imagem) — copiar direto pro wwwroot'] };
  }

  const clean = stripCommentsAndStrings(text);

  const criticalHits = MIGRATION_CRITICAL_SIGNATURES
    .filter(sig => sig.compound ? hasCompoundWordMatch(clean, sig.pattern) : sig.pattern.test(clean))
    .map(sig => sig.reason);
  if (criticalHits.length > 0) {
    return { category: 'C', reasons: criticalHits };
  }

  const mediumHits = MIGRATION_MEDIUM_SIGNATURES.filter(sig => sig.pattern.test(clean)).map(sig => sig.reason);

  // Heurística conservadora pra "seguro": só classifica A se tiver evidência
  // (DTO puro sem método com corpo de lógica, ou .razor sem @inject/@code).
  // Método "vazio" (só get/set) não conta como corpo de lógica.
  const hasMethodBody = /\b(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?[\w<>[\],\s]+\s+\w+\s*\([^)]*\)\s*\{(?!\s*(?:get|set)\s*;?\s*\})/i.test(clean);

  if (mediumHits.length === 0) {
    if (ext === '.cs' && !hasMethodBody) {
      return { category: 'A', reasons: ['Parece DTO/Model/Enum — só propriedades, sem método com lógica detectado'] };
    }
    if (ext === '.razor') {
      const hasInject = /@inject\b/i.test(clean);
      const hasCode = /@code\s*\{/i.test(clean);
      if (!hasInject && !hasCode) {
        return { category: 'A', reasons: ['Componente .razor sem @inject e sem @code — UI pura'] };
      }
    }
  }

  return {
    category: 'B',
    reasons: mediumHits.length ? mediumHits : ['Não bateu em assinatura crítica nem em critério claro de "seguro" — revisar manualmente']
  };
}

async function executeAnalyzeMigrationReadiness(id, args) {
  const targetPath = args.path;
  if (!targetPath) return writeToolError(id, '❌ Parâmetro "path" é obrigatório.');

  const safePath = validatePath(targetPath);
  const extensions = (args.extensions && args.extensions.length) ? args.extensions : ['.cs', '.razor', '.css', '.js'];

  let files;
  try {
    files = await collectFiles(safePath, extensions, null);
  } catch {
    return writeToolError(id, `❌ Caminho não encontrado: ${targetPath}`);
  }

  const byCategory = { A: [], B: [], C: [] };
  const errors = [];

  await runPool(files, PERFORMANCE_CONFIG.concurrency, async (filePath) => {
    try {
      const ext = path.extname(filePath).toLowerCase();
      let text = '';
      if (!MIGRATION_ASSET_EXT.has(ext)) {
        const buffer = await fs.promises.readFile(filePath);
        text = decodeBuffer(buffer).text;
      }
      const result = classifyMigrationFile(filePath, text);
      byCategory[result.category].push({ file: filePath, reasons: result.reasons });
    } catch (err) {
      errors.push({ file: filePath, error: err.message });
    }
  });

  const summary = {
    status: 'success',
    path: safePath,
    totalFiles: files.length,
    counts: { A_seguro: byCategory.A.length, B_revisar: byCategory.B.length, C_critico: byCategory.C.length },
    loteA_seguro: byCategory.A.map(x => x.file).slice(0, 300),
    loteB_revisar: byCategory.B.slice(0, 300),
    loteC_critico: byCategory.C, // nunca trunca — é o lote que exige atenção total
    errors: errors.slice(0, 20),
    note: 'Classificação heurística baseada em assinaturas de código conhecidas, não em interpretação do LLM. LOTE C deve ser revisado item a item; confira uma amostra do LOTE A antes de confiar 100%. Blast radius (quem usa cada símbolo) fica por conta de find_references/get_symbol_usage.'
  };

  writeResult(id, { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] });
}

async function executeFindInProject(id, args) {
  const pattern = args.pattern;
  const searchPath = args.path || '.';
  const filePattern = args.filePattern || '.cs,.razor';
  const includeComments = args.includeComments || false;
  const maxResults = Math.min(args.maxResults || 50, 200);
  const minRelevance = args.minRelevance || 30;

  if (!pattern) return writeToolError(id, '❌ "pattern" é obrigatório.');

  const safePath = validatePath(searchPath);
  const exts = filePattern.split(',').map(e => e.trim());
  const files = await collectFiles(safePath, exts, null);

  if (files.length === 0) {
    return writeResult(id, { 
      content: [{ type: 'text', text: `📋 Nenhum arquivo encontrado em ${searchPath}` }] 
    });
  }

  const results = [];
  const seen = new Set();
  const regex = new RegExp(escapeRegex(pattern), 'gi');

  await runPool(files.slice(0, 200), PERFORMANCE_CONFIG.concurrency, async (filePath) => {
    if (results.length >= maxResults || shuttingDown) return;

    try {
      const buffer = await fs.promises.readFile(filePath);
      const { text } = decodeBuffer(buffer);
      const lines = text.split(/\r\n|\r|\n/);

      let relevance = 0;
      let matches = [];

      for (let i = 0; i < lines.length && results.length < maxResults; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!includeComments && (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*'))) {
          continue;
        }

        if (regex.test(line)) {
          const context = getLineContext(lines, i);
          const isDeclaration = /class|interface|struct|enum|record/.test(line) && line.includes(pattern);
          const isMethod = /void|\w+\s+\w+\s*\(/.test(line) && line.includes(pattern);
          
          let score = 50;
          if (isDeclaration) score += 30;
          if (isMethod) score += 20;
          if (line.includes('public') || line.includes('private') || line.includes('protected')) score += 10;
          if (line.length < 80) score += 10;
          if (line.match(new RegExp(`\\b${escapeRegex(pattern)}\\b`, 'i'))) score += 20;
          
          relevance = Math.max(relevance, score);

          const key = `${filePath}:${i + 1}`;
          if (!seen.has(key) && score >= minRelevance) {
            seen.add(key);
            matches.push({
              line: i + 1,
              text: truncateLine(trimmed),
              context: context,
              score: score,
              type: isDeclaration ? 'declaration' : isMethod ? 'method' : 'usage'
            });
          }
        }
      }

      if (matches.length > 0) {
        results.push({
          file: filePath,
          matches: matches.slice(0, 5),
          totalMatches: matches.length,
          relevance: relevance
        });
      }
    } catch {}
  });

  results.sort((a, b) => b.relevance - a.relevance);

  if (results.length === 0) {
    return writeResult(id, {
      content: [{ 
        type: 'text', 
        text: `📋 Nenhum resultado relevante para "${pattern}" encontrado. Tente reduzir minRelevance ou incluir comentários.` 
      }]
    });
  }

  const output = results.map(r => {
    const matchesText = r.matches.map(m => 
      `  L${m.line} [${m.type}] ${m.text}\n  Contexto: ${m.context}`
    ).join('\n');
    return `📄 ${r.file} (${r.totalMatches} ocorrência(s), relevância: ${r.relevance}%)\n${matchesText}`;
  });

  writeResult(id, {
    content: [{
      type: 'text',
      text: `🔍 ${results.length} arquivo(s) com "${pattern}" (${maxResults} resultados máximos):\n\n${output.join('\n\n')}\n\n💡 Use minRelevance para ajustar a relevância (atual: ${minRelevance}%)`
    }]
  });
}

// =============================================================================
// NOVAS FEATURES - get_code_smells (v8.4.0)
// =============================================================================

async function executeCodeSmells(id, args) {
  const filePath = args.path;
  const thresholds = args.thresholds || {};
  const includeSuggestions = args.suggestions !== false;
  
  const safePath = validatePath(filePath);
  const stat = await fs.promises.stat(safePath);
  
  let files = [];
  if (stat.isDirectory()) {
    files = await collectFiles(safePath, ['.cs', '.razor'], null);
  } else {
    files = [safePath];
  }

  const allSmells = [];

  for (const file of files) {
    try {
      const buffer = await fs.promises.readFile(file);
      const { text } = decodeBuffer(buffer);
      const lines = text.split(/\r\n|\r|\n/);

      const smells = detectCodeSmells(file, lines, thresholds);
      if (smells.length > 0) {
        allSmells.push({ file, smells });
      }
    } catch {}
  }

  const totalSmells = allSmells.reduce((sum, f) => sum + f.smells.length, 0);

  if (totalSmells === 0) {
    return writeResult(id, {
      content: [{
        type: 'text',
        text: `✅ Nenhum code smell detectado em ${files.length} arquivo(s). Código parece saudável!`
      }]
    });
  }

  const summary = {
    totalFiles: files.length,
    totalSmells,
    high: allSmells.reduce((sum, f) => sum + f.smells.filter(s => s.severity === 'high').length, 0),
    medium: allSmells.reduce((sum, f) => sum + f.smells.filter(s => s.severity === 'medium').length, 0),
    low: allSmells.reduce((sum, f) => sum + f.smells.filter(s => s.severity === 'low').length, 0),
    files: allSmells.map(f => ({
      file: f.file,
      smells: f.smells.slice(0, 10),
      total: f.smells.length
    })),
    recommendations: includeSuggestions ? 
      allSmells.flatMap(f => f.smells.map(s => s.suggestion)).filter(Boolean).slice(0, 10) : []
  };

  writeResult(id, {
    content: [{
      type: 'text',
      text: JSON.stringify(summary, null, 2)
    }]
  });
}

function detectCodeSmells(file, lines, thresholds) {
  const text = lines.join('\n'); 
  const smells = [];
  const longMethodThreshold = thresholds.longMethod || 50;
  const largeClassThreshold = thresholds.largeClass || 300;
  const maxParamsThreshold = thresholds.maxParams || 5;
  const maxNestingThreshold = thresholds.maxNesting || 4;

  // 1. Métodos Longos
  const methodRegex = /(?:public|private|protected|internal)?\s*(?:static|async|override|virtual)?\s*(?:\w+)\s+\w+\s*\(/g;
  let match;
  while ((match = methodRegex.exec(text)) !== null) {
    const startLine = text.substring(0, match.index).split('\n').length;
    let braceCount = 0;
    let endLine = startLine;
    let foundBrace = false;
    
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      const openBraces = (line.match(/{/g) || []).length;
      const closeBraces = (line.match(/}/g) || []).length;
      braceCount += openBraces - closeBraces;
      if (openBraces > 0) foundBrace = true;
      if (foundBrace && braceCount === 0) {
        endLine = i;
        break;
      }
    }
    
    const methodLines = endLine - startLine;
    if (methodLines > longMethodThreshold) {
      smells.push({
        type: 'long_method',
        severity: methodLines > longMethodThreshold * 2 ? 'high' : 'medium',
        line: startLine,
        lines: methodLines,
        suggestion: `Divida este método de ${methodLines} linhas em métodos menores (ideal: < ${longMethodThreshold} linhas)`
      });
    }
  }

  // 2. Classes Grandes
  const classRegex = /(?:public|private|protected|internal)?\s*(?:static|sealed|abstract|partial)?\s*(?:class|interface|struct|record)\s+\w+/g;
  while ((match = classRegex.exec(text)) !== null) {
    const startLine = text.substring(0, match.index).split('\n').length;
    let braceCount = 0;
    let endLine = startLine;
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      const openBraces = (line.match(/{/g) || []).length;
      const closeBraces = (line.match(/}/g) || []).length;
      braceCount += openBraces - closeBraces;
      if (braceCount === 0) {
        endLine = i;
        break;
      }
    }
    const classLines = endLine - startLine;
    if (classLines > largeClassThreshold) {
      smells.push({
        type: 'large_class',
        severity: classLines > largeClassThreshold * 1.5 ? 'high' : 'medium',
        line: startLine,
        lines: classLines,
        suggestion: `Considere dividir esta classe de ${classLines} linhas em classes menores com responsabilidades específicas`
      });
    }
  }

  // 3. Parâmetros Demais
  const paramRegex = /(?:public|private|protected|internal)?\s*(?:static|async)?\s*\w+\s+\w+\s*\(([^)]*)\)/g;
  while ((match = paramRegex.exec(text)) !== null) {
    const params = match[1].split(',').filter(p => p.trim()).length;
    if (params > maxParamsThreshold) {
      const lineNum = text.substring(0, match.index).split('\n').length;
      smells.push({
        type: 'long_parameter_list',
        severity: params > maxParamsThreshold + 3 ? 'high' : 'medium',
        line: lineNum,
        parameters: params,
        suggestion: `Reduza de ${params} para <= ${maxParamsThreshold} parâmetros usando um objeto DTO ou parâmetros nomeados`
      });
    }
  }

  // 4. Aninhamento Profundo
  let maxDepth = 0;
  let currentDepth = 0;
  let problemLine = 0;
  const nestingRegex = /\b(?:if|for|while|switch|using)\s*\(/g;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (nestingRegex.test(line)) {
      currentDepth++;
      if (currentDepth > maxDepth) {
        maxDepth = currentDepth;
        problemLine = i;
      }
    }
    if (line.includes('}')) {
      currentDepth = Math.max(0, currentDepth - 1);
    }
  }
  
  if (maxDepth > maxNestingThreshold) {
    smells.push({
      type: 'deep_nesting',
      severity: maxDepth > maxNestingThreshold + 2 ? 'high' : 'medium',
      line: problemLine,
      depth: maxDepth,
      suggestion: `Reduza o aninhamento de ${maxDepth} níveis usando early returns, guard clauses ou extraia para métodos`
    });
  }

  // 5. Duplicação de Código
  const codeBlocks = [];
  for (let i = 0; i < lines.length - 5; i++) {
    const block = lines.slice(i, i + 3).join('\n');
    const hash = crypto.createHash('md5').update(block).digest('hex');
    const existing = codeBlocks.find(b => b.hash === hash && b.block === block);
    if (existing && Math.abs(existing.line - i) > 5) {
      smells.push({
        type: 'duplication',
        severity: 'low',
        line1: existing.line,
        line2: i,
        suggestion: 'Extraia este bloco repetido para um método privado ou classe utilitária'
      });
    } else {
      codeBlocks.push({ hash, block, line: i });
    }
  }

  // 6. Dead Code
  let commentedLines = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') && trimmed.length > 20) {
      commentedLines++;
    }
  }
  if (commentedLines > 10) {
    smells.push({
      type: 'dead_code',
      severity: 'low',
      lines: commentedLines,
      suggestion: `Remova ou atualize ${commentedLines} linhas de código comentado. Use git para histórico.`
    });
  }

  // 7. Nomes Genéricos
  const badNames = ['data', 'info', 'temp', 'tmp', 'result', 'res', 'param', 'args', 'obj', 'item'];
  const badNameRegex = new RegExp(`\\b(${badNames.join('|')})\\b`, 'i');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (badNameRegex.test(line) && (line.includes('var') || line.includes('string') || line.includes('int'))) {
      const match = line.match(badNameRegex);
      if (match) {
        smells.push({
          type: 'bad_name',
          severity: 'low',
          line: i,
          name: match[1],
          suggestion: `Use um nome mais descritivo para '${match[1]}' (ex: userData, orderInfo, tempValue)`
        });
        break;
      }
    }
  }

  return smells;
}

// =============================================================================
// NOVAS FEATURES - get_diagnostics (v8.4.0)
// =============================================================================

async function executeGetDiagnostics(id, args) {
  const searchPath = args.path;
  const type = args.type || 'all';
  
  const safePath = validatePath(searchPath);
  const diagnostics = { errors: [], warnings: [], suggestions: [] };

  const hasCsproj = await fileExists(path.join(safePath, '*.csproj'));
  const hasPackageJson = await fileExists(path.join(safePath, 'package.json'));
  const hasTsConfig = await fileExists(path.join(safePath, 'tsconfig.json'));

  if ((type === 'all' || type === 'dotnet') && hasCsproj) {
    try {
      const { stdout, stderr } = await execAsync('dotnet build --no-restore', { 
        cwd: safePath, 
        maxBuffer: 10 * 1024 * 1024 
      });
      const output = stdout + stderr;
      const lines = output.split('\n');
      
      for (const line of lines) {
        if (line.includes('error')) {
          const match = line.match(/([^:]+\.cs):(\d+)/);
          diagnostics.errors.push({
            file: match ? match[1] : 'unknown',
            line: match ? parseInt(match[2]) : 0,
            message: line.trim()
          });
        } else if (line.includes('warning')) {
          const match = line.match(/([^:]+\.cs):(\d+)/);
          diagnostics.warnings.push({
            file: match ? match[1] : 'unknown',
            line: match ? parseInt(match[2]) : 0,
            message: line.trim()
          });
        }
      }
    } catch {}
  }

  if ((type === 'all' || type === 'typescript') && hasTsConfig) {
    try {
      const { stdout, stderr } = await execAsync('npx tsc --noEmit', { 
        cwd: safePath, 
        maxBuffer: 10 * 1024 * 1024 
      });
      const output = stdout + stderr;
      const lines = output.split('\n');
      
      for (const line of lines) {
        if (line.includes('error TS')) {
          const match = line.match(/([^:]+\.tsx?):(\d+)/);
          diagnostics.errors.push({
            file: match ? match[1] : 'unknown',
            line: match ? parseInt(match[2]) : 0,
            message: line.trim(),
            type: 'typescript'
          });
        }
      }
    } catch {}
  }

  if ((type === 'all' || type === 'eslint') && hasPackageJson) {
    try {
      const { stdout, stderr } = await execAsync('npx eslint --format json', { 
        cwd: safePath, 
        maxBuffer: 10 * 1024 * 1024 
      });
      try {
        const eslintResult = JSON.parse(stdout);
        for (const result of eslintResult) {
          for (const message of result.messages) {
            if (message.severity === 2) {
              diagnostics.errors.push({
                file: result.filePath,
                line: message.line,
                column: message.column,
                message: message.message,
                rule: message.ruleId,
                type: 'eslint'
              });
            } else {
              diagnostics.warnings.push({
                file: result.filePath,
                line: message.line,
                column: message.column,
                message: message.message,
                rule: message.ruleId,
                type: 'eslint'
              });
            }
          }
        }
      } catch {}
    } catch {}
  }

  if (diagnostics.errors.length > 0) {
    const errorFiles = new Set(diagnostics.errors.map(e => e.file));
    diagnostics.suggestions.push(`Corrija ${diagnostics.errors.length} erro(s) em ${errorFiles.size} arquivo(s)`);
    
    const typeErrors = diagnostics.errors.filter(e => e.type);
    if (typeErrors.length > 0) {
      diagnostics.suggestions.push(`Erros de tipo: ${typeErrors.length}`);
    }
  }

  if (diagnostics.warnings.length > 0) {
    diagnostics.suggestions.push(`Revise ${diagnostics.warnings.length} warning(s) para melhorar a qualidade`);
  }

  if (diagnostics.errors.length === 0 && diagnostics.warnings.length === 0) {
    diagnostics.suggestions.push('✅ Nenhum erro ou warning detectado!');
  }

  writeResult(id, {
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'success',
        summary: {
          totalErrors: diagnostics.errors.length,
          totalWarnings: diagnostics.warnings.length,
          projectType: {
            dotnet: hasCsproj,
            typescript: hasTsConfig,
            eslint: hasPackageJson
          }
        },
        ...diagnostics,
        errors: diagnostics.errors.slice(0, 20),
        warnings: diagnostics.warnings.slice(0, 20)
      }, null, 2)
    }]
  });
}

// =============================================================================
// NOVAS FEATURES - project_info (v8.4.0)
// =============================================================================

async function executeProjectInfo(id, args) {
  const searchPath = args.path;
  const safePath = validatePath(searchPath);
  
  const info = {
    path: safePath,
    name: path.basename(safePath),
    type: 'unknown',
    frameworks: [],
    dependencies: {},
    devDependencies: {},
    scripts: {},
    targetFramework: null,
    outputPath: null
  };

  const packageJsonPath = path.join(safePath, 'package.json');
  try {
    const content = await fs.promises.readFile(packageJsonPath, 'utf8');
    const pkg = JSON.parse(content);
    info.type = 'node';
    info.name = pkg.name || info.name;
    info.dependencies = pkg.dependencies || {};
    info.devDependencies = pkg.devDependencies || {};
    info.scripts = pkg.scripts || {};
    info.version = pkg.version;
    info.description = pkg.description;
    info.frameworks = Object.keys(info.dependencies).filter(d => 
      ['react', 'vue', 'angular', 'next', 'express', 'nest', 'dotnet'].some(f => d.includes(f))
    );
  } catch {}

  const csprojFiles = await findFiles(safePath, '*.csproj');
  if (csprojFiles.length > 0) {
    const csprojPath = csprojFiles[0];
    const content = await fs.promises.readFile(csprojPath, 'utf8');
    info.type = 'dotnet';
    const targetFrameworkMatch = content.match(/<TargetFramework>([^<]+)<\/TargetFramework>/);
    if (targetFrameworkMatch) {
      info.targetFramework = targetFrameworkMatch[1];
    }
    const outputPathMatch = content.match(/<OutputPath>([^<]+)<\/OutputPath>/);
    if (outputPathMatch) {
      info.outputPath = outputPathMatch[1];
    }
    info.projectFile = path.basename(csprojPath);
  }

  const tsconfigPath = path.join(safePath, 'tsconfig.json');
  try {
    const content = await fs.promises.readFile(tsconfigPath, 'utf8');
    const tsconfig = JSON.parse(content);
    info.frameworks.push('typescript');
    info.tsconfig = {
      target: tsconfig.compilerOptions?.target || 'ES5',
      module: tsconfig.compilerOptions?.module || 'commonjs',
      strict: tsconfig.compilerOptions?.strict || false
    };
  } catch {}

  const allFiles = await collectFiles(safePath, null, null);
  info.stats = {
    totalFiles: allFiles.length,
    codeFiles: allFiles.filter(f => /\.(cs|js|ts|razor|html|css)$/.test(f)).length,
    totalSize: 0
  };
  for (const file of allFiles) {
    try {
      const stat = await fs.promises.stat(file);
      info.stats.totalSize += stat.size;
    } catch {}
  }
  info.stats.totalSizeHuman = formatSize(info.stats.totalSize);

  writeResult(id, {
    content: [{
      type: 'text',
      text: JSON.stringify(info, null, 2)
    }]
  });
}

// =============================================================================
// NOVAS FEATURES - analyze_dependencies (v8.4.0)
// =============================================================================

async function executeAnalyzeDependencies(id, args) {
  const searchPath = args.path;
  const outputType = args.output || 'stats';
  const safePath = validatePath(searchPath);

  const files = await collectFiles(safePath, ['.cs', '.razor', '.js', '.ts'], null);
  const dependencies = {};
  const references = {};

  for (const file of files) {
    try {
      const buffer = await fs.promises.readFile(file);
      const { text } = decodeBuffer(buffer);
      const imports = [];
      
      const usingRegex = /using\s+([^;]+);/g;
      let match;
      while ((match = usingRegex.exec(text)) !== null) {
        imports.push(match[1]);
      }
      
      const importRegex = /import\s+.*\s+from\s+['"]([^'"]+)['"]/g;
      while ((match = importRegex.exec(text)) !== null) {
        imports.push(match[1]);
      }
      
      if (imports.length > 0) {
        dependencies[file] = imports;
        for (const imp of imports) {
          if (!references[imp]) references[imp] = [];
          references[imp].push(file);
        }
      }
    } catch {}
  }

  const result = {
    totalFiles: files.length,
    filesWithDependencies: Object.keys(dependencies).length,
    totalDependencies: Object.values(dependencies).reduce((sum, deps) => sum + deps.length, 0),
    averageDependencies: Object.values(dependencies).reduce((sum, deps) => sum + deps.length, 0) / Math.max(1, Object.keys(dependencies).length)
  };

  if (outputType === 'graph') {
    result.graph = {
      nodes: files.map(f => ({ id: f, label: path.basename(f) })),
      edges: []
    };
    for (const [file, deps] of Object.entries(dependencies)) {
      for (const dep of deps) {
        const target = files.find(f => f.includes(dep) || f.includes(dep.replace(/\./g, '/')));
        if (target) {
          result.graph.edges.push({ from: file, to: target });
        }
      }
    }
  } else if (outputType === 'list') {
    result.dependencies = dependencies;
    result.references = references;
  }

  const cycles = detectCycles(dependencies);
  if (cycles.length > 0) {
    result.cycles = cycles;
    result.hasCycles = true;
  }

  writeResult(id, {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }]
  });
}

function detectCycles(dependencies) {
  const cycles = [];
  const visited = new Set();
  const recursionStack = new Set();
  
  function dfs(node, path) {
    if (recursionStack.has(node)) {
      cycles.push(path.concat(node));
      return;
    }
    if (visited.has(node)) return;
    
    visited.add(node);
    recursionStack.add(node);
    
    const deps = dependencies[node] || [];
    for (const dep of deps) {
      dfs(dep, [...path, node]);
    }
    
    recursionStack.delete(node);
  }
  
  for (const file of Object.keys(dependencies)) {
    dfs(file, []);
  }
  
  return cycles;
}

// =============================================================================
// NOVAS FEATURES - compare_files (v8.4.0)
// =============================================================================

async function executeCompareFiles(id, args) {
  const file1 = args.file1;
  const file2 = args.file2;
  const format = args.format || 'unified';

  if (!file1 || !file2) {
    return writeToolError(id, '❌ "file1" e "file2" são obrigatórios.');
  }

  const safeFile1 = validatePath(file1);
  const safeFile2 = validatePath(file2);

  try {
    const content1 = await fs.promises.readFile(safeFile1, 'utf8');
    const content2 = await fs.promises.readFile(safeFile2, 'utf8');
    
    const lines1 = content1.split('\n');
    const lines2 = content2.split('\n');
    
    if (format === 'json') {
      const diff = {
        file1: safeFile1,
        file2: safeFile2,
        lines1: lines1.length,
        lines2: lines2.length,
        differences: []
      };
      
      const maxLen = Math.max(lines1.length, lines2.length);
      for (let i = 0; i < maxLen; i++) {
        const l1 = i < lines1.length ? lines1[i] : '';
        const l2 = i < lines2.length ? lines2[i] : '';
        if (l1 !== l2) {
          diff.differences.push({
            line: i + 1,
            file1: l1 || '<EOF>',
            file2: l2 || '<EOF>'
          });
        }
      }
      
      writeResult(id, {
        content: [{
          type: 'text',
          text: JSON.stringify(diff, null, 2)
        }]
      });
    } else if (format === 'side-by-side') {
      const maxLen = Math.max(lines1.length, lines2.length);
      const output = [
        `📊 Comparação lado a lado:`,
        `${'─'.repeat(120)}`,
        `${' '.padEnd(50)}|${' '.padEnd(50)}`,
        `${'Arquivo 1'.padEnd(50)}|${'Arquivo 2'.padEnd(50)}`,
        `${'─'.repeat(120)}`
      ];
      
      for (let i = 0; i < maxLen; i++) {
        const l1 = i < lines1.length ? lines1[i] : '';
        const l2 = i < lines2.length ? lines2[i] : '';
        if (l1 !== l2) {
          const prefix = i < Math.min(lines1.length, lines2.length) ? '⚠️' : '➕/➖';
          output.push(
            `${prefix} L${(i+1).toString().padStart(4)} ${l1.slice(0, 40).padEnd(50)}|` +
            `${prefix} L${(i+1).toString().padStart(4)} ${l2.slice(0, 40).padEnd(50)}`
          );
        }
      }
      
      writeResult(id, {
        content: [{
          type: 'text',
          text: output.join('\n')
        }]
      });
    } else {
      const diff = [];
      let i = 0, j = 0;
      let context = 0;
      const contextLines = 3;
      
      while (i < lines1.length || j < lines2.length) {
        if (i < lines1.length && j < lines2.length && lines1[i] === lines2[j]) {
          if (context < contextLines) {
            diff.push(`  ${lines1[i]}`);
            context++;
          }
          i++; j++;
        } else {
          let startI = i;
          let startJ = j;
          while (i < lines1.length && (j >= lines2.length || lines1[i] !== lines2[j])) {
            i++;
          }
          while (j < lines2.length && (i >= lines1.length || lines1[i] !== lines2[j])) {
            j++;
          }
          
          diff.push(`@@ -${startI+1},${i-startI} +${startJ+1},${j-startJ} @@`);
          for (let k = startI; k < i; k++) {
            diff.push(`- ${lines1[k]}`);
          }
          for (let k = startJ; k < j; k++) {
            diff.push(`+ ${lines2[k]}`);
          }
          context = 0;
        }
      }
      
      writeResult(id, {
        content: [{
          type: 'text',
          text: `📊 Diff unificado (${safeFile1} → ${safeFile2}):\n\n${diff.join('\n')}`
        }]
      });
    }
  } catch (err) {
    writeToolError(id, `❌ Erro ao comparar arquivos: ${err.message}`);
  }
}

// =============================================================================
// NOVAS FEATURES - get_symbol_usage (v8.4.0)
// =============================================================================

async function executeGetSymbolUsage(id, args) {
  const name = args.name;
  const searchPath = args.path || '.';
  const filePattern = args.filePattern || '.cs,.razor';

  if (!name) return writeToolError(id, '❌ "name" é obrigatório.');

  const safePath = validatePath(searchPath);
  const exts = filePattern.split(',').map(e => e.trim());
  const files = await collectFiles(safePath, exts, null);

  const usage = {
    symbol: name,
    totalOccurrences: 0,
    files: [],
    contexts: [],
    declarations: []
  };

  for (const file of files) {
    try {
      const buffer = await fs.promises.readFile(file);
      const { text } = decodeBuffer(buffer);
      const lines = text.split(/\r\n|\r|\n/);
      
      let occurrences = 0;
      let declarations = 0;
      const contexts = [];
      
      const regex = new RegExp(`\\b${escapeRegex(name)}\\b`, 'g');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (regex.test(line)) {
          occurrences++;
          const isDeclaration = /class|interface|struct|enum|record/.test(line);
          if (isDeclaration) declarations++;
          
          const context = getLineContext(lines, i);
          contexts.push({
            line: i + 1,
            text: truncateLine(line.trim()),
            context,
            isDeclaration
          });
        }
      }
      
      if (occurrences > 0) {
        usage.files.push({
          file,
          occurrences,
          declarations
        });
        usage.contexts.push(...contexts);
        usage.totalOccurrences += occurrences;
        if (declarations > 0) {
          usage.declarations.push({ file, count: declarations });
        }
      }
    } catch {}
  }

  usage.files.sort((a, b) => b.occurrences - a.occurrences);
  
  usage.statistics = {
    totalFiles: usage.files.length,
    averagePerFile: (usage.totalOccurrences / Math.max(1, usage.files.length)).toFixed(1),
    mostUsedFile: usage.files.length > 0 ? usage.files[0].file : null,
    isCommonSymbol: usage.totalOccurrences > 10
  };

  writeResult(id, {
    content: [{
      type: 'text',
      text: JSON.stringify(usage, null, 2)
    }]
  });
}

// =============================================================================
// NOVAS FEATURES - code_completion (v8.4.0)
// =============================================================================

async function executeCodeCompletion(id, args) {
  const filePath = args.file;
  const lineNum = args.line || 0;
  const column = args.column || 0;
  const context = args.context || '';
  const maxSuggestions = Math.min(args.maxSuggestions || 5, 10);

  if (!filePath) return writeToolError(id, '❌ "file" é obrigatório.');

  const safePath = validatePath(filePath);
  const buffer = await fs.promises.readFile(safePath);
  const { text } = decodeBuffer(buffer);
  const lines = text.split(/\r\n|\r|\n/);
  
  const suggestions = [];
  const currentLine = lineNum > 0 ? lines[lineNum - 1] || '' : '';
  const currentText = context || currentLine;
  
  if (currentText.includes('new ')) {
    const className = currentText.match(/new\s+(\w+)/);
    if (className) {
      suggestions.push({
        type: 'constructor',
        text: `new ${className[1]}()`,
        description: `Instancia ${className[1]}`
      });
      suggestions.push({
        type: 'constructor',
        text: `new ${className[1]} { }`,
        description: `Instancia ${className[1]} com inicializador`
      });
    }
  }
  
  if (currentText.includes('using ')) {
    const namespace = currentText.match(/using\s+(\w+)/);
    if (namespace) {
      suggestions.push({
        type: 'using',
        text: `using ${namespace[1]}.`,
        description: `Importa namespace ${namespace[1]}`
      });
    }
  }
  
  if (currentText.includes('public ')) {
    suggestions.push({
      type: 'modifier',
      text: 'public { get; set; }',
      description: 'Propriedade auto-implementada'
    });
    suggestions.push({
      type: 'modifier',
      text: 'public void { }',
      description: 'Método público'
    });
  }
  
  if (currentText.includes('var ') || currentText.includes('string ')) {
    suggestions.push({
      type: 'declaration',
      text: 'var = new',
      description: 'Declaração de variável'
    });
  }
  
  if (currentText.includes('if ')) {
    suggestions.push({
      type: 'conditional',
      text: 'if () { }',
      description: 'Condicional if'
    });
    suggestions.push({
      type: 'conditional',
      text: 'if () { } else { }',
      description: 'Condicional if/else'
    });
  }
  
  if (currentText.includes('for ')) {
    suggestions.push({
      type: 'loop',
      text: 'for (int i = 0; i < ; i++) { }',
      description: 'Loop for'
    });
    suggestions.push({
      type: 'loop',
      text: 'foreach (var item in ) { }',
      description: 'Loop foreach'
    });
  }
  
  try {
    const dir = path.dirname(safePath);
    const files = await collectFiles(dir, ['.cs', '.razor'], null);
    const classes = [];
    const methods = [];
    
    for (const f of files.slice(0, 10)) {
      try {
        const content = await fs.promises.readFile(f, 'utf8');
        const classMatch = content.match(/class\s+(\w+)/);
        if (classMatch) classes.push(classMatch[1]);
        const methodMatch = content.match(/public\s+\w+\s+(\w+)\s*\(/);
        if (methodMatch) methods.push(methodMatch[1]);
      } catch {}
    }
    
    if (classes.length > 0 && currentText.includes('new ')) {
      suggestions.push({
        type: 'class',
        text: `new ${classes[0]}()`,
        description: `Instancia ${classes[0]} (encontrado no projeto)`
      });
    }
    
    if (methods.length > 0 && currentText.includes('.')) {
      suggestions.push({
        type: 'method',
        text: `${methods[0]}()`,
        description: `Chama ${methods[0]} (encontrado no projeto)`
      });
    }
  } catch {}

  if (currentText.trim().startsWith('//')) {
    suggestions.push({
      type: 'comment',
      text: '// TODO: Implementar ',
      description: 'Comentário TODO'
    });
    suggestions.push({
      type: 'comment',
      text: '// FIXME: Corrigir ',
      description: 'Comentário FIXME'
    });
  }

  writeResult(id, {
    content: [{
      type: 'text',
      text: JSON.stringify({
        file: safePath,
        line: lineNum,
        column: column,
        suggestions: suggestions.slice(0, maxSuggestions),
        totalSuggestions: suggestions.length,
        context: currentText,
        tip: 'Use o contexto completo para melhores sugestões'
      }, null, 2)
    }]
  });
}

// =============================================================================
// FEATURES FALTANTES - rename_symbol (v8.5.0)
// =============================================================================

async function executeRenameSymbol(id, args) {
  const oldName = args.oldName;
  const newName = args.newName;
  const searchPath = args.path || '.';
  const filePattern = args.filePattern || '.cs,.razor';
  const dryRun = args.dryRun !== false;

  if (!oldName || !newName) {
    return writeToolError(id, '❌ "oldName" e "newName" são obrigatórios.');
  }

  const safePath = validatePath(searchPath);
  const exts = filePattern.split(',').map(e => e.trim());
  const files = await collectFiles(safePath, exts, null);

  const changes = [];
  let totalReplacements = 0;

  for (const file of files) {
    try {
      const buffer = await fs.promises.readFile(file);
      const { text } = decodeBuffer(buffer);
      
      const regex = new RegExp(`\\b${escapeRegex(oldName)}\\b`, 'g');
      const matches = text.match(regex);
      
      if (matches) {
        const newText = text.replace(regex, newName);
        const replacements = matches.length;
        totalReplacements += replacements;
        
        changes.push({
          file,
          replacements,
          preview: buildDiffPreview(text, newText).preview
        });

        if (!dryRun) {
          await writeBackup(file, buffer);
          await fs.promises.writeFile(file, newText, 'utf8');
          invalidateCachePaths(file);
        }
      }
    } catch (err) {
      changes.push({ file, error: err.message });
    }
  }

  writeResult(id, {
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: dryRun ? 'preview' : 'success',
        dryRun,
        totalFiles: changes.length,
        totalReplacements,
        changes: changes.slice(0, 20),
        message: dryRun 
          ? `📋 Preview: ${changes.length} arquivo(s) seriam modificados (${totalReplacements} substituições)`
          : `✅ ${changes.length} arquivo(s) modificados (${totalReplacements} substituições)`
      }, null, 2)
    }]
  });
}

// =============================================================================
// FEATURES FALTANTES - get_call_hierarchy (v8.5.0)
// =============================================================================

async function executeCallHierarchy(id, args) {
  const name = args.name;
  const searchPath = args.path || '.';
  const direction = args.direction || 'both';
  const maxDepth = Math.min(args.maxDepth || 3, 5);

  if (!name) return writeToolError(id, '❌ "name" é obrigatório.');

  const safePath = validatePath(searchPath);
  const files = await collectFiles(safePath, ['.cs', '.razor'], null);

  const hierarchy = {
    symbol: name,
    incoming: [],
    outgoing: [],
    depth: maxDepth
  };

  function findCalls(text, methodName) {
    const calls = [];
    const regex = new RegExp(`\\b${escapeRegex(methodName)}\\s*\\(`, 'g');
    let match;
    while ((match = regex.exec(text)) !== null) {
      const lineNum = text.substring(0, match.index).split('\n').length;
      calls.push({ line: lineNum });
    }
    return calls;
  }

  function findMethodDefinitions(text, methodName) {
    const definitions = [];
    const regex = new RegExp(`(?:public|private|protected|internal)?\\s*(?:static|async)?\\s*\\w+\\s+${escapeRegex(methodName)}\\s*\\(`, 'g');
    let match;
    while ((match = regex.exec(text)) !== null) {
      const lineNum = text.substring(0, match.index).split('\n').length;
      definitions.push({ line: lineNum });
    }
    return definitions;
  }

  for (const file of files) {
    try {
      const buffer = await fs.promises.readFile(file);
      const { text } = decodeBuffer(buffer);

      if (direction === 'incoming' || direction === 'both') {
        const calls = findCalls(text, name);
        if (calls.length > 0) {
          hierarchy.incoming.push({
            file,
            calls: calls.slice(0, 5)
          });
        }
      }

      if (direction === 'outgoing' || direction === 'both') {
        const definitions = findMethodDefinitions(text, name);
        if (definitions.length > 0) {
          const lines = text.split('\n');
          let methodStart = definitions[0].line - 1;
          let methodEnd = methodStart;
          let braceCount = 0;
          
          for (let i = methodStart; i < lines.length; i++) {
            const line = lines[i];
            const openBraces = (line.match(/{/g) || []).length;
            const closeBraces = (line.match(/}/g) || []).length;
            braceCount += openBraces - closeBraces;
            if (braceCount === 0 && i > methodStart) {
              methodEnd = i;
              break;
            }
          }

          const methodBody = lines.slice(methodStart, methodEnd + 1).join('\n');
          const callRegex = /(\w+)\s*\(/g;
          let callMatch;
          while ((callMatch = callRegex.exec(methodBody)) !== null) {
            if (callMatch[1] !== name && !['if', 'for', 'while', 'switch', 'using', 'return', 'throw'].includes(callMatch[1])) {
              hierarchy.outgoing.push({
                file,
                calledMethod: callMatch[1],
                line: methodStart + methodBody.substring(0, callMatch.index).split('\n').length
              });
            }
          }
        }
      }
    } catch {}
  }

  hierarchy.summary = {
    totalIncoming: hierarchy.incoming.reduce((sum, f) => sum + f.calls.length, 0),
    totalOutgoing: hierarchy.outgoing.length,
    filesWithIncoming: hierarchy.incoming.length,
    filesWithOutgoing: hierarchy.outgoing.length > 0 ? 1 : 0
  };

  writeResult(id, {
    content: [{
      type: 'text',
      text: JSON.stringify(hierarchy, null, 2)
    }]
  });
}

// =============================================================================
// FEATURES FALTANTES - get_type_info (v8.5.0)
// =============================================================================

async function executeGetTypeInfo(id, args) {
  const name = args.name;
  const searchPath = args.path || '.';

  if (!name) return writeToolError(id, '❌ "name" é obrigatório.');

  const safePath = validatePath(searchPath);
  const files = await collectFiles(safePath, ['.cs', '.razor'], null);

  let typeInfo = null;

  for (const file of files) {
    try {
      const buffer = await fs.promises.readFile(file);
      const { text } = decodeBuffer(buffer);
      
      const typeRegex = new RegExp(`(?:public|private|protected|internal)?\\s*(?:static|sealed|abstract|partial)?\\s*(?:class|interface|struct|record)\\s+${escapeRegex(name)}`, 'g');
      const match = typeRegex.exec(text);
      
      if (match) {
        const lines = text.split('\n');
        const startLine = text.substring(0, match.index).split('\n').length;
        
        let endLine = startLine;
        let braceCount = 0;
        for (let i = startLine; i < lines.length; i++) {
          const line = lines[i];
          const openBraces = (line.match(/{/g) || []).length;
          const closeBraces = (line.match(/}/g) || []).length;
          braceCount += openBraces - closeBraces;
          if (braceCount === 0 && i > startLine) {
            endLine = i;
            break;
          }
        }

        const typeContent = lines.slice(startLine, endLine + 1).join('\n');
        
        const propRegex = /(?:public|private|protected|internal)?\s*(?:required\s+)?(?:static\s+)?(\w+)\s+(\w+)\s*\{/g;
        const properties = [];
        let propMatch;
        while ((propMatch = propRegex.exec(typeContent)) !== null) {
          properties.push({
            name: propMatch[2],
            type: propMatch[1],
            isRequired: propMatch[0].includes('required')
          });
        }

        const methodRegex = /(?:public|private|protected|internal)?\s*(?:static|async)?\s*(\w+)\s+(\w+)\s*\(/g;
        const methods = [];
        let methodMatch;
        while ((methodMatch = methodRegex.exec(typeContent)) !== null) {
          if (!['if', 'for', 'while', 'switch', 'using'].includes(methodMatch[2])) {
            methods.push({
              name: methodMatch[2],
              returnType: methodMatch[1] || 'void'
            });
          }
        }

        const inheritsRegex = /:\s*([^{]+)/;
        const inheritsMatch = typeContent.match(inheritsRegex);
        const inherits = inheritsMatch ? inheritsMatch[1].split(',').map(i => i.trim()) : [];

        typeInfo = {
          name,
          file,
          startLine,
          endLine,
          totalLines: endLine - startLine + 1,
          kind: match[0].includes('interface') ? 'interface' : 
                match[0].includes('struct') ? 'struct' :
                match[0].includes('record') ? 'record' : 'class',
          inherits,
          properties: properties.slice(0, 20),
          methods: methods.slice(0, 20),
          summary: {
            totalProperties: properties.length,
            totalMethods: methods.length,
            totalInherits: inherits.length
          }
        };
        break;
      }
    } catch {}
  }

  if (!typeInfo) {
    return writeResult(id, {
      content: [{ type: 'text', text: `📋 Tipo "${name}" não encontrado em ${searchPath}` }]
    });
  }

  writeResult(id, {
    content: [{
      type: 'text',
      text: JSON.stringify(typeInfo, null, 2)
    }]
  });
}

// =============================================================================
// FEATURES FALTANTES - extract_interface (v8.5.0)
// =============================================================================

async function executeExtractInterface(id, args) {
  const classPath = args.classPath;
  const className = args.className;
  const methods = args.methods || [];
  const dryRun = args.dryRun !== false;

  if (!classPath || !className) {
    return writeToolError(id, '❌ "classPath" e "className" são obrigatórios.');
  }

  const safePath = validatePath(classPath);
  const buffer = await fs.promises.readFile(safePath);
  const { text } = decodeBuffer(buffer);
  const lines = text.split('\n');

  const classRegex = new RegExp(`(?:public|private|protected|internal)?\\s*(?:static|sealed|abstract|partial)?\\s*class\\s+${escapeRegex(className)}`, 'g');
  const match = classRegex.exec(text);
  
  if (!match) {
    return writeToolError(id, `❌ Classe "${className}" não encontrada em ${classPath}`);
  }

  const methodRegex = /(?:public)\s*(?:static|async)?\s*(\w+)\s+(\w+)\s*\(([^)]*)\)/g;
  const methodMatches = [];
  let methodMatch;
  while ((methodMatch = methodRegex.exec(text)) !== null) {
    if (methods.length === 0 || methods.includes(methodMatch[2])) {
      methodMatches.push({
        name: methodMatch[2],
        returnType: methodMatch[1] || 'void',
        parameters: methodMatch[3].trim()
      });
    }
  }

  if (methodMatches.length === 0) {
    return writeToolError(id, `❌ Nenhum método público encontrado em ${className}`);
  }

  const interfaceName = `I${className}`;
  const interfaceContent = [
    `public interface ${interfaceName}`,
    `{`,
    ...methodMatches.map(m => 
      `    ${m.returnType} ${m.name}(${m.parameters});`
    ),
    `}`
  ].join('\n');

  const updatedClass = text.replace(
    classRegex,
    `public class ${className} : ${interfaceName}`
  );

  const result = {
    className,
    interfaceName,
    interfaceContent,
    methods: methodMatches,
    dryRun,
    message: dryRun 
      ? `📋 Preview: Interface ${interfaceName} com ${methodMatches.length} métodos será criada`
      : `✅ Interface ${interfaceName} criada com sucesso`
  };

  if (!dryRun) {
    const interfacePath = path.join(path.dirname(safePath), `${interfaceName}.cs`);
    await writeBackup(safePath, buffer);
    await fs.promises.writeFile(interfacePath, interfaceContent, 'utf8');
    
    await fs.promises.writeFile(safePath, updatedClass, 'utf8');
    invalidateCachePaths(safePath);
    
    result.interfaceFile = interfacePath;
    result.updatedClass = true;
  }

  writeResult(id, {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }]
  });
}

// =============================================================================
// FEATURES FALTANTES - find_unused_code (v8.5.0)
// =============================================================================

async function executeFindUnusedCode(id, args) {
  const searchPath = args.path || '.';
  const filePattern = args.filePattern || '.cs,.razor';
  const includeTests = args.includeTests || false;

  const safePath = validatePath(searchPath);
  const exts = filePattern.split(',').map(e => e.trim());
  const files = await collectFiles(safePath, exts, null);

  const filteredFiles = includeTests 
    ? files 
    : files.filter(f => !f.includes('.Tests.') && !f.includes('.Test.'));

  const definitions = {};
  const usages = {};

  for (const file of filteredFiles) {
    try {
      const buffer = await fs.promises.readFile(file);
      const { text } = decodeBuffer(buffer);
      
      const methodRegex = /(?:public)\s*(?:static|async)?\s*(\w+)\s+(\w+)\s*\(/g;
      let match;
      while ((match = methodRegex.exec(text)) !== null) {
        const name = match[2];
        if (!['if', 'for', 'while', 'switch', 'using'].includes(name)) {
          const key = `${file}:${name}`;
          definitions[key] = {
            file,
            name,
            returnType: match[1] || 'void',
            line: text.substring(0, match.index).split('\n').length,
            type: 'method'
          };
        }
      }

      const propRegex = /(?:public)\s*(?:required\s+)?(\w+)\s+(\w+)\s*\{/g;
      while ((match = propRegex.exec(text)) !== null) {
        const key = `${file}:${match[2]}`;
        definitions[key] = {
          file,
          name: match[2],
          type: match[1] || 'string',
          line: text.substring(0, match.index).split('\n').length,
          kind: 'property'
        };
      }

      const useRegex = /(\w+)\s*\(/g;
      while ((match = useRegex.exec(text)) !== null) {
        const name = match[1];
        if (!['if', 'for', 'while', 'switch', 'using', 'return', 'throw', 'new'].includes(name)) {
          if (!usages[name]) usages[name] = [];
          usages[name].push({
            file,
            line: text.substring(0, match.index).split('\n').length
          });
        }
      }
    } catch {}
  }

  const unused = [];
  for (const [key, def] of Object.entries(definitions)) {
    const usageCount = (usages[def.name] || []).filter(u => u.file !== def.file).length;
    if (usageCount === 0) {
      unused.push({
        ...def,
        usageCount,
        suggestion: def.type === 'method' 
          ? 'Considere remover este método ou torná-lo privado'
          : 'Considere remover esta propriedade'
      });
    }
  }

  writeResult(id, {
    content: [{
      type: 'text',
      text: JSON.stringify({
        totalDefinitions: Object.keys(definitions).length,
        totalUnused: unused.length,
        unused: unused.slice(0, 20),
        summary: unused.length === 0 
          ? '✅ Nenhum código não utilizado encontrado!' 
          : `⚠️ ${unused.length} símbolos não utilizados encontrados`
      }, null, 2)
    }]
  });
}

// =============================================================================
// FEATURES FALTANTES - analyze_complexity (v8.5.0)
// =============================================================================

function stripCommentsAndStrings(text) {
  // Remove comentários de linha e bloco, e o conteúdo de strings/chars,
  // pra não contar 'if'/'for' etc que apareçam dentro deles.
  return text
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"""[\s\S]*?"""/g, '""')       // raw strings C# 11+
    .replace(/\$?@?"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

async function executeAnalyzeComplexity(id, args) {
  const searchPath = args.path;
  const threshold = args.threshold || 10;

  if (!searchPath) return writeToolError(id, '❌ "path" é obrigatório.');

  const safePath = validatePath(searchPath);
  const stat = await fs.promises.stat(safePath);
  
  let files = [];
  if (stat.isDirectory()) {
    files = await collectFiles(safePath, ['.cs', '.razor'], null);
  } else {
    files = [safePath];
  }

  const results = [];
  let totalComplexity = 0;
  let maxComplexity = 0;
  let filesAboveThreshold = 0;

  for (const file of files) {
    try {
      const buffer = await fs.promises.readFile(file);
      const { text: rawText } = decodeBuffer(buffer);
      const text = stripCommentsAndStrings(rawText);
      const lines = text.split('\n');

      let cyclomaticComplexity = 0;
      let cognitiveComplexity = 0;
      let nestingDepth = 0;
      let maxNesting = 0;

      // \b garante palavra inteira: não casa 'if' dentro de 'Identifier', 'Modified' etc.
      // 'foreach' é checado antes de 'for' pra não contar as duas em cima da mesma ocorrência.
      const decisionRegex = /\bforeach\b|\bfor\b|\bif\b|\belse\s+if\b|\bwhile\b|\bdo\b|\bswitch\b|\bcase\b|\bcatch\b|&&|\|\||\?(?!\?|\.)/g;

      for (const line of lines) {
        const matches = line.match(decisionRegex);
        if (matches) cyclomaticComplexity += matches.length;

        const openBraces = (line.match(/{/g) || []).length;
        const closeBraces = (line.match(/}/g) || []).length;
        nestingDepth += openBraces - closeBraces;
        if (nestingDepth > maxNesting) maxNesting = nestingDepth;
      }

      cognitiveComplexity = cyclomaticComplexity + maxNesting;

      const status = cyclomaticComplexity > threshold ? '⚠️ Alta' : '✅ OK';
      if (cyclomaticComplexity > threshold) filesAboveThreshold++;

      totalComplexity += cyclomaticComplexity;
      if (cyclomaticComplexity > maxComplexity) maxComplexity = cyclomaticComplexity;

      results.push({
        file,
        cyclomaticComplexity,
        cognitiveComplexity,
        maxNesting,
        threshold,
        status,
        recommendation: cyclomaticComplexity > threshold 
          ? `Considere simplificar este arquivo (${cyclomaticComplexity} > ${threshold})`
          : 'Complexidade aceitável'
      });
    } catch {}
  }

  const averageComplexity = results.length > 0 ? (totalComplexity / results.length).toFixed(1) : 0;

  writeResult(id, {
    content: [{
      type: 'text',
      text: JSON.stringify({
        totalFiles: results.length,
        averageComplexity: parseFloat(averageComplexity),
        maxComplexity,
        filesAboveThreshold,
        threshold,
        summary: filesAboveThreshold === 0 
          ? '✅ Todos os arquivos estão dentro do limite de complexidade!'
          : `⚠️ ${filesAboveThreshold} arquivo(s) excedem o limite de complexidade (${threshold})`,
        files: results.slice(0, 20)
      }, null, 2)
    }]
  });
}

// =============================================================================
// FUNÇÕES AUXILIARES E HELPERS
// =============================================================================

async function fileExists(pattern) {
  try {
    const dir = path.dirname(pattern);
    const files = await fs.promises.readdir(dir);
    const basename = path.basename(pattern);
    const regex = new RegExp(basename.replace(/\*/g, '.*'));
    return files.some(f => regex.test(f));
  } catch {
    return false;
  }
}

async function findFiles(dir, pattern) {
  const results = [];
  const regex = new RegExp(pattern.replace(/\*/g, '.*'));
  try {
    const files = await fs.promises.readdir(dir);
    for (const file of files) {
      if (regex.test(file)) {
        results.push(path.join(dir, file));
      }
    }
  } catch {}
  return results;
}

function getLineContext(lines, index, contextLines = 2) {
  const start = Math.max(0, index - contextLines);
  const end = Math.min(lines.length, index + contextLines + 1);
  const context = lines.slice(start, end);
  return context.join('\n').trim();
}

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
  const BINARY_EXT = new Set([
    '.dll', '.exe', '.pdb', '.png', '.jpg', '.jpeg', '.gif', '.ico',
    '.zip', '.pfx', '.bmp', '.webp', '.woff', '.woff2', '.ttf', '.eot',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'
  ]);
  if (BINARY_EXT.has(path.extname(filePath).toLowerCase())) return true;

  // fs.promises.readFile NÃO aceita a opção "length" (isso só existe em fs.read/fs.readSync
  // com handle). O código antigo lia o arquivo inteiro sempre; aqui lemos de fato só os
  // primeiros 512 bytes via file handle.
  let handle;
  try {
    handle = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.alloc(512);
    const { bytesRead } = await handle.read(buffer, 0, 512, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } catch {
    return true;
  } finally {
    if (handle) { try { await handle.close(); } catch {} }
  }
}

// Tabela real do Windows-1252 pro intervalo 0x80-0x9F, onde ele diverge do Latin-1/ISO-8859-1
// (nesse intervalo o Latin-1 tem caracteres de controle C1 que não são usados na prática;
// o CP1252 usa esse espaço pra aspas curvas, travessão, €, etc. — comum em arquivos salvos
// por editores/ferramentas Windows antigas, como FastReport .frx e .resx legados)
const CP1252_MAP = {
  0x80: '\u20AC', 0x82: '\u201A', 0x83: '\u0192', 0x84: '\u201E',
  0x85: '\u2026', 0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02C6',
  0x89: '\u2030', 0x8A: '\u0160', 0x8B: '\u2039', 0x8C: '\u0152',
  0x8E: '\u017D', 0x91: '\u2018', 0x92: '\u2019', 0x93: '\u201C',
  0x94: '\u201D', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014',
  0x98: '\u02DC', 0x99: '\u2122', 0x9A: '\u0161', 0x9B: '\u203A',
  0x9C: '\u0153', 0x9E: '\u017E', 0x9F: '\u0178'
};

function decodeWindows1252(buffer) {
  let out = '';
  for (let i = 0; i < buffer.length; i++) {
    const b = buffer[i];
    out += CP1252_MAP[b] || String.fromCharCode(b); // 0x00-0x7F e 0xA0-0xFF coincidem com Latin-1
  }
  return out;
}

const utf8StrictDecoder = new TextDecoder('utf-8', { fatal: true });

function decodeBuffer(buffer, overrideEncoding = null) {
  let hadBom = false;
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    hadBom = true;
    buffer = buffer.subarray(3);
  }

  if (overrideEncoding) {
    return { text: buffer.toString(overrideEncoding), encoding: overrideEncoding, hadBom };
  }

  try {
    // fatal:true faz REJEITAR bytes inválidos em vez de virar '�' silenciosamente
    // (que é o que buffer.toString('utf-8') fazia antes, perdendo a informação original)
    const text = utf8StrictDecoder.decode(buffer);
    return { text, encoding: 'utf-8', hadBom };
  } catch {
    // Bytes não são UTF-8 válido -> quase certo que é Windows-1252 (caso comum em .resx/.frx antigos)
    return { text: decodeWindows1252(buffer), encoding: 'windows-1252 (auto-detectado)', hadBom };
  }
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

let _backupCounter = 0;
async function writeBackup(filePath, buffer) {
  // Date.now() sozinho pode colidir se o mesmo arquivo for salvo 2x no mesmo milissegundo
  // (ex: duas chamadas seguidas no mesmo turno do Cline), sobrescrevendo o backup anterior
  // silenciosamente. O contador garante nome único mesmo nesse caso.
  const bakPath = `${filePath}.bak.${Date.now()}${(_backupCounter++ % 1000).toString().padStart(3, '0')}`;
  try {
    await fs.promises.writeFile(bakPath, buffer);
    return { ok: true, bakPath };
  } catch (err) {
    return { ok: false, error: err };
  }
}

async function cleanOldBackups(dir, maxAge = BACKUP_CONFIG.maxAge) {
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

// =============================================================================
// TOOLS DE TRADUÇÃO (RESX) - MANTIDAS INTACTAS
// =============================================================================

const RESX_LANGS = ['pt-BR', 'en-US', 'es-ES'];
const LOC_KEY_REGEX = /Loc\[\s*"([^"]*)"\s*\]/g;

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
      keyPositions.get(key).push(i + 1);
    }
  }
  
  const duplicateEntries = [];
  let total = 0;
  for (const [key, positions] of keyPositions) {
    if (positions.length > 1) {
      duplicateEntries.push({ 
        key, 
        positions,
        count: positions.length,
        occurrencesToRemove: positions.length - 1
      });
      total += positions.length - 1;
    }
  }

  // Duplicatas por diferença de maiúscula/minúscula (ex: LabelCEP vs LabelCep) — só DETECÇÃO.
  // Diferente de duplicata exata, aqui não dá pra saber automaticamente qual variante é a
  // "certa" (pode haver código C# referenciando cada uma das duas), então isso não remove
  // nada sozinho — só reporta pra revisão manual, idealmente cruzando com find_references.
  const byLowerCase = new Map();
  for (const key of keyPositions.keys()) {
    const lower = key.toLowerCase();
    if (!byLowerCase.has(lower)) byLowerCase.set(lower, []);
    byLowerCase.get(lower).push(key);
  }
  const caseInsensitiveDuplicates = [];
  for (const [lower, variants] of byLowerCase) {
    if (variants.length > 1) {
      caseInsensitiveDuplicates.push({
        variants,
        positions: variants.map(v => ({ key: v, lines: keyPositions.get(v) }))
      });
    }
  }
  
  return { 
    duplicates: duplicateEntries,
    totalDuplicateOccurrences: total,
    duplicateKeys: duplicateEntries.map(d => d.key),
    hasDuplicates: duplicateEntries.length > 0,
    caseInsensitiveDuplicates,
    hasCaseInsensitiveDuplicates: caseInsensitiveDuplicates.length > 0
  };
}


async function executeDeduplicateResx(id, args) {
  const { path: targetPath, dryRun = true, backup = true, keepFirst = true } = args;
  const safePath = validatePath(targetPath);

  let files;
  try {
    const stat = await fs.promises.stat(safePath);
    files = stat.isDirectory() ? await collectFiles(safePath, ['.resx'], null) : [safePath];
  } catch {
    return writeToolError(id, `❌ Caminho não encontrado: ${targetPath}`);
  }

  const results = [];
  let totalRemoved = 0;
  
  for (const filePath of files) {
    let buffer;
    try { buffer = await fs.promises.readFile(filePath); } catch { continue; }
    const { text } = decodeBuffer(buffer);
    
    // Validar se é um .resx válido — aceita <root> com ou sem atributos/namespaces
    // (o ResXResourceWriter do Visual Studio normalmente gera <root xmlns:...>, não <root> puro)
    if (!/<root[\s>]/.test(text) || !text.includes('</root>')) {
      results.push({ file: filePath, error: 'Arquivo .resx inválido (não contém <root>)' });
      continue;
    }
    
    const dupInfo = findDuplicateKeysWithPositions(text);
    if (!dupInfo.hasDuplicates) {
      results.push({ file: filePath, status: 'no_duplicates' });
      continue;
    }
    
    if (!dryRun) {
      if (backup) await writeBackup(filePath, buffer);
      const clean = removeDuplicates(text, keepFirst);
      await fs.promises.writeFile(filePath, clean.cleanedText, 'utf8');
      totalRemoved += clean.removed;
      results.push({ 
        file: filePath, 
        removed: clean.removed, 
        keys: clean.removedKeys,
        preview: clean.removedKeys.map(k => `  - ${k}`).join('\n')
      });
    } else {
      // ✅ Preview com linhas exatas
      results.push({ 
        file: filePath, 
        duplicates: dupInfo.duplicates,
        count: dupInfo.totalDuplicateOccurrences,
        dryRun: true,
        preview: dupInfo.duplicates.map(d => 
          `  - ${d.key} (linhas: ${d.positions.join(', ')})`
        ).join('\n'),
        suggestion: `Use dryRun:false para remover ${dupInfo.totalDuplicateOccurrences} chave(s) duplicada(s)`
      });
    }
  }
  
  const summary = {
    status: 'success',
    dryRun,
    totalFiles: results.length,
    totalRemoved,
    results: results.slice(0, 20),
    message: dryRun 
      ? `📋 Preview: ${results.filter(r => r.duplicates).length} arquivo(s) com duplicatas. ${totalRemoved} chave(s) seriam removidas.`
      : `✅ ${results.filter(r => r.removed).length} arquivo(s) processados. ${totalRemoved} chave(s) duplicada(s) removidas.`
  };
  
  writeResult(id, { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] });
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

// =============================================================================
// EXECUTORES DAS TOOLS DE TRADUÇÃO
// =============================================================================

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
    if (buffer.length > PERFORMANCE_CONFIG.maxFileSize) continue;
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
      const parsed = await getParsedResx(filePath);
      resxData[lang] = { exists: true, keys: parsed.keys, text: parsed.text, filePath };
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
        // IMPORTANTE: escapedKey aqui precisa ser escapado pra REGEX também (escapeXml só
        // escapa &<>"', não . ( ) [ ] etc.), senão uma chave com esses caracteres quebra o regex.
        const regexSafeKey = escapeRegex(escapedKey);
        // Grupos de captura em vez de match.replace(currentVal, ...): o placeholder criado por
        // buildResxEntries tem <value> IGUAL ao name (name="KEY"><value>KEY</value>), então a
        // string da chave aparece duas vezes no trecho casado. match.replace(texto, ...) troca
        // sempre a PRIMEIRA ocorrência — que é o name, não o value — trocando chave por valor.
        // Com grupos de captura não tem essa ambiguidade: cada pedaço só é usado uma vez.
        const regex = new RegExp(`(<data name="${regexSafeKey}"[^>]*>\\s*<value>)([^<]*)(<\\/value>)`, 'g');
        newContent = newContent.replace(regex, (match, before, currentVal, after) => `${before}${escapedValue}${after}`);
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

// =============================================================================
// DELETE_TRANSLATIONS — remove chaves em lote de todos os idiomas de uma vez.
// Simétrico ao insert_translations: em vez de precisar ler o .resx inteiro e
// reescrever via edit_file (caro em token pra arquivo grande), passa só a
// lista de chaves a remover e o tool localiza/remove o bloco <data> de cada
// uma, preservando o resto do arquivo intacto.
// =============================================================================

async function executeDeleteTranslations(id, args) {
  const { path: targetPath, keys, languages, dryRun = true, backup = true } = args;
  if (!keys || !Array.isArray(keys) || keys.length === 0) {
    return writeToolError(id, '❌ "keys" (array com os nomes das chaves) é obrigatório.');
  }

  const safePath = validatePath(targetPath);
  const langs = (languages && languages.length) ? languages : RESX_LANGS;
  const keysSet = new Set(keys);

  const results = [];
  let totalRemoved = 0;

  for (const lang of langs) {
    const filePath = path.join(safePath, `SharedResources.${lang}.resx`);
    let buffer;
    try { buffer = await fs.promises.readFile(filePath); } catch { continue; }

    const { text } = decodeBuffer(buffer);
    const hasCRLF = text.includes('\r\n');
    const eol = hasCRLF ? '\r\n' : '\n';
    const lines = text.split(/\r\n|\n/);

    const removedKeys = [];
    const outputLines = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const match = line.match(/<data\s+name="([^"]*)"/);
      const key = match ? unescapeXml(match[1]) : null;

      if (key && keysSet.has(key)) {
        removedKeys.push(key);
        // Pula até (e incluindo) a linha de fechamento </data> desse bloco
        while (i < lines.length && !lines[i].includes('</data>')) i++;
        i++;
        continue;
      }
      outputLines.push(line);
      i++;
    }

    const notFoundKeys = keys.filter(k => !removedKeys.includes(k));

    if (removedKeys.length === 0) {
      results.push({ lang, status: 'no_changes', notFoundKeys });
      continue;
    }

    const newContent = outputLines.join(eol);
    totalRemoved += removedKeys.length;

    if (!dryRun) {
      if (backup) await writeBackup(filePath, buffer);
      await fs.promises.writeFile(filePath, newContent, 'utf8');
      invalidateCachePaths(filePath);
    }

    results.push({
      lang,
      status: dryRun ? 'preview' : 'removed',
      removedKeys,
      notFoundKeys,
      count: removedKeys.length
    });
  }

  const summary = {
    status: 'success',
    dryRun,
    totalRemoved,
    results,
    message: dryRun
      ? `📋 Preview: ${totalRemoved} chave(s) seriam removidas. Use dryRun:false para aplicar.`
      : `✅ ${totalRemoved} chave(s) removida(s) em ${results.filter(r => r.status === 'removed').length} arquivo(s).`
  };

  writeResult(id, { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] });
}

// =============================================================================
// FIND_UNUSED_TRANSLATIONS — chaves declaradas no .resx mas que não aparecem
// em nenhum .cs/.razor. Varre o código UMA VEZ construindo um Set de tokens
// (em vez de uma busca por chave, que seria O(chaves × arquivos) e caro em
// tempo/token) e depois só confere cada chave contra esse Set — O(arquivos)
// + O(chaves).
// =============================================================================

async function executeFindUnusedTranslations(id, args) {
  const targetPath = args.path;
  if (!targetPath) return writeToolError(id, '❌ Parâmetro "path" é obrigatório.');

  const safePath = validatePath(targetPath);
  const langs = (args.languages && args.languages.length) ? args.languages : RESX_LANGS;
  const codeExtensions = (args.extensions && args.extensions.length) ? args.extensions : ['.cs', '.razor'];
  // Por padrão assume que o código fica na mesma árvore do .resx. Se o seu .resx estiver
  // numa pasta separada (ex: "Resources/") e o código em outra, passe codePath apontando
  // pra raiz do projeto.
  const codeRoot = args.codePath ? validatePath(args.codePath) : safePath;

  const allKeys = new Set();
  for (const lang of langs) {
    const filePath = path.join(safePath, `SharedResources.${lang}.resx`);
    try {
      const { keys } = await getParsedResx(filePath);
      for (const key of keys.keys()) allKeys.add(key);
    } catch { /* idioma pode não existir, tudo bem */ }
  }
  if (allKeys.size === 0) {
    return writeToolError(id, `❌ Nenhuma chave encontrada em ${safePath} pros idiomas ${langs.join(', ')}.`);
  }

  let files;
  try {
    files = await collectFiles(codeRoot, codeExtensions, null);
  } catch {
    return writeToolError(id, `❌ Caminho de código não encontrado: ${args.codePath || targetPath}`);
  }

  const wordTokens = new Set();
  const locIndexerKeys = new Set();

  for (const filePath of files) {
    let buffer;
    try { buffer = await fs.promises.readFile(filePath); } catch { continue; }
    const { text } = decodeBuffer(buffer);

    LOC_KEY_REGEX.lastIndex = 0;
    let m;
    while ((m = LOC_KEY_REGEX.exec(text)) !== null) {
      locIndexerKeys.add(m[1]);
    }

    // Checagem ampla e propositalmente permissiva: qualquer identificador de palavra
    // inteira no arquivo. Cobre acesso fortemente tipado (SharedResources.Key),
    // GetString("Key"), nameof(Key), etc. — o objetivo é NUNCA marcar uma chave como
    // "não usada" por engano; prefere errar pro lado de "achou uso demais".
    const tokens = text.match(/[A-Za-z_][A-Za-z0-9_]*/g);
    if (tokens) for (const t of tokens) wordTokens.add(t);
  }

  const unusedKeys = [];
  const usedViaLoc = [];
  const usedViaFallbackOnly = [];

  for (const key of allKeys) {
    if (locIndexerKeys.has(key)) {
      usedViaLoc.push(key);
    } else if (wordTokens.has(key)) {
      usedViaFallbackOnly.push(key);
    } else {
      unusedKeys.push(key);
    }
  }

  const summary = {
    status: 'success',
    totalKeys: allKeys.size,
    filesScanned: files.length,
    usedViaLocCount: usedViaLoc.length,
    usedViaFallbackOnlyCount: usedViaFallbackOnly.length,
    usedViaFallbackOnly: usedViaFallbackOnly.slice(0, 50),
    unusedCount: unusedKeys.length,
    unusedKeys: unusedKeys.sort(),
    warning: '⚠️ Heurística, não garantia: uma chave "não usada" ainda pode ser referenciada dinamicamente (string montada em runtime, config, nome vindo de banco). "usedViaFallbackOnly" merece uma olhada — foi achada como palavra solta no código, não via Loc[...], então pode ser coincidência de nome. Confira uma amostra com find_references/search_content antes de mandar pro delete_translations, principalmente em telas fiscais/jurídicas.'
  };

  writeResult(id, { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] });
}

// =============================================================================
// FIND_MISSING_LOC_KEYS — o inverso do anterior: Loc["Chave"] usado no código
// mas que não existe em NENHUM dos .resx. Pega tanto erro de digitação na
// chave quanto "esqueci de gerar a tradução" quanto hardcode que criou a
// própria chave sem passar pelo fluxo normal (generate_labels/insert_translations).
// =============================================================================

async function executeFindMissingLocKeys(id, args) {
  const targetPath = args.path;
  if (!targetPath) return writeToolError(id, '❌ Parâmetro "path" é obrigatório.');

  const safePath = validatePath(targetPath);
  const langs = (args.languages && args.languages.length) ? args.languages : RESX_LANGS;
  const codeExtensions = (args.extensions && args.extensions.length) ? args.extensions : ['.cs', '.razor'];
  const codeRoot = args.codePath ? validatePath(args.codePath) : safePath;

  const declaredKeys = new Set();
  for (const lang of langs) {
    const filePath = path.join(safePath, `SharedResources.${lang}.resx`);
    try {
      const { keys } = await getParsedResx(filePath);
      for (const key of keys.keys()) declaredKeys.add(key);
    } catch { /* idioma pode não existir, tudo bem */ }
  }

  let files;
  try {
    files = await collectFiles(codeRoot, codeExtensions, null);
  } catch {
    return writeToolError(id, `❌ Caminho de código não encontrado: ${args.codePath || targetPath}`);
  }

  // key -> [{file, line}] (guarda só a primeira ocorrência de cada arquivo, pra não
  // inchar a resposta se a mesma chave-fantasma aparecer 10x no mesmo arquivo)
  const usageByKey = new Map();

  for (const filePath of files) {
    let buffer;
    try { buffer = await fs.promises.readFile(filePath); } catch { continue; }
    const { text } = decodeBuffer(buffer);
    const lines = text.split(/\r\n|\n/);

    LOC_KEY_REGEX.lastIndex = 0;
    let m;
    while ((m = LOC_KEY_REGEX.exec(text)) !== null) {
      const key = m[1];
      if (declaredKeys.has(key)) continue;
      if (!key || !key.trim()) continue; // Loc[""] ou Loc[variavel] não é uma chave hardcoded de verdade

      if (!usageByKey.has(key)) usageByKey.set(key, []);
      const occurrences = usageByKey.get(key);
      if (occurrences.some(o => o.file === filePath)) continue;

      // Acha a linha aproximada procurando o texto da chave
      let lineNum = null;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`"${key}"`)) { lineNum = i + 1; break; }
      }
      occurrences.push({ file: filePath, line: lineNum });
    }
  }

  const missingKeys = [...usageByKey.entries()]
    .map(([key, occurrences]) => ({ key, occurrenceCount: occurrences.length, occurrences: occurrences.slice(0, 5) }))
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount);

  const summary = {
    status: 'success',
    filesScanned: files.length,
    declaredKeysCount: declaredKeys.size,
    missingKeysCount: missingKeys.length,
    missingKeys: missingKeys.slice(0, 100),
    suggestion: missingKeys.length > 0
      ? '💡 Cada uma dessas é um Loc["..."] usado no código sem chave correspondente em nenhum .resx. Pode ser erro de digitação (comparar com chaves parecidas já existentes) ou tradução esquecida (rodar generate_labels/insert_translations pra criar).'
      : '✅ Todo Loc["..."] usado no código tem chave correspondente em pelo menos um idioma.'
  };

  writeResult(id, { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] });
}

// =============================================================================
// RESOLVE_CASE_DUPLICATES — cruza as duplicatas por maiúscula/minúscula (achadas
// por find_duplicates) com o uso real de Loc["..."] no código. Loc[...] é um
// lookup de dicionário em runtime, não checado em compilação, então excluir a
// variante errada NUNCA quebra o build — na pior hipótese, aquela tela específica
// para de traduzir aquele texto (visível, não silencioso). Isso muda o cálculo
// de risco: dá pra decidir automaticamente quando o uso é inequívoco.
// =============================================================================

async function executeResolveCaseDuplicates(id, args) {
  const targetPath = args.path;
  if (!targetPath) return writeToolError(id, '❌ Parâmetro "path" é obrigatório.');

  const safePath = validatePath(targetPath);
  const langs = (args.languages && args.languages.length) ? args.languages : RESX_LANGS;
  const codeExtensions = (args.extensions && args.extensions.length) ? args.extensions : ['.cs', '.razor'];
  const codeRoot = args.codePath ? validatePath(args.codePath) : safePath;

  // 1. Junta as chaves de todos os idiomas e agrupa por lowercase
  const allKeys = new Set();
  for (const lang of langs) {
    const filePath = path.join(safePath, `SharedResources.${lang}.resx`);
    try {
      const { keys } = await getParsedResx(filePath);
      for (const key of keys.keys()) allKeys.add(key);
    } catch {}
  }

  const byLowerCase = new Map();
  for (const key of allKeys) {
    const lower = key.toLowerCase();
    if (!byLowerCase.has(lower)) byLowerCase.set(lower, []);
    byLowerCase.get(lower).push(key);
  }
  const groups = [...byLowerCase.values()].filter(variants => variants.length > 1);

  if (groups.length === 0) {
    return writeResult(id, { content: [{ type: 'text', text: JSON.stringify({ status: 'success', groupsFound: 0, message: '✅ Nenhuma duplicata por maiúscula/minúscula encontrada.' }, null, 2) }] });
  }

  // 2. Varre o código UMA VEZ coletando exatamente quais Loc["..."] são usados
  // (case-sensitive, igual o C# trata em runtime)
  let files;
  try {
    files = await collectFiles(codeRoot, codeExtensions, null);
  } catch {
    return writeToolError(id, `❌ Caminho de código não encontrado: ${args.codePath || targetPath}`);
  }

  const usedKeys = new Set();
  for (const filePath of files) {
    let buffer;
    try { buffer = await fs.promises.readFile(filePath); } catch { continue; }
    const { text } = decodeBuffer(buffer);
    LOC_KEY_REGEX.lastIndex = 0;
    let m;
    while ((m = LOC_KEY_REGEX.exec(text)) !== null) usedKeys.add(m[1]);
  }

  // 3. Pra cada grupo, decide com base no uso real
  const safeToClean = [];   // exatamente 1 variante usada -> as outras são seguras de remover
  const needsReview = [];   // 2+ variantes usadas (inconsistência real no código) OU nenhuma usada
  let totalSafeToRemove = 0;

  for (const variants of groups) {
    const usedVariants = variants.filter(v => usedKeys.has(v));
    if (usedVariants.length === 1) {
      const toRemove = variants.filter(v => v !== usedVariants[0]);
      safeToClean.push({ keep: usedVariants[0], remove: toRemove, reason: 'só essa variante é referenciada via Loc[...] no código' });
      totalSafeToRemove += toRemove.length;
    } else if (usedVariants.length === 0) {
      needsReview.push({ variants, reason: 'nenhuma variante usada via Loc[...] — podem ser todas mortas, ou usadas de outro jeito (acesso tipado, dinâmico). Revisar antes de decidir.' });
    } else {
      needsReview.push({ variants, usedVariants, reason: '⚠️ MAIS DE UMA variante é usada no código — é uma inconsistência real, não dá pra resolver sozinho. Alguém referenciou os dois casings em lugares diferentes.' });
    }
  }

  const summary = {
    status: 'success',
    groupsFound: groups.length,
    safeToCleanCount: safeToClean.length,
    totalKeysSafeToRemove: totalSafeToRemove,
    safeToClean,
    needsReviewCount: needsReview.length,
    needsReview,
    nextStep: safeToClean.length > 0
      ? `💡 Pra aplicar: delete_translations com keys:[${safeToClean.flatMap(g => g.remove).map(k => `"${k}"`).join(', ')}], dryRun:true primeiro.`
      : null
  };

  writeResult(id, { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] });
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
      const { keys } = await getParsedResx(filePath);
      translations[lang] = {};
      for (const [key, info] of keys) {
        if (specificKeys && !specificKeys.includes(key)) continue;
        if (info.hasValue) translations[lang][key] = info.value;
      }
    } catch {}
  }
  writeResult(id, { content: [{ type: 'text', text: JSON.stringify(translations, null, 2) }] });
}


function removeDuplicates(text, keepFirst = true) {
  const lines = text.split(/\r\n|\n/);
  const seenKeys = new Set();
  const newLines = [];
  let removed = 0;
  const removedKeys = [];
  let skipUntilClose = false;
  let currentDuplicateKey = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const match = line.match(/<data\s+name="([^"]*)"/);
    
    if (match) {
      const key = unescapeXml(match[1]);
      
      if (keepFirst) {
        // ✅ Padrão: manter a primeira, remover as duplicatas
        if (seenKeys.has(key)) {
          removed++;
          removedKeys.push(key);
          skipUntilClose = true;
          currentDuplicateKey = key;
          continue;
        }
        seenKeys.add(key);
      } else {
        // ✅ keepFirst = false: remover TODAS as ocorrências (inclusive a primeira)
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
        }
        removed++;
        removedKeys.push(key);
        skipUntilClose = true;
        currentDuplicateKey = key;
        continue;
      }
    }
    
    // ✅ Se estamos pulando, pular TUDO até o </data>
    if (skipUntilClose) {
      // Se encontrou o fechamento da entrada, parar de pular
      if (trimmed === '</data>') {
        skipUntilClose = false;
        currentDuplicateKey = '';
        continue;
      }
      // Pular todas as linhas dentro da entrada duplicada
      continue;
    }
    
    newLines.push(line);
  }
  
  return { cleanedText: newLines.join('\n'), removed, removedKeys };
}



async function executeFindDuplicates(id, args) {
  const { path: targetPath } = args;
  const safePath = validatePath(targetPath);

  let files;
  try {
    const stat = await fs.promises.stat(safePath);
    files = stat.isDirectory() ? await collectFiles(safePath, ['.resx'], null) : [safePath];
  } catch {
    return writeToolError(id, `❌ Caminho não encontrado: ${targetPath}`);
  }

  const results = [];
  for (const filePath of files) {
    try {
      const buffer = await fs.promises.readFile(filePath);
      const { text } = decodeBuffer(buffer);
      const dupInfo = findDuplicateKeysWithPositions(text);
      if (dupInfo.duplicates.length > 0 || dupInfo.hasCaseInsensitiveDuplicates) {
        results.push({
          file: filePath,
          duplicates: dupInfo.duplicates,
          count: dupInfo.totalDuplicateOccurrences,
          caseInsensitiveDuplicates: dupInfo.caseInsensitiveDuplicates,
          note: dupInfo.hasCaseInsensitiveDuplicates
            ? '⚠️ Há chaves que só diferem em maiúscula/minúscula (ex: LabelCEP vs LabelCep) — revisar manualmente qual variante manter, idealmente checando find_references de cada uma antes de decidir.'
            : undefined
        });
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
// FIX_MOJIBAKE — repara N níveis de "double-encoding" (arquivo já é UTF-8
// válido, mas o conteúdo foi corrompido 1x, 2x (tripla codificação) ou mais
// vezes por alguma ferramenta que salvou como UTF-8, reabriu como Windows-1252
// por engano, e resalvou). Diferente do fallback do decodeBuffer, que resolve
// o caso de o ARQUIVO em si estar puro Windows-1252 no disco.
// =============================================================================

// Mapeamento reverso do CP1252_MAP (definido lá em cima, perto do decodeBuffer):
// caractere especial -> byte original. É o que faz a reversão funcionar de
// verdade pra 2+ níveis de corrupção — Latin-1 puro não tem esses caracteres
// (€, ƒ, ", ", •, etc.), só o Windows-1252 tem, e é o CP1252 que as ferramentas
// do Windows usam quando abrem um arquivo com o encoding errado.
const CP1252_REVERSE = {};
for (const [byteStr, char] of Object.entries(CP1252_MAP)) {
  CP1252_REVERSE[char] = Number(byteStr);
}

// Reverte pro byte original assumindo que 'text' foi decodificado como CP1252.
// Devolve null se algum caractere não couber num byte (sinal de que o texto
// não é mais mojibake reversível nesse nível — para a cadeia com segurança).
function encodeAsWindows1252(text) {
  const bytes = Buffer.alloc(text.length);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const special = CP1252_REVERSE[ch];
    if (special !== undefined) {
      bytes[i] = special;
    } else {
      const code = ch.codePointAt(0);
      if (code > 0xFF) return null;
      bytes[i] = code;
    }
  }
  return bytes;
}

// Sinais de corrupção: 'Ã'/'Â' seguido de continuação normal (0xA0-0xBF) OU
// de um dos caracteres especiais do CP1252 (ƒ, €, ", —, etc. — é o que aparece
// quando há 2+ níveis de corrupção, tipo "ÃƒÂ¡" em vez de "á").
const CP1252_SPECIALS_CLASS = Object.values(CP1252_MAP)
  .map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('');
const MOJIBAKE_PATTERN = new RegExp(`[ÃÂ][${CP1252_SPECIALS_CLASS}\\u00A0-\\u00BF]`, 'g');

function countMojibake(text) {
  const matches = text.match(MOJIBAKE_PATTERN);
  return matches ? matches.length : 0;
}

// Só devolve texto reparado se tiver certeza de que melhorou: cada passo exige
// que o resultado seja UTF-8 estritamente válido (decoder 'fatal:true' — se não
// for, aborta ali, sem arriscar corromper mais) e que reduza sequências
// suspeitas. Repete até 4x pra cobrir corrupção dupla, tripla ou além, sem
// risco de loop infinito porque só continua enquanto a pontuação melhora.
function tryRepairMojibake(text) {
  const originalScore = countMojibake(text);
  if (originalScore === 0) return null;

  let current = text;
  let currentScore = originalScore;

  for (let pass = 0; pass < 4; pass++) {
    const bytes = encodeAsWindows1252(current);
    if (!bytes) break;

    let candidate;
    try {
      candidate = utf8StrictDecoder.decode(bytes);
    } catch {
      break; // não é UTF-8 válido nesse nível -> já passou do ponto de reversão segura
    }

    const candidateScore = countMojibake(candidate);
    if (candidateScore < currentScore) {
      current = candidate;
      currentScore = candidateScore;
      if (currentScore === 0) break;
    } else {
      break;
    }
  }

  return currentScore < originalScore ? current : null;
}

// Aplica o reparo LINHA POR LINHA em vez do arquivo inteiro de uma vez. Isso importa
// porque um arquivo real quase sempre tem entradas em estados diferentes (algumas já
// corretas, outras corrompidas 1x, 2x...). Reparar o arquivo inteiro como um bloco só
// faz uma linha já correta "contaminar" a validação de UTF-8 estrito e abortar o reparo
// de TODAS as linhas, inclusive as que realmente precisavam de conserto.
function repairMojibakeText(fullText) {
  const lines = fullText.split('\n');
  let beforeTotal = 0;
  let afterTotal = 0;
  let anyChanged = false;

  const repairedLines = lines.map(line => {
    const before = countMojibake(line);
    if (before === 0) return line;

    beforeTotal += before;
    const fixedLine = tryRepairMojibake(line);
    if (fixedLine) {
      anyChanged = true;
      afterTotal += countMojibake(fixedLine);
      return fixedLine;
    }
    afterTotal += before;
    return line;
  });

  if (!anyChanged) return null;
  return { text: repairedLines.join('\n'), before: beforeTotal, after: afterTotal };
}

async function executeFixMojibake(id, args) {
  const { path: targetPath, extensions, dryRun = true, backup = true } = args;
  if (!targetPath) return writeToolError(id, '❌ Parâmetro "path" é obrigatório.');

  const safePath = validatePath(targetPath);
  const exts = (extensions && extensions.length) ? extensions : ['.resx'];

  let files;
  try {
    const stat = await fs.promises.stat(safePath);
    files = stat.isDirectory() ? await collectFiles(safePath, exts, null) : [safePath];
  } catch {
    return writeToolError(id, `❌ Caminho não encontrado: ${targetPath}`);
  }

  const results = [];

  for (const filePath of files) {
    let buffer;
    try { buffer = await fs.promises.readFile(filePath); } catch { continue; }

    const { text } = decodeBuffer(buffer);
    const result = repairMojibakeText(text);
    if (!result) continue;

    const { text: repaired, before: beforeCount, after: afterCount } = result;
    const diff = buildDiffPreview(text, repaired);

    if (!dryRun) {
      if (backup) await writeBackup(filePath, buffer);
      await fs.promises.writeFile(filePath, repaired, 'utf8');
      invalidateCachePaths(filePath);
    }

    results.push({
      file: filePath,
      suspiciousBefore: beforeCount,
      suspiciousAfter: afterCount,
      preview: diff.preview
    });
  }

  const summary = {
    status: 'success',
    dryRun,
    filesScanned: files.length,
    filesWithMojibake: results.length,
    results: results.slice(0, 20),
    message: dryRun
      ? `📋 Preview: ${results.length} arquivo(s) com mojibake detectado (de ${files.length} verificados). Use dryRun:false para corrigir.`
      : `✅ ${results.length} arquivo(s) corrigido(s) (de ${files.length} verificados).`
  };

  writeResult(id, { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] });
}

// =============================================================================
// FUNÇÕES DE ESCRITA E FINALIZAÇÃO
// =============================================================================

function writeResult(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function writeError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

function writeToolError(id, message) {
  writeResult(id, { content: [{ type: 'text', text: message }], isError: true });
}

// =============================================================================
// MAIN - INICIALIZAÇÃO DO SERVIDOR
// =============================================================================

// Iniciar o servidor
console.error('🚀 Node-Search MCP Server v8.5.0 iniciado');
console.error(`📊 Perfil de tools: ${TOOL_PROFILE}`);
console.error(`📁 ${ACTIVE_TOOLS.length} tools ativas`);

// Listar tools ativas no log
if (process.env.DEBUG === 'true') {
  console.error('📋 Tools ativas:');
  for (const tool of ACTIVE_TOOLS) {
    console.error(`  - ${tool}`);
  }
}

// Verificar configurações
if (ALLOWED_ROOTS.length > 0) {
  console.error(`🔒 Pastas permitidas: ${ALLOWED_ROOTS.length} pasta(s)`);
  if (process.env.DEBUG === 'true') {
    for (const root of ALLOWED_ROOTS) {
      console.error(`  - ${root}`);
    }
  }
}

// Verificar disponibilidade do ripgrep
hasRipgrep().then(available => {
  if (available) {
    console.error('✅ Ripgrep disponível - search_content será SUPER RÁPIDO!');
  } else {
    console.error('⚠️ Ripgrep não encontrado - search_content usará fallback em JS (mais lento em pastas grandes)');
    console.error('💡 Instale com um destes comandos (escolha o que já tiver disponível):');
    console.error('   winget install BurntSushi.ripgrep.MSVC');
    console.error('   choco install ripgrep');
    console.error('   scoop install ripgrep');
  }
}).catch(() => {});

// Limpar backups antigos ao iniciar
if (BACKUP_CONFIG.autoCleanup) {
  try {
    const cwd = process.cwd();
    cleanOldBackups(cwd).catch(() => {});
    console.error('🧹 Limpeza automática de backups antigos ativada');
  } catch {}
}

// Verificar versão do Node.js
const nodeVersion = process.versions.node;
const majorVersion = parseInt(nodeVersion.split('.')[0]);
if (majorVersion < 18) {
  console.error(`⚠️ Node.js ${nodeVersion} detectado. Recomendado: v18+ para melhor performance`);
}

// Configurações de ambiente
console.error(`🔄 Concorrência: ${PERFORMANCE_CONFIG.concurrency} workers`);
console.error(`📦 Cache: ${fileCache.maxSize} arquivos, ${fileCache.ttl/1000}s TTL`);
console.error(`⏱️ Timeout de comandos: ${PERFORMANCE_CONFIG.commandTimeout/1000}s`);

// O servidor já está rodando via stdin/stdout
// O loop principal é gerenciado pelo rlInput e processQueue
console.error('✅ Servidor pronto para receber requisições');

// Tratamento de erros não capturados
process.on('uncaughtException', (err) => {
  console.error(`❌ Erro não capturado: ${err.message}`);
  console.error(err.stack);
  // Não sair, apenas logar
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`❌ Promessa rejeitada sem tratamento: ${reason}`);
  console.error(promise);
});

// Sinal de saúde para o Cline
console.error('💚 Heartbeat: servidor respondendo');

// =============================================================================
// FIM DO ARQUIVO
// =============================================================================
