// Renderizado de Markdown para la presentación de un bloque.
//
// @invariant RenderedPresentationIsFaithful: encabezados, listas, citas, código,
// tablas, imágenes, líneas horizontales y referencias a notas al pie se leen como
// lo que son y no como sus marcas.
//
// @invariant EmbeddedMarkupIsInert: el HTML escrito dentro de un bloque se
// presenta como texto. Este módulo no produce marcado activo, y el corpus trae
// 108 bloques con HTML crudo que dependen de eso.
//
// @invariant EditingRevealsTheSource: nada de aquí vuelve al grafo. Renderizar es
// una vista sobre la fuente; la fuente se guarda tal como se escribió y ninguna
// edición pasa de ida y vuelta por este archivo.
//
// La estructura de bloque se reconoce sobre el texto crudo y el escapado ocurre
// después, sobre el contenido de cada pieza. Al revés no funciona: escapar
// primero convierte el `>` de una cita en `&gt;` y la cita deja de existir.

/** Esquemas que pueden viajar en un href o un src. `javascript:` no está. */
const SAFE_URL = /^(https?:\/\/|mailto:|\/|\.\.?\/|#)/i;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Vuelve seguro un valor que va dentro de comillas dobles. Se aplica sobre texto
 * que ya pasó por `escapeHtml`, así que sólo faltan las comillas: escapar de
 * nuevo convertiría el `&` de una URL en `&amp;amp;`.
 */
function quoteAttribute(escaped: string): string {
  return escaped.replace(/"/g, '&quot;');
}

/** Una URL que no declara un esquema conocido no se emite como enlace. */
function safeUrl(raw: string): string | null {
  const url = raw.trim();
  return SAFE_URL.test(url) ? quoteAttribute(url) : null;
}

/**
 * Marcas que no emiten atributos y por lo tanto pueden correr sobre cualquier
 * texto ya escapado sin poder romper nada.
 */
function decorate(html: string): string {
  return html
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
}

const SLOT = '\u0000';

/**
 * Cómo se resuelve una ruta del corpus a algo que el navegador pueda pedir.
 *
 * El bloque conserva su `../assets/foo.png` y aquí se traduce al objeto que
 * Vera guarda. Sin resolvedor, la ruta se emite tal cual y la presentación
 * degrada sola: es lo que ocurre mientras los binarios no se hayan ingerido.
 */
export interface RenderOptions {
  resolveAsset?: (path: string) => { url: string; mediaType: string } | null;
  /**
   * Qué bloque nombra una referencia `((stable_id))`.
   *
   * @invariant ReferenceResolvesToItsBlock: una referencia que no se puede
   * seguir no es una referencia. Sin resolvedor se emite el identificador tal
   * cual, que es la forma honesta de decir que aún no se sabe a qué apunta.
   */
  resolveBlock?: (stableId: string) => { page: string; excerpt: string } | null;
}

/** Un medio que no es imagen se ofrece como archivo, no se finge presentado. */
function mediaElement(
  resolved: { url: string; mediaType: string },
  alt: string,
  fallbackLabel: string,
): string {
  if (resolved.mediaType.startsWith('image/')) {
    return `<img src="${quoteAttribute(resolved.url)}" alt="${quoteAttribute(alt)}" loading="lazy">`;
  }
  return (
    `<a class="media-file" href="${quoteAttribute(resolved.url)}" ` +
    `data-media-type="${quoteAttribute(resolved.mediaType)}">${alt === '' ? fallbackLabel : alt}</a>`
  );
}

/**
 * Marcas que viven dentro de una línea. Recibe texto crudo y devuelve HTML
 * seguro: escapa antes de cualquier otra cosa.
 *
 * Todo elemento que lleve atributos se emite y se guarda de inmediato,
 * dejando en su lugar una marca que ninguna regla posterior reconoce. Sin eso,
 * una regla que corre después reescribe lo que hay dentro de un atributo ya
 * emitido: `![a #x](u)` terminaba con un `<span class="tag">` metido dentro del
 * `alt`, y ese `class="tag"` cerraba el atributo y abría otros. El corpus lo
 * produjo solo, con un `*Begriffsschrift*` dentro de un texto alternativo.
 *
 * El orden entre marcas también importa. Las imágenes van antes que los
 * enlaces, porque `![alt](src)` contiene un `[alt](src)` que el enlace se
 * llevaría; y la nota al pie va antes por la misma razón, porque `[^3]` es un
 * corchete.
 */
export function inlineMarkdown(source: string, options: RenderOptions = {}): string {
  // El separador tiene que ser un carácter que el contenido no pueda traer.
  let html = escapeHtml(source.replace(/\u0000/g, ''));

  const held: string[] = [];
  const hold = (fragment: string): string => `${SLOT}${held.push(fragment) - 1}${SLOT}`;

  // Imagen. Una ruta que no pasa el filtro de esquema se degrada a su texto
  // alternativo en vez de desaparecer sin dejar rastro. El `alt` es texto
  // plano por definición de HTML, así que no recibe marcas.
  html = html.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (whole, alt: string, src: string) => {
      // Si Vera tiene el objeto, la ruta del corpus se traduce a él. Si no, se
      // emite tal cual y la presentación degrada sola.
      const resolved = options.resolveAsset?.(src) ?? null;
      if (resolved !== null) return hold(mediaElement(resolved, alt, src));

      const url = safeUrl(src);
      if (url === null) return alt === '' ? whole : alt;
      return hold(`<img src="${url}" alt="${quoteAttribute(alt)}" loading="lazy">`);
    },
  );

  // Referencia a nota al pie. Sólo el destino lleva id, así que dos bloques que
  // citen la misma nota no producen ids repetidos en la página.
  html = html.replace(/\[\^([^\]\s]+)\]/g, (_whole, id: string) =>
    hold(`<sup class="fnref"><a class="fnref-link" href="#fn-${encodeURIComponent(id)}">${id}</a></sup>`),
  );

  // Referencia a bloque. El identificador no lleva espacios ni paréntesis, de
  // modo que un texto con paréntesis anidados no se confunde con una.
  html = html.replace(/\(\(([^()\s]+)\)\)/g, (whole, id: string) => {
    const target = options.resolveBlock?.(id) ?? null;
    const label = target === null ? id : target.excerpt;
    return hold(
      `<a class="block-ref" data-block="${quoteAttribute(id)}" href="#"` +
        `${target === null ? ' data-dangling="true"' : ''}>${label}</a>`,
    );
  });

  html = html.replace(/\[\[([^\]]+)\]\]/g, (_whole, title: string) =>
    hold(`<a class="wiki" data-page="${quoteAttribute(title)}" href="#">${decorate(title)}</a>`),
  );

  html = html.replace(
    /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (whole, label: string, href: string) => {
      // El corpus también enlaza assets sin la marca de imagen —PDF, sobre
      // todo—, y esos apuntan al mismo objeto.
      const resolved = options.resolveAsset?.(href) ?? null;
      if (resolved !== null) {
        return hold(
          `<a class="media-file" href="${quoteAttribute(resolved.url)}" ` +
            `data-media-type="${quoteAttribute(resolved.mediaType)}">${decorate(label)}</a>`,
        );
      }

      const url = safeUrl(href);
      if (url === null) return whole;
      const external = /^https?:/i.test(url);
      const attributes = external ? ' rel="noreferrer" target="_blank"' : '';
      return hold(`<a href="${url}"${attributes}>${decorate(label)}</a>`);
    },
  );

  html = decorate(html).replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, '$1<span class="tag">#$2</span>');

  // Un elemento guardado puede contener la marca de otro —una imagen dentro de
  // un enlace—, así que se restituye hasta que no quede ninguna.
  for (let pass = 0; pass < 5 && html.includes(SLOT); pass += 1) {
    html = html.replace(new RegExp(`${SLOT}(\\d+)${SLOT}`, 'g'), (_w, at: string) => held[Number(at)] ?? '');
  }

  return html.replace(/\n/g, '<br>');
}

