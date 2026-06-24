# ERROS E RECUPERAÇÃO — REGRAS

## 🔁 LOOP DE ERROS (REGRA MAIS IMPORTANTE)

Se o mesmo erro aparecer **2 vezes seguidas**:
1. **PARE.** Não tente uma terceira correção automática.
2. Mostre ao usuário: o erro exato + o que já foi tentado + hipótese da causa raiz
3. Aguarde instrução antes de continuar

---

## ✅ PROTOCOLO DE SEGURANÇA PARA EDIÇÃO DE ARQUIVOS

Para **TODA** edição de arquivo (replace_in_file ou write_to_file), seguir este checklist:

### Pré-edição (obrigatório)
1. **Ler o arquivo primeiro** com `read_file` — SEMPRE
2. **Verificar encoding:** se vier com caracteres corrompidos (ex: `injeo`), usar fallback `Get-Content` no PowerShell
3. **Git checkpoint** se editando arquivo > 100 linhas: `git diff --stat` para ver se há mudanças não commitadas

### replace_in_file (PADRÃO — safe-edit desativado)
1. SEARCH block deve copiar o texto EXATO do read_file, respeitando espaçamento, aspas, quebras de linha
2. **NÃO incluir marcadores de linha** do read_file (ex: `42 | `)
3. **Blocos pequenos:** Manter SEARCH/REPLACE com < 15 linhas para garantir casamento exato
4. **Indentação e quebras de linha:** Copiar exatamente do read_file — espaços, tabs, \r\n
5. **Após 2 falhas consecutivas:** Re-ler o arquivo com read_file antes de tentar novamente — o estado pode ter mudado
6. Após aplicar com sucesso, **reler o arquivo** para confirmar que a edição foi aplicada corretamente
7. Preferir múltiplos SEARCH/REPLACE blocks em uma única chamada, na ordem em que aparecem no arquivo

### write_to_file (SOMENTE para arquivos novos ou < 50 linhas)
- **NUNCA** usar write_to_file em arquivos > 50 linhas existentes — risco de truncamento
- Para grandes reestruturações, usar edit_text do safe-edit com múltiplos searches

### Pós-edição (obrigatório)
1. **Sempre reler** o arquivo editado com `read_file`
2. Confirmar que nenhum conteúdo foi perdido (comparar com versionamento mental do antes/depois)
3. Se detectar perda de conteúdo, executar `git checkout -- <arquivo>` imediatamente para restaurar

> Loop de 3+ tentativas automáticas desperdiça mais tokens do que qualquer outra coisa.

---

## 🔨 BUILD COM ERROS

Ao ler o `build.log` com falha:

1. Identifique **todos** os erros de uma vez (não corrija um por um)
2. Agrupe por tipo: CS*, EF*, configuração, dependência
3. Proponha as correções em lote antes de aplicar qualquer uma
4. Após corrigir, rode o build novamente e compare com o log anterior

---

## 🚫 ANTI-PADRÕES DE RECUPERAÇÃO

| ❌ Não faça | ✅ Faça |
|-------------|---------|
| Tentar a mesma correção com variação mínima | Mudar a abordagem completamente |
| Criar arquivo novo para contornar erro de compilação | Corrigir a causa raiz |
| Adicionar `#pragma warning disable` | Resolver o warning |
| Comentar código que falha | Entender por que falha |
| Assumir que o erro sumiu sem reler o log | Sempre confirmar com `Get-Content build.log -Tail 20` |

---

## 🗄️ REGRA ABSOLUTA: NENHUM DROP OU RECRIAÇÃO DE TABELA SEM AUTORIZAÇÃO

**Nenhuma migration, script SQL, ou comando DDL pode:**
- `DROP TABLE`, `DROP VIEW`, `DROP SCHEMA`, `DROP INDEX`, `DROP CONSTRAINT`
- **Recriar tabela que já contém dados** (ex: `EnsureCreated()`, `Database.EnsureDeleted()`)
- Executar qualquer comando que destrua dados existentes

**Sempre verificar no banco antes de criar migration destrutiva:**
```sql
SELECT relname, n_live_tup FROM pg_catalog.pg_stat_all_tables WHERE schemaname = 'public' ORDER BY relname;
```
Se `n_live_tup > 0` para a tabela, **nunca** recriá-la.

### O que fazer em vez disso:
1. **Criar migration com `Alter()`/`AddColumn()`** — nunca remover colunas ou tabelas
2. **Renomear com `RenameColumn()`/`RenameTable()`** — preserva dados originais
3. **Marcar como obsoleto no código** — adicionar `[Obsolete]` em vez de deletar
4. **Sugerir ao usuário** — apresentar a análise e perguntar se pode excluir

### Exceções (autorização já concedida):
- Nenhuma — sempre perguntar primeiro.

### Sanção:
- Se uma migration com DROP ou recriação for executada sem aprovação, o usuário pode perder dados irreversivelmente.
- Se isso ocorrer, pare imediatamente, informe o usuário e aguarde instruções.

---

## 📋 ERROS CONHECIDOS DO PROJETO

| Erro | Causa | Solução |
|------|-------|---------|
| `CS0123` no ServerReload | Falta `CancellationToken` como 2º parâmetro | `ServerReload(GridState<T> state, CancellationToken token)` |
| `DbUpdateConcurrencyException` | Novo item sem `EntityState.Added` | Forçar `context.Entry(entity).State = EntityState.Added` |
| `23505 PostgresException` | Violação de unique constraint | Detectar `SqlState == "23505"` no catch e retornar mensagem localizada |
| `CS1061` em Razor page | Método novo não declarado na interface | Declarar em `I*Service.cs` simultaneamente |
| Logs sumindo no Seq | `ILogger` omitido no construtor ServiceBase | `: base(contextFactory, loc, logger)` obrigatório |

---

## 💬 COMUNICAÇÃO DE ERROS AO USUÁRIO

- Erro técnico → `Logger.LogError(ex, "mensagem técnica em PT")` + `Result.Failure(Loc["Msg_ErroGenerico"])`
- Nunca exibir `ex.Message` na UI
- Snackbar de erro: `Snackbar.Add(res.Error, Severity.Error)`
