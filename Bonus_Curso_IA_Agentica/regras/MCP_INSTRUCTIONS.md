
---

## 📄 ARQUIVO: `MCP_INSTRUCTIONS.md`


# 🔌 Configuração dos MCPs no Cline

## O que são MCPs?

**MCP (Model Context Protocol)** é um padrão aberto que permite ao Cline interagir com ferramentas e fontes de dados de forma nativa. Em vez de o Cline apenas gerar código esperando que você o execute, o MCP dá ao agente **"mãos e olhos"** para:

- ✅ Conectar-se ao PostgreSQL e executar queries
- ✅ Ler e escrever arquivos do projeto
- ✅ Testar a interface no navegador
- ✅ Compilar o projeto e validar erros
- ✅ Buscar e substituir texto em lote

---

## 📌 Passo a Passo para Configurar

### 1. Abra as configurações do Cline

1. No VS Code, clique no ícone do **Cline** na barra lateral esquerda.
2. Clique no ícone de **Engrenagem** (Configurações) no topo do painel.
3. Role até a seção **MCP Servers**.
4. Clique no botão **"Edit MCP Settings"** (ou "Open MCP Settings") para abrir o arquivo `cline_mcp_settings.json`.

### 2. Cole a configuração completa

Substitua todo o conteúdo do arquivo pelo JSON abaixo:

