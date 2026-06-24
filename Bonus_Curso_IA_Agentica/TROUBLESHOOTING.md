# 🛠️ Guia de Sobrevivência e Engenharia de Prompt para Erros (Troubleshooting)

Se o seu projeto quebrou ou o deploy falhou, use os prompts exatos abaixo com o seu agente Cline para resolver em segundos.

---

### 🔥 Cenário A: O banco PostgreSQL não conecta ou dá erro de credenciais
**Instrução:** Copie o log de erro do terminal e envie este prompt para o Cline:
> *"Cline, minha aplicação Blazor não está conseguindo estabelecer conexão com o contêiner do PostgreSQL. Aqui está o log de erro anexado. Revise o arquivo de configuração de variáveis de ambiente do `docker-compose` e a string de conexão no `appsettings.json` para garantir que o Host e as credenciais batem exatamente com as regras do .NET 10. Corrija o desalinhamento."*

---

### 🧱 Cenário B: Erro na execução do Pipeline de Migrations do EF Core
**Instrução:** Se ao rodar `dotnet ef database update` der falha de sintaxe ou de tabela existente:
> *"Cline, o pipeline de migrations falhou. Estou usando PostgreSQL com isolamento Multi-Tenant conforme as regras do livro do Tony Chagas. Analise a última migration gerada e verifique se há conflito de chaves primárias ou se o mapeamento do `TenantId` quebrou alguma regra do DbContext. Proponha a correção sem perder dados."*

---

### 🎨 Cenário C: Componentes do MudBlazor não renderizam ou perdem o estilo
**Instrução:** Se a tela ficar em branco ou sem design após criar um componente:
> *"Cline, o componente Blazor que criamos está perdendo a folha de estilo do MudBlazor ou gerando erros no console do navegador. Verifique se os escopos do `_Imports.razor`, do `Program.cs` (injeção de dependência do MudBlazor) e as tags de CSS/JS no `App.razor` (ou `index.html`) estão corretamente referenciados para a versão estável do pacote do MudBlazor."*
