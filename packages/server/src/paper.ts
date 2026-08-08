// La página en papel: el documento sin el taller alrededor.
//
// Exportar a PDF era pedirle al navegador que imprimiera, y lo que salía
// dependía de quién lo pidiera: márgenes del sistema, encabezados con la fecha y
// la dirección, y el tamaño de papel de la impresora que hubiera configurada. Un
// PDF que se guarda no puede depender de eso.
//
// Así que se compone aquí y se descarga hecho. El HTML lo dibuja `renderMarkdown`
// —el mismo que dibuja la pantalla, por eso vive en el dominio y no en el
// cliente— y quien lo pasa a papel es un Chrome sin ventana, encontrado como se
// encuentra whisper o llama: un binario en el sistema, y donde no lo haya se dice
// que no lo hay. @invariant TheModelIsLocalOrThereIsNone dice esto mismo para el
// modelo; aquí vale igual, y por la misma razón: componer un PDF fuera de casa
// sería mandar la página entera a un servidor ajeno para que la lea.
//
// Lo que el papel deja fuera lo decidió Herbert: las propiedades de la cabecera,
// las referencias del pie, los fondos y la sangría del esquema. Un papel no se
// navega —no hay dónde pulsar una propiedad ni a dónde llevar un retroenlace—, y
// lo que queda cuando se quita todo eso es el texto seguido, que es lo que un
// documento es cuando deja de ser una herramienta.

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { renderMarkdown, type RenderOptions } from '@vera/core';

import { findTool } from './transcribe.ts';

const run = promisify(execFile);

/** Los nombres con que un Chrome sin ventana se llama a sí mismo por ahí. */
const CHROMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome'];

export interface PaperBlock {
  stableId: string;
  parent: string | null;
  position: number;
  content: string;
}

export interface PaperOptions {
  title: string;
  blocks: readonly PaperBlock[];
  /** A qué resuelve cada `../assets/foo.png` que la página nombre. */
  assets?: readonly { path: string; url: string; mediaType: string }[];
  /** De qué servidores se aceptan incrustaciones, para decir de dónde venían. */
  embedHosts?: readonly string[];
  /**
   * Con sangría, para poder compararlo.
   *
   * El papel va sin ella: un esquema sangrado en pantalla se lee como jerarquía
   * porque las viñetas la sostienen, y en papel sin viñetas quedan escalones sin
   * causa. Queda la opción porque quitarla del todo es una apuesta y hay que
   * poder mirar las dos.
   */
  indent?: boolean;
}

