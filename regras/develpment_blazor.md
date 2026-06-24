# Hotline ERP - Guia Consolidado de Desenvolvimento Total

> **Fonte da verdade para desenvolvimento.** Todo código gerado ou modificado DEVE seguir estas diretrizes.

---

## ⚡ QUICK REFERENCE (Leitura Obrigatória Antes de Codificar)

| Categoria | Regra Essencial |
|-----------|-----------------|
| **Arquitetura** | Injete interface, nunca classe concreta |
| **ServiceBase** | **SEMPRE** passe ILogger no construtor (evita apagão de logs) |
| **Multi-Tenant** | Chave primária composta (TenantId, Id) + FKs compostas |
| **Atualizações** | Mapeamento manual de propriedades, NUNCA `context.Update()` |
| **Novos Itens** | `EntityState.Added` forçado para evitar `DbUpdateConcurrencyException` |
| **Queries de Leitura** | Use `.AsNoTracking()` |
| **Queries de Edição** | **NUNCA** use `.AsNoTracking()` |
| **Decimais** | `.HasPrecision(18,2)` (proibido `.HasColumnType`) |
| **Banco de Dados** | snake_case, collation `icu_ci_ai`, limites de 63 caracteres |
| **Datas** | Sempre UTC (`DateTime.UtcNow`) |
| **Strings UI** | Tudo via `IStringLocalizer`, zero hardcoding |
| **Logs** | Técnico em português + metadados; usuário vê mensagem genérica |
| **Try-Catch** | Log técnico → retorna Result.Failure com msg localizada |
| **Permissões** | `_podeEscrever`/`_podeExcluir` em TODA página |
| **Background Jobs** | Intervalos no `appsettings.json`, nunca hardcoded |

---

## 🚫 ANTI-PADRÕES (COMPORTAMENTOS PROIBIDOS)

| ❌ Proibido | ✅ Correto | Onde |
|-------------|------------|------|
| `new Servico()` | Injetar via DI | Todos services |
| `: base(ctx, loc)` sem ILogger | `: base(ctx, loc, logger)` | Construtores ServiceBase |
| `context.Update(entity)` | Mapeamento manual de propriedades | Atualizações |
| `[Key]` em entidades multi-tenant | Chave composta via Fluent API | Modelagem |
| `HasColumnType("decimal(18,2)")` | `.HasPrecision(18, 2)` | Configuração EF |
| `.AsNoTracking()` antes de update | Buscar sem AsNoTracking | Update/Delete |
| `DateTime.Now` | `DateTime.UtcNow` | Datas |
| Strings hardcoded na UI | `@Loc["Chave"]` | Razor |
| `ex.Message` exibido ao usuário | `Loc["Msg_ErroGenerico"]` | Try-Catch |
| Intervalos hardcoded | `appsettings.json` | Hangfire |
| `Color="var(--mud-palette-primary)"` | `Color="Color.Primary"` | MudBlazor |
| `style="margin: 8px"` | `Class="ma-2"` | Layout |
| Navigation property preenchida antes de `context.Add()` | Limpar (`entity.Nav = null`) antes de Add, usar apenas FK | Cascade Insert |
| `catch` genérico em SaveChanges | Detectar `PostgresException SqlState == "23505"` e retornar msg específica | Violação Unique Constraint |
| `context.Update()` em entidades complexas | Mapeamento manual de propriedades | Sobrescrita de TenantId |
| **Criar cópia de diálogo view em outro módulo** | Referenciar via `@using` do módulo de origem | Diálogos compartilhados |
| **Identificador quebrando em grid** | `white-space: nowrap` + coluna ≥ 180px | Layout de grids |
| **Carregar Todos Registros na UI** | **OBRIGATÓRIO** usar MudDataGrid com ServerData e Paginação | UI Performance |
| **Height= Fixa em Grids ServerData** | Deixar altura livre para auto-ajuste com a Paginação | UI Layout |
| **Espaçamentos Gigantes** | Utilizar Dense="true", pa-2, mb-2 para densidade de Backoffice | UI Layout |
| **StreamReader sem Encoding.UTF8** | **SEMPRE** usar System.Text.Encoding.UTF8 em CSVs | Importações |
| `@using` ou `@inject` redundantes locais | Utilizar imports centralizados em `_Imports.razor` | Componentes Razor |

---

## 1. Arquitetura e Serviços

- Todo serviço deve expor uma interface correspondente (ex: `IProdutoService`) e ser injetado **exclusivamente** por essa interface — nunca pela classe concreta.
  - ✅ `@inject IProdutoService ProdutoService`
  - ❌ `@inject ProdutoService ProdutoService`
- Namespaces recomendados: `Hotline.Services`, `Hotline.Services.Interfaces`.
- Serviços que acessam banco ou localização devem herdar de `ServiceBase` e usar `CreateContext()` / `CreateContextAsync()` para obter `AppDbContext` com filtros de tenant aplicados automaticamente.
- **Padrão de Construtor e Regra Crítica de Injeção de ILogger (Prevenção de Furos de Log no Seq):**
  - Ao herdar de `ServiceBase`, **é terminantemente obrigatório** injetar `ILogger<SeuServico>` no construtor da classe filha e repassá-lo ao construtor base: `: base(contextFactory, loc, logger)`.
  - 🛑 **ATENÇÃO CRÍTICA:** Se você omitir o `ILogger` chamando apenas `: base(contextFactory, loc)`, a propriedade `Logger` assumirá internamente o `NullLogger.Instance`. Isso fará com que qualquer erro ou exceção capturada em blocos `try-catch` chamando `Logger.LogError(...)` seja **completamente engolida**, criando um furo de telemetria catastrófico (apagão silencioso de logs no Seq).

```csharp
// ❌ INCORRETO (Silencia todos os logs de exceção do serviço no Seq!)
public MyService(IDbContextFactory<AppDbContext> contextFactory,
    IStringLocalizer<SharedResources> loc) : base(contextFactory, loc)
{
}

// ✅ CORRETO (Garante telemetria completa e em tempo real no Seq!)
public MyService(IDbContextFactory<AppDbContext> contextFactory,
    IStringLocalizer<SharedResources> loc,
    ILogger<MyService> logger) : base(contextFactory, loc, logger)
{
}
```

- **Uso do Contexto:** Utilize sempre `using var context = CreateContext();` ou `using var context = await CreateContextAsync();`.
- **Ciclo de Vida:** Use `IDbContextFactory<AppDbContext>` em serviços com lifetime diferente de Scoped (ex: Singletons, Workers) para evitar problemas de concorrência.
- **Middleware:** `TenantLoggingMiddleware` deve ser o **primeiro** na pipeline em `Program.cs`, antes da Autenticação, para garantir contexto de Tenant em todos os logs de requisição.
- **Envelope de Retorno (Result Pattern):** Todas as operações de persistência (salvar, excluir) e transições de estado complexas em camadas de serviço devem obrigatoriamente retornar o envelope `Result` ou `Result<T>` (localizado no namespace `Hotline.Models.DTOs`) em vez de tipos primitivos (`bool`, `Guid`, `void`) ou de disparar exceções de controle de fluxo de negócio para a UI.
  - **Tratamento Seguro:** Envolva o método de serviço em `try-catch`, registrando o erro técnico detalhado via `Logger.LogError` e retornando `Result.Failure(Loc["Msg_ErroExplicito"])`.
  - **Acoplamento de UI:** Na camada de apresentação (Razor/Blazor), sempre consuma o `Result` verificando `res.IsSuccess` e exiba o erro localizado diretamente via `Snackbar.Add(res.Error, Severity.Error)`.

---

## 2. Modelos, Auditoria e Multi-Tenancy

- Entidades de negócio devem implementar `IBaseEntity` e, quando aplicável, `IMultiTenant` (com `TenantId`).

### 2.1. Chaves Primárias Compostas para Multi-Tenancy (Regra de Ouro)

- **Regra Crítica:** Todas as entidades que implementam `IMultiTenant` **devem obrigatoriamente** usar chaves primárias compostas `(TenantId, Id)` em vez de chaves primárias simples (`Id`).
- **Por que?** Isso garante isolamento de dados no nível do banco de dados, evitando conflitos de IDs entre tenants e permitindo que o PostgreSQL otimize consultas usando índices compostos.
- **Implementação:** Nas configurações do Fluent API, use `.HasKey(x => new { x.TenantId, x.Id })` em vez de `.HasKey(x => x.Id)`.
- **Chaves Estrangeiras Compostas:** Todas as FKs que referenciam entidades IMultiTenant também devem ser compostas, incluindo o `TenantId` na chave estrangeira (ex: `.HasForeignKey(x => new { x.TenantId, x.ClienteId })`).

```csharp
public class NovaEntidade : IBaseEntity, IMultiTenant
{
    // NÃO use [Key] aqui - a chave primária é composta e definida no Fluent API
    public Guid Id { get; set; }
 
    public Guid TenantId { get; set; }
 
    // Campos de Auditoria — preenchidos automaticamente pelo AppDbContext via ITenantProvider
    public DateTime CriadoEm { get; set; }
    public Guid CriadoPor { get; set; }
    public DateTime? AlteradoEm { get; set; }
    public Guid? AlteradoPor { get; set; }
}
```

**Configuração do Fluent API:**

```csharp
public class NovaEntidadeConfiguration : IEntityTypeConfiguration<NovaEntidade>
{
    public void Configure(EntityTypeBuilder<NovaEntidade> builder)
    {
        // Chave primária composta (TenantId, Id)
        builder.HasKey(x => new { x.TenantId, x.Id });
        
        // Se houver FK para outra entidade IMultiTenant, use chave composta
        builder.HasOne(x => x.OutraEntidade)
               .WithMany()
               .HasForeignKey(x => new { x.TenantId, x.OutraEntidadeId })
               .HasPrincipalKey(x => new { x.TenantId, x.Id });
    }
}
```

- **Injeção de Metadados e Auditoria (Regra de Ouro em Blazor Server / IDbContextFactory):**
  - Campos de auditoria (`CriadoEm`, `CriadoPor`, `AlteradoEm`, `AlteradoPor`) e o isolamento de `TenantId` são preenchidos automaticamente e centralizados no `AppDbContext` durante a persistência em `SaveChangesAsync`. **Não preencha ou altere esses campos manualmente nos Services ou telas.**

### 2.2. Uso de Guid.Empty vs Tenant.SystemTenantId (Regra Crítica)

- **Contexto:** O sistema possui uma variável dedicada para representar o inquilino de sistema: `Tenant.SystemTenantId` (configurável via `appsettings.json` -> `Security:SystemTenantId`, valor padrão: `00000000-0000-0000-0000-000000000001`).
- **Regra Geral:** Use `Guid.Empty` **apenas** para representar "não atribuído/não autenticado". Use `Tenant.SystemTenantId` para representar explicitamente o inquilino de sistema.

**Quando usar Guid.Empty (CORRETO):**

| Caso de Uso | Exemplo | Justificativa |
|-------------|---------|---------------|
| Verificar se entidade é nova | `if (entity.Id == Guid.Empty)` | ID vazio indica entidade ainda não persistida |
| Usuário não autenticado | `return Guid.Empty;` em TenantProvider | Usuário sem autenticação não possui tenant |
| Limpar cache/override | `if (tenantId == Guid.Empty)` | Remove override de tenant no cache |
| Dados de seed (opcional) | `CriadoPor = Guid.Empty` em Configuration | Indica criado pelo sistema/seed (pode usar SystemTenantId para consistência) |

**Quando usar Tenant.SystemTenantId (OBRIGATÓRIO):**

| Caso de Uso | Exemplo | Justificativa |
|-------------|---------|---------------|
| Criar dados como sistema | `CriadoPor = Tenant.SystemTenantId` | Rastreia que foi criado pelo tenant de sistema |
| Verificar se é usuário de sistema | `if (tenantId == Tenant.SystemTenantId)` | Identifica explicitamente o tenant de sistema |
| Criar tenant de sistema | `Id = Tenant.SystemTenantId` | Usa o ID configurado do tenant de sistema |

**Verificações Combinadas (CORRETO):**

```csharp
// Verificar se usuário pode ver dados globais (não autenticado OU sistema)
if (TenantProvider.TenantId == Guid.Empty || TenantProvider.TenantId == Tenant.SystemTenantId)
{
    // Mostrar funcionalidades administrativas
}

// Verificar se usuário de sistema (suporta ambos os casos)
if (_tenantProvider.IsSystemUser && (_tenantProvider.TenantId == Guid.Empty || _tenantProvider.TenantId == Tenant.SystemTenantId))
{
    query = query.IgnoreQueryFilters();
}
```