```json
{
  "mcpServers": {
    "sequential-thinking": {
      "autoApprove": ["sequentialthinking"],
      "disabled": false,
      "timeout": 600,
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
    },
    "codecompress": {
      "disabled": false,
      "type": "stdio",
      "command": "codecompress-server",
      "args": [
        "--mcp",
        "--yes",
        "--no-cluster",
        "--exclude",
        "testes,docfx,bin,obj,node_modules,.git,.vs,packages,Migrations,Scripts,Backups,Resources,Properties,logs,wwwroot/lib,*.dll,*.exe,*.pdf,*.png,*.jpg,*.sql"
      ],
      "autoApprove": [
        "expand_symbol", "assemble_context", "dependency_graph", "file_tree",
        "get_symbols", "project_outline", "get_symbol", "blast_radius",
        "topic_outline", "snapshot_create", "invalidate_cache", "list_repos",
        "search_text", "changes_since", "find_unused_symbols", "stop_server",
        "get_hot_path", "find_references", "get_module_api", "project_dependencies",
        "search_symbols", "index_project"
      ],
      "cwd": "C:\\curso",
      "timeout": 300
    },
    "pg_curso": {
      "autoApprove": [
        "pg_list_schemas", "pg_describe_table", "pg_health", "pg_top_queries",
        "pg_unused_indexes", "pg_suggest_indexes", "pg_explain", "pg_table_indexes",
        "pg_table_size", "pg_stat_activity", "pg_settings", "pg_extension",
        "pg_list_roles", "pg_table_privileges", "pg_constraint_info", "pg_sequence_info",
        "pg_table_stats", "pg_database_size", "pg_blocking_locks", "pg_list_views",
        "pg_list_functions", "pg_list_extensions", "pg_search_columns", "pg_seq_scan_tables",
        "pg_inspect_locks", "pg_kill", "pg_replication_status", "pg_advisor",
        "pg_table_bloat", "pg_list_tables", "pg_readonly", "pg_query"
      ],
      "disabled": false,
      "timeout": 60,
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@yawlabs/postgres-mcp@latest"],
      "env": {
        "DATABASE_URL": "postgresql://postgres:sql@localhost:5432/curso",
        "ALLOW_WRITES": "1",
        "PGSSLMODE": "disable"
      }
    },
    "playwright": {
      "autoApprove": [
        "browser_close", "browser_resize", "browser_console_messages", "browser_handle_dialog",
        "browser_evaluate", "browser_file_upload", "browser_drop", "browser_fill_form",
        "browser_press_key", "browser_type", "browser_navigate_back", "browser_network_requests",
        "browser_network_request", "browser_run_code_unsafe", "browser_take_screenshot",
        "browser_snapshot", "browser_click", "browser_drag", "browser_hover",
        "browser_select_option", "browser_tabs", "browser_wait_for", "browser_navigate"
      ],
      "timeout": 60,
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@playwright/mcp"]
    },
    "context7": {
      "autoApprove": ["get-library-docs", "resolve-library-id", "query-docs"],
      "timeout": 60,
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    },
    "windows-search": {
      "autoApprove": ["search_windows", "replace_in_files", "read_lines", "fix_encoding", "fix_mojibake", "search_files"],
      "timeout": 60,
      "type": "stdio",
      "command": "node",
      "args": ["C:/Users/SEU_USUARIO/.cline-mcps/windows-search/index.js"]
    },
    "dotnet-build": {
      "autoApprove": ["cancel_build", "list_builds", "check_build"],
      "disabled": false,
      "timeout": 120,
      "type": "stdio",
      "command": "node",
      "args": ["C:/Users/SEU_USUARIO/.cline-mcps/dotnet-build/index.js"]
    },
    "filesystem": {
      "autoApprove": [
        "read_file", "read_media_file", "read_multiple_files", "write_file",
        "edit_file", "create_directory", "list_directory_with_sizes", "directory_tree",
        "move_file", "get_file_info", "list_allowed_directories", "list_directory",
        "search_files", "read_text_file"
      ],
      "disabled": false,
      "timeout": 60,
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y", "@modelcontextprotocol/server-filesystem",
        "C:/curso/projeto_curso"
      ]
    },
    "glider": {
      "type": "stdio",
      "command": "glider",
      "args": ["--default-timeout", "10m", "--build-host", "netframework", "--verbose"],
      "timeout": 600,
      "autoApprove": [
        "server_status", "sync", "reload", "unload", "resolve_symbol",
        "get_symbol_at_position", "find_references", "find_implementations", "find_callers",
        "get_outgoing_calls", "get_type_hierarchy", "get_derived_types", "get_symbol_info",
        "analyze_change_impact", "get_type_dependencies", "rename_symbol", "move_type",
        "move_member", "organize_usings", "format_document", "batch", "get_completion",
        "get_signature_help", "get_hover", "get_symbol_info_batch", "get_type_hierarchy_batch",
        "write_file", "find_unused_symbols", "find_external_dependency_usages",
        "get_project_format_summary", "get_structure", "get_cascade_impact", "view_external_definition",
        "find_unused_parameters", "find_member_in_hierarchy", "search_text", "get_project_graph",
        "get_type_source", "semantic_query", "find_unused_project_references", "find_package_usages",
        "analyze_complexity", "get_method_signature", "find_overrides", "diagnostic_hotspots",
        "get_file_contents", "expand_symbol", "get_symbol", "get_method_source", "load",
        "get_type_info", "get_diagnostics", "search_symbols", "find_code"
      ]
    }
  }
}
```

---

### 3. Ajuste os caminhos para o SEU ambiente

> ⚠️ **ATENÇÃO REQUISITO OBRIGATÓRIO:** Não tente rodar o projeto sem fazer as alterações abaixo. O Cline falhará silenciosamente se encontrar caminhos de diretórios inexistentes.

| O que alterar | Onde está no JSON | Como alterar |
| :--- | :--- | :--- |
| **`SEU_USUARIO`** | `windows-search` e `dotnet-build` | Substitua `C:/Users/SEU_USUARIO/` pelo nome exato da sua pasta de usuário do Windows. Exemplo: `C:/Users/joao/` |
| **Senha do PostgreSQL** | `pg_curso` → `env` → `DATABASE_URL` | Se você definiu uma senha diferente de `sql` na instalação, atualize a string de conexão: `postgresql://postgres:SUA_SENHA@localhost:5432/curso` |
| **Porta do PostgreSQL** | `pg_curso` → `env` → `DATABASE_URL` | Se mudou a porta padrão `5432`, ajuste no final da string de conexão |

---

### 4. Verifique a conexão

