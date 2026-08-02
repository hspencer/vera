// Lector del formato de grafo por archivos de Logseq.
//
// Medido sobre el corpus real de ../mind: 970 archivos, 41.707 viñetas, de las
// cuales 31.907 indentan con tabulador y 1.836 con espacios; 3.294 propiedades
// de página, 720 propiedades de bloque y 11.358 líneas de continuación, todas
// con la forma `indentación + 2 espacios`.
//
// Este archivo sólo lee. No conoce Vera ni emite operaciones.

/** Una propiedad `clave:: valor`. */
const PROPERTY = /^[ \t]*([A-Za-z0-9_-]+):: ?(.*)$/;
const BULLET = /^([\t ]*)- ?(.*)$/;

export interface ParsedBlock {
  depth: number;
  content: string;
  properties: Map<string, string>;
}

export interface ParsedPage {
  /** Propiedades de la cabecera, antes de la primera viñeta. */
  properties: Map<string, string>;
  blocks: ParsedBlock[];
  /** Líneas de cabecera que no eran propiedades y no caben en ningún bloque. */
  preamble: string[];
}

/**
 * Profundidad de una viñeta. Un tabulador es un nivel; dos espacios también,
 * porque parte del corpus se escribió a mano y no pasó por Logseq.
 */
function depthOf(indent: string): number {
  const tabs = (indent.match(/\t/g) ?? []).length;
  const spaces = (indent.match(/ /g) ?? []).length;
  return tabs + Math.floor(spaces / 2);
}

export function parseLogseqPage(source: string): ParsedPage {
  const lines = source.split('\n');
  const properties = new Map<string, string>();
  const preamble: string[] = [];
  const blocks: ParsedBlock[] = [];

  let current: ParsedBlock | null = null;
  let seenBullet = false;

  const flush = (): void => {
    if (current === null) return;
    current.content = current.content.replace(/\s+$/, '');
    blocks.push(current);
    current = null;
  };

  for (const line of lines) {
    const bullet = BULLET.exec(line);

    if (bullet !== null) {
      flush();
      seenBullet = true;
      const head = bullet[2] ?? '';
      current = {
        depth: depthOf(bullet[1] ?? ''),
        content: head,
        properties: new Map(),
      };

      // Una viñeta que es sólo `clave:: valor` declara una propiedad del
      // bloque, no su contenido. Es la regla de Logseq, y el corpus la usa 453
      // veces: sin esto, veintisiete identidades de bloque acabarían escritas
      // como texto y la tabla que venía debajo perdería su identificador.
      const asProperty = PROPERTY.exec(head);
      if (asProperty !== null) {
        current.properties.set(asProperty[1] ?? '', (asProperty[2] ?? '').trim());
        current.content = '';
      }
      continue;
    }

    if (line.trim() === '') {
      // Una línea en blanco cierra el bloque en curso pero no aporta contenido.
      flush();
      continue;
    }

    const property = PROPERTY.exec(line);

    if (!seenBullet) {
      // Cabecera de página.
      if (property !== null) properties.set(property[1] ?? '', (property[2] ?? '').trim());
      else preamble.push(line.trim());
      continue;
    }

    if (current === null) {
      // Texto suelto tras una línea en blanco: se vuelve un bloque propio para
      // no perderlo.
      current = { depth: 0, content: line.trim(), properties: new Map() };
      continue;
    }

    // Línea de continuación del bloque en curso.
    if (property !== null) {
      current.properties.set(property[1] ?? '', (property[2] ?? '').trim());
    } else {
      current.content = current.content === '' ? line.trim() : `${current.content}\n${line.trim()}`;
    }
  }

  flush();
  return { properties, blocks, preamble };
}

/**
 * Título de página a partir del nombre de archivo. Logseq codifica la barra
 * como `___` y escapa otros caracteres en porcentaje: `%3A` es dos puntos.
 */
export function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.md$/, '');
  let decoded = base;
  try {
    decoded = decodeURIComponent(base);
  } catch {
    // Un porcentaje suelto que no era escape: se conserva el nombre literal.
  }
  return decoded.replace(/___/g, '/');
}

/** Los journals se nombran `2024_02_26.md`. */
export function journalTitle(filename: string): string | null {
  const match = /^(\d{4})_(\d{2})_(\d{2})\.md$/.exec(filename);
  if (match === null) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/**
 * Referencias a recursos: `![alt](../assets/x.png)`.
 * Los paréntesis se cuentan en vez de cortar en el primero, porque el corpus
 * trae capturas llamadas `Captura_de_pantalla_..._a_la(s)_...png`.
 */
export function referencedAssets(content: string): string[] {
  const found = new Set<string>();
  const opener = /\[[^\]]*\]\((\.\.\/assets\/)/g;
  for (const match of content.matchAll(opener)) {
    const from = (match.index ?? 0) + match[0].length - (match[1] ?? '').length;
    let depth = 1;
    let at = from;
    while (at < content.length && depth > 0) {
      const ch = content[at];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      if (depth > 0) at += 1;
    }
    const path = content.slice(from, at);
    if (path !== '') {
      try {
        found.add(decodeURIComponent(path));
      } catch {
        found.add(path);
      }
    }
  }
  return [...found];
}

/** Macros `{{...}}` que el corpus trae y Vera no traduce. */
const MACRO = /\{\{([a-z-]+)/g;

export function referencedMacros(content: string): string[] {
  const found: string[] = [];
  for (const match of content.matchAll(MACRO)) {
    const name = match[1];
    if (name !== undefined) found.push(name);
  }
  return found;
}
