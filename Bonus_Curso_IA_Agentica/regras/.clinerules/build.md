# BUILD E TERMINAL — REGRAS

## ⚠️ REGRA ABSOLUTA
NUNCA execute com `execute_command` comandos que demorem >10s.

---

## 🏆 PREFERIDO: MCP `dotnet-build` (recomendado)

Use o MCP `dotnet-build` em vez de `execute_command` para builds longos:

1. **start_build** — inicia build em background, retorna `taskId` imediatamente
2. **check_build** — verifica status e últimas 50 linhas do log
3. **list_builds** — lista builds dos últimos 30 dias
4. **cancel_build** — cancela build em andamento

**Exemplo:**
```
start_build("C:/projeto/MeuProjeto.sln", "Release")
check_build("DotNetBuild_20260121_143022")
```

**Localização:** `C:/Users/tony_/.cline-mcps/dotnet-build/index.js`

Se o MCP não estiver disponível, use o fluxo abaixo.

---

## 🚀 FLUXO FALLBACK (sem MCP) PARA BUILDS LONGOS

```powershell
# 1. Criar script (substitua o comando conforme necessário)
@"
cd "PASTA_DO_PROJETO"
COMANDO_AQUI > build.log 2>&1
echo "=== FIM $(Get-Date) ===" >> build.log
"@ | Out-File -FilePath "temp-build.ps1" -Encoding utf8

# 2. Executar em background
Start-Process -NoNewWindow -FilePath "powershell" -ArgumentList "-File", "temp-build.ps1"

# 3. Ver progresso
Get-Content build.log -Tail 10

# 4. Verificar conclusão
$log = Get-Content build.log; if ($log -match "=== FIM") { "CONCLUÍDO"; $log | Select-Object -Last 20 } else { "Ainda rodando..."; $log | Select-Object -Last 5 }

# 5. Limpar
Remove-Item temp-build.ps1 -ErrorAction SilentlyContinue
```

**Comandos que exigem esse fluxo:** `npm run build`, `npm install`, `npm ci`, `npm test`, `npm start`, `yarn build/install`, `dotnet build/run/test`, `msbuild`, `npx *`, `node scripts/*`

---

## ✅ COMANDOS DIRETOS (execute_command, <5s)

`git status/diff/log/branch`, `ls`, `dir`, `pwd`, `cat`, `type`, `echo`, `Get-Process`, `Get-Date`

---

## 🧠 ATUALIZAR MEMORY BANK APÓS BUILD

Adicionar em `memory-bank/progress.md`:
```
## Build [DATA]
✅ SUCESSO / ❌ FALHA — [observação ou erro]
```