**Anti-Padrão (EVITAR):**

```csharp
// ❌ INCORRETO - Não usa SystemTenantId para dados de sistema
CriadoPor = Guid.Empty  // em contexto onde deveria rastrear tenant de sistema

// ❌ INCORRETO - Verificação incompleta para usuário de sistema
if (_tenantProvider.IsSystemUser && _tenantProvider.TenantId == Guid.Empty)
{
    // Falha se usuário de sistema tiver TenantId == Tenant.SystemTenantId
}
```

**Referência:** Auditoria completa em `Docs/auditoria_guid_empty_system_tenant.md`
  - 🛑 **ATENÇÃO CRÍTICA (Problema da Factory / Blazor Interativo):** Em cenários interativos Blazor, as classes de serviço utilizam `IDbContextFactory<AppDbContext>` para instanciar contextos. O DbContext criado por factory **não possui** acesso Scoped ao pipeline HTTP tradicional, o que torna o uso do `AuthenticationStateProvider` de forma direta ou síncrona ineficaz (resultando em valores nulos de usuário, ou seja, `Guid.Empty`).
  - ✅ **RESOLUÇÃO OBRIGATÓRIA VIA `ITenantProvider`:** O `AppDbContext` deve resolver o ID do usuário ativo acessando diretamente a propriedade síncrona `_tenantProvider.UserId`. O `TenantProvider` é injetado automaticamente de forma robusta pelo container de DI e resolve síncrona e inteligentemente o usuário logado com fallback seguro para contextos HTTP e circuitos Blazor (SignalR), mantendo a auditoria sempre preenchida.
- Configure filtro global de Tenant no `AppDbContext`. Nunca consulte dados sem garantir o filtro de `TenantId`.
- **Jamais** permita que um usuário de um Tenant acesse dados de outro.

---

## 3. Persistência e EF Core

- **Uso correto de `.AsNoTracking()`:** Deve ser utilizado **exclusivamente** em consultas de leitura que não sofrerão mutação de estado (métodos `Listar...Async`, `Buscar...Async`, geração de DTOs ou simulação de cálculos) para ganho de performance e redução do consumo de memória.
- **ATENÇÃO CRÍTICA (Proibição de `.AsNoTracking()` em Atualizações/Exclusões):** O uso de `.AsNoTracking()` desconecta a entidade do gerenciador de estado do EF Core (Change Tracker). **NUNCA** utilize `.AsNoTracking()` ao carregar uma entidade que será editada, deletada ou mutada. Caso contrário, a execução de `SaveChangesAsync()` não detectará nenhuma alteração e os dados serão descartados silenciosamente, gerando inconsistências graves no banco.
- Para atualizar entidades, prefira carregar a entidade rastreada (sem `AsNoTracking`), copiar as propriedades permitidas da UI (protegendo chaves de Tenant e metadados) e então chamar `SaveChangesAsync()`.
- Evite N+1: pré-carregue todos os dados necessários (Produtos, Regras Fiscais) em memória (Dicionários/Listas) **antes** de iniciar a iteração. Evite chamadas ao banco dentro de `foreach` ou `while`.
- Prefira `AsSplitQuery()` quando existirem múltiplos includes para evitar produto cartesiano.
- Use `IDbContextFactory<AppDbContext>` em serviços com lifetime diferente de Scoped.

### 3.1. Precisão de Decimais (Portabilidade)

Sempre use `.HasPrecision(p, s)` para colunas decimais. Proibido `.HasColumnType("decimal(p,s)")`.

```csharp
// ❌ PROIBIDO
builder.Property(x => x.ValorTotal).HasColumnType("decimal(18,2)");

// ✅ CORRETO
builder.Property(x => x.ValorTotal).HasPrecision(18, 2);
```

### 3.2. Convenções de Banco

- **Nomenclatura Obrigatória:** Use **exclusivamente letras minúsculas (snake_case)** para todos os objetos do banco de dados (tabelas, colunas, chaves primárias, chaves estrangeiras e índices).
- **Sensibilidade a Caso e Acentos (Collation):** Para PostgreSQL, é obrigatório o uso da collation ICU `icu_ci_ai` em todas as colunas do tipo `string`. Isso garante comportamento Case-Insensitive e Accent-Insensitive. Esta regra é aplicada globalmente via `modelBuilder` no `AppDbContext.cs`.
- **Padronização de Prefixos e Nomes de Constraints (Restrições de PostgreSQL):** 
  - PK: `pk_<tabela>`
  - FK: `fk_<origem>_<destino>` (ex: `fk_ajuda_contextual_traducao_ajuda_contextual_ajuda_contextual`)
  - Índices: `ix_<tabela>_<colunas>`
  - ⚠️ **ATENÇÃO CRÍTICA À LIMITAÇÃO DE 63 CARACTERES:** O PostgreSQL possui um limite estrito de **63 caracteres** para identificadores (nomes de tabelas, colunas, índices e constraints).
  - 🛑 **PROIBIÇÃO DE CARACTERES ESPECIAIS (COMO TILDE `~`):** Nunca permita que o EF Core gere ou que você declare nomes de constraints com caracteres especiais no final como o til/tilde (`~`). O EF Core costuma colocar o til para abreviar nomes muito longos que passam de 63 caracteres, o que força o uso de aspas duplas no Postgres e gera sérios problemas de compatibilidade e erros em scripts SQL.
  - 🛑 **EVITE ASPAS DUPLAS:** Todas as constraints devem caber no limite de 63 caracteres e serem declaradas sem aspas duplas em scripts Postgres, contendo apenas letras minúsculas (`snake_case`), números e sublinhados (`_`).
- **Conformidade PostgreSQL:** Estas regras são obrigatórias para garantir o funcionamento correto e sem falhas sob o motor PostgreSQL.
- Tabelas transacionais podem usar `Guid` com geração sequencial (como UUIDv7 ou gerados pelo EF Core) para reduzir fragmentação de índices.

### 3.2.1. Otimização de Índices e Performance Multi-Tenant

Em sistemas ERP SaaS Multi-Tenant com banco de dados compartilhado (Shared Database, Shared Schema), o design de índices é crítico para a escalabilidade e o isolamento de dados do sistema. Siga rigorosamente as seguintes diretrizes de modelagem e indexação:

- **Chaves Primárias Compostas (TenantId, Id):**
  - **Regra Fundamental:** Todas as entidades `IMultiTenant` usam chaves primárias compostas `(TenantId, Id)` em vez de chaves simples (`Id`). Isso garante isolamento de dados no nível do banco e otimiza consultas.
  - **Benefício:** O PostgreSQL pode usar o índice da chave primária composta para filtrar por tenant automaticamente, sem necessidade de índices adicionais simples em `Id`.
- **Índices Compostos Liderados por TenantId (Tenant-Leading Indexes):**
  - **Regra de Ouro:** Qualquer tabela de negócio que implemente `IMultiTenant` e possua chaves estrangeiras ou campos frequentemente filtrados deve usar índices compostos onde o `tenant_id` seja obrigatoriamente a primeira coluna (ex: `.HasIndex(x => new { x.TenantId, x.ClienteId })`).
  - **Por que?** Como o EF Core aplica um filtro global de consulta (`HasQueryFilter(e => e.TenantId == _tenantProvider.TenantId)`), toda busca realizada pelo ERP terá o `tenant_id` na cláusula `WHERE`. Índices compostos que começam com o `tenant_id` permitem que o PostgreSQL filtre rapidamente os dados do inquilino atual e, no mesmo passo do índice, resolva a chave estrangeira ou o filtro de negócio, eliminando scans sequenciais dispendiosos e otimizando o tempo de resposta das consultas.
- **Unicidade de Chaves de Negócio (Composite Unique Constraints):**
  - **Regra Crítica:** Restrições de unicidade em chaves de negócio (como CPF/CNPJ de clientes, SKU de produtos, códigos de referência de pedidos, ou e-mails de usuários) **jamais** devem ser globais no banco. Elas devem obrigatoriamente incluir o `TenantId` no índice único composto (ex: `.HasIndex(x => new { x.TenantId, x.CpfCnpj }).IsUnique()`).
  - **Por que?** Se você criar um índice único simples e global em uma coluna como `sku`, o cadastro do produto "PROD001" pelo Inquilino A impedirá que o Inquilino B também o cadastre no mesmo banco compartilhado, gerando falhas operacionais e vazamento lógico de dados.
- **Remoção Dinâmica de Índices Redundantes (Prevenção de Index Bloat):**
  - **Mapeamento Automático:** Por padrão, o EF Core cria automaticamente um índice de coluna única para cada chave estrangeira (FK) declarada no modelo. No entanto, quando criamos um índice composto liderado por tenant (ex: `{ TenantId, VendedorId }`), o índice simples gerado pelo EF Core na FK (`VendedorId`) torna-se redundante no PostgreSQL e causa inchaço desnecessário do banco de dados (index bloat), prejudicando operações de escrita.
  - **Solução no AppDbContext:** O Hotline ERP implementa uma convenção customizada de finalização de modelo chamada `RedundantIndexRemovalConvention` in `AppDbContext.cs`. Essa convenção analisa automaticamente o modelo durante a compilação do EF Core e remove do metadado os índices simples de chaves estrangeiras se já existir um índice composto correspondente liderado por `TenantId` (ex: `{ TenantId, ForeignKey }`).
  - **Consequência:** Não declare `HasNoIndex()` manualmente para desabilitar índices de FKs. Escreva a modelagem da chave estrangeira normalmente e declare o índice composto `{ TenantId, ForeignKey }`. A limpeza do índice simples de FK será feita de forma reativa e transparente pela convenção no pipeline do DbContext.
- **Índices de Filtros Frequentes do ERP:**
  - Além de chaves estrangeiras, crie índices compostos liderados por `TenantId` para filtros comuns de telas, relatórios e buscas avançadas, como:
    - Status e Data de Criação: `new { x.TenantId, x.Status, x.CriadoEm }`
    - Códigos e Referências de Busca: `new { x.TenantId, x.CodigoReferencia }`

### 3.3. Proteção de Inquilino (TenantId) em Atualizações

Em sistemas multi-tenant, a integridade do `TenantId` é a prioridade máxima. 

- 🛑 **PROIBIDO:** O uso de `context.Update(entity)` ou `context.Entry(existing).CurrentValues.SetValues(inputObject)` para atualizar registros vindos da UI (formulários).
    - **Por que?** Esses métodos sobrescrevem **todos** os campos da entidade. Se o objeto vindo da UI for parcial (não contiver `TenantId`, `FotoId`, `CriadoEm`, etc.), esses campos serão zerados ou alterados para valores padrão (`Guid.Empty`, `null`), causando corrupção de dados e quebra de isolamento.
- ✅ **OBRIGATÓRIO:** Use o padrão de **Mapeamento Manual de Propriedades**:
    1. Carregue a entidade existente do banco usando `FindAsync` (o filtro global de tenant garantirá que você só acesse dados do inquilino atual).
    2. Atribua manualmente apenas as propriedades que o usuário tem permissão de editar no formulário.
    3. Jamais atribua valor ao `TenantId`, `CriadoEm`, `CriadoPor` ou `FotoId` (a menos que a funcionalidade seja especificamente para trocar a foto).

```csharp
// ❌ INCORRETO (Perigoso)
public async Task SalvarAsync(Usuario usuario) {
    context.Usuarios.Update(usuario); // Sobrescreve TenantId com Guid.Empty se vier da UI parcial
    await context.SaveChangesAsync();
}

// ✅ CORRETO (Seguro)
public async Task SalvarAsync(Usuario input) {
    var existing = await context.Usuarios.FindAsync(input.Id);
    if (existing != null) {
        existing.Nome = input.Nome;
        existing.Email = input.Email;
        existing.Ativo = input.Ativo;
        // TenantId e CriadoEm permanecem intactos no objeto 'existing'
    }
    await context.SaveChangesAsync();
}
```

### 3.4. Sincronização Mestre-Detalhe Segura (Prevenção de Erros de Concorrência no EF Core)

Ao sincronizar coleções filhas (como itens de pedido, parcelas financeiras, ou endereços de clientes) em fluxos de atualização (`UPDATE`), é comum que a camada de UI (Blazor) envie novos itens com chaves primárias (`Id`) já pré-geradas (`Guid.NewGuid()`).

