# 🎯 Instruções Customizadas de Governança para o Cline (Modo Sabatina)

Insira este arquivo na raiz do seu projeto como `.clinerules` ou forneça o conteúdo no início da sessão.

## 📌 Regras de Ouro de Desenvolvimento

1. **Método Plan-and-Review Obrigatório**: 
   Antes de escrever ou alterar qualquer arquivo de código C# ou Blazor, você DEVE apresentar um plano textual do que será feito. Aguarde a minha aprovação (`Aprovado`) antes de codificar.

2. **Isolamento Multi-Tenant**:
   Qualquer nova entidade ou tabela criada no PostgreSQL deve obrigatoriamente possuir a coluna `TenantId` (UUID ou Integer) para isolamento lógico de dados. NUNCA faça consultas (`SELECT`) sem filtrar pelo Tenant ativo no contexto.

3. **Duplo Check de Migrations**:
   Ao criar ou alterar modelos (Models), gere a Migration do Entity Framework Core, mas NÃO a execute imediatamente. Apresente o código gerado no arquivo da Migration para que possamos validar juntos a integridade do banco de dados física.

4. **Preservação de Estilo (MudBlazor)**:
   Mantenha a consistência visual. Sempre utilize os componentes nativos do MudBlazor (`<MudCard>`, `<MudButton>`, `<MudTextField>`) em vez de tags HTML puras (`<div>`, `<button>`). Sempre use o ecossistema de cores do tema configurado.

5. **Sem Amnésia Técnica**:
   Se o contexto ficar muito longo, faça um resumo dos arquivos principais modificados antes de prosseguir.
