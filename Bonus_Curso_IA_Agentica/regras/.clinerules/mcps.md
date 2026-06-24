# 🎯 Estratégia de Uso dos MCPs — Hotline ERP

| MCP | Prioridade | Quando Usar (Gatilho) | Substitui (PROIBIDO USAR) |
|-----|-----------|-------------|-----------|
| **glider** | 🔵 **ALTA** | Qualquer análise, navegação ou diagnóstico de código C# (`.cs`). | `search_files`, `windows-search` para símbolos, `read_file` em arquivos grandes |
| **pg_hotline** | 🔵 **ALTA** | Consultas, validação de esquema, inserts/updates de teste e DDL emergencial no banco **hotline**. | `execute_command` com CLI de banco |
| **codecompress** | 🔵 **ALTA** | Indexar o projeto no início de cada sessão (via `index_project`). | Navegação manual de arquivos |
| **pg_tyx_juris** | 🟡 **MÉDIA** | Consultas no banco **tyx_juris** (quando relevante para integração). | `execute_command` com CLI |
| **pg_tyx_rag** | 🟢 **BAIXA** | Consultas no banco **tyx_rag** (RAG/chromadb). | `execute_command` com CLI |
| **pg_vetsaas** | 🟢 **BAIXA** | Consultas no banco **vetsaas**. | `execute_command` com CLI |
| **windows-search** | 🔵 **ALTA** | Busca de strings brutas, hardcoded, configs, arquivos .resx, .json, .razor ou qualquer texto em arquivos. | `findstr`, `Select-String` manual, `grep` |
| **filesystem** | 🟡 **MÉDIA** | Navegação de diretórios (árvore), leitura rápida de arquivos pequenos, busca por nome de arquivo (glob). | `execute_command` para `dir`/`tree` |
| **sequential-thinking** | 🟡 **MÉDIA** | Antes de iniciar refatorações complexas ou investigar bugs com múltiplas causas. | Agir por impulso / "Tentativa e Erro" |
| **playwright** | 🟢 **BAIXA** | Validar quebras de layout na UI ou fluxos de tela pontuais. | Testes manuais cegos |
| **dotnet-build** | 🔵 **ALTA** | **TODOS** os builds longos (>10s) do .NET. | `execute_command` com `dotnet build`, scripts PowerShell |
| **context7** | 🟢 **BAIXA** | Erros de sintaxe em pacotes NuGet/npm externos desconhecidos. | Inventar métodos ou supor assinaturas da API |

---

## 🛠️ Protocolo de Execução por Ferramenta

### 1. glider (Padrão Mandatório para C# — substituto do roslyn-codelens)
> **Regra de Ouro:** NUNCA tente adivinhar o impacto de uma alteração via busca de texto puro. Use a árvore semântica do Roslyn através do Glider.

*   **Carregamento:** Sempre chamar `load` com o caminho do `.slnx` antes de usar ferramentas semânticas.
*   **Rastreamento de Impacto:** Antes de alterar qualquer propriedade, use `find_references` ou `analyze_change_impact`.
*   **Navegação:** Use `search_symbols` para encontrar classes, métodos, propriedades. Use `find_code` como roteador inicial.
*   **Diagnóstico:** Use `get_diagnostics` imediatamente após mudanças para capturar erros de compilação.
*   **Edição:** Use `write_file` do Glider (com `applyChanges=true`) para editar arquivos .cs — ele já sincroniza o workspace automaticamente.
*   **Pós-edição:** Use `format_document` e `organize_usings` para manter o código limpo.
*   **⛔ Substitui COMPLETAMENTE** `search_files` e `windows-search` para qualquer busca de símbolos, tipos, métodos ou propriedades C#.
*   **⚠️ Se ficar inconsistente,** use `reload` ou `sync` antes de recarregar.
*   **⚠️ Workspace descarrega se ficar inativo.** Use `unload` antes de builds externos.

### 2. codecompress (Indexação do Projeto)
> **Regra de Ouro:** No início de **CADA sessão**, executar `index_project` para indexar o projeto.

*   **Comando padrão:**
    ```
    index_project(path: "c:\\Tony\\OneDrive\\Sistemas\\novos", excludePatterns: ["bin/**", "obj/**", "node_modules/**", "Migrations/**", "Backups/**", "Scripts/**"])
    ```
