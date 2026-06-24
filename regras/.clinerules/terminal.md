# TERMINAL — DETECÇÃO DE SHELL

**SEMPRE antes de executar comandos no Windows:**
1. Verifique se é CMD ou PowerShell — execute `echo %0` se não souber
2. **CMD:** evite `Select-Object`, `Get-Content -Tail`, pipes com cmdlets PowerShell
3. **PowerShell:** todos os cmdlets disponíveis normalmente

**Fallback universal:** `cmd /c "comando"` ou `powershell -Command "comando"`
