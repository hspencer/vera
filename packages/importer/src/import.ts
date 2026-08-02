// Importación de un grafo de archivos Logseq a Vera.
//
// Lee el origen estrictamente en solo lectura y es repetible: nunca escribe en
// el corpus de partida, para poder comparar el resultado cuantas veces haga
// falta.
//
// Emite operaciones al log con canal `import`. Nada entra por otra vía, así que
// el corpus importado queda con la misma procedencia que cualquier otro cambio.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { VeraGraph } from '@vera/core';
import type { Change, ParticipantId } from '@vera/core';

import {
  journalTitle,
  parseLogseqPage,
  referencedAssets,
  referencedMacros,
  titleFromFilename,
} from './logseq.ts';

/** Propiedades que describen el estado de la interfaz, no el contenido. */
const INTERFACE_PROPERTIES = new Set(['collapsed', 'heading', 'id']);

export interface LossReport {
  filesRead: number;
  unreadableFiles: string[];

  pagesSeen: number;
  pagesCreated: number;
  pagesRejected: { title: string; reason: string }[];
  pagesQualifiedByPath: { from: string; to: string }[];

  blocksSeen: number;
  blocksCreated: number;
  blocksRejected: { page: string; reason: string }[];

  propertiesSeen: number;
  propertiesCreated: number;

  adoptedStableIds: number;
  collapseStatesDropped: number;

  linksSeen: number;
  linksResolved: number;
  linksWaiting: number;

  tagsSeen: number;

  assetsReferenced: number;
  assetsFound: number;
  assetsMissing: string[];
  assetBytes: number;

  macrosPreserved: Record<string, number>;
  unportedQueries: number;
  queryMacrosBeyondFirstPerBlock: number;

  preambleLinesKept: number;
  emptyBlocksSkipped: number;
}

export interface ImportOptions {
  /** Raíz del grafo Logseq. Sólo se lee. */
  source: string;
  participant: ParticipantId;
  graph: VeraGraph;
  /** Límite de archivos, para ensayos rápidos. */
  limit?: number;
}

function emptyReport(): LossReport {
  return {
    filesRead: 0,
    unreadableFiles: [],
    pagesSeen: 0,
    pagesCreated: 0,
    pagesRejected: [],
    pagesQualifiedByPath: [],
    blocksSeen: 0,
    blocksCreated: 0,
    blocksRejected: [],
    propertiesSeen: 0,
    propertiesCreated: 0,
    adoptedStableIds: 0,
    collapseStatesDropped: 0,
    linksSeen: 0,
    linksResolved: 0,
    linksWaiting: 0,
    tagsSeen: 0,
    assetsReferenced: 0,
    assetsFound: 0,
    assetsMissing: [],
    assetBytes: 0,
    macrosPreserved: {},
    unportedQueries: 0,
    queryMacrosBeyondFirstPerBlock: 0,
    preambleLinesKept: 0,
    emptyBlocksSkipped: 0,
  };
}

function markdownFilesIn(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries.sort()) {
      const full = join(dir, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) walk(full);
      else if (entry.endsWith('.md')) found.push(full);
    }
  };
  walk(root);
  return found;
}

