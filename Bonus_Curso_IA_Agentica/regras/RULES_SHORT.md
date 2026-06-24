```markdown

\# 📌 Regras Resumidas — Cline



> Use esta versão para consulta rápida. Para a versão completa, veja `CLINE\_CUSTOM\_INSTRUCTIONS.md`.



\---



\## 🧠 REGRAS DE OURO (Top 10)



1\. \*\*Multi-Tenant:\*\* Toda entidade → chave composta `(TenantId, Id)`.

2\. \*\*NUNCA\*\* use `context.Update()` → use mapeamento manual.

3\. \*\*Sempre\*\* rode `dotnet build` após alterações.

4\. \*\*Plan-and-Review:\*\* Planeje antes de agir. Espere aprovação.

5\. \*\*NUNCA\*\* leia `bin/`, `obj/`, `.vs/`, `.git/`, `node\_modules/`.

6\. \*\*Frontend:\*\* MudBlazor → \*\*sem CSS manual\*\*.

7\. \*\*Injeção de Dependência:\*\* Use interfaces, nunca classes concretas.

8\. \*\*Decimais:\*\* `.HasPrecision(18,2)` — \*\*proibido\*\* `.HasColumnType`.

9\. \*\*Datas:\*\* Sempre `DateTime.UtcNow` (UTC).

10\. \*\*Logs:\*\* Técnico em português; usuário vê mensagem genérica.



\---



\## 📌 FLUXO DE TRABALHO



\### Antes de qualquer alteração:

1\. \*\*LEIA\*\* as regras.

2\. \*\*APRESENTE\*\* um plano.

3\. \*\*AGUARDE\*\* aprovação.



\### Após cada alteração:

1\. \*\*RODE\*\* `dotnet build`.

2\. \*\*CORRIJA\*\* erros autonomamente.

3\. \*\*ENTREGUE\*\* resultado validado.



\---



\*\*Versão:\*\* 1.0

```





