'use strict';

// ── Utilities ───────────────────────────────────────

function normalizeNewlines(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function indentLevelFromSpaces(count, perIndent) {
  perIndent = Math.max(1, perIndent);
  return Math.max(1, Math.floor(count / perIndent) + 1);
}

/**
 * Replace all matches of `pattern` (must have /g flag) with placeholder
 * tokens, pushing the formatted replacement into `stash`.
 * Returns [newText, stash].
 */
function protectSegments(text, pattern, formatter) {
  const stash = [];
  const result = text.replace(pattern, (...args) => {
    const token = `\x02PROT${stash.length}\x03`;
    stash.push(formatter(...args));
    return token;
  });
  return [result, stash];
}

function restoreSegments(text, stash) {
  for (let i = 0; i < stash.length; i++) {
    // Use split/join to avoid '$' interpretation in replacement strings
    text = text.split(`\x02PROT${i}\x03`).join(stash[i]);
  }
  return text;
}

// ── Markdown → Jira ─────────────────────────────────

function mdToJira(text, opts) {
  opts = Object.assign({
    spaces_per_indent:      2,
    convert_tables:         true,
    convert_images:         true,
    convert_blockquotes:    true,
    preserve_code_language: true,
    blockquote_multiline:   true,
  }, opts);

  text = normalizeNewlines(text);
  const spi = Math.max(1, parseInt(opts.spaces_per_indent) || 2);
  const stash = [];

  // 1. Protect fenced code blocks
  let [t1, cb] = protectSegments(
    text,
    /```([A-Za-z0-9_+\-]*)[ \t]*\n([\s\S]*?)\n```/g,
    (_m, lang, content) => {
      lang    = (lang || '').trim();
      content = content.replace(/\n+$/, '');
      if (opts.preserve_code_language && lang) return `{code:${lang}}\n${content}\n{code}`;
      return `{code}\n${content}\n{code}`;
    }
  );
  text = t1; stash.push(...cb);

  // 2. Protect inline code
  let [t2, ic] = protectSegments(
    text,
    /`([^`\n]+)`/gm,
    (_m, code) => `{{${code}}}`
  );
  text = t2; stash.push(...ic);

  // 3. Images
  if (opts.convert_images) {
    text = text.replace(/!\[[^\]]*\]\(([^)]+)\)/g, '!$1!');
  }

  // 4. Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '[$1|$2]');

  // 5. Headers (h6 → h1, longest first to avoid partial matches)
  for (let lvl = 6; lvl >= 1; lvl--) {
    text = text.replace(
      new RegExp(`^${'#'.repeat(lvl)}\\s+(.*)$`, 'gm'),
      `h${lvl}. $1`
    );
  }

  // 6. Blockquotes
  if (opts.convert_blockquotes) {
    const lines = text.split('\n');
    const out   = [];
    let buf     = [];

    const flush = () => {
      if (!buf.length) return;
      if (opts.blockquote_multiline) {
        out.push('{quote}', ...buf, '{quote}');
      } else {
        buf.forEach(l => out.push(`{quote}${l}{quote}`));
      }
      buf = [];
    };

    lines.forEach(line => {
      if (/^\s*>\s?/.test(line)) {
        buf.push(line.replace(/^\s*>\s?/, ''));
      } else {
        flush();
        out.push(line);
      }
    });
    flush();
    text = out.join('\n');
  }

  // 7. Tables
  if (opts.convert_tables) {
    const isSep = l => /^\|?[\s:\-]+(\|[\s:\-]+)+\|?$/.test(l.trim());
    const lines = text.split('\n');
    const out   = [];
    let i = 0;

    while (i < lines.length) {
      if (lines[i].includes('|') && i + 1 < lines.length && isSep(lines[i + 1])) {
        const tbl = [lines[i], lines[i + 1]];
        i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
          tbl.push(lines[i++]);
        }
        const headers = tbl[0].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        out.push('|| ' + headers.join(' || ') + ' ||');
        for (const row of tbl.slice(2)) {
          const cells = row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
          out.push('| ' + cells.join(' | ') + ' |');
        }
        continue;
      }
      out.push(lines[i++]);
    }
    text = out.join('\n');
  }

  // 8. Bold & strikethrough
  text = text.replace(/\*\*(.+?)\*\*/g,  '*$1*');
  text = text.replace(/__(.+?)__/g,       '*$1*');
  text = text.replace(/~~(.+?)~~/g,       '-$1-');

  // 9. Italic *text* (not **text**)
  text = text.replace(/(?<!\*)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '_$1_');

  // 10. Unordered lists
  text = text.replace(/^(\s*)([-+*])\s+(.*)$/gm, (_m, sp, _b, content) => {
    const level = indentLevelFromSpaces(sp.replace(/\t/g, '    ').length, spi);
    return '*'.repeat(level) + ' ' + content;
  });

  // 11. Ordered lists
  text = text.replace(/^(\s*)\d+\.\s+(.*)$/gm, (_m, sp, content) => {
    const level = indentLevelFromSpaces(sp.replace(/\t/g, '    ').length, spi);
    return '#'.repeat(level) + ' ' + content;
  });

  return restoreSegments(text, stash);
}

// ── Jira → Markdown ─────────────────────────────────

function jiraToMd(text) {
  text = normalizeNewlines(text);
  const stash = [];

  // 1. Protect code blocks
  let [t1, cb] = protectSegments(
    text,
    /\{code(?::([A-Za-z0-9_+\-]+))?\}\n?([\s\S]*?)\n?\{code\}/g,
    (_m, lang, content) => {
      lang    = (lang || '').trim();
      content = (content || '').replace(/\n+$/, '');
      if (lang) return `\`\`\`${lang}\n${content}\n\`\`\``;
      return `\`\`\`\n${content}\n\`\`\``;
    }
  );
  text = t1; stash.push(...cb);

  // 2. Protect inline code
  let [t2, ic] = protectSegments(
    text,
    /\{\{([^}\n]+)\}\}/gm,
    (_m, code) => `\`${code}\``
  );
  text = t2; stash.push(...ic);

  // 3. Quote blocks
  text = text.replace(/\{quote\}\n?([\s\S]*?)\n?\{quote\}/g, (_m, content) => {
    content = content.replace(/^\n+|\n+$/g, '');
    return content.split('\n').map(l => l.trim() ? '> ' + l : '>').join('\n');
  });

  // 4. Headers
  for (let lvl = 6; lvl >= 1; lvl--) {
    text = text.replace(
      new RegExp(`^h${lvl}\\.\\s+(.*)$`, 'gm'),
      '#'.repeat(lvl) + ' $1'
    );
  }

  // 5. Tables
  const isJiraHdr = l => { const s = l.trim(); return s.startsWith('||') && s.endsWith('||'); };
  const isJiraRow = l => { const s = l.trim(); return s.startsWith('|') && s.endsWith('|') && !s.startsWith('||'); };
  {
    const lines = text.split('\n');
    const out   = [];
    let i = 0;

    while (i < lines.length) {
      if (isJiraHdr(lines[i])) {
        const tbl = [lines[i++]];
        while (i < lines.length && isJiraRow(lines[i])) tbl.push(lines[i++]);

        const hcells = tbl[0].trim().replace(/^\|+|\|+$/g, '').split('||').map(c => c.trim()).filter(Boolean);
        out.push('| ' + hcells.join(' | ') + ' |');
        out.push('| ' + hcells.map(() => '---').join(' | ') + ' |');
        for (const row of tbl.slice(1)) {
          const cells = row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
          out.push('| ' + cells.join(' | ') + ' |');
        }
        continue;
      }
      out.push(lines[i++]);
    }
    text = out.join('\n');
  }

  // 6. Images
  text = text.replace(/!(https?:\/\/[^!\s]+)!/g, '![]($1)');

  // 7. Links
  text = text.replace(/\[([^|\]]+)\|([^\]]+)\]/g, '[$1]($2)');

  // 8. Bold *text* → **text**
  text = text.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '**$1**');

  // 9. Italic _text_ → *text*
  text = text.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '*$1*');

  // 10. Strikethrough -text-
  text = text.replace(/(?<!\w)-([^- \n][^-\n]*?)-(?!\w)/g, '~~$1~~');

  // 11. Unordered lists
  text = text.replace(/^(\*+)\s+(.*)$/gm, (_m, stars, content) =>
    '  '.repeat(stars.length - 1) + '- ' + content
  );

  // 12. Ordered lists
  text = text.replace(/^(#+)\s+(.*)$/gm, (_m, hashes, content) =>
    '  '.repeat(hashes.length - 1) + '1. ' + content
  );

  return restoreSegments(text, stash);
}

