
---

## 📄 ARQUIVO: `SABATINA_AGENTE_TEMPLATE.md`

# 🧠 Sabatina do Agente — Template de Planejamento

> *"Nunca dê ordens complexas a um agente sem antes pedir que ele explique o plano de execução."*

Este template contém os prompts prontos para forçar o Cline a planejar antes de agir, seguindo o fluxo **Plan-and-Review** (Capítulo 4 do curso).

---

## 📌 FLUXO DE TRABALHO

```
[ PROMPT DE ALINHAMENTO ] → [ CLINE APRESENTA PLANO ] → [ USUÁRIO AVALIA ] → [ APROVAÇÃO ] → [ EXECUÇÃO ]
```

---

## 🔹 ETAPA 1: PROMPT DE ALINHAMENTO (MODO PLAN)

### Template Genérico

Copie e cole o prompt abaixo, substituindo `[DESCRIÇÃO DA TAREFA]` pela sua demanda:

---

📥 **PROMPT DE TRAVAMENTO EM MODO PLAN**

> *"Cline, vamos planejar a implementação da seguinte tarefa:*
>
> **[DESCREVA A TAREFA AQUI]**
>
> *REGRAS CRUCIAIS:*
> - *Entre estritamente em MODO PLAN. Não altere, não crie e não apague nenhum arquivo ainda.*
> - *Não execute comandos de escrita ou terminal até minha autorização.*
>
> *Passos que você deve executar agora:*
>
> 1. *Leia o arquivo `DEVELOPMENT.md` (ou `RULES_SHORT.md`) para relembrar a arquitetura Multi-Tenant e os padrões de nomenclatura.*
> 2. *Desenhe uma proposta detalhada de como vai implementar esta funcionalidade.*
> 3. *Liste quais os arquivos que planeja criar ou modificar.*
> 4. *Explique como vai testar a funcionalidade após a implementação.*
> 5. *Identifique possíveis impactos ou riscos na arquitetura existente.*
>
> *Aguarde pela minha revisão e autorização antes de passar para o modo de execução (Act)."*

---

### Exemplo Específico: Adicionar uma Nova Entidade

📥 **EXEMPLO: PROMPT DE ALINHAMENTO**

> *"Cline, vamos planejar a implementação da nova entidade `Product` no nosso sistema.*
>
> *REGRAS CRUCIAIS:*
> - *Entre estritamente em MODO PLAN. Não altere, não crie e não apague nenhum arquivo ainda.*
> - *Não execute comandos de escrita ou terminal até minha autorização.*
>
> *Passos que você deve executar agora:*
>
> 1. *Leia o arquivo `DEVELOPMENT.md` para relembrar as regras de Multi-Tenant.*
> 2. *Desenhe a estrutura da entidade `Product` com os campos: `TenantId`, `Id`, `Name`, `Price`, `StockQuantity`.*
> 3. *Liste quais os arquivos que planeja criar ou modificar (Models, DbContext, Services, etc.).*
> 4. *Explique como vai testar o isolamento Multi-Tenant após a implementação.*
> 5. *Identifique se há impacto em migrações existentes.*
>
> *Aguarde pela minha revisão e autorização antes de passar para o modo de execução (Act)."*

---

## 📝 ETAPA 2: AVALIAÇÃO DO PLANO

Após o Cline apresentar o plano, use este **Checklist do Arquiteto** para avaliar:

| ✅ | Critério de Avaliação | Status |
| :---: | :--- | :---: |
| □ | O plano menciona a chave composta `(TenantId, Id)`? | _____ |
| □ | O plano menciona o uso de Fluent API no `OnModelCreating`? | _____ |
| □ | O plano explica como vai bloquear o `context.Update()`? | _____ |
| □ | O plano lista todos os arquivos a serem criados/modificados? | _____ |
| □ | O plano considera o impacto em migrações existentes? | _____ |
| □ | O plano sugere testes para validar o isolamento Multi-Tenant? | _____ |

---

## 🔹 ETAPA 3: E SE O PLANO FOR FRACO?

Se o Cline entregar um plano superficial ou com erros, use um dos prompts abaixo:

| Situação | Prompt de Correção |
| :--- | :--- |
| **Faltou detalhe técnico** | *"Seu plano está bom, mas faltou detalhar como você vai aplicar o filtro global de TenantId nas consultas. Refine essa parte."* |
| **Esqueceu o Multi-Tenant** | *"Seu plano não mencionou o isolamento Multi-Tenant. Releia o `DEVELOPMENT.md` e ajuste sua abordagem."* |
| **Não listou os arquivos** | *"Liste explicitamente quais arquivos serão criados e quais serão modificados."* |
| **Não considerou migrações** | *"Explique como você vai lidar com migrações existentes e se uma nova migração será necessária."* |

---

## 🔹 ETAPA 4: PROMPT DE AUTORIZAÇÃO (MODO ACT)

Após aprovar o plano, use este prompt para autorizar a execução:

---

📥 **PROMPT DE AUTORIZAÇÃO DE ESCRITA**

> *"Excelente plano! Suas sugestões estão aprovadas.*
>
> *Pode passar para o MODO ACT e realizar as alterações propostas.*
>
> *No entanto, antes de dar a tarefa por concluída, você deve realizar OBRIGATORIAMENTE um Double-Check:*
>
> 1. *Compare cada arquivo que alterou com as diretrizes de isolamento Multi-Tenant.*
> 2. *Verifique se alguma query ou tabela esqueceu o TenantId.*
> 3. *Rode o comando `dotnet build` no terminal.*
> 4. *Se houver erros, corrija-os autonomamente.*
>
> *Somente após o build passar com sucesso, me entregue o resultado final."*

---

## 🛠️ DOUBLE-CHECK OBRIGATÓRIO

O Cline deve executar estas verificações **antes de finalizar a tarefa**:

| Verificação | Comando ou Ação |
| :--- | :--- |
| **Build** | `dotnet build` |
| **Migrações** | `dotnet ef migrations add Nome` (se necessário) |
| **Testes** | `dotnet test` (se houver testes) |
| **Validação Multi-Tenant** | Verificar se todas as entidades têm `HasQueryFilter` |

---

## 📋 CHECKLIST DE EXECUÇÃO

| ✅ | Etapa | Status |
| :---: | :--- | :---: |
| □ | Enviou o Prompt de Alinhamento (MODO PLAN) | _____ |
| □ | Cline apresentou o plano | _____ |
| □ | Avaliou o plano com o Checklist do Arquiteto | _____ |
| □ | Aprovou ou refinou o plano | _____ |
| □ | Enviou o Prompt de Autorização (MODO ACT) | _____ |
| □ | Cline executou o Double-Check | _____ |
| □ | Cline rodou `dotnet build` com sucesso | _____ |
| □ | Tarefa concluída e validada | _____ |

---

**Versão:** 1.0
**Última Atualização:** 2026-06-24
**Autor:** Tony Chagas