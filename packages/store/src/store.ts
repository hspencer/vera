// Persistencia de Vera sobre SQLite.
//
// Reparto de responsabilidades, que conviene tener claro antes de leer el
// código: `operations` es el registro canónico y las tablas de estado son su
// materialización. Al arrancar, el log se reproduce sobre un VeraGraph y ese
// grafo responde las lecturas; las reglas viven en @vera/core y sólo allí, para
// que no existan dos implementaciones que puedan discrepar.
//
// Las tablas materializadas se mantienen igualmente al día porque son lo que
// consultan la proyección Markdown y, más adelante, el cliente WASM.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VeraGraph, titleKey } from '@vera/core';
import type { Change, Operation, ParticipantId, ParticipantKind } from '@vera/core';

const SCHEMA = join(dirname(fileURLToPath(import.meta.url)), '../../../schema/schema.sql');

export interface Store {
  readonly db: DatabaseSync;
  readonly graphId: string;
  close(): void;
}

export interface OpenOptions {
  /** Ruta al archivo; `:memory:` para una base efímera. */
  path: string;
  graphName?: string;
  graphId?: string;
}

export function openStore(options: OpenOptions): Store {
  const db = new DatabaseSync(options.path);
  db.exec(readFileSync(SCHEMA, 'utf8'));

  const graphId = options.graphId ?? 'graph:1';
  db.prepare('INSERT OR IGNORE INTO graphs (id, name) VALUES (?, ?)').run(
    graphId,
    options.graphName ?? 'mind',
  );
  db.prepare('INSERT OR IGNORE INTO change_logs (graph_id, last_sequence) VALUES (?, 0)').run(
    graphId,
  );

  return {
    db,
    graphId,
    close: () => db.close(),
  };
}

// ---------------------------------------------------------------------------
// Participantes
// ---------------------------------------------------------------------------

export function saveParticipant(
  store: Store,
  participant: { id: ParticipantId; name: string; kind: ParticipantKind; status?: string },
): void {
  store.db
    .prepare(
      `INSERT INTO participants (id, name, kind, status) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, status = excluded.status`,
    )
    .run(participant.id, participant.name, participant.kind, participant.status ?? 'active');
  store.db
    .prepare(
      `INSERT INTO memberships (graph_id, participant_id, status) VALUES (?, ?, 'active')
       ON CONFLICT (graph_id, participant_id) DO NOTHING`,
    )
    .run(store.graphId, participant.id);
}

// ---------------------------------------------------------------------------
// Escritura: una operación aplicada se vuelve durable
// ---------------------------------------------------------------------------

/**
 * Persiste una operación que @vera/core ya aceptó y aplicó, junto con el efecto
 * que dejó en el estado materializado. Todo ocurre en una transacción: una
 * operación aplica entera o no aparece.
 */
