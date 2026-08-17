// El archivo portable de un grafo Vera.
//
// Es JSON deliberadamente: se puede inspeccionar y recuperar sin instalar Vera.
// Los objetos viajan en base64 junto al estado actual y el registro completo de
// operaciones. La importación usa el estado actual; el registro queda dentro del
// archivo para que una copia descargada no pierda la historia.

import type { VeraGraph } from '@vera/core';
import type { Store } from '@vera/store';
import { readObject } from '@vera/store/objects';

export const VERA_FILE_FORMAT = 'vera-graph';
export const VERA_FILE_VERSION = 1;

export interface VeraFile {
  format: typeof VERA_FILE_FORMAT;
  version: typeof VERA_FILE_VERSION;
  exportedAt: number;
  graph: {
    id: string;
    name: string;
    owner: string | null;
    participants: { id: string; name: string; kind: 'human' | 'agent'; status: string }[];
    pages: {
      id: string;
      title: string;
      visibility: 'private' | 'public';
      originCreatedAt: number | null;
      properties: { key: string; value: string }[];
      blocks: {
        id: string;
        parent: string | null;
        position: number;
        content: string;
        properties: { key: string; value: string }[];
        gloss: string | null;
      }[];
    }[];
    operations: unknown[];
  };
  assets: {
    path: string;
    hash: string;
    mediaType: string;
    byteSize: number;
    originalName: string | null;
    description: string | null;
    alternativeText: string | null;
    bytes: string;
  }[];
}

export function makeVeraFile(store: Store, graph: VeraGraph, objectsRoot: string | null): VeraFile {
  const participants = store.db
    .prepare('SELECT id, name, kind, status FROM participants ORDER BY id')
    .all() as VeraFile['graph']['participants'];

  // Una fila por referencia, no por hash: dos nombres pueden apuntar a los
  // mismos bytes y ambos forman parte del corpus. Los objetos que sólo sostienen
  // una grabación también viajan, con una ruta recuperable por su hash.
  const media = store.db.prepare(
    `SELECT m.hash, m.media_type AS mediaType, m.byte_size AS byteSize,
            m.original_name AS originalName, m.description,
            m.alternative_text AS alternativeText,
            COALESCE(r.path, '../assets/' || m.hash) AS path
       FROM media m
       LEFT JOIN media_references r ON r.hash = m.hash AND r.graph_id = ?
      ORDER BY m.hash, r.path`,
  ).all(store.graphId) as Omit<VeraFile['assets'][number], 'bytes'>[];
  const assets = media.map((asset) => ({
    path: asset.path,
    hash: asset.hash,
    mediaType: asset.mediaType,
    byteSize: asset.byteSize,
    originalName: asset.originalName,
    description: asset.description,
    alternativeText: asset.alternativeText,
    bytes: objectsRoot === null ? '' : Buffer.from(readObject(objectsRoot, asset.hash)).toString('base64'),
  }));

  return {
    format: VERA_FILE_FORMAT,
    version: VERA_FILE_VERSION,
    exportedAt: Date.now(),
    graph: {
      id: graph.id,
      name: graph.name,
      owner: graph.owner,
      participants,
      pages: graph.pages().map((page) => ({
        id: page.id,
        title: page.title,
        visibility: page.visibility,
        originCreatedAt: page.originCreatedAt,
        properties: graph.propertiesOf(page.id).map(({ key, value }) => ({ key, value })),
        blocks: graph.blocksOf(page.id).map((block) => ({
          id: block.stableId,
          parent: block.parent,
          position: block.position,
          content: block.content,
          properties: graph.propertiesOf(block.stableId).map(({ key, value }) => ({ key, value })),
          gloss: graph.gloss(block.stableId)?.content ?? null,
        })),
      })),
      operations: graph.operations(),
    },
    assets,
  };
}

export function readVeraFile(bytes: Uint8Array): VeraFile | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return { error: 'el archivo .vera no contiene JSON válido' };
  }
  if (typeof value !== 'object' || value === null) return { error: 'el archivo .vera está vacío' };
  const file = value as Partial<VeraFile>;
  if (file.format !== VERA_FILE_FORMAT) return { error: 'no es un archivo de grafo Vera' };
  if (file.version !== VERA_FILE_VERSION) return { error: `versión .vera no compatible: ${String(file.version)}` };
  if (!Array.isArray(file.graph?.pages) || !Array.isArray(file.assets)) return { error: 'el archivo .vera está incompleto' };
  const validProperties = (properties: unknown): properties is { key: string; value: string }[] =>
    Array.isArray(properties) && properties.every((one) =>
      typeof one === 'object' && one !== null &&
      typeof (one as { key?: unknown }).key === 'string' &&
      typeof (one as { value?: unknown }).value === 'string');
  for (const page of file.graph.pages) {
    if (typeof page?.id !== 'string' || typeof page.title !== 'string' || !Array.isArray(page.blocks) || !validProperties(page.properties)) {
      return { error: 'el archivo .vera contiene una página inválida' };
    }
    for (const block of page.blocks) {
      if (typeof block?.id !== 'string' ||
          !(block.parent === null || typeof block.parent === 'string') ||
          typeof block.position !== 'number' || typeof block.content !== 'string' ||
          !validProperties(block.properties) ||
          !(block.gloss === null || typeof block.gloss === 'string')) {
        return { error: 'el archivo .vera contiene un bloque inválido' };
      }
    }
  }
  for (const asset of file.assets) {
    if (typeof asset?.path !== 'string' || typeof asset.hash !== 'string' || typeof asset.bytes !== 'string') {
      return { error: 'el archivo .vera contiene un asset inválido' };
    }
  }
  return file as VeraFile;
}
