
---

# 🚀 Bônus Exclusivos | Guia Definitivo: Do Zero ao Deploy com IA Agêntica

## Bem-vindo ao Kit do Aluno de Elite! 🎁

Este repositório contém **recursos extras, templates e ferramentas** que complementam o curso **"Guia Definitivo: Do Zero ao Deploy com IA Agêntica"**, criado por **Tony Chagas**.

Aqui você encontra tudo o que precisa para **acelerar seu aprendizado**, **governar seu agente de IA** e **entregar seu SaaS Multi-Tenant com .NET, Blazor, PostgreSQL e DeepSeek** como um verdadeiro Engenheiro de IA.

---

## 📦 O Que Você Vai Encontrar Aqui

### 📁 `regras/` — Governança do Cline
Arquivos que ensinam o Cline a pensar como um arquiteto sênior.

| Arquivo | Como usar |
| :--- | :--- |
| `CLINE_CUSTOM_INSTRUCTIONS.md` | **Use no início de cada sessão.** Peça ao Cline para ler este arquivo. |
| `DEVELOPMENT.md` | Guia de referência com todas as regras arquiteturais. |
| `RULES_SHORT.md` | Versão resumida para consulta rápida. |
| `SABATINA_AGENTE_TEMPLATE.md` | Template para forçar o Cline a planejar antes de agir. |
| `MCP_INSTRUCTIONS.md` | Passo a passo para configurar os MCPs no Cline. |

### 📁 `mcps/` — Configuração dos MCPs
Arquivo de configuração pronto para conectar o Cline ao PostgreSQL, arquivos e ferramentas.

### 📄 Arquivos de Infraestrutura

| Arquivo | O que faz |
| :--- | :--- |
| `.clineignore` | Impede o Cline de ler pastas pesadas (economiza tokens). |
| `docker-compose.prod.yml` | Deploy em produção com PostgreSQL e persistência de dados. |
| `github-actions-ci-cd.yml` | Pipeline CI/CD automatizado para build, testes e deploy. |

### 📄 Guias e Materiais de Apoio

| Arquivo | O que faz |
| :--- | :--- |
| `GUIA_DE_INSTALACAO_RAPIDO.md` | Comece a usar os bônus em 5 minutos. |
| `EXEMPLO_PROMPT_CAPITULO_4.md` | Veja um exemplo real de prompt do curso. |
| `PROXIMOS_PASSOS.md` | Checklist do aluno após a compra. |
| `COMPARATIVO_VIBE_CODING.md` | Entenda a diferença entre desenvolvimento tradicional e Vibe Coding. |
| `TROUBLESHOOTING.md` | Guia de resolução de problemas para deploy e infraestrutura. |

---

## 🛠️ Como Usar Este Repositório

### 1. Clone o repositório
```bash
git clone https://github.com/tonychagas/curso.git
cd curso
```

### 2. Copie os arquivos para seu projeto
```bash
# Copie as regras para a raiz do projeto
cp -r Bonus_Curso_IA_Agentica/regras/* C:\curso\

# Copie o .clineignore para a raiz
cp Bonus_Curso_IA_Agentica/.clineignore C:\curso\
```

### 3. Instrua o Cline
No chat do Cline, digite:
> *"Leia o arquivo `CLINE_CUSTOM_INSTRUCTIONS.md` e adote estas regras como sua constituição."*

### 4. Configure os MCPs
Siga o passo a passo em `MCP_INSTRUCTIONS.md` para conectar o Cline ao PostgreSQL.

---

## 🎓 Sobre o Curso

O **Guia Definitivo: Do Zero ao Deploy com IA Agêntica** é um treinamento prático que capacita desenvolvedores a criar SaaS profissionais governando IAs como o Cline e o DeepSeek.

### 🧠 O que você vai aprender

| Módulo | Conteúdo |
| :--- | :--- |
| **Parte 1** | Doutrinando o Ambiente — Setup de elite, PostgreSQL, Cline + DeepSeek e MCPs |
| **Parte 2** | Arquitetura Técnica do SaaS — NuGet, Modelagem Multi-Tenant, Migrações |
| **Parte 3** | Engenharia de Prompt — O método de alinhamento que evita amnésia da IA |
| **Parte 4** | Execução Ponta a Ponta — Frontend com MudBlazor, banco via MCP, IA e WhatsApp |
| **Parte 5** | O Marco da Entrega — Testes automatizados e deploy na nuvem com Docker |

### 🛠️ Tecnologias abordadas
- **Frontend:** .NET 10 Blazor + MudBlazor
- **Backend:** Multi-Tenant com isolamento físico/lógico
- **Banco de Dados:** PostgreSQL com MCP (Model Context Protocol)
- **Agente de IA:** Cline + DeepSeek / OpenRouter
- **Automação:** Testes xUnit, Docker, GitHub Actions CI/CD

---

## 📚 Estrutura do Curso

| Capítulo | Título | O que você vai construir |
| :---: | :--- | :--- |
| 0 | Guia do Iniciante | Preparação do ambiente e mentalidade |
| 1 | Setup de Elite | Instalação de todas as ferramentas |
| 2 | Configurando o Cline | Conexão DeepSeek, MCPs e governança |
| 3 | Pacotes NuGet | Injeção dos motores do SaaS |
| 4 | Modelagem Multi-Tenant | Fluxo Plan-and-Review e entidades |
| 5 | Migrations e Seed Data | Banco físico e dados de teste |
| 6 | Engenharia de Prompt | Técnica do Double-Check |
| 7 | Frontend com MudBlazor | Dashboard e interface visual |
| 8 | Conectando o Banco via MCP | Auditoria e segurança de dados |
| 9 | Inteligência e Comunicação | DeepSeek, WhatsApp e e-mail |
| 10 | Testes Automatizados | xUnit e validação de segurança |
| 11 | Deploy | Docker e produção na nuvem |

---

## 🎯 Para Quem é Este Curso

| Perfil | Por que este curso é para você |
| :--- | :--- |
| **Iniciantes** | Capítulo 0 explica tudo do zero. Você não precisa saber programar. |
| **Desenvolvedores** | Aprenda a governar a IA em vez de escrever código manualmente. |
| **Arquitetos** | Domine a engenharia de prompts e a governança de agentes. |
| **Empreendedores** | Crie seu próprio SaaS sem precisar de uma equipe de desenvolvimento. |

---

## 💬 Depoimentos

> *"Eu escrevo prompts, não código. A IA faz o trabalho pesado enquanto eu governo a arquitetura e a estratégia."*
>
> — **Tony Chagas**, Instrutor

> *"Vibe Coding não é sobre programar menos, é sobre programar melhor. É sobre focar no que realmente importa."*
>
> — **Andrej Karpathy**, Criador do termo "Vibe Coding"

---

## 🤝 Contribuições e Feedback

Criou um prompt incrível ou um componente visual fantástico? Fique à vontade para abrir um **Pull Request** e compartilhar com a comunidade!

---

## 📬 Contato

| Canal | Link |
| :--- | :--- |
| **YouTube** | [@tonychagas4248](https://www.youtube.com/@tonychagas4248) |
| **GitHub** | [github.com/tonychagas](https://github.com/tonychagas) |
| **E-mail** | tony_marshall@outlook.com |

---

## 📜 Licença

Este material é de uso exclusivo para alunos do curso. Para mais informações, entre em contato.

---

> **Bons estudos, boa governança e nos vemos em produção! 🚀**
>
> **Tony Chagas**  
> Engenheiro de Software | Especialista em Vibe Coding e IA Agêntica

---

⭐ **Se este repositório te ajudou, deixe uma estrela!** ⭐


---
