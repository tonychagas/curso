\# 🧠 Sabatina do Agente — Template de Planejamento



\## 📌 PROMPT DE TRAVAMENTO EM MODO PLAN



> \*"Cline, vamos planejar a implementação da nova funcionalidade: \[DESCRIÇÃO].\*

>

> \*REGRAS CRUCIAIS:\*

> - \*Entre estritamente em MODO PLAN. Não altere, não crie e não apague nenhum arquivo ainda.\*

> - \*Não execute comandos de escrita ou terminal até minha autorização.\*

>

> \*Passos que você deve executar agora:\*

>

> 1. \*Leia o arquivo `CLINE\_CUSTOM\_INSTRUCTIONS.md` para relembrar a arquitetura.\*

> 2. \*Leia o `DEVELOPMENT.md` para relembrar as regras de persistência.\*

> 3. \*Desenhe uma proposta detalhada de como vai implementar esta funcionalidade.\*

> 4. \*Liste quais os arquivos que planeja criar ou modificar.\*

> 5. \*Explique como vai testar a funcionalidade após a implementação.\*

>

> \*Aguarde pela minha revisão e autorização antes de passar para o modo de execução (Act)."\*



\---



\## 🔁 APÓS APROVAÇÃO — PROMPT DE EXECUÇÃO COM DOUBLE-CHECK



> \*"Cline, o seu plano foi aprovado. Pode passar para o MODO ACT e realizar as alterações propostas.\*

>

> \*No entanto, antes de dar a tarefa por concluída, você deve realizar OBRIGATORIAMENTE um Double-Check:\*

>

> 1. \*Compare cada arquivo que alterou com as diretrizes de isolamento Multi-Tenant.\*

> 2. \*Verifique se alguma query ou tabela esqueceu o TenantId.\*

> 3. \*Rode o comando `dotnet build` no terminal.\*

>

> \*Se encontrar qualquer inconformidade, corrija-a autonomamente antes de me entregar o resultado final."\*



\---



\*\*Versão:\*\* 1.0

\*\*Última atualização:\*\* 2026-06-24