Após salvar o arquivo, os servidores MCP devem aparecer no painel do Cline com status **"Conectado"** (indicador verde).

```
+-----------------------------------------------------------------------+
| 📸 [TELA MCP-2] Print da área inferior do Cline exibindo os           |
| indicadores conectados com sucesso para cada servidor MCP injetado.   |
+-----------------------------------------------------------------------+
```

---

## 🛠️ Servidores MCP Ativos

| Servidor | Função | Por que é indispensável |
| :--- | :--- | :--- |
| **sequential-thinking** | Força a IA a "pensar" em etapas lógicas e sequenciais | Evita decisões precipitadas ou pulos de validação complexos |
| **codecompress** | Compacta o código-fonte de arquivos grandes ao enviar para a IA | Economiza milhares de tokens e impede amnésia no meio de arquivos longos |
| **pg_curso** | Conecta a IA diretamente ao PostgreSQL | O Cline lê schemas, verifica índices e analisa a saúde do banco |
| **playwright** | Dá um navegador web invisível para a IA interagir | Permite que o Cline teste a interface MudBlazor em tempo real |
| **context7** | Indexa e busca documentações oficiais de bibliotecas | Garante que a IA use sintaxes atualizadas do .NET 10 e MudBlazor |
| **windows-search** | Permite buscas indexadas ultra-rápidas e substituições em lote | Facilita refatorações em massa em todo o sistema |
| **dotnet-build** | Permite que o Cline execute compilações (`dotnet build`) | A IA descobre erros de compilação imediatamente e se corrige |
| **filesystem** | Delimita e concede acesso seguro às pastas locais do projeto | Escudo de segurança que impede a IA de ler arquivos pessoais |
| **glider** | Analisador estático avançado para soluções C#/.NET | Realiza engenharia reversa e análise de impacto |

---

## ⚠️ Se algo não funcionar

| Problema | Solução |
| :--- | :--- |
| MCP com erro vermelho | Verifique o caminho no JSON (especialmente `SEU_USUARIO`) |
| PostgreSQL não conecta | Confirme a senha e a porta na `DATABASE_URL` |
| Cline não encontra o arquivo | Reinicie o VS Code |
| Comando `npm` não encontrado | Instale o Node.js: https://nodejs.org/ |

---

## 📚 Como usar os MCPs no dia a dia

### Exemplo 1: Auditar o banco de dados

No chat do Cline, digite:

> *"Use o MCP pg_curso para listar todas as tabelas do banco e me mostrar a estrutura da tabela Users."*

### Exemplo 2: Compilar o projeto

> *"Use o MCP dotnet-build para compilar o projeto e me mostrar se há erros."*

### Exemplo 3: Testar a interface

> *"Use o MCP playwright para abrir a página de dashboard do nosso SaaS e tirar um print."*

### Exemplo 4: Buscar e substituir em lote

> *"Use o MCP windows-search para encontrar todos os arquivos que contêm 'TenantId' e substituir por 'TenantId' com alias."*

---

## 📋 Checklist de Configuração dos MCPs

| ✅ | Etapa | Status |
| :---: | :--- | :---: |
| □ | Instalou o Node.js (para npm) | _____ |
| □ | Instalou o codecompress-server globalmente (`npm install -g codecompress-server`) | _____ |
| □ | Instalou o glider-mcp globalmente (`npm install -g glider-mcp`) | _____ |
| □ | Configurou o arquivo `cline_mcp_settings.json` | _____ |
| □ | Substituiu `SEU_USUARIO` pelos caminhos corretos | _____ |
| □ | Validou que todos os MCPs estão com status "Conectado" | _____ |

---

> 🚀 **Pronto!** Agora o Cline tem "mãos e olhos" para interagir com seu banco de dados, arquivos, navegador e muito mais.
>
> **Volte para o Capítulo 2** para ver como usar esses MCPs na prática!

---

**Versão:** 1.0
**Última Atualização:** 2026-06-24
**Autor:** Tony Chagas