/** El orden de lectura: cada bloque después de su padre, y los hijos por posición. */
function inReadingOrder(blocks: readonly PaperBlock[]): { block: PaperBlock; depth: number }[] {
  const byParent = new Map<string | null, PaperBlock[]>();
  for (const block of blocks) {
    const kin = byParent.get(block.parent) ?? [];
    kin.push(block);
    byParent.set(block.parent, kin);
  }
  for (const kin of byParent.values()) kin.sort((a, b) => a.position - b.position);

  const ordered: { block: PaperBlock; depth: number }[] = [];
  const walk = (parent: string | null, depth: number): void => {
    for (const block of byParent.get(parent) ?? []) {
      ordered.push({ block, depth });
      walk(block.stableId, depth + 1);
    }
  };
  walk(null, 0);

  /*
   * Un bloque cuyo padre no está en la página no se pierde.
   *
   * No debería pasar, y por eso mismo hay que decidir qué hacer si pasa: un
   * documento al que le falta un párrafo sin avisar es peor que uno con el
   * párrafo fuera de sitio.
   */
  if (ordered.length < blocks.length) {
    const seen = new Set(ordered.map((one) => one.block.stableId));
    for (const block of blocks) {
      if (!seen.has(block.stableId)) ordered.push({ block, depth: 0 });
    }
  }
  return ordered;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/*
 * La hoja de estilo del papel, que es corta a propósito.
 *
 * Carta, sin fondos, tinta negra. Las fuentes son las que Vera ya sirve —el
 * papel se pide al propio servidor, así que las alcanza por su ruta de siempre—
 * y no las del sistema, que en otra máquina serían otras.
 */
const STYLE = `
@font-face {
  font-family: 'IBM Plex Sans';
  src: url('/fonts/plex-sans-400.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
}
@font-face {
  font-family: 'IBM Plex Sans';
  src: url('/fonts/plex-sans-400-italic.woff2') format('woff2');
  font-weight: 400;
  font-style: italic;
}
@font-face {
  font-family: 'IBM Plex Sans';
  src: url('/fonts/plex-sans-600.woff2') format('woff2');
  font-weight: 600;
  font-style: normal;
}
@font-face {
  font-family: 'IBM Plex Mono';
  src: url('/fonts/plex-mono-400.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
}

@page {
  size: letter;
  margin: 25mm 22mm;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: none;
  color: #000;
  font-family: 'IBM Plex Sans', system-ui, sans-serif;
  font-size: 10.5pt;
  line-height: 1.55;
  -webkit-print-color-adjust: economy;
}

h1.paper-title {
  margin: 0 0 1.55rem;
  font-size: 18pt;
  font-weight: 600;
  line-height: 1.25;
}

.b { margin: 0; }

/* Un párrafo detrás de otro, sin hueco entre ellos: el texto va seguido y lo que
   separa es el sentido, no el aire. Lo que sí abre son los encabezados. */
.b > p { margin: 0 0 0.55rem; }

.b > :is(h1, h2, h3, h4, h5, h6) {
  margin: 1.55rem 0 0.4rem;
  font-weight: 600;
  break-after: avoid;
}

.b > h1 { font-size: 14pt; }
.b > h2 { font-size: 12.5pt; }
.b > h3 { font-size: 11.5pt; }
.b > :is(h4, h5, h6) { font-size: 10.5pt; }

.b > :first-child { margin-top: 0; }

.b ul, .b ol { margin: 0 0 0.55rem; padding-left: 1.4em; }
.b li { margin: 0; }

.b blockquote {
  margin: 0 0 0.55rem;
  padding-left: 1em;
  border-left: 1px solid #999;
}

.b code, .b pre {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.88em;
}

.b pre {
  margin: 0 0 0.55rem;
  padding: 0.5em 0.7em;
  border: 1px solid #ccc;
  white-space: pre-wrap;
  break-inside: avoid;
}

.b img { max-width: 100%; height: auto; }

.b table {
  width: 100%;
  margin: 0 0 0.55rem;
  border-collapse: collapse;
  break-inside: avoid;
}

.b :is(th, td) {
  padding: 0.25em 0.5em;
  border: 1px solid #bbb;
  text-align: left;
  vertical-align: top;
  background: none;
}

/* Los enlaces se leen, no se pulsan: en papel un color no lleva a ninguna parte. */
.b a { color: #000; text-decoration: underline; }

/* Lo que corre no corre en el papel. Queda dónde estaba, que es lo único que un
   papel puede llevar de una incrustación. */
.b .embed iframe { display: none; }
.b .embed figcaption { display: none; }
.b .embed::after {
  content: 'incrustado desde ' attr(data-source);
  display: block;
  padding: 0.4rem 0;
  border-top: 1px solid #999;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.75em;
  word-break: break-all;
}
`;

/**
 * El papel de una página: HTML completo, servido desde el propio Vera.
 *
 * Se sirve y no se escribe en un archivo temporal porque así las imágenes, las
 * fuentes y los medios se piden por su ruta de siempre y a su propio origen. Un
 * `file://` habría obligado a copiar cada objeto al lado del HTML y a reescribir
 * las rutas, y a que las dos formas de mirar la misma página no fueran la misma.
 */
export function paperHtml(options: PaperOptions): string {
  const render: RenderOptions = {};
  if (options.embedHosts !== undefined) render.embedHosts = options.embedHosts;
  const assets = options.assets ?? [];
  if (assets.length > 0) {
    const byPath = new Map(assets.map((asset) => [asset.path, asset]));
    render.resolveAsset = (path) => {
      const found = byPath.get(path);
      if (found !== undefined) return { url: found.url, mediaType: found.mediaType };
      try {
        return byPath.get(decodeURIComponent(path)) ?? null;
      } catch {
        return null;
      }
    };
  }

  const body = inReadingOrder(options.blocks)
    .filter(({ block }) => block.content.trim() !== '')
    .map(({ block, depth }) => {
      const sangría =
        options.indent === true && depth > 0 ? ` style="margin-left:${depth * 1.2}rem"` : '';
      return `<div class="b"${sangría}>${renderMarkdown(block.content, render)}</div>`;
    })
    .join('\n');

  return (
    `<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n` +
    `<title>${escapeHtml(options.title)}</title>\n<style>${STYLE}</style>\n</head>\n` +
    `<body>\n<h1 class="paper-title">${escapeHtml(options.title)}</h1>\n${body}\n</body>\n</html>\n`
  );
}

export interface PaperPresence {
  ready: boolean;
  binary: string | null;
}

/** ¿Hay con qué componer un PDF? Se pregunta antes de prometer nada. */
export function paperPresence(): PaperPresence {
  const binary = findTool(CHROMES, process.env['VERA_CHROME']);
  return { ready: binary !== null, binary };
}

/**
 * Pasa a PDF lo que haya en esa dirección.
 *
 * Con su propio perfil temporal: sin él, un Chrome sin ventana se encuentra con
 * el Chrome que la persona tiene abierto, y o falla o —peor— le habla. El perfil
 * se borra al terminar, salga bien o mal.
 */
export async function toPdf(
  url: string,
  options: { timeoutMs?: number } = {},
): Promise<{ pdf: Buffer } | { error: string }> {
  const presence = paperPresence();
  if (!presence.ready || presence.binary === null) {
    return { error: 'no hay un Chrome en esta máquina con el que componer el PDF' };
  }

  let workshop: string | null = null;
  try {
    workshop = await mkdtemp(join(tmpdir(), 'vera-paper-'));
    const out = join(workshop, 'pagina.pdf');
    await run(
      presence.binary,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        `--user-data-dir=${join(workshop, 'perfil')}`,
        // Sin encabezado ni pie: la fecha y la dirección que el navegador
        // estampa por su cuenta son suyas, no del documento.
        '--no-pdf-header-footer',
        // Y sin fondos: lo que se imprime es tinta sobre el papel que haya.
        `--print-to-pdf=${out}`,
        // Tiempo virtual: el reloj de la página corre acelerado hasta agotarlo,
        // así se esperan las fuentes y las imágenes sin esperarlas de verdad.
        '--virtual-time-budget=5000',
        url,
      ],
      { timeout: options.timeoutMs ?? 60_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const pdf = await readFile(out);
    return { pdf };
  } catch (error) {
    const why = error instanceof Error ? error.message : 'error desconocido';
    return { error: `no se pudo componer el PDF: ${why}` };
  } finally {
    if (workshop !== null) await rm(workshop, { recursive: true, force: true }).catch(() => undefined);
  }
}