// ══════════════════════════════════════════════════
//  UI
// ══════════════════════════════════════════════════

const mdEl      = document.getElementById('md-input');
const jiraEl    = document.getElementById('jira-input');
const mdStats   = document.getElementById('md-stats');
const mdLines   = document.getElementById('md-lines');
const jiraStats = document.getElementById('jira-stats');
const jiraLines = document.getElementById('jira-lines');
const toastEl   = document.getElementById('toast');

// ── Settings helpers ─────────────────────────────

function getOpts() {
  return {
    spaces_per_indent:      parseInt(document.getElementById('s-spaces').value)    || 2,
    convert_tables:         document.getElementById('s-tables').checked,
    convert_images:         document.getElementById('s-images').checked,
    convert_blockquotes:    document.getElementById('s-blockquotes').checked,
    preserve_code_language: document.getElementById('s-codelang').checked,
    blockquote_multiline:   document.getElementById('s-multiline').checked,
  };
}

// ── Toast ────────────────────────────────────────

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

// ── Char counter ─────────────────────────────────

function updateStats(el, statsEl, linesEl) {
  const v     = el.value;
  const chars = v.length;
  const lines = v ? v.split('\n').length : 0;
  statsEl.textContent = chars === 1 ? '1 caractere' : `${chars.toLocaleString('pt-BR')} caracteres`;
  linesEl.textContent = lines === 1 ? '1 linha'     : `${lines.toLocaleString('pt-BR')} linhas`;
}

