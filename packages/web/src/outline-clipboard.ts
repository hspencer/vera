export interface ClipboardOutlineItem {
  content: string;
  depth: number;
}

/**
 * Reconoce un outline Markdown completo, sin convertir texto ambiguo.
 *
 * Una sola viñeta puede ser prosa y una línea sin viñeta puede ser la
 * continuación de un párrafo: en ambos casos se deja actuar al portapapeles
 * ordinario. Sólo una lista inequívoca, o el formato raíz+hijos que Vera misma
 * copia, se vuelve bloques.
 */
export function parseOutlineClipboard(text: string): ClipboardOutlineItem[] | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines[0]?.trim() === '') lines.shift();
  while (lines.at(-1)?.trim() === '') lines.pop();
  if (lines.length < 2) return null;

  const itemFrom = (line: string) => {
    const match = /^(\s*)(?:[-+*]|\d+[.)])\s+(.+)$/.exec(line);
    if (match === null) return null;
    const indent = [...(match[1] ?? '')].reduce(
      (sum, character) => sum + (character === '\t' ? 2 : 1),
      0,
    );
    return { content: match[2] ?? '', indent };
  };

  const firstIsHeading = itemFrom(lines[0] ?? '') === null;
  const listLines = firstIsHeading ? lines.slice(1) : lines;
  const parsed = listLines.map(itemFrom);
  if (parsed.some((item) => item === null)) return null;
  if (parsed.length === 0 || parsed[0]?.indent !== 0) return null;

  const levels = [0];
  const outline: ClipboardOutlineItem[] = firstIsHeading
    ? [{ content: lines[0] ?? '', depth: 0 }]
    : [];
  const depthOffset = firstIsHeading ? 1 : 0;
  let previousIndent = 0;
  for (const item of parsed) {
    if (item === null) return null;
    let depth = levels.indexOf(item.indent);
    if (depth < 0) {
      if (item.indent <= previousIndent || item.indent - previousIndent > 3) return null;
      levels.push(item.indent);
      depth = levels.length - 1;
    } else {
      levels.length = depth + 1;
    }
    outline.push({ content: item.content, depth: depth + depthOffset });
    previousIndent = item.indent;
  }
  return outline;
}
