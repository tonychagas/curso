# TRADUÇÕES .RESX — REGRAS

## ARQUIVOS
| Idioma | Arquivo |
|--------|---------|
| Inglês | `SharedResources.en-US.resx` |
| Português | `SharedResources.pt-BR.resx` |
| Espanhol | `SharedResources.es-ES.resx` |

Caminho base: `C:\Tony\OneDrive\Sistemas\novos\hotline\`

---

## COMANDOS

**Buscar** (todos os idiomas):
```powershell
findstr /s /i "TEXTO" "C:\Tony\...\SharedResources.*.resx"
```

**Ver arquivo:**
```powershell
Get-Content "C:\Tony\...\SharedResources.pt-BR.resx"
```

**Alterar valor** (use texto exato do conteúdo atual):
```powershell
(Get-Content "C:\Tony\...\SharedResources.pt-BR.resx") -replace 'TEXTO ATUAL', 'NOVO TEXTO' | Set-Content "C:\Tony\...\SharedResources.pt-BR.resx"
```

---

## REGRAS

- ✅ Alterar APENAS o idioma solicitado (salvo pedido explícito dos 3)
- ✅ Confirmar texto exato com `findstr` antes de alterar
- ✅ Manter tags XML intactas — só alterar conteúdo dentro de `<value>`
- ❌ Nunca usar `search_files` ou `edit_file` do Cline
- ❌ Nunca alterar estrutura XML