// ── Auto-convert (debounced) ─────────────────────

let autoTimer   = null;
let converting  = false;  // prevent echo loop

mdEl.addEventListener('input', () => {
  updateStats(mdEl, mdStats, mdLines);
  if (!document.getElementById('auto-convert').checked || converting) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    converting = true;
    jiraEl.value = mdToJira(mdEl.value, getOpts());
    updateStats(jiraEl, jiraStats, jiraLines);
    converting = false;
  }, 350);
});

jiraEl.addEventListener('input', () => {
  updateStats(jiraEl, jiraStats, jiraLines);
  if (!document.getElementById('auto-convert').checked || converting) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    converting = true;
    mdEl.value = jiraToMd(jiraEl.value);
    updateStats(mdEl, mdStats, mdLines);
    converting = false;
  }, 350);
});

// Focus highlight
mdEl.addEventListener('focus',   () => document.getElementById('panel-md').classList.add('focus-in'));
mdEl.addEventListener('blur',    () => document.getElementById('panel-md').classList.remove('focus-in'));
jiraEl.addEventListener('focus', () => document.getElementById('panel-jira').classList.add('focus-in'));
jiraEl.addEventListener('blur',  () => document.getElementById('panel-jira').classList.remove('focus-in'));

// ── Conversion buttons ───────────────────────────

document.getElementById('btn-md2jira').addEventListener('click', () => {
  jiraEl.value = mdToJira(mdEl.value, getOpts());
  updateStats(jiraEl, jiraStats, jiraLines);
  toast('✓ Convertido: Markdown → Jira');
});

document.getElementById('btn-jira2md').addEventListener('click', () => {
  mdEl.value = jiraToMd(jiraEl.value);
  updateStats(mdEl, mdStats, mdLines);
  toast('✓ Convertido: Jira → Markdown');
});