*   **Uso:** Indexa **todos os projetos** sob a pasta pai (`novos/`), incluindo hotline, tyx_juris, vetsaas, etc.
*   **⚠️ Path:** Deve apontar para `c:\Tony\OneDrive\Sistemas\novos` (não apenas `hotline/`).
*   **⚠️ Se o MCP estiver desconectado,** reiniciar VS Code (Ctrl+Shift+P → "Developer: Reload Window").

### 3. PostgreSQL (Acesso Direto aos Bancos)
> **Regra de Ouro:** Alterações emergenciais de estrutura ou dados devem ser feitas via MCP. Ignorar migrations do EF Core se a prioridade for correção imediata.

#### Bancos disponíveis:
| MCP | Banco | Finalidade |
|-----|-------|-----------|
| `pg_hotline` | `hotline` | Banco principal do ERP |
| `pg_tyx_juris` | `tyx_juris` | Sistema jurídico (integração) |
| `pg_tyx_rag` | `tyx_rag` | RAG / ChromaDB |
| `pg_vetsaas` | `vetsaas` | SaaS veterinário |

*   Use **`pg_hotline`** para consultas no banco principal do Hotline.
*   Use `pg_readonly` para SELECT/EXPLAIN (sempre seguro, executa dentro de `BEGIN READ ONLY`).
    *   **⚠️ Limite de 1000 linhas** — resultados grandes retornam `truncated: true`. Use `limit`/`offset` para paginar.
*   Use `pg_query` para DDLs (`ALTER`, `RENAME`, `INSERT`, `UPDATE`, `DELETE`). `ALLOW_WRITES=1` já está ativo.
*   Use `pg_advisor` para validar se tabelas novas possuem chaves primárias (PK) e índices.
*   Use `pg_describe_table` para inspecionar colunas, tipos, FKs, índices rapidamente.

### 4. Busca Textual no Windows (`windows-search`)
> **Substituto oficial do `ripgrep`** (incompatível com caminhos Windows).  
> **Versão atual:** v4.0.0 — implementação Node.js nativa (sem dependências npm).

#### Ferramentas disponíveis:
| Tool | Descrição | Quando usar |
|------|-----------|-------------|
| **`search_files`** | Busca texto/regex em arquivos com streaming (memória eficiente) | Strings literais, hardcoded, configs, `.resx`, `.json`, `.razor` |
| **`replace_in_files`** | Busca e substitui texto/regex em lote. Padrão: `dryRun: true`. Suporta `encoding` (utf-8, windows-1252) e `backup: true` (cria .bak) | Substituições em massa com preview + backup automático |
| **`read_lines`** | Lê intervalo específico de linhas (mais barato que ler arquivo inteiro) | Ver trecho pontual sem carregar arquivo completo |
| **`fix_encoding`** | Detecta e corrige encoding não-UTF-8 (ex: Windows-1252 em .resx) | Normalizar encoding de arquivos legados |
| **`fix_mojibake`** | Detecta e corrige mojibake por **dupla codificação** (UTF-8 decodificado como Latin-1) | Arquivos com caracteres corrompidos (ex: "SÃ£o" → "São") |

#### ✅ Testado e Funcionando (22/06/2026)
- **`replace_in_files`** com `.resx` preserva **acentuação** (testado com "à", "á", "ã", "ç")
- **`fix_encoding`** confirma que os 3 `.resx` (pt-BR, en-US, es-ES) já estão em UTF-8
- **`search_files`** com `simpleMatch: true` encontra texto literal ignorando diferenças de formatação (multi-linha vs inline)

#### ⚙️ `replace_in_files` — Parâmetros importantes:
| Parâmetro | Tipo | Padrão | Descrição |
|-----------|------|--------|-----------|
| `pattern` | string | - | Texto ou regex a buscar |
| `replacement` | string | - | Texto de substituição (suporta $1, $2) |
| `path` | string | - | Arquivo ou diretório |
| `filePattern` | string | todas | Extensões (ex: `.resx,.cs`) |
| `simpleMatch` | bool | false | `true` = busca literal (não regex). **Sempre true para .resx** |
| `dryRun` | bool | true | Preview sem alterar. Rode com `false` para aplicar |
| `backup` | bool | true | Cria `.bak` antes de sobrescrever |
| `encoding` | string | auto-detect | Forçar encoding (ex: `utf-8`, `windows-1252`) |