* 🛑 **O RISCO:** Se você simplesmente adicionar o novo objeto com um `Id` preenchido à coleção rastreada da entidade pai (ex: `existing.Itens.Add(novoItem)`), o EF Core interpretará incorretamente que a entidade já existia no banco (por ter uma chave primária não-padrão/preenchida) e tentará realizar um comando `UPDATE` em vez de um `INSERT` (`Added`). Ao rodar o `SaveChangesAsync()`, o banco retornará `0` linhas afetadas por essa instrução fictícia, resultando na exceção catastrófica de concorrência: **`DbUpdateConcurrencyException`**.
* ✅ **A SOLUÇÃO OBRIGATÓRIA:** Sempre que inserir um novo item em coleções filhas onde o ID possa vir preenchido do front-end, você deve forçar explicitamente o estado da entidade no DbContext como `EntityState.Added`:

```csharp
// Loop de sincronização de itens (dentro do método Salvar/Update)
var existingItem = existing.Itens.FirstOrDefault(ei => ei.Id == item.Id);
if (existingItem == null)
{
    // Novo item filho (com ID gerado na UI ou em memória)
    existing.Itens.Add(item);
    
    // ✅ OBRIGATÓRIO: Força o EF Core a fazer um INSERT no banco
    context.Entry(item).State = EntityState.Added; 
}
else
{
    // Atualizar campos do item filho existente...
}
```

### 3.5. Sanitização de Campos com Máscara (CEP, CPF, CNPJ)

- **Sanitização Mandatória no Nível de Entidade:** Todos os campos que possuem máscaras visuais na UI (como CEP `00000-000`, CNPJ `00.000.000/0000-00` ou CPF `000.000.000-00`) e limites rígidos de comprimento no banco de dados (como `varchar(8)` ou `varchar(14)`) **devem obrigatoriamente** ser sanitizados no nível da propriedade (setter) da própria entidade ou DTO para remover quaisquer caracteres não numéricos antes de persistir no banco.
- **Prevenção de Estouro de Campo (DbUpdateException / PostgresException):** Isso garante que mesmo que a UI envie a string formatada com hífens, pontos e barras, a entidade filtre e armazene apenas os dígitos limpos (ex: 8 dígitos para CEP, 14 dígitos para CNPJ, 11 dígitos para CPF), eliminando erros graves de estouro de tamanho de campo (ex: `value too long for type character varying(8)`) no banco de dados.
- **Implementação Recomendada (Backing Field + Regex):**

```csharp
private string? _cep;
[MaxLength(8)]
public string? Cep
{
    get => _cep;
    set => _cep = value != null ? System.Text.RegularExpressions.Regex.Replace(value, "[^0-9]", "") : null;
}
```

```csharp
private string _documento = string.Empty;
[Required]
[MaxLength(14)]
public string Documento
{
    get => _documento;
    set => _documento = value != null ? System.Text.RegularExpressions.Regex.Replace(value, "[^0-9]", "") : string.Empty;
}
```

### 3.6. Gestão de Arquivos e Uploads (Global vs Tenant)

- **Regra Geral:** Todo arquivo salvo através do `IFileService` fica atrelado ao `TenantId` atual do usuário (pasta física `uploads/{tenantId}`). A tabela `Arquivos` rastreia essa posse.
- **Uploads para Tabelas Globais (Ex: DNE):** Arquivos (como `.csv` de importação) que alimentam dados **globais** do sistema (tabelas que não possuem `TenantId`, como Paises, Cidades, Ceps) devem **obrigatoriamente** ser salvos no Inquilino de Sistemas (Global).
  - **Como fazer:** Utilize a flag `forceGlobal = true` no método `SalvarArquivoAsync` e passe `IsGlobal="true"` em componentes compartilhados como o `CsvImportDialog`.
  - **Por que?** Isso impede a anomalia arquitetural onde um arquivo fisicamente isolado dentro da pasta de um Inquilino específico atualiza os dados visíveis para todos os outros Inquilinos, além de permitir o gerenciamento e deleção seguros do arquivo pelos administradores globais no gerenciador de arquivos do sistema (pasta `uploads/global`).
- **Segurança:** Qualquer botão ou funcionalidade que dispare importações de dados globais deve ser **ocultado** para usuários não-Sistemas, protegendo o botão com o if correspondente (ex: `@if (TenantProvider.IsSystemUser && TenantId == Guid.Empty)`).

### 3.7. Prevenção de Cascade Insert (Evitando Violação de Unique Constraints)

Ao adicionar entidades ao DbContext com `context.Add(entity)`, o EF Core faz **cascade insert** de todas as navigation properties preenchidas. Se essas navigation properties apontarem para entidades **já existentes** no banco (como `Produto`, `Cliente`, `Transportadora`), o EF Core tentará inseri-las como novos registros, violando unique constraints.

- 🛑 **PROIBIDO:** Adicionar uma entidade ao contexto (`context.Add`) quando ela possui navigation properties para entidades existentes preenchidas pela UI (ex: `PedidoItem.Produto` vindo do formulário).
- ✅ **OBRIGATÓRIO:** Limpe as navigation properties problemáticas antes do `Add`:

```csharp
// ❌ INCORRETO — EF Core tentará inserir o Produto como novo (viola ix_produtos_tenant_id_sku)
context.Pedidos.Add(pedido); // pedido.Itens[0].Produto está preenchido

// ✅ CORRETO — Limpa navigation properties antes de adicionar
foreach (var item in pedido.Itens)
{
    item.Produto = null; // Remove referência para evitar cascade insert
}
context.Pedidos.Add(pedido);
```

- **Tratamento de PostgresException 23505:** Em blocos `catch` de `SaveChangesAsync`, detecte especificamente a violação de unique constraint para retornar mensagem clara ao usuário:

```csharp
catch (Exception ex)
{
    if (ex is DbUpdateException dbEx && dbEx.InnerException is Npgsql.PostgresException pgEx
        && pgEx.SqlState == "23505"
        && pgEx.ConstraintName == "ix_produtos_tenant_id_sku")
    {
        return Result<Guid>.Failure(Loc["Msg_SkuAlreadyExists"]);
    }
    // ...
}
```

### 3.8. Cópia Completa de Propriedades e Log de Auditoria em Serviços (Zero-Omissions)

- **Cópia de 100% dos Campos Editáveis:** Sempre que implementar um método de criação ou atualização (ex: `SaveAsync`, `SalvarAsync`, `UpdateAsync`) em qualquer serviço de negócio, você deve obrigatoriamente copiar **todos** os campos expostos pela interface ou passados no DTO/objeto visual. Erros de omissão de cópia (como esquecer de mapear propriedades secundárias do DTO para a entidade) causam falhas graves e descarte silencioso de dados.
- **Evite AsNoTracking() na Edição:** Nunca use `.AsNoTracking()` na busca por chaves primárias quando o objetivo for editar a entidade recuperada. O EF Core precisa rastrear a entidade para persistir as mudanças de forma nativa e segura.
- **Log de Auditoria Detalhado:** Em entidades críticas do negócio (ex: `Tenant`, `TenantConfig`, `Cliente`, `Transportadora`), implemente uma comparação campo a campo detalhada de forma explícita antes de persistir as alterações e registre as modificações em log (`Logger`), listando exatamente quais campos mudaram e seus valores antigos e novos.

```csharp
// Exemplo de comparação de auditoria
var changes = new List<string>();
if (existing.CampoA != dto.CampoA) 
    changes.Add($"CampoA: '{existing.CampoA}' -> '{dto.CampoA}'");
if (changes.Any())
{
    Logger.LogInformation("Entidade {Id} modificada. Alterações: {Changes}", existing.Id, string.Join(", ", changes));
}
```

### 3.9. Importação de CSVs (Upsert Pattern e Resumo)

Ao implementar lógicas de importação em massa (CSVs, Planilhas):
- 🛑 **PROIBIDO:** Usar `ON CONFLICT DO NOTHING` ou deletar dados antigos para substituir pelos novos.
- ✅ **OBRIGATÓRIO:** Utilizar o padrão de **Upsert** (Atualizar se existir, Inserir se não existir). No PostgreSQL, utilize `INSERT INTO ... ON CONFLICT (colunas_chave) DO UPDATE SET ...` para garantir que registros preexistentes sejam atualizados com os dados mais recentes do CSV.
- **Resumo da Operação:** Todo serviço de importação deve retornar um objeto de resultado contendo estatísticas da operação (ex: `ImportSummaryDto`), informando ao usuário exatamente quantos registros foram **Inseridos** e quantos foram **Modificados/Atualizados**.
- **Performance:** Para tabelas com milhões de registros (ex: CEPs), faça uso de `COPY` (via `NpgsqlBinaryImporter`) para uma tabela temporária (temp table) e execute o `INSERT ... ON CONFLICT DO UPDATE` da tabela temporária para a tabela principal no banco, processando a inserção em massa em altíssima velocidade.

---

## 4. Padronização de Data e Hora (UTC)

- **Persistência:** Salve sempre datas no banco de dados em formato **UTC**. Use `DateTime.UtcNow` — nunca `DateTime.Now`.
- **Queries:** Ao filtrar por períodos (ex: Vendas do dia), converta os parâmetros de data para UTC **antes** da consulta.
- **Exibição:** A conversão para o fuso horário local do usuário deve ocorrer apenas na camada de apresentação (UI).

---

## 5. Localização (i18n) — Zero Hardcoding

- **Regra de Ouro:** Nenhuma string visível ao usuário (labels, mensagens, placeholders, tooltips) deve estar hardcoded em C#, Razor ou CSS.
- Centralize recursos em `Resources/SharedResources.pt-BR.resx`, `SharedResources.en-US.resx`, `SharedResources.es-ES.resx`; mantenha paridade entre idiomas.
- Injete `IStringLocalizer<SharedResources> Loc` e use `@Loc["Chave"]`.
- Para mensagens com parâmetros, use placeholders no `.resx` e `string.Format(Loc["Chave"], args)`.
- **Siglas e Unidades:** Unidades de medida (m³, kg, etc.) **jamais** devem ser escritas diretamente no Razor. Use as chaves padronizadas (ex: `Loc["Unit_CubicMeter_Short"]`).
- **Encoding Obrigatório:** Todos os arquivos (`.resx`, `.razor`, `.cs`) **devem** ser salvos em **UTF-8 com BOM (UTF-8-sig)**. Isso evita que caracteres especiais como `³`, `á`, `ç` sejam corrompidos em diferentes sistemas operacionais (Windows/Android).

### 5.1. Padronização de Chaves

| Tipo | Prefixo | Exemplos |
|:---|:---|:---|
| Labels | `Label` | `LabelNome`, `LabelEmail`, `LabelDataNascimento` |
| Botões | `Botao` | `BotaoSalvar`, `BotaoExcluir`, `BotaoNovo` |
| Mensagens | `Mensagem` | `MensagemSucessoSalvar`, `MensagemErroInesperado` |
| Placeholders | `Placeholder` | `PlaceholderPesquisar` |
| Logs técnicos | `Log_` | `Log_ErroProcessamento`, `Log_PedidoFaturado` |
| Módulos | `Modulo_` | `Modulo_Vendas`, `Modulo_Financeiro` |
| Unidades | `Unit_` | `Unit_CubicMeter_Short`, `Unit_Kilogram_Short` |

### 5.2. Política de Registro de Chaves

- Ao adicionar nova chave: inclua-a em **todos** os arquivos `.resx` suportados (pt-BR, en-US, es-ES). Se a tradução não estiver pronta, use o texto em inglês como placeholder.
- Documente o formato de placeholders no comentário da chave (ex: `{0} - nome do usuário`).
- Pull Requests que adicionem keys devem atualizar todos os `.resx` e incluir uma linha no changelog de i18n.
- **⛔ PROIBIDO** valores placeholder com o próprio nome da chave (ex: `<value>LabelCEP</value>`). Isso gera duplicatas e warnings MSB3568 no build. Use **sempre** um valor real traduzido.
- **🔁 WORKFLOW OBRIGATÓRIO:** (1) Verifique se a chave já existe no `SharedResources.pt-BR.resx`. (2) Se não existir, crie-a primeiro no pt-BR com o valor em português. (3) Depois adicione a tradução correspondente no en-US. (4) Depois no es-ES. **Nunca crie a chave em apenas um arquivo.**
- **🛡 VERIFICAÇÃO PRÉ-COMMIT:** Antes de finalizar, execute `Select-String -Path 'Resources\SharedResources.*.resx' -Pattern 'name=\"NovaChave\"'` nos três arquivos para confirmar que a chave existe em todos com valores reais.

### 5.3. Tratamento de Chaves Faltantes (Fallback)

