// Proyección Markdown de la base canónica.
//
// Una sola dirección: base → Markdown. logseq-block-identity-reference.allium
// excluye explícitamente importar ediciones desde el espejo, así que esto no
// tiene vuelta y no la pretende.
//
// Requisito duro: determinismo. Proyectar dos veces el mismo estado produce
// bytes idénticos, o el `git diff` deja de significar nada.
//
// @guarantee CleanMarkdownProjection: las líneas llevan contenido y estructura,
// nunca metadata de identidad generada. La correspondencia entre stable_id y
// ruta vive en el manifiesto, fuera del texto.

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { VeraGraph } from '@vera/core';
import type { Block, Page } from '@vera/core';

export interface ProjectionSummary {
  pages: number;
  journals: number;
  blocks: number;
  files: string[];
}

export interface ManifestEntry {
  path: string;
  title: string;
  visibility: 'private' | 'public';
  /** stable_id de cada bloque en el orden en que aparece en el archivo. */
  blocks: string[];
}

const JOURNAL = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Nombre de archivo para un título. Invierte la lectura del importador: la
 * barra vuelve a `___` y lo que no cabe en un nombre de archivo se escapa en
 * porcentaje.
 */
export function filenameFor(title: string): string {
  const escaped = title
    .replace(/\//g, '___')
    .replace(/[<>:"\\|?*\u0000-\u001f]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
  return `${escaped}.md`;
}

/** Ordena los hijos de un bloque por posición, con el identificador como desempate. */
function sortBlocks(blocks: Block[]): Block[] {
  return [...blocks].sort(
    (a, b) => a.position - b.position || (a.stableId < b.stableId ? -1 : a.stableId > b.stableId ? 1 : 0),
  );
}

/**
 * Cuerpo Markdown de una página. Las propiedades salen en el orden en que se
 * asignaron, que es determinista porque el log se reproduce siempre igual, y
 * además conserva el orden que traía el corpus.
 */
export function renderPage(graph: VeraGraph, page: Page): { text: string; blocks: string[] } {
  const lines: string[] = [];

  for (const property of graph.propertiesOf(page.id)) {
    lines.push(`${property.key}:: ${property.value}`);
  }
  if (lines.length > 0) lines.push('');

  const order: string[] = [];
  const all = graph.blocksOf(page.id);
  const byParent = new Map<string | null, Block[]>();
  for (const block of all) {
    const key = block.parent;
    const held = byParent.get(key) ?? [];
    held.push(block);
    byParent.set(key, held);
  }

  const emit = (parent: string | null, depth: number): void => {
    for (const block of sortBlocks(byParent.get(parent) ?? [])) {
      const indent = '\t'.repeat(depth);
      const [first = '', ...rest] = block.content.split('\n');
      lines.push(`${indent}- ${first}`);
      // Las líneas siguientes van a la indentación del bloque más dos espacios,
      // que es como Logseq marca la continuación.
      for (const line of rest) lines.push(`${indent}  ${line}`);

      // Las propiedades del bloque son contenido; su identidad no.
      for (const property of graph.propertiesOf(block.stableId)) {
        lines.push(`${indent}  ${property.key}:: ${property.value}`);
      }

      order.push(block.stableId);
      emit(block.stableId, depth + 1);
    }
  };
  emit(null, 0);

  return { text: `${lines.join('\n').replace(/\s+$/, '')}\n`, blocks: order };
}

/** Vacía un directorio de proyección sin tocar su `.git`. */
function clearProjection(dir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === '.git') continue;
    rmSync(join(dir, entry), { recursive: true, force: true });
  }
}

export function projectGraph(graph: VeraGraph, target: string): ProjectionSummary {
  mkdirSync(target, { recursive: true });
  clearProjection(target);
  mkdirSync(join(target, 'pages'), { recursive: true });
  mkdirSync(join(target, 'journals'), { recursive: true });

  const manifest: ManifestEntry[] = [];
  const summary: ProjectionSummary = { pages: 0, journals: 0, blocks: 0, files: [] };

  // Orden estable de páginas: por título, no por identificador ni por orden de
  // creación, para que el diff no dependa de cuándo se escribió cada cosa.
  const pages = [...graph.pages()].sort((a, b) =>
    a.title < b.title ? -1 : a.title > b.title ? 1 : 0,
  );

  for (const page of pages) {
    const journal = JOURNAL.exec(page.title);
    const relative =
      journal === null
        ? join('pages', filenameFor(page.title))
        : join('journals', `${journal[1]}_${journal[2]}_${journal[3]}.md`);

    const { text, blocks } = renderPage(graph, page);
    writeFileSync(join(target, relative), text, 'utf8');

    manifest.push({
      path: relative,
      title: page.title,
      visibility: page.visibility,
      blocks,
    });
    summary.files.push(relative);
    summary.blocks += blocks.length;
    if (journal === null) summary.pages += 1;
    else summary.journals += 1;
  }

  // El manifiesto conserva lo que el Markdown limpio no puede llevar: qué
  // stable_id corresponde a cada línea. Sin él la proyección sería legible pero
  // no reconstruible.
  writeFileSync(
    join(target, 'manifest.json'),
    `${JSON.stringify(
      {
        graph: graph.name,
        lastSequence: graph.log().lastSequence,
        pages: manifest,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  writeFileSync(
    join(target, 'README.md'),
    [
      `# ${graph.name}`,
      '',
      'Proyección Markdown del grafo de Vera. Se genera; no se edita a mano.',
      '',
      `- páginas: ${summary.pages}`,
      `- journals: ${summary.journals}`,
      `- bloques: ${summary.blocks}`,
      '',
      'La identidad estable de cada bloque vive en `manifest.json`, no en el texto:',
      'el Markdown lleva contenido y estructura, nunca metadata técnica.',
      '',
      'Editar aquí no cambia nada en Vera. La proyección es de una sola dirección.',
      '',
    ].join('\n'),
    'utf8',
  );

  return summary;
}

/** Comprueba que dos proyecciones consecutivas coinciden byte a byte. */
export function projectionIsDeterministic(graph: VeraGraph, targetA: string, targetB: string): boolean {
  projectGraph(graph, targetA);
  projectGraph(graph, targetB);

  const listing = (dir: string): string[] => {
    const found: string[] = [];
    const walk = (at: string, prefix: string): void => {
      for (const entry of readdirSync(at).sort()) {
        if (entry === '.git') continue;
        const full = join(at, entry);
        if (statSync(full).isDirectory()) walk(full, `${prefix}${entry}/`);
        else found.push(`${prefix}${entry}`);
      }
    };
    walk(dir, '');
    return found;
  };

  const a = listing(targetA);
  const b = listing(targetB);
  if (a.length !== b.length || a.some((name, at) => name !== b[at])) return false;

  for (const name of a) {
    // Comparación binaria: byte a byte, no de texto normalizado.
    if (!readFileSync(join(targetA, name)).equals(readFileSync(join(targetB, name)))) {
      return false;
    }
  }
  return true;
}