*   **Server:** `C:/Users/tony_/.cline-mcps/windows-search/index.js` — implementação pura Node.js.
*   **⚠️ Ignora automaticamente:** `bin/`, `obj/`, `.git/`, `node_modules/`, `dist/`, `.vs/`, `.idea/`, `TestResults/`, `packages/`.
*   **⚠️ Pula binários:** `.dll`, `.exe`, `.png`, `.jpg`, `.zip`, `.pfx`, etc.
*   **⚠️ Limite:** 15MB por arquivo (exceto `search_files` que usa streaming, sem limite). `replace_in_files` regrava em UTF-8.
*   **🔧 Fallback 1 — `findstr`**:
    ```cmd
    findstr /s /i "TEXTO" "caminho\*.cs"
    ```
*   **🔧 Fallback 2 — `Select-String`**:
    ```powershell
    Get-ChildItem -Recurse -Filter "*.cs" | Select-String "TEXTO"
    ```
*   **🔧 Fallback 3 — `replace_in_files` corrompeu o arquivo?**:
    ```powershell
    Copy-Item "arquivo.resx.bak" "arquivo.resx" -Force
    ```

### 5. filesystem (Navegação e Leitura de Arquivos)
> MCP oficial `@modelcontextprotocol/server-filesystem`. Escopo: `hotline`, `tyx_juris`, `vetsaas`.

⚠️ **IMPORTANTE:** Não substitui `windows-search`. O `search_files` do filesystem busca **por nome de arquivo (glob)**, não por conteúdo textual.

#### Quando usar:
* **`directory_tree`** — Visão completa da estrutura de diretórios
* **`read_text_file`** — Ler arquivos pequenos (<50 linhas)
* **`read_multiple_files`** — Ler vários arquivos de uma vez
* **`search_files`** — Buscar **arquivos por nome** com glob (ex: `"*Controller.cs"`)
* **`get_file_info`** — Metadata (tamanho, datas) sem ler conteúdo

#### ⛔ Quando NÃO usar:
* Busca de conteúdo textual → use `windows-search`
* Análise de símbolos C# → use `glider`
* Arquivos grandes (>100 linhas) → prefira `read_file` nativo do Cline

### 6. sequential-thinking (Contenção de Raciocínio)
*   **Quando usar:** Tarefas com >3 passos, refatorações complexas, bugs com múltiplas causas.
*   **⛔ Não use para:** tarefas simples de 1-2 passos.

### 7. playwright (Testes de UI)
*   **Quando usar:** Validar quebras de layout, fluxos de tela pontuais.
*   **⚠️** Pode falhar se `node_modules/` estiver no `.clineignore`.
*   **⛔ Baixa prioridade.**

### 8. dotnet-build (Build Assíncrono) — v1.2.1
> **Regra de Ouro:** NUNCA use `execute_command` para builds >10s.

* **`start_build`** — Inicia build em background.
  * `solutionPath`: suporta `.sln`, `.slnx`, `.csproj`, `.fsproj`
  * `configuration`: `Debug` ou `Release` (padrão: `Release`)
  * Retorna `taskId` imediatamente
* **`check_build`** — Verifica status, `durationMs` e últimas linhas do log.
* **`list_builds`** — Lista os últimos 5 builds (configurável via ENV `MCP_MAX_HISTORY`).
* **`cancel_build`** — Cancela build em andamento.
* **📁 Logs:** `C:/Users/tony_/.cline-mcps/dotnet-build/logs/`
* **⚠️** `list_builds` retorna os builds finalizados (inclui `exitCode`, `configuration`, `publish`)
* **⚠️** Se o MCP não responder, reiniciar VS Code (Ctrl+Shift+P → "Developer: Reload Window")

### 9. context7 (Documentação Externa)
*   **Processo obrigatório em 2 etapas:**
    1. `resolve-library-id` com o `libraryName` exato
    2. `query-docs` com o `libraryId` retornado (formato `/org/project`)
*   **⛔ Apenas para** pacotes externos com API desconhecida.
*   **⚠️ Máximo de 3 chamadas por pergunta.**

---

## 🔗 Referência Cruzada

- `cline_docs/systemPatterns.md` — padrões de arquitetura
- `cline_docs/techContext.md` — tecnologias e setup
- `.clinerules/build.md` — builds longos
- `.clinerules/errors.md` — recuperação de erros
- `.clinerules/memory-bank.md` — regras do memory bank (indexação no início de cada sessão)