- 🚨 **DETECÇÃO DE STRING BRUTA:** Se a UI renderizar o nome literal da chave (como `BotaoNovo`, `BotaoVoltar`, `LabelTitulo`) em vez do texto traduzido, isso é um indicativo de que a chave de recurso está ausente ou grafada incorretamente nos arquivos `.resx`.
- **Ação Imediata:** Não substitua a chamada por uma string hardcoded. Em vez disso, abra os três arquivos `.resx` (`pt-BR`, `en-US` e `es-ES`) e registre a chave ausente com seus respectivos valores traduzidos.

### 5.4. Logging e Tratamento de Erros com Localização (Regra Crítica)

Esta seção é **obrigatória** para prevenir violações de localização em operações técnicas e de erro.

#### 5.4.1. Logger.LogError — Zero Hardcoding

- 🛑 **PROIBIDO:** Strings literais em `Logger.LogError(ex, "...")`.
- ✅ **OBRIGATÓRIO:** Use sempre `Loc["Log_Chave"]` para mensagens de log técnico.
- **Padrão de Metadados:** Sempre inclua metadados técnicos (ex: `{ Error = ex.Message }`) para debug no Seq.

```csharp
// ❌ INCORRETO — String hardcoded no log técnico
Logger.LogError(ex, "Erro ao assinar XML.");

// ✅ CORRETO — Chave de recurso + metadados
Logger.LogError(ex, Loc["Log_ErroAssinarXml"], new { Error = ex.Message });
```

#### 5.4.2. Snackbar.Add — Zero Hardcoding

- 🛑 **PROIBIDO:** Strings literais em `Snackbar.Add("...", Severity.X)`.
- ✅ **OBRIGATÓRIO:** Use sempre `Loc["Msg_Chave"]` para mensagens de feedback ao usuário.
- **Prefixo de Chave:** Mensagens de feedback devem usar prefixo `Msg_` (ex: `Msg_ErroInesperado`, `Msg_SalvoSucesso`).

```csharp
// ❌ INCORRETO — String hardcoded no feedback
Snackbar.Add("Por favor, selecione um arquivo .csv válido.", Severity.Error);

// ✅ CORRETO — Chave de recurso
Snackbar.Add(Loc["Msg_SelecioneArquivoCsvValido"], Severity.Error);
```

#### 5.4.3. Result.Failure — Zero Ex.Message ao Usuário

- 🛑 **PROIBIDO:** Concatenar `ex.Message` em `Result.Failure("Erro: " + ex.Message)`.
- ✅ **OBRIGATÓRIO:** Use sempre `Result.Failure(Loc["Msg_ErroInesperado"])` para mensagens genéricas ao usuário.
- **Segurança:** Detalhes técnicos (`ex.Message`) devem ir apenas no log técnico via `Logger.LogError`, nunca na UI.

```csharp
// ❌ INCORRETO — Expondo detalhes técnicos ao usuário
catch (Exception ex)
{
    Logger.LogError(ex, "Error importing NCMs");
    _resultado = Result.Failure("Erro ao conectar na API IBPT: " + ex.Message);
}

// ✅ CORRETO — Log técnico detalhado + mensagem genérica ao usuário
catch (Exception ex)
{
    Logger.LogError(ex, Loc["Log_ErroImportarNcmsApi"], new { Error = ex.Message });
    _resultado = Result.Failure(Loc["Msg_ErroInesperado"]);
}
```

#### 5.4.4. Consistência de IStringLocalizer — Proibido .Value

