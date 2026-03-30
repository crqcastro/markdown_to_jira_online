# Markdown ↔ Jira Converter

Conversor bidirecional entre Markdown e Jira Wiki Markup, hospedado no GitHub Pages.

## Acesso

Acesse diretamente pelo navegador via GitHub Pages (sem instalação ou build necessário).

## Funcionalidades

- Conversão de **Markdown → Jira Wiki Markup**
- Conversão de **Jira Wiki Markup → Markdown**
- Suporte a: títulos, negrito, itálico, código inline, blocos de código, listas, tabelas, imagens, links e citações (blockquotes)
- Auto-conversão com debounce (350ms)
- Tema claro/escuro (persistido no `localStorage`)
- Configurações de conversão ajustáveis (indentação, tabelas, imagens, blockquotes, linguagem de código)
- Botões de copiar, limpar e trocar painéis
- Exemplo de uso embutido

## Estrutura

```
index.html    — aplicação completa (HTML + CSS + JS em arquivo único)
styles.css    — estilos separados
converter.js  — lógica de conversão separada
.nojekyll     — impede processamento Jekyll no GitHub Pages
```

## Desenvolvimento

Abra `index.html` diretamente no navegador. Não há build, dependências ou gerenciador de pacotes.

## Deploy

O deploy é feito automaticamente via GitHub Actions para o GitHub Pages a cada push na branch `main`.

## Arquitetura

A lógica de conversão usa um padrão de **protect/restore stash**: blocos de código e código inline são substituídos por tokens `\x02PROTn\x03` antes das transformações inline, evitando que as regras de formatação corrompam o conteúdo de código.
