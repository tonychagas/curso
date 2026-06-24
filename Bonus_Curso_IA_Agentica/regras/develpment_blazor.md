```markdown
---
author: Tony Chagas
date: 2026-06-24
version: 1.1
---

# 🏗️ Curso ERP - Guia Consolidado de Desenvolvimento Total

> **Fonte da verdade para desenvolvimento.** Todo código gerado ou modificado DEVE seguir estas diretrizes.
>
> **Regra de Ouro:** Se a IA não seguir estas regras, peça para ela reler este arquivo antes de continuar.

---

## ⚡ QUICK REFERENCE (Leitura Obrigatória Antes de Codificar)

| Categoria | Regra Essencial |
| :--- | :--- |
| **Arquitetura** | Injete interface, nunca classe concreta |
| **ServiceBase** | **SEMPRE** passe ILogger no construtor (evita apagão de logs) |
| **Multi-Tenant** | Chave primária composta (TenantId, Id) + FKs compostas |
| **Atualizações** | Mapeamento manual de propriedades, NUNCA `context.Update()` |
| **Novos Itens** | `EntityState.Added` forçado para evitar `DbUpdateConcurrencyException` |
| **Queries de Leitura** | Use `.AsNoTracking()` para consultas que não alteram dados |
| **Queries de Edição** | **NUNCA** use `.AsNoTracking()` em atualizações |
| **Decimais** | `.HasPrecision(18,2)` (proibido `.HasColumnType`) |
| **Banco de Dados** | snake_case, collation `icu_ci_ai`, limites de 63 caracteres |
| **Datas** | Sempre UTC (`DateTime.UtcNow`) |
| **Strings UI** | Tudo via `IStringLocalizer`, zero hardcoding |
| **Logs** | Técnico em português + metadados; usuário vê mensagem genérica |
| **Try-Catch** | Log técnico → retorna Result.Failure com msg localizada |
| **Testes** | Use xUnit + FluentAssertions. Teste cenários de isolamento Multi-Tenant |
| **Commits** | Formato: `feat: descrição`, `fix: descrição`, `docs: descrição` |

---

## 🧠 Fluxo de Trabalho (Plan-and-Review)

**ANTES de qualquer alteração de código:**
1. Leia este arquivo (`DEVELOPMENT.md`).
2. Apresente um plano detalhado (use o template `SABATINA_AGENTE_TEMPLATE.md`).
3. Aguarde aprovação do usuário.

**APÓS qualquer alteração de código:**
1. Rode `dotnet build` para validar compilação.
2. Se houver erros, corrija autonomamente.
3. Rode `dotnet test` se houver testes.

---

## 📁 Estrutura de Pastas do Projeto

```
\curso\projeto curso\
├── Models/          → Entidades e interfaces (IMultiTenant)
├── Data/            → AppDbContext e configurações
├── Services/        → Lógica de negócio e provedores (ITenantProvider)
├── Migrations/      → Migrações do EF Core (geradas pelo Cline)
├── wwwroot/         → Arquivos estáticos (CSS, JS, imagens)
└── Program.cs       → Inicialização da aplicação
```

---

## 🏷️ Padrões de Nomenclatura

| Elemento | Padrão | Exemplo |
| :--- | :--- | :--- |
| **Classes** | PascalCase | `TenantService`, `UserRepository` |
| **Interfaces** | I + PascalCase | `ITenantService`, `IRepository` |
| **Métodos** | PascalCase | `GetTenantById()`, `CreateUser()` |
| **Variáveis** | camelCase | `tenantId`, `userName`, `isActive` |
| **Constantes** | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT`, `DEFAULT_PAGE_SIZE` |
| **Tabelas** | snake_case | `tenants`, `users`, `api_configs` |
| **Colunas** | snake_case | `tenant_id`, `user_name`, `created_at` |

---

## 🧪 Diretrizes de Testes

1. **Teste de Isolamento Legítimo:** Tenant Alpha consulta seus dados → retorna apenas dados do Tenant Alpha.
2. **Teste de Invasão Passiva:** Tenant Alpha tenta ler ID do Tenant Beta → retorna `404 Not Found` ou `null`.
3. **Teste de Invasão Ativa:** Tenant Alpha tenta atualizar registro do Tenant Beta → exceção de segurança ou bloqueio.

---

## 🚀 Fluxo de Deploy

| Ambiente | Estratégia |
| :--- | :--- |
| **Desenvolvimento** | `dotnet run` ou `dotnet watch` local |
| **Homologação** | Docker Compose com PostgreSQL |
| **Produção** | Docker + VPS (Rocky Linux) com Nginx e systemd |

---

## 📌 Lembre-se

- **NUNCA** exponha chaves de API ou senhas no código.
- **SEMPRE** use variáveis de ambiente para credenciais.
- **SEMPRE** execute `dotnet build` antes de commit.

---

> **Versão:** 1.1
> **Última Atualização:** 2026-06-24
> **Autor:** Tony Chagas
```

---