- 🛑 **PROIBIDO:** Acesso explícito à propriedade `.Value` em chamadas de UI (ex: `Snackbar.Add(Loc["Msg_X"].Value, Severity.Error)`).
- ✅ **OBRIGATÓRIO:** Use conversão implícita: `Snackbar.Add(Loc["Msg_X"], Severity.Error)`.
- **Exceção:** O `.Value` é permitido **apenas** em contextos onde conversão implícita não funciona (ex: atributos HTML, concatenação de strings em C#).

```csharp
// ❌ INCORRETO — .Value desnecessário
Snackbar.Add(Loc["Msg_ErroInesperado"].Value, Severity.Error);

// ✅ CORRETO — Conversão implícita
Snackbar.Add(Loc["Msg_ErroInesperado"], Severity.Error);
```

---

## 6. UI/UX (Blazor + MudBlazor)

### 6.1. Layout, Margens e Cabeçalho Global (Padrão V2)

O layout do Hotline ERP é baseado em uma interface de alta densidade e aproveitamento máximo de tela (widescreen), utilizando uma estrutura limpa e compactada:

- **Cabeçalho Global (MudAppBar):** A barra superior possui altura reduzida fixa de `48px`. O logotipo e título "HOTLINE" são ocultados da barra superior, mantendo-se em destaque apenas no menu lateral.
- **Ajuda Contextual Global:** O ícone de interrogação de ajuda local foi removido de cada tela e movido para a barra global superior (`MudAppBar`) no canto superior direito. Ele abre a ajuda baseando-se reativamente na rota ativa.
- **Aproveitamento de Espaço (Widescreen):** O container de conteúdo principal (`MudContainer`) se expande horizontalmente até ocupar `100%` da largura disponível da tela, utilizando paddings laterais enxutos de `16px` para eliminar espaços ociosos.
- **Evitar Espaçamento Duplo:** Containers internos (`.mud-container .mud-container`) têm margens e paddings anulados a `0` para que as telas fiquem o mais próximo possível do topo útil da página.
- **Acabamento Minimalista de Rolagem (Scrollbar):** Todas as barras de rolagem (do navegador ou de tabelas/painéis) são reduzidas para `6px` de espessura com cantos arredondados (`9999px`) e fundo transparente.

#### 6.1.1. Cabeçalho de Páginas (SfPageHeader.razor)
O cabeçalho minimalista das telas de listagem/cadastro deve ser ultra-compacto:
- **Ocultação do Avatar:** O avatar/ícone circular colorido do cabeçalho de página é ocultado no padrão V2 para despoluir a interface.
- **Trilha de Navegação (Breadcrumb) Superior:** Posicionada acima do título da página com fonte micro (`0.75rem`), cor neutra `#9CA3AF`, separador `/` e com o último item desabilitado para evitar cliques redundantes.
- **Título de Alto Contraste:** Peso negrito proeminente (`font-weight: 800`) e cor `#111827`.
- **Ações Alinhadas:** Botões de ação da tela (`Novo`, `Salvar`, etc.) ficam na mesma linha do título, alinhados horizontalmente à direita.
- **Micro-Interação em Botões:** Botões de preenchimento primário se elevam ligeiramente (`translateY(-1px)`) com sombra difusa suave ao passar o mouse (`hover`).

### 6.1.2. Padrão de Diálogos e Modais Premium (Padrão V2)

Todas as janelas de diálogo do MudBlazor no ERP devem seguir a nova estética minimalista V2 (aplicada de forma automática a todo `<MudDialog>` sob a classe ancestral `.v2-layout`):

- **Geometria de Bordas:** Todos os modais possuem cantos arredondados suavizados de `12px` (classe `.v2-layout .mud-dialog`).
- **Cabeçalho Transparente e Neutro:** Sem caixas de fundo colorido sólido (banners). O cabeçalho é transparente, contendo tipografia em negrito e o botão simples de fechar "X" posicionado no canto superior direito.
- **Espaçamento e Respiro Visual:** O conteúdo interno do modal possui padding generoso de `pa-6` (24px) para garantir conforto visual e respiro entre inputs e elementos de texto.
- **Backdrop com Efeito de Vidro (Glassmorphic):** O fundo desfocado (`backdrop-filter: blur(4px)`) com escurecimento suave (`rgba(17, 24, 39, 0.45)`) é aplicado ao overlay atrás do modal, destacando o diálogo de forma tridimensional.
- **Borda Sutil:** Uma borda muito fina e neutra em torno de todo o modal (`border: 1px solid var(--mud-palette-lines-default)`).
- **Botões de Ação de Rodapé:** Devem ser alinhados à direita no canto inferior.
  - O botão de **Cancelar/Voltar** deve usar estilo de texto transparente: `Variant="Variant.Text"`.
  - O botão de **Confirmar/Salvar** deve usar preenchimento sólido primário do tema: `Variant="Variant.Filled"`.

#### Exemplo Canônico de Código (`Dialog` V2):

```razor
<MudDialog>
    <TitleContent>
        <div class="d-flex align-center justify-space-between w-100">
            <MudText Typo="Typo.h6" Class="font-bold">@Loc["LabelNovaContaBancaria"]</MudText>
            <MudIconButton Icon="@Icons.Material.Filled.Close" Color="Color.Default" OnClick="Cancelar" Size="Size.Small" />
        </div>
    </TitleContent>
    <DialogContent>
        <div class="pa-2">
            <MudForm @ref="_form" @bind-IsValid="_isValid">
                <MudGrid Spacing="3">
                    <MudItem xs="12" md="12">
                        <MudTextField @bind-Value="_model.Descricao" Label="@Loc["LabelDescricao"]" Required="true" Variant="Variant.Outlined" Margin="Margin.Dense" />
                    </MudItem>
                    <!-- Outros inputs... -->
                </MudGrid>
            </MudForm>
        </div>
    </DialogContent>
    <DialogActions>
        <MudButton Variant="Variant.Text" OnClick="Cancelar" Color="Color.Default">@Loc["BotaoCancelar"]</MudButton>
        <MudButton Variant="Variant.Filled" Color="Color.Primary" OnClick="Confirmar" Class="ml-2">@Loc["BotaoSalvar"]</MudButton>
    </DialogActions>
</MudDialog>
```

### 6.2. Formulários (Inputs)

- **Variant:** Sempre `Variant.Outlined`.
- **Margin:** Sempre `Margin.Dense`.
- **Required:** Use `Required="true"` com `RequiredError="@Loc["MensagemCampoObrigatorio"]"`.

### 6.3. DataGrids e Tabelas (Padrão V2)

- **Defaults Obrigatórios:** `Dense="true"`, `Hover="true"`, `Bordered="false"`, `Striped="false"`.
- **Transição de Hover:** Linhas de tabelas e grids (`mud-table-row`) possuem uma transição de fundo suave (`transition: background-color 0.15s ease`).
- **Navegação e Paginação de Rodapé V2:**
  - **Esquerda:** Exibe o contador de registros discreto: `"Exibindo X-Y de Z"`.
  - **Direita:** O seletor de quantidade de itens por página ("Itens por página" + select) e os botões de paginação (`[Primeiro] [<] [1] [>] [Último]`) são renderizados juntos no canto direito de forma compacta e alinhada.
  - **Estilo de Botões:** O botão de página ativa é preenchido com a cor principal do tema, enquanto as páginas não selecionadas possuem apenas bordas cinzas claras e hover suave.
- **Filtros e Campo de Pesquisa:** Barra de busca no topo direito via `ToolBarContent`. O campo de pesquisa (`search-field`) deve ter cantos arredondados de `8px` e efeito de sombra externa sutil de `3px` ao receber foco.
- **Ações de Linha:** Agrupadas sob um `MudMenu` expansivo acionado pelo ícone `MoreVert` (três pontos). Popovers e menus dropdown recebem cantos arredondados (`8px`), borda sutil e sombras difusas para dar profundidade. Proibido botões avulsos nas linhas.
- **Virtualização:** `Virtualize="true"` + `Height="55vh"` obrigatórios quando estimativa > 50 linhas.
- **Totalizadores:** Valores calculados complexos são exibidos via `FooterContent` (proibido linha fake no `Items`). Totalizadores de contagem simples (como "Total Registrado") são considerados redundantes por conta do Highlights Panel superior e são ocultados automaticamente no V2 pelo CSS global.
- **Dimensionamento de Colunas (v8+):** Proibido o atributo `Width` direto nas colunas (`PropertyColumn`, `TemplateColumn`). Use `<ColGroup>` com `<col style="width: ...px;" />` para larguras fixas e `<col />` para colunas flexíveis. Evita o aviso de compilação `MUD0002`.
- **Botões de Exportação:** Sempre que for criada uma funcionalidade de exportação de dados (seja em DataGrids ou barras de ações), **é obrigatório** utilizar o padrão de **Botão Único com Menu Cascata (Dropdown)**. O usuário deve ver um único botão de ação contendo a palavra "Exportar" com ícone de download e uma seta indicativa para baixo (`KeyboardArrowDown`). Ao clicar, deve ser aberto um `MudMenu` oferecendo as opções:
  1. **Excel (.xlsx)**: Gerado usando o assistente genérico `ExcelExportHelper.GenerateExcelBytes` (que utiliza ClosedXML).
  2. **CSV (.csv)**: Gerado usando o assistente `CsvExportHelper.GenerateCsvBytes` (que utiliza CsvHelper).
  Não duplique consultas ao banco de dados; a mesma coleção mapeada deve ser fornecida a ambos os métodos.

### 6.4. Estados de Componente

Todo componente deve tratar os quatro estados fundamentais. Nunca deixe um estado indefinido sem feedback visual.

**Loading** — desabilite o botão de ação e exiba indicador de progresso:

```razor
<MudButton Disabled="@_isSaving" OnClick="SalvarAsync">
    @if (_isSaving)
    {
        <MudProgressCircular Size="Size.Small" Indeterminate="true" Class="mr-2" />
    }
    @Loc["BotaoSalvar"]
</MudButton>
```

**Empty State** — exibir ícone e mensagem orientativa quando não houver dados:

```razor
@if (!_itens.Any())
{
    <MudStack AlignItems="AlignItems.Center" Class="pa-8">
        <MudIcon Icon="@Icons.Material.Filled.SearchOff" Size="Size.Large" Color="Color.Default" />
        <MudText Typo="Typo.subtitle1">@Loc["MensagemNenhumResultadoEncontrado"]</MudText>
        <MudButton Color="Color.Primary" OnClick="NovoRegistro">@Loc["BotaoNovo"]</MudButton>
    </MudStack>
}
```

**Error State** — mensagem clara com opção de tentar novamente:

```razor
@if (_erroCarregamento)
{
    <MudAlert Severity="Severity.Error" Class="ma-4">
        @Loc["MensagemErroCarregarDados"]
        <MudButton Size="Size.Small" OnClick="CarregarAsync">@Loc["BotaoTentarNovamente"]</MudButton>
    </MudAlert>
}
```

**Disabled State** — comunique o motivo visualmente via `HelperText` ou tooltip em formulários com lógica condicional.

### 6.5. Responsividade e Acessibilidade (WCAG 2.1 AA)

- Use classes responsivas do MudBlazor (`xs`, `sm`, `md`, `lg`).
- Contraste mínimo: **4,5:1** para texto normal; **3:1** para texto grande.
- Suporte completo à navegação por teclado (`Tab`, `Enter`, `Esc`). Não use `tabindex` com valores positivos.
- Foco visível: nunca remova `outline: none` sem fornecer substituto visível.
- **ARIA Labels:** Todo componente interativo sem texto visível descritivo deve ter `aria-label` ou `aria-describedby`.

```razor
<!-- Botão apenas com ícone: obrigatório ter aria-label -->
<MudIconButton Icon="@Icons.Material.Filled.Delete"
               aria-label="@Loc["LabelExcluirRegistro"]"
               OnClick="OnDeleteClick" />
```

- Roles e estados: componentes customizados devem declarar `role` ARIA e refletir seus estados (`aria-expanded`, `aria-disabled`, `aria-selected`).
- Campos com erro: o MudBlazor associa automaticamente a mensagem via `aria-describedby` quando se usa `HelperText` ou `Error`. Não crie mensagens de erro flutuantes desconectadas do campo.

### 6.6. Seletor de Inquilinos em Larga Escala (TenantSelector)

Para sistemas multi-tenant maduros e de alta escala, o seletor superior de ambiente de trabalho (`TenantSelector.razor`) deve seguir as seguintes premissas:
- **Pesquisa Inteligente (Autocomplete):** Obrigatório o uso de `MudAutocomplete<Tenant>` com filtragem local/em-memória ultra-rápida (in-memory) a partir de um único carregamento de dados. Isso viabiliza busca instantânea em listas com centenas de inquilinos.
- **Suporte a Inquilinos Inativos:** O seletor deve permitir a listagem e seleção de inquilinos inativos para fins de auditoria do Administrador de Sistemas.
- **Estilização de Inativos:** Itens inativos na lista devem possuir identificação visual explícita com redução de opacidade (`opacity: 0.6`), texto riscado (`text-decoration-line-through`), e a badge `[Inativo]` renderizada lateralmente por um `MudChip`.
- **Alerta Crítico de Contexto:** Se o inquilino selecionado for inativo, a barra de status superior de operação deve exibir destaque na cor vermelha (`Severity.Error`) com o aviso `[INATIVO]` para segurança operacional.
- **Prevenção do Conflito RZ9999:** Ao aninhar templates genéricos (como o `<ItemTemplate>` do Autocomplete) dentro de componentes que possuem parâmetro de contexto implícito (como o `<Authorized>` do `<AuthorizeView>`), deve-se declarar explicitamente o nome do parâmetro do filho: `<ItemTemplate Context="tenant">` para que o Blazor diferencie os contextos de renderização.

### 6.7. Contraste e Acessibilidade em Alertas de Erro

Alertas e caixas de erro de formulário crítico (como em `Login.razor`) devem possuir excelente legibilidade sob qualquer tela:
- **Evitar Contraste Falso:** Proibido utilizar `color: var(--mud-palette-error-text)` sobre fundos claros de erro (`var(--mud-palette-error-hover)`), pois essa variável de texto herda tons claros (branco/cinza) que se tornam ilegíveis.
- **Padrão de Cor:** Fixar uma cor escura de alto contraste e peso de fonte adequado, como o vermelho escuro oficial de marca do Salesforce (`#C23934`) com `font-weight: 600;`. Isso atende à especificação WCAG 2.1 AA de taxa mínima de contraste de cores (4.5:1).

### 6.8. Padrões de Navegação (Breadcrumbs) e Roteamento

Para garantir consistência visual de padrão Enterprise (Salesforce-like), eliminar duplicação de lógica de trilhas de navegação e evitar falhas de roteamento:
- **Centralização:** Nunca declare ou renderize o `MudBreadcrumbs` de forma avulsa nas páginas. Utilize sempre o `<SfPageHeader>` que gerencia isso automaticamente.
- **Navegação Orientada a Estado:** Utilize o serviço `IBreadcrumbService` para gerenciar a trilha de forma reativa.
- **Substituição Dinâmica:** Em páginas dinâmicas (como formulários de edição com GUIDs na URL), inicialize a rota com um título provisório ou genérico e atualize-o para o nome real da entidade assim que o carregamento assíncrono for concluído, chamando `BreadcrumbService.UpdateLastItemTitle(nomeEntidade)`.
- **Regra do Último Item (Auto-Enforced):** O último item da lista (representando a página atual) é automaticamente desabilitado (`Disabled="true"`) pelo `SfPageHeader` para evitar cliques circulares/redundantes e demarcar o local de trabalho atual.
- **Ícones Inteligentes:** O item 'Home' ou o primeiro item de toda trilha recebe automaticamente o ícone de Home, poupando declarações manuais.

#### 6.8.1. Alinhamento Estrito com o Menu Lateral (NavMenu.razor)
- **Sincronização de Hierarquia:** O breadcrumb pai intermediário e o subtítulo/legenda primária da página **devem corresponder exatamente** ao grupo no qual o item está aninhado no menu lateral.
- **Consistência de Chaves de Tradução:** Sempre use a mesma chave de tradução em ambos os lados para evitar divergências de rotulagem.
  - **Módulo de Cadastros:** Use `@Loc["MenuCadastros"]` (evite chaves genéricas como `LabelCatalog` ou `LabelSystemManagement`).
  - **Módulo de Gestão de Acessos:** Use `@Loc["MenuGestaoAcessos"]` (evite chaves genéricas como `LabelSettings` ou `LabelGovernance`).
  - **Módulo de Logística:** Use `@Loc["Modulo_Logistica"]` (evite chaves genéricas como `MenuLogistica`).
- **Nível Intermediário Obrigatório:** Páginas aninhadas dentro de grupos de menu complexos devem refletir o nível do grupo na trilha de breadcrumbs antes de exibir o nome da página atual.

#### 6.8.2. Múltiplas Diretivas de Rota (Alias de Rotas)
- **Prevenção de 404 (Páginas Órfãs):** Quando links legados, barras laterais ou botões de atalho referenciarem uma URL diferente do caminho físico real da página, **declare múltiplos atributos `@page` no topo do arquivo Razor**.
- **Exemplo de Alias:** Se o menu aponta para `/test-upload` mas a página reside fisicamente sob o subdiretório de sistemas, adicione ambas as rotas no topo do arquivo:
  ```razor
  @page "/sistemas/laboratorio-upload"
  @page "/test-upload"
  ```
  Isso garante retrocompatibilidade total e evita quebras de navegação ou redirecionamentos circulares.

#### 6.8.3. Diálogos Compartilhados entre Módulos (Ownership)

- **Regra de Origem:** Todo diálogo de visualização de entidade (View Dialog) **deve residir** no diretório `Dialogs/` do módulo proprietário da entidade (ex: `CRM/Dialogs/ClienteViewDialog.razor`). Outros módulos que precisarem exibir o mesmo diálogo devem referenciá-lo via `@using` do namespace do módulo de origem.
- **Proibido:** Criar cópias duplicadas do mesmo diálogo em módulos diferentes (ex: `Vendas/Dialogs/ClienteViewDialog.razor` vs `CRM/Dialogs/ClienteViewDialog.razor`).
- ✅ Correto: `@using Hotline.Components.Pages.CRM.Dialogs` + `DialogService.ShowAsync<ClienteViewDialog>(...)`.
- ❌ Incorreto: Criar um segundo `ClienteViewDialog.razor` em `Vendas/Dialogs/`.

### 6.9. Layout de Grids: Identificadores e Códigos

- **Regra de Identificadores em Grids:** Códigos de pedido (PED-ANO-000001), documentos (CNPJ/CPF), SKUs e outros identificadores alfanuméricos **nunca** devem quebrar em múltiplas linhas dentro de células de grid/data table.
- **Implementação Obrigatória:** Em todo `<MudLink>`, `<MudText>` ou `<MudTd>` que exiba um identificador, aplique:
  - `white-space: nowrap;` no estilo do elemento
  - Largura mínima da coluna de **180px** via `<ColGroup>` ou `Width`
- **Fim de Conteúdo com Scroll (Painéis Laterais):** Em painéis com `overflow-y: auto` e altura fixa (ex: painéis de detalhe mestre-detalhe), utilize `padding-bottom: 80px` combinado com `mask-image: linear-gradient(to bottom, black 95%, transparent 100%)` para criar um fade visual sutil que indica o fim natural da rolagem.

### 6.10. Code-Behind em Diálogos

- **Diálogos de Visualização Simples (View Only):** Diálogos que apenas exibem dados passados por parâmetro (sem realizar operações de persistência ou chamadas a serviços) **podem** usar code-behind inline (`@code { }`) sem herdar de `HotlineComponentBase`.
- **Diálogos com Ações (Create/Edit/Delete):** Devem herdar de `HotlineComponentBase` para acesso a `Logger`, `TenantProvider`, permissões e `Snackbar`.
- Esta distinção evita overhead desnecessário de injeção de dependências para diálogos de apenas visualização.

### 6.11. Gestão de Diretivas @using e @inject nos Componentes Razor

Para evitar redundâncias e manter o topo dos componentes Razor limpo e legível:
- **Priorize Imports Globais:** Qualquer namespace C# ou injeção de serviço de uso comum em múltiplos componentes deve ser declarado de forma centralizada no arquivo [_Imports.razor](file:///c:/Tony/OneDrive/Sistemas/novos/hotline/Components/_Imports.razor).
- **Proibido Redundâncias:** Nunca declare diretivas `@using` ou `@inject` locais nos arquivos `.razor` se elas já constarem no arquivo global `_Imports.razor` (como `Hotline.Models`, `MudBlazor`, `IStringLocalizer`, `NavigationManager`, etc.).
- **Quando usar localmente:** Apenas declare `@using` local se o namespace for exclusivo daquele componente (evitando poluir as importações globais com namespaces de uso único) ou para resolver conflitos de nomes (ambiguidades).

---

## 7. Design Tokens e Estilo

Nunca use cores, fontes ou espaçamentos hard-coded no CSS ou nos componentes Razor. Use sempre as variáveis de tema do MudBlazor mapeadas para os tokens do SLDS.

```csharp
var hotlineTheme = new MudTheme
{
    Palette = new PaletteLight
    {
        Primary          = "#0176D3",  // SLDS Brand Color
        Secondary        = "#1B96FF",  // SLDS Brand Accessible
        Success          = "#2E844A",
        Warning          = "#DD7A01",
        Error            = "#BA0517",
        Info             = "#0070D2",
        Background       = "#F3F3F3",
        Surface          = "#FFFFFF",
        AppbarBackground = "#0176D3",
    },
    Typography = new Typography
    {
        Default = new Default { FontFamily = new[] { "Salesforce Sans", "Arial", "sans-serif" } }
    }
};
```

- ✅ `Color="Color.Primary"` ou `var(--mud-palette-primary)`.
- ❌ `style="color: #0176D3"` ou classes CSS com valores de cor literal.
- Espaçamentos via classes utilitárias (`ma-`, `pa-`, `gap-`); não usar `margin`/`padding` inline.
- Proibido overrides globais e `!important`.
- Evite seletores de elemento puro (`button {}`, `input {}`); prefira classes explícitas.

---

## 8. Logging e Observabilidade

- Use **Serilog** + **Seq** para telemetria técnica.
- **Logs Técnicos:** Estruturados, em português brasileiro, com metadados (`TenantId`, `UserPerfilId`). Localize as mensagens via `SharedResources` (prefixo `Log_`).
- **Logs Estruturados (Metadata):** Sempre que possível, inclua metadados relevantes (IDs de entidades, SKUs, etc.) como objetos anônimos no log para facilitar a filtragem no **Seq**.
- **Proibido:** Expor `ex.Message` ou `ex.StackTrace` ao usuário; logue internamente e retorne mensagem localizada genérica.

### 8.1. Padrão Try-Catch em Services

```csharp
try
{
    // lógica
}
catch (Exception ex)
{
    _logger.LogError(ex, Loc["Log_ErroProcessamento"], new { TenantId = tenantId, Error = ex.Message });
    return Result.Failure(Loc["Msg_ErroInesperado"]);
}
```

### 8.1.1. Padrão Try-Catch em Componentes Razor (UI)

Em componentes que herdam de `HotlineComponentBase`, utilize o `Logger` e o `TenantId` injetados:

```razor
try
{
    await Servico.ExecutarAsync();
    Snackbar.Add(Loc["Msg_Sucesso"], Severity.Success);
}
catch (Exception ex)
{
    // Log técnico no Seq com metadados
    Logger.LogError(ex, Loc["Log_ErroProcessamento"], new { TenantId = TenantId, Error = ex.Message });
    
    // Snackbar amigável para o usuário (sem ex.Message)
    Snackbar.Add(Loc["Msg_ErroInesperado"], Severity.Error);
}
```

### 8.2. Níveis de Log

| Nível | Quando usar |
|:---|:---|
| `Information` | Fluxos principais de negócio (ex: "Pedido Faturado"). |
| `Warning` | Problemas não críticos (ex: "Tentativa de login inválida"). |
| `Error` | Falhas que impedem a conclusão de uma tarefa. |
| `Critical` | Falhas catastróficas (DB indisponível, falta de memória). |

### 8.3. Configuração Serilog (Program.cs)

Pacotes: `Serilog.AspNetCore`, `Serilog.Enrichers.Environment`, `Serilog.Enrichers.Process`, `Serilog.Enrichers.Thread`, `Serilog.Sinks.Seq`.

```csharp
Log.Logger = new LoggerConfiguration()
    .Enrich.FromLogContext()
    .Enrich.WithMachineName()
    .Enrich.WithEnvironmentName()
    .WriteTo.Console()
    .WriteTo.Seq("http://seq:5341")
    .CreateLogger();

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseSerilog();
```

- Configure sinks por ambiente (console em dev, Seq em staging/produção).
- Use `MinimumLevel.Override` para reduzir ruído de bibliotecas de terceiros.

### 8.4. Enriquecimento por Request

O `TenantLoggingMiddleware` injeta `TenantId` no contexto do Serilog automaticamente. Enriqueça também com `RequestId` e `CorrelationId` para rastreio entre serviços.

```csharp
public async Task InvokeAsync(HttpContext context)
{
    var tenantId = context.Request.Headers["X-Tenant-Id"].FirstOrDefault() ?? "unknown";
    using (Serilog.Context.LogContext.PushProperty("TenantId", tenantId))
    {
        await _next(context);
    }
}
```

Registre em `Program.cs` antes da autenticação:

```csharp
app.UseMiddleware<TenantLoggingMiddleware>();
app.UseAuthentication();
```

---

## 9. Segurança

### 9.1. Autorização e RBAC Granular

- Todas as páginas devem herdar de `HotlineComponentBase` para injeção padronizada de `SecurityService`, `Loc`, `Nav` e `AuthStateProvider`.
- Valide permissões por ação (Ler, Escrever, Excluir) no `OnInitializedAsync`. Usuário sem permissão de "Ler" deve ser redirecionado para `/nao-autorizado`.

```razor
@inherits HotlineComponentBase
@attribute [Authorize(Roles = "Sistemas, Administrador")]
```

```csharp
private bool _podeEscrever;
private bool _podeExcluir;

protected override async Task OnInitializedAsync()
{
    await base.OnInitializedAsync();

    if (UserPerfilId > 0)
    {
        if (!await HasPermissionAsync("NomeDoModulo", "Ler"))
        {
            Nav.NavigateTo("/nao-autorizado");
            return;
        }

        _podeEscrever = await HasPermissionAsync("NomeDoModulo", "Escrever");
        _podeExcluir  = await HasPermissionAsync("NomeDoModulo", "Excluir");
    }
}
```

- **Esconder:** `@if (_podeEscrever)` para botões de "Novo" / "Adicionar".
- **Desabilitar:** `Disabled="@(!_podeEscrever)"` em botões de salvar e itens de menu de edição.
- Nomes de módulos via `Loc["Modulo_NomeDoModulo"]` — nunca strings fixas.

### 9.2. Senhas e Criptografia

- Senhas: **BCrypt** com custo adequado. Proibido MD5, SHA1 ou texto puro.
- Validação: `BCrypt.Net.BCrypt.Verify(senhaDigitada, senhaHashed)`.
- Dados sensíveis (tokens, senhas de certificado): use `IEncryptionService` (AES-256 com IV aleatório por operação).
- Chaves em variáveis de ambiente ou `appsettings.Development.json` (gitignored). Nunca no `appsettings.json` base ou no repositório.

---

## 10. Estrutura de Pastas e Nomenclatura

### 10.1. UI

- `Components/Pages/Vendas/`
- `Components/Pages/Financeiro/`
- `Components/Pages/Cadastros/`
- `Components/Pages/Configuracoes/`

Nomenclatura de arquivos: `EntidadeList.razor`, `EntidadeEditor.razor`, `EntidadeDialog.razor`.

### 10.2. Backend (Services)

| Pasta | Conteúdo | Exemplos |
|:---|:---|:---|
| `Interfaces/` | Todas as interfaces (`I...Service`). | `IClienteService`, `IPedidoService` |
| `Core/` | Serviços de domínio e regras de negócio. | `PedidoService`, `ProdutoService` |
| `Infrastructure/` | Utilitários técnicos (Email, Arquivos, CEP). | `EmailService`, `FileService` |
| `Fiscal/` | Lógica tributária e validações de documentos. | `FiscalService` |
| `Marketplace/` | Integrações com plataformas externas. | `MarketplaceService` |
| `Security/` | Autenticação, Multi-tenancy e Permissões. | `AuthService`, `TenantService` |
| `Background/` | Workers e Hosted Services. | `MarketplaceTokenWorker` |
| `Calculators/` | Serviços especializados de cálculo complexo. | `OrderCalculatorService` |

---

## 11. Validação

- Use **FluentValidation** para regras complexas.
- Armazene os validadores em `Models/Validators/`.
- Mensagens de erro via chaves do `SharedResources`.

---

## 12. Enums e Constantes

- **Enums:** Use `[Display(Name = "LabelNoRecurso")]` quando o Enum precisar ser exibido em telas.
- **Magic Strings:** Proibido. Use classes de constantes para caminhos de API ou status fixos.

---

## 13. Imagens e Mídia

- **Proibido:** URLs externas aleatórias (ex: `picsum.photos`) em homologação/produção.
- **Padrão:** Imagens armazenadas no FileStorage do tenant para garantir persistência e performance.
- O sistema utiliza IA Generativa para criação de catálogo inicial (seeding); o armazenamento final deve seguir a regra acima.

---

## 14. Voz, Tom e Mensagens

### 14.1. Princípios

| Princípio | Correto | Errado |
|---|---|---|
| Direto e orientado à ação | "Informe um e-mail válido." | "Campo inválido." |
| Afirmativo no sucesso | "Registro salvo com sucesso." | "Operação concluída." |
| Específico no erro | "Não foi possível excluir: o registro possui dependências." | "Erro ao excluir." |
| Humano e sem jargão técnico | "Algo deu errado. Tente novamente." | "Exception: NullReference." |

### 14.2. Tom por Tipo de Mensagem

- **Sucesso:** Afirmativo, breve. Ex: "Cliente salvo com sucesso."
- **Erro de validação:** Instrução direta. Ex: "O CPF informado não é válido."
- **Erro de sistema:** Empático + ação. Ex: "Não conseguimos processar sua solicitação. Tente novamente ou entre em contato com o suporte."
- **Confirmação de exclusão:** Claro sobre a consequência. Ex: "Deseja excluir este registro? Esta ação não pode ser desfeita."
- **Tooltip / Helper Text:** Contextual, sem repetir o label. Ex: campo "CNPJ" → helper "Somente números, 14 dígitos."

### 14.3. Capitalização

- Mensagens completas: primeira letra maiúscula, ponto final.
- Labels de campo: capitalização de título (ex: "Data de Nascimento").
- Botões: imperativo, sem ponto (ex: "Salvar", "Cancelar", "Excluir").

---

## 15. Compatibilidade com SLDS 2 (Roadmap)

O SLDS 2 (Spring '25) prioriza CSS custom properties e desacopla estrutura de estilo visual. A migração não é obrigatória agora, mas o código deve ser escrito para não dificultar essa evolução.

- Não sobrescreva classes SLDS ou MudBlazor com CSS de escopo global; prefira escopo de componente.
- Proibido `!important`.
- Não crie tokens de cor fora do `MudTheme`.
- Evite seletores de elemento puro (`button {}`, `input {}`).

Seguindo essas regras, a migração futura se reduz a atualizar os valores no `MudTheme`, sem caçar overrides espalhados.

---

## 16. Background Jobs (Hangfire)

O processamento em segundo plano utiliza o Hangfire e deve seguir as seguintes diretrizes:

### 16.1. Armazenamento Dinâmico (Storage)
A configuração de armazenamento do Hangfire é feita no `appsettings.json` através da chave `HangfireSettings:StorageType`:
- `postgresql`: Persistência robusta no banco de dados principal PostgreSQL (Padrão).
- `memoria`: Persistência volátil (útil para testes ou ambientes efêmeros).

### 16.2. Observabilidade de Jobs
- **Hangfire Dashboard:** Acessível via rádio RBAC (Roles `Sistemas` ou `Administrador`).
- **Logs de Console:** Utilize a infraestrutura do `Hangfire.Console` para que os logs de execução apareçam na página de detalhes do Job no Dashboard.
- **Polling Interval:** Mantenha o `SchedulePollingInterval` em **15 segundos** (padrão) para evitar overhead desnecessário em modo produção.

### 16.3. Registro e Parametrização de Tarefas Recorrentes
- **Configuração Obrigatória:** Todo Worker ou tarefa recorrente deve ter seus parâmetros (especialmente o intervalo de execução) definidos no `appsettings.json`, dentro da seção `HangfireSettings`. 
- **Padrão:** O `Program.cs` deve ler esses valores via `IOptions<HangfireSettings>` para registrar o Job. Jamais use valores "chumbados" (hardcoded) para intervalos de tempo.
- **Recarga em Tempo Real (Workers/BackgroundServices):** Para assegurar que alterações no `appsettings.json` reflitam instantaneamente em tempo de execução sem reiniciar a aplicação, é **obrigatório** que os `BackgroundService` consumam essas configurações injetando `IOptionsMonitor<T>` em vez de `IConfiguration` ou `IOptions<T>`. Utilize a propriedade `.CurrentValue` a cada iteração do loop para obter os intervalos de execução e parâmetros mais atualizados.
- **Registro:** O registro deve ser feito após o build da aplicação, utilizando o `IRecurringJobManager`.

---

## 17. Hotline Help Center (Contextual)

O sistema de ajuda contextual permite que o usuário receba orientações específicas baseadas na funcionalidade que está utilizando no momento.

### 17.1. Funcionamento
- **Gatilho:** O ícone `?` no `SfPageHeader` dispara o `HotlineHelpDrawer`.
- **Contexto:** A chave de contexto é baseada na rota relativa (ex: `vendas/pedidos`).
- **Persistência:** O conteúdo é carregado do banco de dados (tabela `ajuda_contextual`).

### 17.2. Criação de Conteúdo (Admin)
- Utilize a tela `/admin/ajuda` para gerenciar os textos.
- **Editor:** O sistema utiliza o **Syncfusion Rich Text Editor**.
- **Padrão Visual:** Mantenha títulos em `<h1>` ou `<h2>`, use listas para passos e `<b>` para nomes de campos/botões.
- **Imagens:** Devem ser salvas no diretório `help-images/` via serviço de arquivos do tenant.

### 17.3. Mapeamento de Rota e Coincidência com o Banco (Importante)

- **Regra de Ouro:** O banco de dados **deve sempre refletir a rota real** do sistema (a URL da página). O mapeamento correto é o caminho físico da rota. Quaisquer divergências devem ser ajustadas prioritariamente no banco de dados para que os registros em `ajuda_contextual` tenham a mesma chave do caminho real da URL.
- **Funcionamento Automático:** Por padrão, o `SfPageHeader` infere o contexto de ajuda com base na rota relativa da URL (ex: `/clientes` resulta na chave `clientes`, `/sistemas/saude` resulta em `sistemas/saude`). Ao manter as chaves no banco idênticas a essas rotas reais, nenhuma configuração manual é necessária nas páginas.
- **Uso do CustomContext:** A propriedade `CustomContext` no componente `SfPageHeader` deve ser utilizada apenas em cenários de exceção extrema (ex: modais, abas dinâmicas ou fluxos complexos na mesma página física onde se deseja exibir conteúdos de ajuda distintos). 

  ```razor
  <SfPageHeader Icon="@Icons.Material.Filled.People" 
                Title="@Loc["MenuClientes"]" 
                BreadcrumbItems="_breadcrumbItems"
                CustomContext="ajuda-customizada-exemplo">
  ```

---

## 18. Política de Migração e Dump de Dados (Zero Loss)

- **Regra de Ouro:** Sempre que uma nova tabela ou campo for adicionado ou modificado no banco de dados, a sua persistência deve ser prevista de forma mandatória tanto no mecanismo de exportação (`DumpDatabaseToJsonAsync`) quanto no de restauração (`RestoreDatabaseFromJsonAsync`) dentro do `SeedDataService.cs`. Isso assegura que o estado do banco de dados possa ser reiniciado, migrado ou restaurado de maneira íntegra sem qualquer perda de informações.

---

## 19. Resiliência de APIs (Polly) e Criptografia de Dados Sensíveis

### 19.1. Isolamento de Clientes HTTP e Circuit Breaker por Canal (Polly)
Chamadas de integração ou consultas de APIs externas (como ViaCEP, BrasilAPI, Nominatim ou APIs de marketplaces) devem sempre utilizar **Typed Clients** (Clientes HTTP Tipados) específicos e isolados em vez de compartilhar o cliente padrão genérico (`AddHttpClient("")`).
- 🛑 **PROIBIÇÃO DE CIRCUIT BREAKER GLOBAL:** Nunca aplique um Circuit Breaker agressivo no `HttpClient` genérico padrão. Caso contrário, se uma única API de terceiros (como o ViaCEP) falhar, o circuito global se abrirá e bloqueará silenciosamente e por efeito dominó todas as chamadas de outros microsserviços integrados perfeitamente funcionais (como Mercado Livre ou Shopee).
- ✅ **ESTRATÉGIA PARA CEP/UX RÁPIDA (Fast-Fail):**
  - **Timeout curto:** Limite cada requisição de busca de CEP em no máximo `10 segundos` para manter boa experiência do usuário.
  - **Retentativas Rápidas:** Use retentativas curtas (ex: `300ms`, `800ms`, `2s`) para instabilidades transitórias de rede.
  - **Circuit Breaker Isolado:** Configure o Circuit Breaker para abrir após `3 falhas consecutivas` por `15 segundos`. Isso assegura que, em caso de queda de uma API, as chamadas subsequentes falhem instantaneamente (fast-fail), permitindo que o sistema caia rapidamente nas rotas de fallback internas (`ViaCEP` -> `BrasilAPI V1` -> `BrasilAPI V2` -> `Nominatim/OSM`) sem travar a interface da tela.

### 19.2. Criptografia de Credenciais (DPAPI) em Migrações e Seeds
Os dados sensíveis armazenados pelo sistema (como senhas de certificados ou chaves de integração de inquilinos) são criptografados de forma transparente via **Data Protection (DPAPI)** do ASP.NET Core.
- 🛑 **ERRO DE CRIPTOGRAFIA EM SEEDS E RESTORES:** A criptografia DPAPI depende de chaves físicas armazenadas no ambiente local do servidor (`DataProtection-Keys`). Ao realizar uma carga de dados (restauração de dump JSON com `--load-data` ou banco semeado de outra máquina), as chaves criptográficas não serão idênticas. Qualquer tentativa de descriptografia resultará na exceção `CryptographicException` e retornará valores nulos ou vazios no sistema.
- ✅ **AÇÃO RECOMENDADA:** É mandatório prever fluxos de tratamento seguro e logs amigáveis para essa indisponibilidade física. Para restabelecer o funcionamento, o desenvolvedor ou administrador do inquilino deve realizar o recadastro das credenciais/certificados através do painel administrativo no novo ambiente, gerando uma nova assinatura e criptografia com as chaves válidas locais.

---

## 20. Git e Commits

### 20.1. Formato de Mensagem (Conventional Commits)

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

**Types permitidos:**
| Type | Uso |
|------|-----|
| `feat` | Nova funcionalidade |
| `fix` | Correção de bug |
| `docs` | Documentação (apenas) |
| `style` | Formatação, espaçamentos (sem mudança de código) |
| `refactor` | Refatoração sem mudança de comportamento |
| `perf` | Melhoria de performance |
| `test` | Adicionar/ corrigir testes |
| `chore` | Tarefas de manutenção (deps, configs) |
| `i18n` | Atualização de localização/resx |

**Exemplos:**
```
feat(clientes): adicionar campo data de nascimento
fix(pedidos): corrigir cálculo de imposto para MEI
i18n: adicionar chaves de tradução para módulo fiscal
```

### 20.2. Tamanho do PR

- **Máximo:** 400 linhas alteradas
- **Exceção:** PRs gerados por migrações automáticas do EF Core
- **Regra:** Um PR deve resolver UMA coisa (feature, bug fix, refatoração)

### 20.3. Checklist pré-commit

- [ ] Código segue regras do development.md
- [ ] Rodou `dotnet build` sem erros
- [ ] Rodou `dotnet test` (se aplicável)
- [ ] Atualizou .resx para novos textos (pt-BR, en-US, es-ES)
- [ ] Commits atômicos (não misturar feat + fix + refactor)

---

## 21. Instruções Específicas para Assistente IA (Cline)

### 21.1. Antes de qualquer tarefa

1. **Leia este documento inteiro** antes de gerar código
2. **Consulte a Quick Reference** para regras essenciais
3. **Verifique os Anti-Padrões** para evitar erros conhecidos

### 21.2. Durante a codificação

| Ao fazer | Consulte seção |
|----------|----------------|
| Criar nova entidade | §§ 2 (Modelos), 3.2 (Chaves compostas) |
| Criar service | §§ 1 (Arquitetura), 8.1 (Try-Catch) |
| Criar página Blazor | § 6 (UI/UX) |
| Adicionar texto na UI | § 5 (Localização) |
| Query no banco | § 3 (Persistência, AsNoTracking) |
| Update no banco | §§ 3.3 (Proteção TenantId), 3.4 (Sincronização) |
| Adicionar validação | § 11 (FluentValidation) |
| Adicionar permissão | § 9.1 (RBAC) |
| Adicionar background job | § 16 (Hangfire) |

### 21.3. Formato de resposta

- **Código:** sempre mostrar diff antes de aplicar
- **Explicações:** breves, objetivas, referenciando a seção do documento
- **Dúvidas:** se uma regra não estiver clara, pergunte antes de prosseguir

---

## 22. Checklist de Qualidade (Antes do Commit)

### 22.1. Backend (.cs)

- [ ] Service injeta ILogger no construtor
- [ ] Entidade IMultiTenant tem chave primária composta (TenantId, Id)
- [ ] Update usa mapeamento manual, não `context.Update()`
- [ ] Novos itens em coleção têm `EntityState.Added` forçado
- [ ] Query de leitura tem `.AsNoTracking()`
- [ ] Query de edição NÃO tem `.AsNoTracking()`
- [ ] Decimal tem `.HasPrecision()` (não `.HasColumnType`)
- [ ] Try-catch loga erro e retorna `Result.Failure`
- [ ] `context.Add()` limpa navigation properties para entidades existentes
- [ ] `catch` de SaveChanges detecta `PostgresException SqlState == "23505"` para unique constraints

### 22.2. Frontend (.razor)

- [ ] Textos via `@Loc["Chave"]` (zero hardcoding)
- [ ] MudBlazor usa `Variant.Outlined` + `Margin.Dense`
- [ ] MudGrid com `Virtualize="true"` + `Height="55vh"` para >50 linhas
- [ ] Botões de ação usam `MudMenu` com ícone `MoreVert`
- [ ] Estados tratados: Loading, Empty, Error, Disabled
- [ ] `MudTabs` com `Elevation="0" Rounded="false"`
- [ ] Identificadores com `white-space: nowrap` e coluna ≥ 180px
- [ ] Diálogos compartilhados usam módulo de origem (Ownership)

### 22.3. Banco de Dados (Migration)

- [ ] Nomes em snake_case (tabelas, colunas, constraints)
- [ ] Collation `icu_ci_ai` em colunas string
- [ ] Constraints com no máximo 63 caracteres, sem aspas duplas
- [ ] Índices compostos liderados por `TenantId`
- [ ] Unique constraints incluem `TenantId`

## 23. Padrões de UI/UX e Design Premium (Hotline Aesthetics)

Para garantir que o sistema não pareça um formulário genérico e alcance um nível premium (Aesthetics), todas as interfaces criadas (Dashboards, Painéis, Cards) devem seguir estas regras visuais, complementando os guias do `frontend-specialist`:

- **Design de Tickets/Cards (`MudPaper`):** Para destacar informações vitais ou resultados de simulações, evite `<div>` cinzas ou sem bordas. Utilize `<MudPaper Elevation="2">` com `border-radius` arredondado (ex: `16px`) para criar a ilusão de um cartão flutuante.
- **Micro-interações (`.hover-lift`):** Elementos interativos como atalhos e cartões de resultados devem possuir feedback visual ao passar o mouse. Utilize ou crie classes CSS (como `hover-lift` que aplica `transform: translateY(-5px)` e um leve `box-shadow`) para que a tela pareça "viva".
- **Indicadores de Status Dinâmicos:** Esqueça componentes estáticos grandes (`MudAlert`) para indicar o status de conexões contínuas (ex: Sefaz, Certificado). Substitua-os por componentes minimalistas com "Pulse Effects" (pequenos pontos piscantes via CSS `animation: pulse`) e badges sutis.
- **Watermarks (Marcas D'água):** Painéis importantes ficam mais elegantes com a inclusão de ícones grandes (`font-size: 140px`) posicionados de forma absoluta no canto inferior com opacidade super baixa (ex: `opacity: 0.05`), quebrando a monotonia do fundo.
- **Respiro no Grid (White Space):** Formulários não devem ser espremidos para caber na mesma linha. Evite colunas `md="1"`. Divida os campos do `MudGrid` logicamente em múltiplas linhas, agrupando Origem/Valores em uma linha e Natureza/Tipos em outra linha. O respiro melhora a clareza e diminui o cansaço cognitivo do usuário.

---


---

*Este documento é a fonte de verdade para padrões de desenvolvimento no projeto Hotline ERP.*

---

## 24. Padrões ServerData e Serviços Paginados (MudDataGrid)

> Regras derivadas de bugs reais encontrados durante desenvolvimento. Leia antes de criar qualquer tela de listagem.

### 24.1. Regra Crítica — NUNCA use `Items=` em grids de listagem

`Items=` + `Virtualize` dá ilusão de performance mas ainda carrega todos os registros via `ListarTodosAsync()`. Em Blazor Server isso causa Memory Leaks cumulativos por circuito WebSocket.

```razor
<!-- ❌ PROIBIDO -->
<MudDataGrid T="Pedido" Items="@_pedidos" QuickFilter="@_quickFilter" Virtualize="true" Height="55vh">

<!-- ✅ CORRETO -->
<MudDataGrid T="Pedido" ServerData="ServerReload" @ref="_grid">
    <PagerContent><MudDataGridPager T="Pedido" /></PagerContent>
</MudDataGrid>
```

### 24.2. Assinatura obrigatória do ServerReload (CancellationToken)

O MudBlazor 8+ exige `CancellationToken` como segundo parâmetro. Sem ele o build falha com `CS0123`.

```csharp
// ❌ ERRADO — falha no MudBlazor 8+
private async Task<GridData<T>> ServerReload(GridState<T> state)

// ✅ CORRETO
private async Task<GridData<T>> ServerReload(GridState<T> state, CancellationToken token)
```

### 24.3. Padrão completo de implementação

```csharp
private MudDataGrid<T>? _grid;
private bool _loading = true;
private string _searchString = "";
private int _totalItems = 0;

private async Task<GridData<T>> ServerReload(GridState<T> state, CancellationToken token)
{
    _loading = true;
    try
    {
        var sortField = state.SortDefinitions.FirstOrDefault()?.SortBy ?? "Nome";
        var sortDesc  = state.SortDefinitions.FirstOrDefault()?.Descending ?? false;
        var result = await Service.ObterPaginadoAsync(
            state.Page, state.PageSize, _searchString, sortField, sortDesc);
        _totalItems = result.TotalCount;
        return new GridData<T> { Items = result.Items, TotalItems = result.TotalCount };
    }
    catch (Exception ex)
    {
        Logger.LogError(ex, Loc["Log_ErroProcessamento"], new { Error = ex.Message });
        Snackbar.Add(Loc["Msg_ErroCarregarDados"], Severity.Error);
        return new GridData<T> { Items = [], TotalItems = 0 };
    }
    finally { _loading = false; }
}

private async Task ReloadGrid() { if (_grid != null) await _grid.ReloadServerData(); }
private async Task OnSearch(string value) { _searchString = value; await ReloadGrid(); }
```

No markup, use `DebounceInterval` em vez de `Immediate="true"` (Immediate dispara por tecla = uma query por caractere):
```razor
<MudTextField DebounceInterval="400" OnDebounceIntervalElapsed="OnSearch" />
```

### 24.4. Sincronia obrigatória: Implementação + Interface

Todo método novo em `*Service.cs` deve ser declarado na interface `I*Service.cs` simultaneamente. Erros `CS1061` nas Razor pages são sempre por falta dessa sincronia.

```
[ ] FooService.cs   — implementação
[ ] IFooService.cs  — declaração na interface
[ ] Razor page      — ServerReload chamando o método
```

### 24.5. Armadilha de naming em DTOs

DTOs têm nomes de propriedades que podem diferir das entidades. Abra sempre o arquivo do DTO antes de escrever projeções.

| DTO | Propriedade correta | Erro comum |
|-----|---------------------|------------|
| `TransportadoraDto` | `CNPJ` (maiúsculo) | `Cnpj` |
| `TransportadoraDto` | `Ativa` | `Ativo` |
| `FornecedorDto` | `Ativo` | `Ativa` |

### 24.6. `record` posicional vs. class com inicializador

```csharp
// Se o DTO for: public record ProdutoListDto(Guid Id, string Sku, string Nome, ...);

// ❌ ERRADO — record posicional não suporta inicializador de objeto
new ProdutoListDto { Id = x.Id, Nome = x.Nome }

// ✅ CORRETO — use o construtor posicional
new ProdutoListDto(x.Id, x.Sku, x.Nome, ...)
```

### 24.7. ILike em propriedades de navegação

Nunca use `EF.Functions.ILike` em campos de entidades relacionadas sem `.Include()` prévio.

```csharp
// ❌ ERRO — NomeCliente não existe na tabela pedidos
query.Where(x => EF.Functions.ILike(x.NomeCliente, $"%{s}%"))

// ✅ CORRETO — Include antes do Where
var query = context.Pedidos
    .Include(x => x.Cliente)
    .AsNoTracking()
    .AsQueryable();

query = query.Where(x =>
    EF.Functions.ILike(x.CodigoPedido, $"%{s}%") ||
    (x.Cliente != null && EF.Functions.ILike(x.Cliente.RazaoSocial, $"%{s}%")));
```

### 24.8. Checklist de nova tela de listagem

```
[ ] MudDataGrid usa ServerData= (não Items=)
[ ] ServerReload tem CancellationToken como 2º parâmetro
[ ] <PagerContent><MudDataGridPager> presente
[ ] MudTextField usa DebounceInterval (não Immediate)
[ ] Refresh usa _grid.ReloadServerData()
[ ] Serviço tem ObterPaginadoAsync declarado também na interface
[ ] DTOs verificados: nomes exatos conferidos no arquivo .cs do DTO
[ ] NoRecordsContent dentro do grid (não bloco if/else externo ao grid)
[ ] _loading = false obrigatoriamente no bloco finally
[ ] Highlights panel mostra _totalItems (não _lista.Count)
```

---

# Padrões de Documentação - Hotline ERP
## Diretrizes para IAs e Desenvolvedores

### PADRÃO OURO DE DOCUMENTAÇÃO OBRIGATÓRIA (C# e .razor)

Se você é uma IA assistente (Cline, Roo Code, Copilot, etc.) e está lendo este arquivo, SIGA ESTAS REGRAS OBRIGATORIAMENTE para todos os arquivos:

---

## REGRA 1: Comentários XML em C#

### Para interfaces (.cs):
- **remarks**: Adicionar `<remarks>` com a descrição clara das responsabilidades da interface e suas dependências.
- **param**: Adicionar `<param>` para CADA parâmetro de todos os métodos.
- **returns**: Adicionar `<returns>` para CADA retorno de todos os métodos.
- **exception**: Adicionar `<exception>` para todas as exceções possíveis.
- **example**: Adicionar `<example>` obrigatoriamente para métodos complexos (com mais de 3 parâmetros ou regras de negócio).

### Para classes e métodos (.cs):
- **summary**: Garantir que TODA classe pública e TODO método público tenha `<summary>` descrevendo seu propósito.
- **param / returns**: Garantir que todo método público tenha `<param>` para cada parâmetro e `<returns>` descrevendo o retorno.
- **properties**: Garantir que todas as propriedades públicas tenham `<summary>` descrevendo o que armazenam e o formato esperado.
- **exception**: Adicionar `<exception>` quando aplicável.

### Exemplo que TODAS as IAs devem seguir:
```csharp
/// <summary>
/// Interface para o serviço de cálculo de impostos federais e estaduais.
/// </summary>
/// <remarks>
/// Esta interface é consumida pela camada de faturamento e depende de <see cref="IMatrizFiscalService"/> para obter as alíquotas.
/// </remarks>
public interface ICalculadorImpostoService
{
    /// <summary>
    /// Calcula o imposto ICMS sobre um valor de venda.
    /// </summary>
    /// <param name="valor">Valor da venda (deve ser maior que zero).</param>
    /// <param name="ufOrigem">UF de origem da mercadoria.</param>
    /// <param name="ufDestino">UF do destinatário (SP, RJ, ES, etc.).</param>
    /// <returns>Valor do ICMS calculado.</returns>
    /// <exception cref="ArgumentException">Lançada quando valor <= 0 ou UF inválida.</exception>
    /// <example>
    /// <code>
    /// var calculador = container.Resolve<ICalculadorImpostoService>();
    /// var valorIcms = calculador.CalcularICMS(1500.00m, "SP", "RJ");
    /// </code>
    /// </example>
    decimal CalcularICMS(decimal valor, string ufOrigem, string ufDestino);
}
```

---

## REGRA 2: Cabeçalho em arquivos .cs

### Ao CRIAR um novo arquivo .cs ou MODIFICAR um existente:
Se não houver cabeçalho no topo, ADICIONE (e se já tiver, preserve-o):
```csharp
// ==========================================
// ARQUIVO: NomeDoArquivo.cs
// MÓDULO: Fiscal|Logistica|Vendas|Cadastros|Core
// PROPÓSITO: [Uma frase clara descrevendo o propósito do arquivo]
// CRIADO EM: [AAAA-MM-DD] (Formato ISO)
// ==========================================
```

---

## REGRA 3: Cabeçalho em arquivos .razor

### Ao CRIAR um novo arquivo .razor ou MODIFICAR um existente:
Se não houver cabeçalho no topo, ADICIONE (e se já tiver, preserve-o):
```razor
@* 
    COMPONENTE: NomeDoComponente
    MÓDULO: Fiscal|Logistica|Vendas|Cadastros|Core
    ROTA: @page "/caminho" (se aplicável)
    PROPÓSITO: [Descrição do que o componente faz]
    DEPENDÊNCIAS: [Serviços injetados]
    CRIADO EM: [AAAA-MM-DD] (Formato ISO)
*@
```

---

## REGRA 4: Quando NÃO documentar (exceções)

NÃO adicione comentários XML em:
- Arquivos de teste (*.Tests.cs) - a menos que o método seja muito complexo
- Migrations do EF Core (pasta Migrations/)
- Arquivos gerados automaticamente (ex: *.Designer.cs)
- Propriedades autoimplementadas triviais (Id, Nome simples, DataCadastro)

---

## REGRA 5: Prioridade de documentação

Sempre documente nesta ordem:
1. Services/Fiscal/ (prioridade máxima)
2. Services/ (todos os serviços)
3. Models/Entities/ (entidades do banco)
4. Components/Pages/ (telas)
5. Controllers/ (se existir)

---

## REGRA 6: Regras de aprovação para IAs

**NÃO peça aprovação do usuário para:**
- Adicionar cabeçalhos em arquivos novos
- Adicionar comentários XML
- Adicionar exemplos em comentários
- Corrigir formatação de documentação existente

**PEÇA aprovação APENAS para:**
- Mudanças na lógica de negócio
- Alterações no comportamento do sistema
- Remoção de código existente

---

## REGRA 7: Idioma e estilo

- Todos os comentários devem ser em **PORTUGUÊS**
- Use primeira letra maiúscula e ponto final
- Seja específico, não genérico
- Explique "POR QUÊ", não apenas "O QUÊ"

---

## REGRA 8: Exemplos obrigatórios

Para métodos que contenham regras de negócio complexas (mais de 10 linhas), SEMPRE inclua um exemplo:

```csharp
/// <example>
/// // Emitir NF-e para um cliente em SP
/// var resultado = await _fiscalService.EmitirNFE(
///     pedidoId: 123,
///     cliente: cliente,
///     produtos: listaProdutos
/// );
/// </example>
```

---

## REGRA 9: Verificação automática

Após finalizar a documentação de um arquivo, verifique:
- [ ] Cabeçalho presente (arquivos .cs e .razor novos)
- [ ] Toda classe pública tem summary
- [ ] Todo método público tem summary + params + returns
- [ ] Exceções documentadas

---

## REGRA 10: Comportamento esperado da IA

Ao receber um comando para criar ou modificar código, você DEVE:
1. Automaticamente adicionar cabeçalhos conforme REGRA 2 ou 3
2. Automaticamente adicionar comentários XML conforme REGRA 1
3. NÃO perguntar "devo adicionar comentários?" - apenas FAZER
4. Seguir as prioridades da REGRA 5


## 🤖REGAR 11: Diretrizes para o Cline e DeepSeek V4

### 1. Gestão de Contexto e Performance (Anti-Lentidão)
* **Escopo de Leitura:** NUNCA tente ler, indexar ou buscar arquivos dentro das pastas `bin/`, `obj/`, `.vs/` ou `.git/`. Elas contêm metadados gerados pelo compilador do Blazor que travam a memória do VS Code e do CodeCompress MCP.
* **Modelo Adequado:** 
  * Use o **DeepSeek V4 Flash (Non-think)** para tarefas visuais, HTML Razor, CSS/Tailwind e alterações simples de CRUD.
  * Use o **DeepSeek V4 Pro (Think High/Max)** estritamente para refatorações complexas de C#, depuração de erros de compilação ou queries pesadas do EF Core.

### 2. Padrões de Código Blazor / .NET
* **Abordagem Code-Behind:** Para componentes com lógica complexa de C#, prefira criar classes parciais (`NomeComponente.razor.cs`) em vez de inflar a tag `@code { ... }` dentro do arquivo `.razor`. Isso mantém a renderização visual separada da lógica e economiza memória de análise do VS Code.
* **Concisão Absoluta:** Vá direto ao ponto. Escreva código Blazor limpo, tipado e com injeção de dependência correta. Evite explicações teóricas sobre o ciclo de vida do .NET (como `OnInitialized`), a menos que seja explicitamente solicitado.

### 3. Fluxo de Trabalho com Terminal
* Se o código Blazor gerado apresentar erros de sintaxe ou compilação, use as ferramentas de terminal para rodar `dotnet build`. Leia o erro do compilador e corrija o código imediatamente antes de reportar ao usuário.

## FIM DAS INSTRUÇÕES PARA IAs