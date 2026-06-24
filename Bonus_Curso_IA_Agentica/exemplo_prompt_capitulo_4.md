```markdown
# 📌 Exemplo de Prompt - Capítulo 4: Plan-and-Review

> Este é um exemplo real do nível de detalhe e qualidade que você vai encontrar no curso **"Guia Definitivo: Do Zero ao Deploy com IA Agêntica"**.

---

## 🧠 O Fluxo Plan-and-Review

No curso, você aprende a nunca dar ordens complexas a um agente sem antes pedir que ele explique o plano de execução. É a estratégia de ouro da engenharia de prompt agêntica.

---

## 📥 Prompt de Alinhamento (Capítulo 4)

> *"DIRETRIZ MESTRE DE SESSÃO: Leia o arquivo DEVELOPMENT.md na raiz C:\curso usando a ferramenta filesystem para absorver nossas regras de ouro de arquitetura. **NÃO crie ou altere nenhum arquivo C# ainda.** Esta é uma etapa estritamente de planejamento e alinhamento técnico.*
>
> *O DESAFIO: Precisamos modelar a camada de dados Multi-Tenant para o nosso ERP Blazor utilizando o EF Core 10 e PostgreSQL, centralizados diretamente na raiz C:\curso. O isolamento deve ser lógico por software com chave primária composta (TenantId, Id).*
>
> *QUERO QUE VOCÊ ME APRESENTE SEU PLANO DE ATAQUE DETALHANDO:*
>
> 1. *Como você estruturará o contrato IMultiTenant e as quatro entidades fundamentais (Tenant, User, Customer com precisão decimal correta e ApiConfig) na pasta Models.*
>
> 2. *Como desenhará o AppDbContext.cs na pasta Data aplicando Fluent API para mapear as chaves compostas e como implementará o filtro global automático e o interceptador no SaveChangesAsync para blindar o sistema contra vazamento de dados (impedindo o uso de context.Update).*
>
> 3. *Como você atualizará o Program.cs na raiz para registrar nossas dependências de forma limpa.*
>
> *ANTES DE EXECUTAR, RESPONDA:*
>
> *- Você entendeu perfeitamente a demanda e as restrições do nosso DEVELOPMENT.md?*
> *- Quais sugestões arquiteturais ou de melhoria de performance (como indexação no Postgres para chaves compostas) você propõe para este ecossistema antes de começarmos a codificar?"*

---

## 📸 Resultado Esperado

O Cline responde com um plano estruturado, listando arquivos a serem criados, sugestões de índices e impactos arquiteturais — **sem escrever uma linha de código ainda**.

```text
[MODO PLAN - ANÁLISE ESTRATÉGICA]

Li o DEVELOPMENT.md e entendi perfeitamente as diretrizes.

Meu plano de ataque estruturado para análise:

1. Interface e Modelos: Criarei a pasta Models/ contendo IMultiTenant, Tenant, User, Customer (com .HasPrecision para decimal) e ApiConfig.

2. Camada de Persistência: Criarei Data/AppDbContext.cs implementando o filtro dinâmico via reflexão e blindagem de TenantId no interceptador.

3. Inicialização: Atualizarei o Program.cs injetando o ITenantProvider e o DbContext com Npgsql.

💡 MINHAS SUGESTÕES DE MELHORIA:
- Índices Estratégicos: TenantId + Email em Users para acelerar autenticação.
- Desempenho no Filtro Global: TenantId como primeiro elemento da chave primária composta.

Estou pronto para prosseguir. Posso iniciar a criação e alteração dos arquivos no modo Act?
```

---

## 🛠️ Como Usar Este Exemplo

1. Abra o chat do Cline no VS Code.
2. Copie e cole o prompt acima.
3. Veja o Cline apresentar o plano **antes de escrever qualquer código**.
4. Aprove ou refine o plano.
5. Autorize a execução.

---

## 📚 Quer ver o capítulo completo?

O **Capítulo 4** contém **10+ prompts como este**, além de:
- Checklist do Arquiteto para avaliar o plano da IA
- Estratégias para refinar planos fracos
- Técnica do Double-Check para validação cruzada
- Exercícios práticos para fixação

👉 **Adquira o Guia Definitivo: Do Zero ao Deploy com IA Agêntica** e tenha acesso a todos os capítulos!

---

**Tony Chagas**  
Engenheiro de Software | Especialista em Vibe Coding e IA Agêntica
```
