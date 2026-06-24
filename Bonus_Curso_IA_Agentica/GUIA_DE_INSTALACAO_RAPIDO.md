## 📄 ARQUIVO: `GUIA_DE_INSTALACAO_RAPIDO.md`

# 🚀 Guia Rápido de Instalação — Bônus do Curso

## Como usar os bônus em 5 minutos

---

## 📋 Pré-requisitos

Antes de começar, certifique-se de que você tem:

| Item | Status |
| :--- | :---: |
| VS Code instalado | ☐ |
| Git instalado | ☐ |
| Acesso ao repositório do curso | ☐ |

---

## 🛠️ Passo a Passo

### 1. Clone o repositório

Abra o terminal (PowerShell ou Prompt de Comando) e execute:

```bash
git clone https://github.com/tonychagas/curso.git
cd curso
```

---

### 2. Copie os arquivos para seu projeto

```bash
# Copie os templates de governança para a raiz do projeto
cp Bonus_Curso_IA_Agentica/regras/*.md C:\curso\
cp Bonus_Curso_IA_Agentica/regras/*.json C:\curso\

# Copie o .clineignore para a raiz
cp Bonus_Curso_IA_Agentica/.clineignore C:\curso\
```

> 💡 **Dica:** Se você estiver no Windows e o comando `cp` não funcionar, use `copy` ou copie os arquivos manualmente pelo Explorer.

---

### 3. Configure os MCPs no Cline

1. No VS Code, clique no ícone do **Cline** na barra lateral.
2. Clique no ícone de **Engrenagem** (Configurações).
3. Role até **MCP Servers** e clique em **"Edit MCP Settings"** .
4. Substitua o conteúdo pelo JSON do arquivo `mcps/cline_mcp_settings.json`.
5. **Ajuste os caminhos:** Substitua `SEU_USUARIO` pelo nome da sua pasta de usuário.

---

### 4. Instrua o Cline

No chat do Cline, digite:

> *"Leia o arquivo `CLINE_CUSTOM_INSTRUCTIONS.md` e adote estas regras como sua constituição."*

---

### 5. Use o Docker de Produção (Opcional)

```bash
docker-compose -f docker-compose.prod.yml up -d
```

---

## ✅ Pronto!

Agora você tem:

| Recurso | Status |
| :--- | :---: |
| ✅ Templates de governança | Instalados |
| ✅ Configuração MCP | Configurada |
| ✅ .clineignore | Ativo |
| ✅ Docker (opcional) | Pronto |

---

## 📚 Para mais detalhes

Consulte o **Guia Definitivo: Do Zero ao Deploy com IA Agêntica** para um passo a passo completo de cada etapa.

---

**Bom desenvolvimento! 🚀**

**Tony Chagas**  
Engenheiro de Software | Especialista em Vibe Coding e IA Agêntica

---