export function recordOperation(store: Store, graph: VeraGraph, operation: Operation): void {
  const { db } = store;
  // SAVEPOINT y no BEGIN: así una importación en lote puede envolver miles de
  // operaciones en una sola transacción exterior sin que esta anide mal.
  const savepoint = `op_${operation.sequence}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try {
    const submission = operation.submission;
    db.prepare(
      `INSERT INTO operations (
         id, graph_id, origin_id, sequence, participant_id, change_kind, change_payload,
         subject_id, channel, evidence_reference, evidence_captured_at, submitted_at, applied_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      operation.id,
      store.graphId,
      operation.originId,
      operation.sequence,
      submission.submittedBy,
      submission.change.kind,
      JSON.stringify(submission.change),
      operation.subjectId,
      submission.channel,
      submission.evidence?.reference ?? null,
      submission.evidence?.capturedAt ?? null,
      submission.submittedAt,
      operation.appliedAt,
    );

    db.prepare('UPDATE change_logs SET last_sequence = ? WHERE graph_id = ?').run(
      operation.sequence,
      store.graphId,
    );

    // La revisión que corresponde a ESTA operación, no la última del grafo: al
    // persistir en lote la última sería siempre la misma para todas.
    const revision = graph.revisions()[operation.sequence - 1];
    if (revision !== undefined) {
      db.prepare(
        `INSERT INTO revisions (id, operation_id, graph_id, page_id, block_id, authored_by, channel, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        `rev:${operation.sequence}`,
        operation.id,
        store.graphId,
        revision.page,
        revision.block,
        revision.authoredBy,
        revision.channel,
        revision.recordedAt,
      );
    }

    materialise(store, graph, submission.change, operation.subjectId);
    db.exec(`RELEASE ${savepoint}`);
  } catch (error) {
    db.exec(`ROLLBACK TO ${savepoint}`);
    db.exec(`RELEASE ${savepoint}`);
    throw error;
  }
}

/**
 * Carga masiva. Persiste el log entero y después materializa el estado final de
 * una sola vez.
 *
 * Hace falta una ruta aparte porque materialise() lee el estado actual del
 * grafo mientras recorre operaciones en orden histórico: un bloque creado en la
 * operación 100 puede enlazar a una página que nació en la 5000, y esa clave
 * ajena todavía no existiría. Aquí el orden deja de importar.
 */
export function recordAllOperations(store: Store, graph: VeraGraph): void {
  const { db } = store;
  db.exec('BEGIN');
  db.exec('PRAGMA defer_foreign_keys = ON');
  try {
    const insertOperation = db.prepare(
      `INSERT INTO operations (
         id, graph_id, origin_id, sequence, participant_id, change_kind, change_payload,
         subject_id, channel, evidence_reference, evidence_captured_at, submitted_at, applied_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertRevision = db.prepare(
      `INSERT INTO revisions (id, operation_id, graph_id, page_id, block_id, authored_by, channel, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const revisions = graph.revisions();
    for (const operation of graph.operations()) {
      const submission = operation.submission;
      insertOperation.run(
        operation.id,
        store.graphId,
        operation.originId,
        operation.sequence,
        submission.submittedBy,
        submission.change.kind,
        JSON.stringify(submission.change),
        operation.subjectId,
        submission.channel,
        submission.evidence?.reference ?? null,
        submission.evidence?.capturedAt ?? null,
        submission.submittedAt,
        operation.appliedAt,
      );
      const revision = revisions[operation.sequence - 1];
      if (revision !== undefined) {
        insertRevision.run(
          `rev:${operation.sequence}`,
          operation.id,
          store.graphId,
          revision.page,
          revision.block,
          revision.authoredBy,
          revision.channel,
          revision.recordedAt,
        );
      }
    }

    db.prepare('UPDATE change_logs SET last_sequence = ? WHERE graph_id = ?').run(
      graph.log().lastSequence,
      store.graphId,
    );

    materialiseAll(store, graph);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Vuelca el estado actual del grafo sobre las tablas materializadas. */
export function materialiseAll(store: Store, graph: VeraGraph): void {
  const { db } = store;
  for (const table of [
    'unported_queries',
    'block_tags',
    'page_links',
    'property_assignments',
    'blocks',
    'pages',
  ]) {
    db.exec(`DELETE FROM ${table}`);
  }

  const insertPage = db.prepare(
    `INSERT INTO pages (id, graph_id, title, title_key, visibility, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const page of graph.pages()) {
    insertPage.run(
      page.id,
      store.graphId,
      page.title,
      titleKey(page.title),
      page.visibility,
      page.createdAt,
    );
  }

  const insertBlock = db.prepare(
    `INSERT INTO blocks (id, page_id, parent_id, position, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const block of graph.allBlocks()) {
    insertBlock.run(
      block.stableId,
      block.page,
      block.parent,
      block.position,
      block.content,
      block.createdAt,
    );
  }

  const insertProperty = db.prepare(
    `INSERT INTO property_assignments (id, graph_id, page_id, block_id, key, value)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  let propertyCounter = 0;
  for (const page of graph.pages()) {
    for (const property of graph.propertiesOf(page.id)) {
      propertyCounter += 1;
      insertProperty.run(
        `prop:${propertyCounter}`,
        store.graphId,
        property.page,
        property.block,
        property.key,
        property.value,
      );
    }
  }
  for (const block of graph.allBlocks()) {
    for (const property of graph.propertiesOf(block.stableId)) {
      propertyCounter += 1;
      insertProperty.run(
        `prop:${propertyCounter}`,
        store.graphId,
        property.page,
        property.block,
        property.key,
        property.value,
      );
    }
  }

  const insertLink = db.prepare(
    `INSERT INTO page_links (id, graph_id, source_page, source_block, target_title, target_key, target_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertTag = db.prepare(
    'INSERT OR IGNORE INTO block_tags (block_id, page_id, tag) VALUES (?, ?, ?)',
  );
  for (const block of graph.allBlocks()) {
    for (const link of graph.linksOf(block.stableId)) {
      insertLink.run(
        link.id,
        store.graphId,
        link.sourcePage,
        link.sourceBlock,
        link.targetTitle,
        titleKey(link.targetTitle),
        link.target,
      );
    }
    for (const tag of graph.tagsOf(block.stableId)) {
      insertTag.run(block.stableId, block.page, tag);
    }
  }

  const insertUnported = db.prepare(
    `INSERT INTO unported_queries (id, graph_id, block_id, source_text, ported_to, ported_by, ported_at)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL)`,
  );
  for (const unported of graph.unportedQueries()) {
    insertUnported.run(unported.id, store.graphId, unported.block, unported.sourceText);
  }
}

function materialise(store: Store, graph: VeraGraph, change: Change, subjectId: string): void {
  const { db } = store;

  switch (change.kind) {
    case 'create_page':
    case 'rename_page':
    case 'set_page_visibility': {
      const page = graph.page(subjectId);
      if (page === undefined) return;
      db.prepare(
        `INSERT INTO pages (id, graph_id, title, title_key, visibility, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           title = excluded.title, title_key = excluded.title_key,
           visibility = excluded.visibility`,
      ).run(
        page.id,
        store.graphId,
        page.title,
        titleKey(page.title),
        page.visibility,
        page.createdAt,
      );
      // Renombrar reconecta enlaces en toda la base, no sólo en esta página.
      if (change.kind === 'rename_page') resyncAllLinks(store, graph);
      else resolveWaitingLinks(store, graph);
      return;
    }

    case 'remove_page': {
      // Igual que con el bloque: una página sólo se puede quitar cuando ya no
      // quedan bloques suyos, pero la página misma puede llevar propiedades, y
      // esas sí impiden borrarla.
      db.prepare('DELETE FROM property_assignments WHERE page_id = ?').run(subjectId);
      db.prepare('UPDATE page_links SET target_id = NULL WHERE target_id = ?').run(subjectId);
      db.prepare('DELETE FROM pages WHERE id = ?').run(subjectId);
      return;
    }

    case 'create_block':
    case 'edit_block':
    case 'move_block': {
      const block = graph.block(subjectId);
      if (block === undefined) return;

      // Dónde estaba antes, leído de la base mientras la fila todavía lo dice.
      // Mover deja un hueco en el grupo de origen, y sin esto ese grupo se
      // quedaría con las posiciones viejas.
      const before = db
        .prepare('SELECT page_id AS page, parent_id AS parent FROM blocks WHERE id = ?')
        .get(subjectId) as { page: string; parent: string | null } | undefined;

      db.prepare(
        `INSERT INTO blocks (id, page_id, parent_id, position, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           page_id = excluded.page_id, parent_id = excluded.parent_id,
           position = excluded.position, content = excluded.content`,
      ).run(
        block.stableId,
        block.page,
        block.parent,
        block.position,
        block.content,
        block.createdAt,
      );
      syncBlockRelations(store, graph, block.stableId);

      // Crear o mover sienta el bloque en un índice y renumera a sus hermanos.
      // Esa renumeración es parte de aplicar la operación, así que también tiene
      // que bajar a disco: si no, la memoria y la base contarían dos órdenes
      // distintos hasta el siguiente arranque.
      if (change.kind !== 'edit_block') {
        writeSiblingOrder(store, graph, block.page, block.parent);
        if (before !== undefined && (before.page !== block.page || before.parent !== block.parent)) {
          writeSiblingOrder(store, graph, before.page, before.parent);
        }
      }

      // Mover arrastra el subárbol, y con él la página que registran sus enlaces.
      if (change.kind === 'move_block') {
        for (const descendant of graph.descendantsOf(subjectId)) {
          db.prepare('UPDATE blocks SET page_id = ? WHERE id = ?').run(
            descendant.page,
            descendant.stableId,
          );
          syncBlockRelations(store, graph, descendant.stableId);
        }
      }
      return;
    }

    case 'remove_block': {
      // Dónde vivía, para poder cerrar el hueco en su grupo después de quitarlo.
      const home = db
        .prepare('SELECT page_id AS page, parent_id AS parent FROM blocks WHERE id = ?')
        .get(subjectId) as { page: string; parent: string | null } | undefined;

      // Las propiedades del bloque van primero. Su clave foránea no declara
      // ON DELETE, así que mientras exista una el borrado del bloque falla; y
      // como el bloque en memoria ya se había quitado, el fallo llegaba después
      // de que el dominio hubiera aceptado la operación.
      db.prepare('DELETE FROM property_assignments WHERE block_id = ?').run(subjectId);
      db.prepare('DELETE FROM page_links WHERE source_block = ?').run(subjectId);
      db.prepare('DELETE FROM block_tags WHERE block_id = ?').run(subjectId);
      db.prepare('DELETE FROM unported_queries WHERE block_id = ?').run(subjectId);
      db.prepare('DELETE FROM blocks WHERE id = ?').run(subjectId);
      if (home !== undefined) writeSiblingOrder(store, graph, home.page, home.parent);
      return;
    }

    case 'set_property':
    case 'remove_property': {
      db.prepare(
        `DELETE FROM property_assignments
         WHERE key = ? AND (page_id IS ? OR block_id IS ?)`,
      ).run(change.propertyKey, change.page ?? null, change.block ?? null);
      if (change.kind === 'set_property') {
        db.prepare(
          `INSERT INTO property_assignments (id, graph_id, page_id, block_id, key, value)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          `prop:${subjectId}:${change.propertyKey}`,
          store.graphId,
          change.page ?? null,
          change.block ?? null,
          change.propertyKey,
          change.propertyValue,
        );
      }
      return;
    }
  }
}

/** Reescribe enlaces, etiquetas y query preservada de un bloque. */
/**
 * Baja a disco el orden de un grupo de hermanos tal como lo dejó el dominio.
 *
 * Insertar entre hermanos es una sola operación, y renumerar al resto es parte
 * de aplicarla. El dominio ya lo hizo en memoria; esto lo hace persistente, que
 * es lo único que evita que la base y el grafo cuenten dos órdenes distintos.
 */
function writeSiblingOrder(
  store: Store,
  graph: VeraGraph,
  page: string,
  parent: string | null,
): void {
  const siblings =
    parent === null
      ? graph.blocksOf(page).filter((block) => block.parent === null)
      : graph.childrenOf(parent);

  const statement = store.db.prepare('UPDATE blocks SET position = ? WHERE id = ?');
  for (const sibling of siblings) statement.run(sibling.position, sibling.stableId);
}

function syncBlockRelations(store: Store, graph: VeraGraph, blockId: string): void {
  const { db } = store;
  db.prepare('DELETE FROM page_links WHERE source_block = ?').run(blockId);
  db.prepare('DELETE FROM block_tags WHERE block_id = ?').run(blockId);
  db.prepare('DELETE FROM unported_queries WHERE block_id = ?').run(blockId);

  const block = graph.block(blockId);
  if (block === undefined) return;

  for (const link of graph.linksOf(blockId)) {
    db.prepare(
      `INSERT INTO page_links (id, graph_id, source_page, source_block, target_title, target_key, target_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      link.id,
      store.graphId,
      link.sourcePage,
      link.sourceBlock,
      link.targetTitle,
      titleKey(link.targetTitle),
      link.target,
    );
  }

  for (const tag of graph.tagsOf(blockId)) {
    db.prepare(
      'INSERT OR IGNORE INTO block_tags (block_id, page_id, tag) VALUES (?, ?, ?)',
    ).run(blockId, block.page, tag);
  }

  const unported = graph.unportedQueries().find((u) => u.block === blockId);
  void block;
  if (unported !== undefined) {
    db.prepare(
      `INSERT INTO unported_queries (id, graph_id, block_id, source_text, ported_to, ported_by, ported_at)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL)`,
    ).run(unported.id, store.graphId, blockId, unported.sourceText);
  }
}

/** Conecta los enlaces que esperaban una página recién escrita. */
function resolveWaitingLinks(store: Store, graph: VeraGraph): void {
  const rows = store.db
    .prepare('SELECT id FROM page_links WHERE graph_id = ? AND target_id IS NULL')
    .all(store.graphId) as { id: string }[];
  if (rows.length === 0) return;
  const live = new Map(graph.links().map((l) => [l.id, l.target]));
  for (const row of rows) {
    const target = live.get(row.id);
    if (target != null) {
      store.db.prepare('UPDATE page_links SET target_id = ? WHERE id = ?').run(target, row.id);
    }
  }
}

/** Tras renombrar, la resolución de cualquier enlace pudo cambiar. */
function resyncAllLinks(store: Store, graph: VeraGraph): void {
  for (const link of graph.links()) {
    store.db
      .prepare('UPDATE page_links SET target_id = ? WHERE id = ?')
      .run(link.target, link.id);
  }
}

// ---------------------------------------------------------------------------
// Lectura: reproducir el log
// ---------------------------------------------------------------------------

interface OperationRow {
  id: string;
  origin_id: string;
  sequence: number;
  participant_id: string;
  change_payload: string;
  subject_id: string;
  channel: string;
  evidence_reference: string | null;
  evidence_captured_at: number | null;
  submitted_at: number;
}

/**
 * Reconstruye el grafo desde el registro de operaciones. El estado
 * materializado no se lee para esto a propósito: si el log y las tablas
 * discreparan, manda el log.
 */
export function loadGraph(store: Store, graphName = 'mind'): VeraGraph {
  const graph = VeraGraph.create({ name: graphName, id: store.graphId });

  const participants = store.db
    .prepare('SELECT id, name, kind, status FROM participants')
    .all() as { id: string; name: string; kind: string; status: string }[];
  for (const p of participants) {
    graph.addParticipant({ id: p.id, name: p.name, kind: p.kind as ParticipantKind });
    graph.admit(p.id);
  }

  const rows = store.db
    .prepare(
      `SELECT id, origin_id, sequence, participant_id, change_payload, subject_id, channel,
              evidence_reference, evidence_captured_at, submitted_at
       FROM operations WHERE graph_id = ? ORDER BY sequence`,
    )
    .all(store.graphId) as unknown as OperationRow[];

  for (const row of rows) {
    graph.submitOperation({
      originId: row.origin_id,
      participant: row.participant_id,
      channel: row.channel as 'typed_text' | 'authenticated_voice' | 'agent_generation' | 'import',
      change: JSON.parse(row.change_payload) as Change,
      submittedAt: row.submitted_at,
      ...(row.evidence_reference === null
        ? {}
        : {
            evidence: {
              reference: row.evidence_reference,
              capturedAt: row.evidence_captured_at ?? 0,
            },
          }),
    });
  }

  // Los participantes suspendidos vuelven a serlo después de reproducir: durante
  // la reproducción deben poder aplicar lo que aplicaron en su día.
  for (const p of participants) {
    if (p.status === 'suspended' && p.id !== graph.owner) graph.suspend(p.id);
  }

  return graph;
}

// ---------------------------------------------------------------------------
// Búsqueda por FTS5
// ---------------------------------------------------------------------------

export interface StoredHit {
  page: string;
  block: string | null;
  field: 'page_title' | 'block_content';
  excerpt: string;
  rank: number;
}

/**
 * Búsqueda respaldada por el índice de texto completo de SQLite. Existe para
 * demostrar que la ruta SQL responde lo mismo que el grafo en memoria; el
 * plegado de diacríticos lo aporta el tokenizador declarado en el esquema.
 */
export function searchStore(store: Store, text: string, limit = 50): StoredHit[] {
  if (text.trim() === '') return [];
  const term = `"${text.replace(/"/g, '""')}"`;

  const pages = store.db
    .prepare(
      `SELECT p.id AS page, p.title AS excerpt
       FROM pages_fts f JOIN pages p ON p.rowid = f.rowid
       WHERE pages_fts MATCH ? AND p.graph_id = ?
       ORDER BY p.id LIMIT ?`,
    )
    .all(term, store.graphId, limit) as { page: string; excerpt: string }[];

  const blocks = store.db
    .prepare(
      `SELECT b.page_id AS page, b.id AS block, substr(b.content, 1, 120) AS excerpt
       FROM blocks_fts f JOIN blocks b ON b.rowid = f.rowid
       WHERE blocks_fts MATCH ?
       ORDER BY b.id LIMIT ?`,
    )
    .all(term, limit) as { page: string; block: string; excerpt: string }[];

  return [
    ...pages.map((row) => ({ ...row, block: null, field: 'page_title' as const })),
    ...blocks.map((row) => ({ ...row, field: 'block_content' as const })),
  ].map((hit, at) => ({ ...hit, rank: at + 1 }));
}

/** Vecindad resuelta con una consulta recursiva, no con un recorrido en JS. */
export function neighbourhoodFromStore(
  store: Store,
  centre: string,
  depth: number,
): { page: string; distance: number }[] {
  return store.db
    .prepare(
      `WITH RECURSIVE edges(a, b) AS (
         SELECT source_page, target_id FROM page_links
          WHERE target_id IS NOT NULL AND graph_id = ?1 AND source_page <> target_id
         UNION
         SELECT target_id, source_page FROM page_links
          WHERE target_id IS NOT NULL AND graph_id = ?1 AND source_page <> target_id
       ),
       reach(page, distance) AS (
         SELECT ?2, 0
         UNION
         SELECT edges.b, reach.distance + 1
           FROM edges JOIN reach ON edges.a = reach.page
          WHERE reach.distance < ?3
       )
       SELECT page, min(distance) AS distance FROM reach GROUP BY page ORDER BY distance, page`,
    )
    .all(store.graphId, centre, depth) as { page: string; distance: number }[];
}

// ---------------------------------------------------------------------------
// Medios
// ---------------------------------------------------------------------------

export interface MediaRecord {
  hash: string;
  mediaType: string;
  byteSize: number;
  originalName: string | null;
}

/**
 * Registra un objeto ya guardado y la ruta por la que el Markdown lo nombra.
 *
 * `media` está indexada por contenido, así que dos rutas con los mismos bytes
 * comparten fila: el `INSERT OR IGNORE` es la deduplicación, no un descuido.
 */
export function recordMedia(
  store: Store,
  reference: { path: string; hash: string; mediaType: string; byteSize: number; at: number },
): void {
  store.db
    .prepare(
      `INSERT OR IGNORE INTO media (hash, media_type, byte_size, custody, original_name, created_at)
       VALUES (?, ?, ?, 'internal', ?, ?)`,
    )
    .run(
      reference.hash,
      reference.mediaType,
      reference.byteSize,
      reference.path,
      reference.at,
    );

  store.db
    .prepare(
      'INSERT OR REPLACE INTO media_references (graph_id, path, hash) VALUES (?, ?, ?)',
    )
    .run(store.graphId, reference.path, reference.hash);
}

export function mediaByHash(store: Store, hash: string): MediaRecord | null {
  const row = store.db
    .prepare('SELECT hash, media_type, byte_size, original_name FROM media WHERE hash = ?')
    .get(hash) as
    | { hash: string; media_type: string; byte_size: number; original_name: string | null }
    | undefined;

  if (row === undefined) return null;
  return {
    hash: row.hash,
    mediaType: row.media_type,
    byteSize: row.byte_size,
    originalName: row.original_name,
  };
}

/** Resolución de las rutas de este grafo: lo que la presentación necesita. */
export function mediaReferences(store: Store): { path: string; hash: string; mediaType: string }[] {
  return store.db
    .prepare(
      `SELECT r.path AS path, r.hash AS hash, m.media_type AS mediaType
         FROM media_references r JOIN media m ON m.hash = r.hash
        WHERE r.graph_id = ?
        ORDER BY r.path`,
    )
    .all(store.graphId) as { path: string; hash: string; mediaType: string }[];
}

// ---------------------------------------------------------------------------
// Estado de plegado
// ---------------------------------------------------------------------------
//
// @invariant FoldingIsNotAChange: plegar es lo que una persona está mirando, no
// lo que dice el grafo. No pasa por `submitOperation`, no genera revisión y no
// aparece en el registro. Por eso vive en su propia tabla, indexada por
// participante: dos personas pueden tener el mismo bloque abierto y cerrado.

export function setFold(
  store: Store,
  participant: string,
  block: string,
  folded: boolean,
): void {
  if (!folded) {
    // Lo desplegado es el estado por omisión, así que se representa por ausencia
    // en vez de guardar un cero por cada bloque que alguien abrió alguna vez.
    store.db
      .prepare('DELETE FROM block_collapse_state WHERE participant_id = ? AND block_id = ?')
      .run(participant, block);
    return;
  }

  store.db
    .prepare(
      `INSERT INTO block_collapse_state (participant_id, block_id, collapsed) VALUES (?, ?, 1)
       ON CONFLICT (participant_id, block_id) DO UPDATE SET collapsed = 1`,
    )
    .run(participant, block);
}

/** Los bloques que este participante tiene plegados en una página. */
export function foldedOnPage(store: Store, participant: string, page: string): string[] {
  return (
    store.db
      .prepare(
        `SELECT s.block_id AS block
           FROM block_collapse_state s JOIN blocks b ON b.id = s.block_id
          WHERE s.participant_id = ? AND b.page_id = ? AND s.collapsed = 1`,
      )
      .all(participant, page) as { block: string }[]
  ).map((row) => row.block);
}
