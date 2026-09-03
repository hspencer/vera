// Presentación deliberadamente pequeña de wikitext. No expande plantillas,
// etiquetas ni extensiones: sólo convierte la gramática editorial básica.

const escapeHtml = (text: string): string => text
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeAttribute = (text: string): string => escapeHtml(text)
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function inlineMediaWiki(source: string): string {
  const held: string[] = [];
  const hold = (html: string): string => `\u0000${held.push(html) - 1}\u0000`;
  let text = escapeHtml(source);
  text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_whole, page: string, label?: string) =>
    hold(`<span class="mediawiki-link" title="${escapeAttribute(page.trim())}">${label?.trim() || page.trim()}</span>`));
  text = text.replace(/\[(https?:\/\/[^\s\]]+)(?:\s+([^\]]+))?\]/g, (_whole, href: string, label?: string) =>
    hold(`<a href="${escapeAttribute(href)}" rel="noreferrer" target="_blank">${label?.trim() || href}</a>`));
  text = text.replace(/'''''(.+?)'''''/g, '<strong><em>$1</em></strong>');
  text = text.replace(/'''(.+?)'''/g, '<strong>$1</strong>');
  text = text.replace(/''(.+?)''/g, '<em>$1</em>');
  return text.replace(/\u0000(\d+)\u0000/g, (_whole, at: string) => held[Number(at)] ?? '');
}

function readTable(lines: string[], start: number): { html: string; next: number } | null {
  if (!(lines[start] ?? '').trimStart().startsWith('{|')) return null;
  const rows: string[] = [];
  let cells: string[] = [];
  const flush = (): void => {
    if (cells.length > 0) rows.push(`<tr>${cells.join('')}</tr>`);
    cells = [];
  };
  for (let at = start + 1; at < lines.length; at += 1) {
    const line = (lines[at] ?? '').trim();
    if (line === '|}') { flush(); return { html: `<table>${rows.join('')}</table>`, next: at + 1 }; }
    if (line.startsWith('|-')) { flush(); continue; }
    if (line.startsWith('!')) {
      for (const value of line.slice(1).split('!!')) cells.push(`<th>${inlineMediaWiki(value.trim())}</th>`);
    } else if (line.startsWith('|')) {
      for (const value of line.slice(1).split('||')) cells.push(`<td>${inlineMediaWiki(value.trim())}</td>`);
    }
  }
  return null;
}

export function renderMediaWiki(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let paragraph: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const flushParagraph = (): void => {
    if (paragraph.length > 0) output.push(`<p>${paragraph.map(inlineMediaWiki).join('<br>')}</p>`);
    paragraph = [];
  };
  const closeList = (): void => {
    if (list !== null) output.push(`</${list}>`);
    list = null;
  };

  for (let at = 0; at < lines.length;) {
    const line = lines[at] ?? '';
    const table = readTable(lines, at);
    if (table !== null) { flushParagraph(); closeList(); output.push(table.html); at = table.next; continue; }
    const heading = /^(={1,6})\s*(.*?)\s*\1$/.exec(line.trim());
    if (heading !== null) {
      flushParagraph(); closeList();
      const level = Math.min(6, (heading[1] ?? '=').length + 1);
      output.push(`<h${level}>${inlineMediaWiki(heading[2] ?? '')}</h${level}>`);
      at += 1; continue;
    }
    const item = /^([*#])\s*(.*)$/.exec(line);
    if (item !== null) {
      flushParagraph();
      const wanted = item[1] === '#' ? 'ol' : 'ul';
      if (list !== wanted) { closeList(); list = wanted; output.push(`<${wanted}>`); }
      output.push(`<li>${inlineMediaWiki(item[2] ?? '')}</li>`);
      at += 1; continue;
    }
    closeList();
    if (line.trim() === '') flushParagraph();
    else if (line.startsWith(' ')) { flushParagraph(); output.push(`<pre>${escapeHtml(line.slice(1))}</pre>`); }
    else paragraph.push(line);
    at += 1;
  }
  flushParagraph(); closeList();
  return output.join('');
}
