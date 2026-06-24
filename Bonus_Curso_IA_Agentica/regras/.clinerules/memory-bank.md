# MEMORY BANK — REGRAS

Minha memória reseta entre sessões. Eu dependo EXCLUSIVAMENTE do Memory Bank e dos arquivos de projeto para continuar o trabalho.

---

## 📋 LEITURA OBRIGATÓRIA NO INÍCIO DE CADA SESSÃO

Na ordem:
1. Indexar o projeto com `codecompress` → `index_project(path: ".", excludePatterns: ["bin/**", "obj/**", "node_modules/**", "Migrations/**", "Backups/**", "Scripts/**"])`
2. `development.md` na raiz do projeto → extrair padrões para `cline_docs/systemPatterns.md` (se ainda não sincronizado)
3. `todo.md` → sincronizar com `cline_docs/activeContext.md` e `cline_docs/progress.md`
4. Todos os 5 arquivos de `cline_docs/`:
   - `productContext.md` — propósito do projeto
   - `activeContext.md` — o que está sendo feito agora + tarefas ativas
   - `systemPatterns.md` — padrões técnicos e arquitetura
   - `techContext.md` — tecnologias e setup
   - `progress.md` — o que funciona e o que falta

> Se `cline_docs/` não existir, criar a pasta e todos os 5 arquivos antes de qualquer trabalho.
> Se o MCP `codecompress` estiver desconectado, reiniciar VS Code (Ctrl+Shift+P → "Developer: Reload Window").

---

## 🔄 SINCRONIZAÇÃO

| Fonte | Destino |
|-------|---------|
| `development.md` | `systemPatterns.md` → seção "Development Standards" |
| `todo.md` `- [ ]` alta prioridade | `activeContext.md` → "Current Tasks" |
| `todo.md` `- [x]` | `progress.md` → "What Works" |
| `todo.md` `- [ ]` baixa prioridade | `progress.md` → "Backlog" |

---

## 🛠️ DURANTE O DESENVOLVIMENTO

- Declarar `[MEMORY BANK: ACTIVE]` no início de cada tool use
- Após mudanças significativas: atualizar `activeContext.md`, `progress.md` e checar `todo.md`

---

## 💾 COMANDO "update memory bank"

1. Reler todos os arquivos de projeto (todo.md, development.md)
2. Sincronizar Memory Bank completo
3. Garantir que `activeContext.md` deixe os próximos passos CLAROS

---

## 🚫 PROIBIDO

- Modificar `development.md` sem permissão
- Deletar ou reestruturar `todo.md`
- Duplicar informações — referenciar arquivos existentes
