
---

## 📄 ARQUIVO: `TROUBLESHOOTING.md`


# 🛠️ Troubleshooting: Guia de Resolução de Problemas

## Guia de Sobrevivência para Deploy e Infraestrutura

---

> *"No Vibe Coding, você não precisa saber tudo. Você precisa saber como pedir ajuda à IA quando algo dá errado."*

---

## 📌 Como usar este guia

1. Identifique o erro que apareceu no terminal ou nos logs.
2. Encontre o erro correspondente na lista abaixo.
3. Copie o **Prompt de Correção** e cole no chat do Cline.
4. Aguarde o Cline analisar e corrigir o problema.

---

## 🔴 ERRO 1: Porta 80/443 já ocupada

### Mensagem de erro
```
port is already allocated
```

### Prompt para o Cline
> *"O deploy falhou com o erro: 'port is already allocated'. Analise o docker-compose.yml e ajuste o mapeamento de portas para usar uma porta disponível (ex: 8080:80)."*

### O que o Cline vai fazer
- Verificar o `docker-compose.yml`
- Ajustar o mapeamento de portas
- Reiniciar o container com a nova configuração

---

## 🔴 ERRO 2: Conexão com PostgreSQL falha

### Mensagem de erro
```
FATAL: password authentication failed
```

### Prompt para o Cline
> *"O PostgreSQL não está aceitando a conexão. Verifique a variável de ambiente DATABASE_URL no docker-compose.yml e confirme se a senha está correta."*

### O que o Cline vai fazer
- Abrir o `docker-compose.yml`
- Verificar a string de conexão
- Sugerir a correção ou atualizar as credenciais

---

## 🔴 ERRO 3: Falha ao rodar dotnet ef database update

### Mensagem de erro
```
No database provider has been configured
```

### Prompt para o Cline
> *"A migração falhou. Verifique se o Npgsql.EntityFrameworkCore.PostgreSQL está instalado e configurado no Program.cs. Rode o build e corrija os erros."*

### O que o Cline vai fazer
- Verificar os pacotes NuGet instalados
- Validar a configuração no `Program.cs`
- Corrigir as referências e rodar o build novamente

---

## 🔴 ERRO 4: Variáveis de ambiente não carregadas

### Mensagem de erro
```
The configuration 'DEEPSEEK_KEY' was not found
```

### Prompt para o Cline
> *"O sistema não está encontrando a variável DEEPSEEK_KEY. Verifique se ela está definida no docker-compose.yml e no sistema operacional."*

### O que o Cline vai fazer
- Verificar o `docker-compose.yml` e o arquivo `.env`
- Adicionar as variáveis ausentes
- Reiniciar os containers

---

## 🔴 ERRO 5: Container não inicia

### Mensagem de erro
```
Exited (1)
```

### Prompt para o Cline
> *"O container falhou ao iniciar com código de erro 1. Analise os logs do container, identifique a causa e corrija o docker-compose.yml ou o Dockerfile."*

### O que o Cline vai fazer
- Analisar os logs do container
- Identificar a causa raiz (configuração, dependência, etc.)
- Propor e aplicar a correção

---

## 🔴 ERRO 6: Cline não encontra o arquivo

### Mensagem de erro
```
ENOENT: no such file or directory
```

### Prompt para o Cline
> *"O arquivo [NOME_DO_ARQUIVO] não foi encontrado. Verifique se ele existe no caminho correto e ajuste a referência."*

### O que o Cline vai fazer
- Verificar a existência do arquivo
- Ajustar o caminho relativo ou absoluto
- Criar o arquivo se necessário

---

## 🔴 ERRO 7: Falha na compilação do .NET

### Mensagem de erro
```
Build failed with X errors
```

### Prompt para o Cline
> *"O build falhou com os seguintes erros: [cole a mensagem de erro]. Analise cada erro um por um, corrija os arquivos afetados e execute o build novamente."*

### O que o Cline vai fazer
- Identificar cada erro (namespace faltando, tipo incorreto, referência ausente)
- Corrigir os arquivos um a um
- Rodar `dotnet build` novamente
- Repetir até a compilação passar

---

## 🔴 ERRO 8: Falha na migração (conflito)

### Mensagem de erro
```
Unable to create an object of type 'AppDbContext'
```

### Prompt para o Cline
> *"A migração falhou. Verifique se o DbContext está configurado corretamente no Program.cs e se as dependências estão registradas."*

### O que o Cline vai fazer
- Verificar o registro do DbContext no `Program.cs`
- Verificar a string de conexão
- Sugerir a correção

---

## 🔴 ERRO 9: Falha ao instalar pacote NuGet

### Mensagem de erro
```
Package restore failed
```

### Prompt para o Cline
> *"A instalação do pacote falhou. Execute `dotnet restore` e, se necessário, limpe o cache com `dotnet nuget locals all --clear`."*

### O que o Cline vai fazer
- Executar `dotnet restore`
- Limpar o cache se necessário
- Tentar a instalação novamente

---

## 🔴 ERRO 10: Falha no GitHub Actions

### Mensagem de erro
```
The workflow is not valid
```

### Prompt para o Cline
> *"O workflow do GitHub Actions falhou com o erro: [cole a mensagem]. Analise o arquivo .github/workflows/deploy.yml e corrija a sintaxe."*

### O que o Cline vai fazer
- Abrir o arquivo de workflow
- Verificar a sintaxe YAML
- Corrigir erros e sugerir a nova versão

---

## 🟡 PROMPT GENÉRICO (Para qualquer erro)

Se você não souber qual erro está enfrentando, use este prompt universal:

> *"O deploy falhou com o seguinte erro: [cole a mensagem de erro]. Analise os logs, identifique a causa raiz e me apresente um plano de correção. Após minha aprovação, execute a correção e rode o deploy novamente."*

---

## 🟢 DICA DE OURO

Quando o Cline corrigir um erro, **peça para ele documentar a solução**:

> *"Agora que você corrigiu o erro, adicione este cenário ao nosso guia de troubleshooting para referência futura."*

---

## 📋 Checklist de Correção Rápida

| ✅ | Etapa | Status |
| :---: | :--- | :---: |
| □ | Identifiquei o erro | _____ |
| □ | Colei a mensagem de erro no prompt | _____ |
| □ | Enviei o prompt para o Cline | _____ |
| □ | Aguardei a correção | _____ |
| □ | Validei que o problema foi resolvido | _____ |

---

**Versão:** 1.0
**Última Atualização:** 2026-06-24
**Autor:** Tony Chagas

---
