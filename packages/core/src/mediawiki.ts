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

type WikiCell = { tag: 'td' | 'th'; attributes: string; source: string };

/** Separa celdas sin partir el `|` único de `[[destino|etiqueta]]`. */
function splitCells(source: string, marker: '||' | '!!'): string[] {
  const cells: string[] = [];
  let began = 0;
  let links = 0;
  for (let at = 0; at < source.length - 1; at += 1) {
    const pair = source.slice(at, at + 2);
    if (pair === '[[') { links += 1; at += 1; continue; }
    if (pair === ']]') { links = Math.max(0, links - 1); at += 1; continue; }
    if (links === 0 && pair === marker) {
      cells.push(source.slice(began, at));
      began = at + 2;
      at += 1;
    }
  }
  cells.push(source.slice(began));
  return cells;
}

/** Conserva sólo atributos estructurales inocuos; estilos y eventos se omiten. */
function readCell(source: string, tag: 'td' | 'th'): WikiCell {
  const separator = source.indexOf('|');
  if (separator === -1) return { tag, attributes: '', source: source.trim() };
  const candidate = source.slice(0, separator).trim();
  if (!/^(?:(?:colspan|rowspan|scope|class|style)\s*=)/i.test(candidate)) {
    return { tag, attributes: '', source: source.trim() };
  }
  const attributes: string[] = [];
  for (const found of candidate.matchAll(/\b(colspan|rowspan)\s*=\s*["']?(\d{1,2})["']?/gi)) {
    const value = Math.max(1, Math.min(99, Number(found[2] ?? '1')));
    attributes.push(`${(found[1] ?? '').toLowerCase()}="${value}"`);
  }
  const scope = /\bscope\s*=\s*["']?(row|col)["']?/i.exec(candidate)?.[1]?.toLowerCase();
  if (scope !== undefined) attributes.push(`scope="${scope}"`);
  return { tag, attributes: attributes.length > 0 ? ` ${attributes.join(' ')}` : '', source: source.slice(separator + 1).trim() };
}

function readTable(lines: string[], start: number): { html: string; next: number } | null {
  if (!(lines[start] ?? '').trimStart().startsWith('{|')) return null;
  const rows: string[] = [];
  let cells: WikiCell[] = [];
  let caption = '';
  const flush = (): void => {
    if (cells.length > 0) rows.push(`<tr>${cells.map((cell) => `<${cell.tag}${cell.attributes}>${inlineMediaWiki(cell.source.replace(/\n/g, ' '))}</${cell.tag}>`).join('')}</tr>`);
    cells = [];
  };
  for (let at = start + 1; at < lines.length; at += 1) {
    const line = (lines[at] ?? '').trim();
    if (line === '|}') {
      flush();
      const named = caption === '' ? '' : `<caption>${inlineMediaWiki(caption)}</caption>`;
      return { html: `<table>${named}${rows.join('')}</table>`, next: at + 1 };
    }
    if (line.startsWith('|+')) {
      const raw = line.slice(2).trim();
      const separator = raw.indexOf('|');
      caption = separator >= 0 && /=/.test(raw.slice(0, separator)) ? raw.slice(separator + 1).trim() : raw;
      continue;
    }
    if (line.startsWith('|-')) { flush(); continue; }
    if (line.startsWith('!')) {
      for (const value of splitCells(line.slice(1), '!!')) cells.push(readCell(value, 'th'));
    } else if (line.startsWith('|')) {
      for (const value of splitCells(line.slice(1), '||')) cells.push(readCell(value, 'td'));
    } else if (cells.length > 0 && line !== '') {
      const last = cells[cells.length - 1];
      if (last !== undefined) last.source += `\n${line}`;
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
