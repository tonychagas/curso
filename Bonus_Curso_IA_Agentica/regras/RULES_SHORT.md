
---

## 📄 ARQUIVO: `RULES_SHORT.md`


# 📌 Regras Resumidas — Cline

> Use esta versão para consulta rápida. Para a versão completa, veja `CLINE_CUSTOM_INSTRUCTIONS.md` e `DEVELOPMENT.md`.

---

## 🧠 REGRAS DE OURO (Top 10)

| # | Regra | Detalhe |
| :---: | :--- | :--- |
| 1 | **Multi-Tenant** | Toda entidade → chave composta `(TenantId, Id)` |
| 2 | **NUNCA** use `context.Update()` | Use mapeamento manual de propriedades |
| 3 | **Sempre** rode `dotnet build` | Após qualquer alteração de código |
| 4 | **Plan-and-Review** | Planeje antes de agir. Espere aprovação. |
| 5 | **NUNCA** leia pastas pesadas | Evite `bin/`, `obj/`, `.vs/`, `.git/`, `node_modules/` |
| 6 | **Frontend:** MudBlazor | **NUNCA** escreva CSS manual se o MudBlazor tiver o componente |
| 7 | **Injeção de Dependência** | Use interfaces, nunca classes concretas |
| 8 | **Decimais** | `.HasPrecision(18,2)` — **proibido** `.HasColumnType` |
| 9 | **Datas** | Sempre `DateTime.UtcNow` (UTC) |
| 10 | **Logs** | Técnico em português; usuário vê mensagem genérica |

---

## 📌 FLUXO DE TRABALHO OBRIGATÓRIO

### 🔹 Antes de qualquer alteração:

| Passo | Ação |
| :---: | :--- |
| 1 | **LEIA** as regras (este arquivo ou `DEVELOPMENT.md`) |
| 2 | **APRESENTE** um plano detalhado (use `SABATINA_AGENTE_TEMPLATE.md`) |
| 3 | **AGUARDE** aprovação do usuário |

### 🔹 Após cada alteração:

| Passo | Ação |
| :---: | :--- |
| 1 | **RODE** `dotnet build` |
| 2 | **CORRIJA** erros autonomamente |
| 3 | **ENTREGUE** resultado validado |

---

## 📚 PADRÕES DE CÓDIGO

### Backend (C#)

| Elemento | Padrão | Exemplo |
| :--- | :--- | :--- |
| Classes | PascalCase | `TenantService` |
| Interfaces | I + PascalCase | `ITenantService` |
| Métodos | PascalCase | `GetTenantById()` |
| Variáveis | camelCase | `tenantId`, `userName` |
| Constantes | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |

### Banco de Dados (PostgreSQL)

| Elemento | Padrão | Exemplo |
| :--- | :--- | :--- |
| Tabelas | snake_case | `tenants`, `users` |
| Colunas | snake_case | `tenant_id`, `user_name` |
| Chave Primária | Composta | `(TenantId, Id)` |

---

## 🔒 SEGURANÇA OBRIGATÓRIA

| Regra | Como aplicar |
| :--- | :--- |
| **Multi-Tenant** | `HasQueryFilter(e => e.TenantId == _tenantProvider.TenantId)` |
| **Leitura** | Use `.AsNoTracking()` em consultas que não alteram dados |
| **Edição** | **NUNCA** use `.AsNoTracking()` em atualizações |
| **Atualização** | Mapeamento manual, NUNCA `context.Update()` |
| **Novos Itens** | `EntityState.Added` forçado |

---

## 🚫 O QUE NUNCA FAZER

| Proibição | Motivo |
| :--- | :--- |
| ❌ `context.Update(entidade)` | Sobrescreve campos acidentalmente |
| ❌ `.HasColumnType` em decimais | Use `.HasPrecision(18,2)` |
| ❌ Hardcoding de strings na UI | Use `IStringLocalizer` |
| ❌ Datas locais (`DateTime.Now`) | Use `DateTime.UtcNow` |
| ❌ CSS manual com MudBlazor | Use os componentes do MudBlazor |
| ❌ Ler `bin/`, `obj/`, `.vs/`, `.git/` | Economia de tokens e performance |

---

## 🛠️ COMANDOS ÚTEIS PARA O CLINE

| Comando | Quando usar |
| :--- | :--- |
| `dotnet build` | Após qualquer alteração de código |
| `dotnet ef migrations add Nome` | Criar uma nova migração |
| `dotnet ef database update` | Aplicar migrações ao banco |
| `dotnet test` | Rodar testes automatizados |
| `dotnet watch` | Rodar o projeto em modo contínuo |

---

## 📌 PROMPT RÁPIDO PARA INICIAR UMA SESSÃO

> *"Leia o arquivo `RULES_SHORT.md` e adote estas regras como sua constituição. Responda com 'Regras assimiladas' e aguarde minhas instruções."*

---

## 📋 CHECKLIST DE VERIFICAÇÃO RÁPIDA

| ✅ | Item | Status |
| :---: | :--- | :---: |
| □ | Li as regras de Multi-Tenant | _____ |
| □ | Entendi o fluxo Plan-and-Review | _____ |
| □ | Sei que NUNCA devo usar `context.Update()` | _____ |
| □ | Sei que SEMPRE devo usar `.HasPrecision(18,2)` | _____ |
| □ | Sei que devo rodar `dotnet build` após alterações | _____ |

---

**Versão:** 1.0
**Última Atualização:** 2026-06-24
**Autor:** Tony Chagas

---
