```markdown

\# 🔌 Configuração dos MCPs no Cline



Este guia explica como configurar os servidores MCP (Model Context Protocol) para dar ao Cline acesso ao PostgreSQL, arquivos, navegador e outras ferramentas.



\---



\## 📌 Passo a Passo



\### 1. Abra as configurações do Cline

1\. No VS Code, clique no ícone do \*\*Cline\*\* na barra lateral esquerda.

2\. Clique no ícone de \*\*Engrenagem\*\* (Configurações).

3\. Role até a seção \*\*MCP Servers\*\*.

4\. Clique no botão para abrir o arquivo `cline\_mcp\_settings.json`.



\### 2. Cole a configuração

Substitua todo o conteúdo do arquivo pelo JSON fornecido no arquivo `cline\_mcp\_settings.json` disponível neste repositório.



\### 3. Ajuste os caminhos

\*\*ATENÇÃO:\*\* Substitua `SEU\_USUARIO` pelos caminhos corretos do seu sistema.



| O que alterar | Onde | Como |

| :--- | :--- | :--- |

| \*\*Caminho do Windows Search\*\* | `windows-search` → `args` | Substitua `C:/Users/SEU\_USUARIO/` pelo seu usuário. |

| \*\*Caminho do dotnet-build\*\* | `dotnet-build` → `args` | Substitua `C:/Users/SEU\_USUARIO/` pelo seu usuário. |

| \*\*Credenciais do PostgreSQL\*\* | `pg\_curso` → `env` → `DATABASE\_URL` | Ajuste senha e porta se necessário. |



\### 4. Verifique a conexão

Após salvar, os servidores MCP devem aparecer como \*\*"Conectados"\*\* (indicador verde).



\---



\## 🔧 Servidores MCP Ativos



| Servidor | Função |

| :--- | :--- |

| `sequential-thinking` | Força a IA a pensar em etapas lógicas. |

| `codecompress` | Compacta código para economizar tokens. |

| `pg\_curso` | Conecta ao PostgreSQL para auditoria e consultas. |

| `playwright` | Testa a interface no navegador. |

| `filesystem` | Acesso seguro à pasta do projeto. |

| `glider` | Análise estática de código C#. |

| `dotnet-build` | Compila o projeto via MCP. |

| `windows-search` | Busca e substitui em lote. |



\---



\## ⚠️ Se algo não funcionar



| Problema | Solução |

| :--- | :--- |

| MCP com erro vermelho | Verifique o caminho no JSON. |

| PostgreSQL não conecta | Confirme a senha e a porta. |

| Cline não encontra o arquivo | Reinicie o VS Code. |



\---



\*\*Versão:\*\* 1.0

\*\*Última atualização:\*\* 2026-06-24

```



