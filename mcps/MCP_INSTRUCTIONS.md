
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

## 📌 Pré-requisitos

Antes de configurar os MCPs, certifique-se de que você tem:

| Item | Status |
| :--- | :---: |
| Node.js instalado (para usar `npx`) | ☐ |
| CodeCompress Server instalado globalmente (`npm install -g codecompress-server`) | ☐ |
| Glider MCP instalado globalmente (`npm install -g glider-mcp`) | ☐ |

---

## 📌 Passo a Passo para Configurar

### 1. Abra as configurações do Cline

1. No VS Code, clique no ícone do **Cline** na barra lateral esquerda.
2. Clique no ícone de **Engrenagem** (Configurações) no topo do painel.
3. Role até a seção **MCP Servers**.
4. Clique no botão **"Edit MCP Settings"** (ou "Open MCP Settings") para abrir o arquivo `cline_mcp_settings.json`.

### 2. Cole a configuração

Copie o conteúdo do arquivo `cline_mcp_settings.json` disponível na pasta `mcps/` deste repositório e cole no arquivo aberto.

### 3. Ajuste os caminhos para o SEU ambiente

> ⚠️ **ATENÇÃO REQUISITO OBRIGATÓRIO:** Não tente rodar o projeto sem fazer as alterações abaixo. O Cline falhará silenciosamente se encontrar caminhos de diretórios inexistentes.

| O que alterar | Onde está no JSON | Como alterar |
| :--- | :--- | :--- |
| **`SEU_USUARIO`** | `windows-search` e `dotnet-build` | Substitua `C:/Users/SEU_USUARIO/` pelo nome exato da sua pasta de usuário do Windows. Exemplo: `C:/Users/joao/` |
| **Senha do PostgreSQL** | `pg_curso` → `env` → `DATABASE_URL` | Se você definiu uma senha diferente de `sql` na instalação, atualize a string de conexão: `postgresql://postgres:SUA_SENHA@localhost:5432/curso` |
| **Porta do PostgreSQL** | `pg_curso` → `env` → `DATABASE_URL` | Se mudou a porta padrão `5432`, ajuste no final da string de conexão |

### 4. Verifique a conexão

Após salvar o arquivo, os servidores MCP devem aparecer no painel do Cline com status **"Conectado"** (indicador verde).

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

---
