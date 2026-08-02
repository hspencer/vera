// Lectura del contenido de un bloque. Todo lo derivado del texto vive aquí, en
// un solo lugar, para que los índices no puedan discrepar del contenido.

/** `[[Página]]` — referencias a páginas. */
const LINK = /\[\[([^\]]+)\]\]/g;

/** `#tag` — etiquetas libres. */
const TAG = /(?:^|\s)#([\p{L}\p{N}_-]+)/gu;

/** `{{query ...}}` — macros de Logseq que el corpus trae y Vera no traduce. */
const QUERY_MACRO = /\{\{query\b/;

/**
 * Títulos referenciados por un bloque, sin repetir y en orden de aparición.
 * Una misma página nombrada dos veces produce un solo enlace.
 */
export function referencedTitles(content: string): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const match of content.matchAll(LINK)) {
    const title = match[1]?.trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    titles.push(title);
  }
  return titles;
}

/** Etiquetas de un bloque, sin repetir. */
export function referencedTags(content: string): string[] {
  const seen = new Set<string>();
  for (const match of content.matchAll(TAG)) {
    const tag = match[1];
    if (tag) seen.add(tag);
  }
  return [...seen];
}

/**
 * El texto literal de la macro de consulta, si el bloque trae una.
 * Cuenta llaves para no cortar en un `}}` interno.
 */
export function queryMacroText(content: string): string | null {
  if (!QUERY_MACRO.test(content)) return null;
  const start = content.search(QUERY_MACRO);
  if (start < 0) return null;

  let depth = 0;
  for (let i = start; i < content.length - 1; i += 1) {
    if (content[i] === '{' && content[i + 1] === '{') {
      depth += 1;
      i += 1;
    } else if (content[i] === '}' && content[i + 1] === '}') {
      depth -= 1;
      i += 1;
      if (depth === 0) return content.slice(start, i + 1);
    }
  }
  return content.slice(start);
}

/**
 * Clave de comparación de títulos: sin mayúsculas, sin diacríticos y con los
 * espacios normalizados, igual que el `remove_diacritics 2` del esquema SQL.
 */
export function titleKey(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** Coincidencia de texto libre, con el mismo plegado que titleKey. */
export function matches(haystack: string, needle: string): boolean {
  if (needle === '') return false;
  return titleKey(haystack).includes(titleKey(needle));
}

/** Fragmento alrededor de la coincidencia, para justificar un acierto. */
export function excerpt(source: string, needle: string, width = 80): string {
  const at = titleKey(source).indexOf(titleKey(needle));
  if (at < 0) return source.slice(0, width);
  const from = Math.max(0, at - Math.floor(width / 3));
  const slice = source.slice(from, from + width);
  return (from > 0 ? '…' : '') + slice + (from + width < source.length ? '…' : '');
}