// ── Swap ─────────────────────────────────────────

document.getElementById('btn-swap').addEventListener('click', () => {
  [mdEl.value, jiraEl.value] = [jiraEl.value, mdEl.value];
  updateStats(mdEl,   mdStats,   mdLines);
  updateStats(jiraEl, jiraStats, jiraLines);
  toast('⇅ Conteúdo trocado');
});

// ── Copy ─────────────────────────────────────────

document.getElementById('btn-copy-md').addEventListener('click', () => {
  navigator.clipboard.writeText(mdEl.value)
    .then(() => toast('📋 Markdown copiado!'))
    .catch(()  => toast('Erro ao copiar'));
});

document.getElementById('btn-copy-jira').addEventListener('click', () => {
  navigator.clipboard.writeText(jiraEl.value)
    .then(() => toast('📋 Jira markup copiado!'))
    .catch(()  => toast('Erro ao copiar'));
});

// ── Clear ────────────────────────────────────────

document.getElementById('btn-clear-md').addEventListener('click', () => {
  mdEl.value = '';
  updateStats(mdEl, mdStats, mdLines);
});
document.getElementById('btn-clear-jira').addEventListener('click', () => {
  jiraEl.value = '';
  updateStats(jiraEl, jiraStats, jiraLines);
});
document.getElementById('btn-clear').addEventListener('click', () => {
  mdEl.value = jiraEl.value = '';
  updateStats(mdEl,   mdStats,   mdLines);
  updateStats(jiraEl, jiraStats, jiraLines);
  toast('🗑 Tudo limpo');
});

// ── Settings panel ───────────────────────────────

document.getElementById('settings-toggle').addEventListener('click', () => {
  document.getElementById('settings-panel').classList.toggle('open');
});

// ── Theme toggle ─────────────────────────────────

const themeBtn = document.getElementById('theme-toggle');
let dark = localStorage.getItem('theme') === 'dark';

function applyTheme() {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : '');
  themeBtn.textContent = dark ? '☀️' : '🌙';
  themeBtn.title       = dark ? 'Modo claro' : 'Modo escuro';
}
applyTheme();

themeBtn.addEventListener('click', () => {
  dark = !dark;
  localStorage.setItem('theme', dark ? 'dark' : 'light');
  applyTheme();
});

// ── Example ──────────────────────────────────────

const EXAMPLE = `# Título Principal

Bem-vindo ao **Markdown ↔ Jira Converter**!
Este é um texto com *itálico* e ~~texto riscado~~.

## Funcionalidades

- Conversão bidirecional entre Markdown e Jira markup
- Suporte a **tabelas**, \`código inline\` e blocos de código
- Listas ordenadas e não ordenadas com aninhamento

## Código de exemplo

\`\`\`javascript
function saudacao(nome) {
  console.log(\`Olá, \${nome}!\`);
}
saudacao('Mundo');
\`\`\`

## Listas

Lista não ordenada:
- Item A
- Item B
  - Sub-item B1
  - Sub-item B2
- Item C

Lista ordenada:
1. Primeiro passo
2. Segundo passo
3. Terceiro passo

## Links e Imagens

[Visite o GitHub](https://github.com/crqcastro/markdown_to_jira)

![Logo](https://example.com/logo.png)

## Citação

> "A simplicidade é o mais alto grau de sofisticação."
> — Leonardo da Vinci

## Tabela

| Nome     | Versão | Status     |
|----------|--------|------------|
| Plugin   | 1.0.0  | Estável    |
| Website  | 1.0.0  | Online     |
`;

document.getElementById('btn-example').addEventListener('click', () => {
  mdEl.value = EXAMPLE;
  updateStats(mdEl, mdStats, mdLines);
  jiraEl.value = mdToJira(EXAMPLE, getOpts());
  updateStats(jiraEl, jiraStats, jiraLines);
  toast('📋 Exemplo carregado!');
});