export function importLogseqGraph(options: ImportOptions): LossReport {
  const report = emptyReport();
  const { graph, participant } = options;

  const pagesRoot = join(options.source, 'pages');
  const journalsRoot = join(options.source, 'journals');
  const assetsRoot = join(options.source, 'assets');

  const files = [
    ...markdownFilesIn(pagesRoot).map((path) => ({ path, journal: false })),
    ...markdownFilesIn(journalsRoot).map((path) => ({ path, journal: true })),
  ].slice(0, options.limit ?? Number.MAX_SAFE_INTEGER);

  let counter = 0;
  const origin = (): string => {
    counter += 1;
    return `import:${counter}`;
  };

  const submit = (change: Change): string | null => {
    const outcome = graph.submitOperation({
      originId: origin(),
      participant,
      channel: 'import',
      change,
    });
    return outcome.status === 'applied' ? outcome.subjectId : null;
  };

  const assetSizes = new Map<string, number>();

  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file.path, 'utf8');
    } catch {
      report.unreadableFiles.push(relative(options.source, file.path));
      continue;
    }
    report.filesRead += 1;

    const filename = file.path.slice(file.path.lastIndexOf('/') + 1);
    // Una página en un subdirectorio conserva su ruta como espacio de nombres.
    // Sin esto, pages/Personas/Ann Morrison.md y pages/Ann Morrison.md compiten
    // por un mismo título y una de las dos se pierde.
    const withinRoot = relative(file.journal ? journalsRoot : pagesRoot, file.path);
    const parsed = parseLogseqPage(source);

    // El título declarado gana sobre el nombre de archivo: Logseq lo usa cuando
    // el nombre real no cabe en el sistema de archivos.
    const declared = parsed.properties.get('title');
    const title =
      (file.journal ? journalTitle(filename) : null) ??
      (declared !== undefined && declared !== '' ? declared : titleFromFilename(filename));

    report.pagesSeen += 1;

    const visibility = parsed.properties.get('public') === 'true' ? 'public' : 'private';
    let pageId = submit({ kind: 'create_page', title, visibility });
    let effectiveTitle = title;

    if (pageId === null) {
      // El nombre desnudo ya estaba tomado. Sólo entonces vale la pena calificar
      // con la ruta: hacerlo siempre rompería los [[enlaces]] que nombran el
      // título corto, que en este corpus son ciento veintitrés.
      const qualified = titleFromFilename(withinRoot);
      if (qualified !== title) {
        pageId = submit({ kind: 'create_page', title: qualified, visibility });
        if (pageId !== null) {
          effectiveTitle = qualified;
          report.pagesQualifiedByPath.push({ from: title, to: qualified });
        }
      }
    }

    if (pageId === null) {
      report.pagesRejected.push({ title, reason: 'a page already carries this title' });
      continue;
    }
    report.pagesCreated += 1;

    // Propiedades de página. `title` y `public` ya se consumieron arriba, pero
    // se conservan igual: son contenido que el corpus declaró.
    for (const [key, value] of parsed.properties) {
      // collapsed:: es estado de interfaz también cuando aparece en la cabecera.
      if (key === 'collapsed') {
        report.collapseStatesDropped += 1;
        continue;
      }
      report.propertiesSeen += 1;
      if (value === '') continue;
      const set = submit({
        kind: 'set_property',
        page: pageId,
        propertyKey: key,
        propertyValue: value,
      });
      if (set !== null) report.propertiesCreated += 1;
    }

    // El preámbulo que no era propiedad se conserva como primer bloque, para no
    // perder texto que alguien escribió.
    const blocks = [...parsed.blocks];
    if (parsed.preamble.length > 0) {
      report.preambleLinesKept += parsed.preamble.length;
      blocks.unshift({
        depth: 0,
        content: parsed.preamble.join('\n'),
        properties: new Map(),
      });
    }

    // Pila de ancestros por profundidad, para reconstruir el árbol.
    const ancestors: string[] = [];
    const positions = new Map<string, number>();

    for (const block of blocks) {
      report.blocksSeen += 1;

      if (block.content.trim() === '' && block.properties.size === 0) {
        report.emptyBlocksSkipped += 1;
        continue;
      }

      const depth = Math.min(block.depth, ancestors.length);
      const parent = depth > 0 ? (ancestors[depth - 1] ?? null) : null;
      const key = parent ?? pageId;
      const position = positions.get(key) ?? 0;
      positions.set(key, position + 1);

      const proposed = block.properties.get('id');
      const change: Change = {
        kind: 'create_block',
        page: pageId,
        parent,
        position,
        content: block.content,
        ...(proposed !== undefined ? { stableId: proposed } : {}),
      };

      const blockId = submit(change);
      if (blockId === null) {
        report.blocksRejected.push({
        page: effectiveTitle,
        reason: 'the stable id was already taken',
      });
        continue;
      }
      report.blocksCreated += 1;
      if (proposed !== undefined && blockId === proposed) report.adoptedStableIds += 1;

      ancestors[depth] = blockId;
      ancestors.length = depth + 1;

      // Propiedades del bloque. `collapsed` es estado de interfaz, no contenido.
      for (const [propertyKey, value] of block.properties) {
        if (propertyKey === 'collapsed') {
          report.collapseStatesDropped += 1;
          continue;
        }
        if (INTERFACE_PROPERTIES.has(propertyKey)) continue;
        report.propertiesSeen += 1;
        if (value === '') continue;
        const set = submit({
          kind: 'set_property',
          block: blockId,
          propertyKey,
          propertyValue: value,
        });
        if (set !== null) report.propertiesCreated += 1;
      }

      // Recuento de lo que el bloque trae, para el informe.
      for (const macro of referencedMacros(block.content)) {
        report.macrosPreserved[macro] = (report.macrosPreserved[macro] ?? 0) + 1;
      }
      for (const asset of referencedAssets(block.content)) {
        report.assetsReferenced += 1;
        const full = join(assetsRoot, asset.replace(/^\.\.\/assets\//, ''));
        if (assetSizes.has(full)) {
          report.assetsFound += 1;
          continue;
        }
        try {
          const stats = statSync(full);
          assetSizes.set(full, stats.size);
          report.assetsFound += 1;
          report.assetBytes += stats.size;
        } catch {
          report.assetsMissing.push(asset);
        }
      }
    }
  }

  // Estado final, leído del grafo y no de los contadores: si el importador se
  // equivocó al contar, esto lo delata.
  const links = graph.links();
  report.linksSeen = links.length;
  report.linksResolved = links.filter((l) => l.target !== null).length;
  report.linksWaiting = links.filter((l) => l.target === null).length;
  report.tagsSeen = graph.allBlocks().reduce((n, b) => n + graph.tagsOf(b.stableId).length, 0);
  report.unportedQueries = graph.unportedQueries().length;
  // Un bloque sólo lleva un registro de query sin portar. Si trae dos macros,
  // la segunda se conserva en el texto pero no genera su propio registro, y
  // eso hay que decirlo en vez de dejar cuadrar el informe por casualidad.
  report.queryMacrosBeyondFirstPerBlock =
    (report.macrosPreserved['query'] ?? 0) - report.unportedQueries;

  return report;
}

/** Hash de contenido para el almacén de objetos direccionado por hash. */
export function contentHash(bytes: Buffer): string {
  return `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
}