// --------------------------------------------------------------------------
// Estructura de bloque
// --------------------------------------------------------------------------

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)\d+[.)]\s+(.*)$/;
const FOOTNOTE = /^ {0,3}\[\^([^\]\s]+)\]:\s*(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_DIVIDER = /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/;

interface ListItem {
  indent: number;
  ordered: boolean;
  text: string;
}

/** Anida por sangría. Una lista dentro de un bloque rara vez pasa de dos niveles. */
function renderList(items: ListItem[], options: RenderOptions): string {
  let html = '';
  // Cada nivel abierto recuerda con qué etiqueta se abrió: una lista ordenada
  // dentro de una con viñetas tiene que cerrar con </ol>, no con </ul>.
  const open: { indent: number; tag: 'ul' | 'ol' }[] = [];
  const top = (): { indent: number; tag: 'ul' | 'ol' } | undefined => open[open.length - 1];

  for (const item of items) {
    while (open.length > 0 && item.indent < (top()?.indent ?? 0)) {
      html += `</li></${open.pop()?.tag}>`;
    }

    const current = top();
    if (current === undefined || item.indent > current.indent) {
      const tag = item.ordered ? 'ol' : 'ul';
      html += `<${tag}>`;
      open.push({ indent: item.indent, tag });
    } else if (current.tag !== (item.ordered ? 'ol' : 'ul')) {
      // Cambiar de viñetas a numeración al mismo nivel abre una lista nueva.
      html += `</li></${open.pop()?.tag}>`;
      const tag = item.ordered ? 'ol' : 'ul';
      html += `<${tag}>`;
      open.push({ indent: item.indent, tag });
    } else {
      html += '</li>';
    }

    html += `<li>${inlineMarkdown(item.text, options)}`;
  }

  while (open.length > 0) html += `</li></${open.pop()?.tag}>`;
  return html;
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/**
 * Renderiza el Markdown de un bloque completo.
 *
 * Devuelve HTML seguro: todo el texto pasa por `escapeHtml` antes de recibir
 * marcado, y ninguna rama emite atributos provenientes del contenido sin
 * escaparlos.
 */
export function renderMarkdown(source: string, options: RenderOptions = {}): string {
  const lines = source.split('\n');
  let html = '';
  let at = 0;

  const flushParagraph = (buffer: string[]): void => {
    if (buffer.length === 0) return;
    html += `<p>${inlineMarkdown(buffer.join('\n'), options)}</p>`;
    buffer.length = 0;
  };

  const paragraph: string[] = [];

  while (at < lines.length) {
    const line = lines[at] ?? '';

    // Código cercado. Su contenido se escapa y no recibe marcado en línea: un
    // ejemplo de código tiene que verse tal como se escribió.
    const fence = FENCE.exec(line);
    if (fence !== null) {
      flushParagraph(paragraph);
      const marker = fence[1] ?? '```';
      const language = fence[2] ?? '';
      const body: string[] = [];
      at += 1;
      while (at < lines.length) {
        const current = lines[at] ?? '';
        const closing = FENCE.exec(current);
        if (closing !== null && (closing[1] ?? '').startsWith(marker[0] ?? '`')) {
          at += 1;
          break;
        }
        body.push(current);
        at += 1;
      }
      // El lenguaje viene de la línea cruda, así que aquí sí hay que escapar
      // todo: `quoteAttribute` sólo completa lo que `escapeHtml` ya hizo.
      const attribute =
        language === '' ? '' : ` class="language-${quoteAttribute(escapeHtml(language))}"`;
      html += `<pre><code${attribute}>${escapeHtml(body.join('\n'))}</code></pre>`;
      continue;
    }

    if (line.trim() === '') {
      flushParagraph(paragraph);
      at += 1;
      continue;
    }

    if (RULE.test(line)) {
      flushParagraph(paragraph);
      html += '<hr>';
      at += 1;
      continue;
    }

    // El título de la página ya es el h1 del documento, así que un `#` de bloque
    // entra un nivel más abajo y el esquema de encabezados no queda con dos h1.
    const heading = HEADING.exec(line);
    if (heading !== null) {
      flushParagraph(paragraph);
      const level = Math.min(6, (heading[1] ?? '#').length + 1);
      html += `<h${level}>${inlineMarkdown(heading[2] ?? '', options)}</h${level}>`;
      at += 1;
      continue;
    }

    const footnote = FOOTNOTE.exec(line);
    if (footnote !== null) {
      flushParagraph(paragraph);
      const id = footnote[1] ?? '';
      html +=
        `<div class="footnote" id="fn-${encodeURIComponent(id)}">` +
        `<span class="footnote-id">${escapeHtml(id)}</span>` +
        `<span class="footnote-body">${inlineMarkdown(footnote[2] ?? '', options)}</span></div>`;
      at += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      flushParagraph(paragraph);
      const body: string[] = [];
      while (at < lines.length) {
        const quoted = QUOTE.exec(lines[at] ?? '');
        if (quoted === null) break;
        body.push(quoted[1] ?? '');
        at += 1;
      }
      html += `<blockquote>${inlineMarkdown(body.join('\n'), options)}</blockquote>`;
      continue;
    }

    // Tabla: exige la fila separadora, para no confundir con un texto que
    // simplemente contiene barras verticales.
    if (TABLE_ROW.test(line) && TABLE_DIVIDER.test(lines[at + 1] ?? '')) {
      flushParagraph(paragraph);
      const head = cells(line);
      at += 2;
      const body: string[][] = [];
      while (at < lines.length && TABLE_ROW.test(lines[at] ?? '')) {
        body.push(cells(lines[at] ?? ''));
        at += 1;
      }
      const headRow = head.map((cell) => `<th>${inlineMarkdown(cell, options)}</th>`).join('');
      const rows = body
        .map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell, options)}</td>`).join('')}</tr>`)
        .join('');
      html += `<div class="table-scroll"><table><thead><tr>${headRow}</tr></thead><tbody>${rows}</tbody></table></div>`;
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      flushParagraph(paragraph);
      const items: ListItem[] = [];
      while (at < lines.length) {
        const current = lines[at] ?? '';
        const bullet = BULLET.exec(current);
        const ordered = ORDERED.exec(current);
        if (bullet === null && ordered === null) break;
        const match = (ordered ?? bullet) as RegExpExecArray;
        items.push({
          indent: (match[1] ?? '').length,
          ordered: ordered !== null,
          text: match[2] ?? '',
        });
        at += 1;
      }
      html += renderList(items, options);
      continue;
    }

    paragraph.push(line);
    at += 1;
  }

  flushParagraph(paragraph);
  return html;
}
