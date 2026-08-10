// El registro de exposición: qué salió de la memoria, hacia dónde y con qué
// concesión.
//
// El log de operaciones cuenta lo que se escribió, y eso bastaba mientras todo
// el que entraba escribía. Una inteligencia artificial hace algo que el log no
// ve: recibe. Se lleva páginas, extractos y contexto sin modificar una coma, y
// de eso no quedaba rastro. Cotito lleva 6.844 operaciones escritas y cero
// lecturas registradas, y no porque no haya leído.
//
// Vive en la API y no en el adaptador MCP, y la diferencia es la que decide si
// esto sirve para algo: puesto en MCP, el mayor lector del corpus —un agente
// que entra por HTTP directo, como Cotito hoy— quedaría fuera del registro, y
// un registro con un agujero del tamaño de su lector principal es decorativo.
// Aquí lo hereda toda puerta: la web, MCP, curl y lo que venga después.
//
// Ver specs/mcp-server.allium, contrato WhatWasReadIsRecorded.

import type { Store } from './store.ts';

export interface Exposure {
  /** Quién se lo llevó. Sale de la credencial, nunca de lo que diga quien pide. */
  participant: string;
  /** Con qué credencial, para poder revocar sabiendo qué se revoca. */
  credential?: string | null;
  /** Qué cliente dijo ser. Se registra y no se cree. */
  client?: string | null;
  /** Por dónde entró: la ruta o la herramienta. */
  surface: string;
  /** Qué pidió, dicho como lo pidió. */
  subject: string;
  /** Qué se le entregó: identidades estables de páginas y bloques. */
  delivered?: readonly string[];
  /** Cómo acabó: `served`, `refused`, `empty`. */
  outcome?: string;
  /** Cuánto viajó, en caracteres. */
  volume?: number;
  at: number;
}

export interface RecordedExposure extends Exposure {
  id: string;
  delivered: readonly string[];
  outcome: string;
  volume: number;
}

let counter = 0;

/**
 * Anota una entrega.
 *
 * @invariant NoDeliveryWithoutItsRecord. Se llama antes de responder y no
 * después: una anotación que ocurre después de que el texto salió por el cable
 * es una anotación que un proceso caído convierte en lectura invisible.
 *
 * Lo que no se guarda es la respuesta. Copiar el texto entregado dejaría una
 * segunda copia del corpus dentro del registro que existe para vigilarlo, y
 * crecería más rápido que el corpus mismo. Se guarda a qué apuntaba —las
 * direcciones estables— y cuánto medía.
 */
export function recordExposure(store: Store, exposure: Exposure): string {
  counter += 1;
  const id = `exposure:${exposure.at.toString(36)}:${counter.toString(36)}`;
  const delivered = [...new Set(exposure.delivered ?? [])];
  store.db
    .prepare(
      `INSERT INTO exposures
         (id, graph_id, participant_id, credential_id, client, surface, subject, outcome, volume, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      store.graphId,
      exposure.participant,
      exposure.credential ?? null,
      exposure.client ?? null,
      exposure.surface,
      exposure.subject,
      exposure.outcome ?? 'served',
      Math.max(0, Math.round(exposure.volume ?? 0)),
      exposure.at,
    );
  if (delivered.length > 0) {
    const insert = store.db.prepare(
      'INSERT OR IGNORE INTO exposed_subjects (exposure_id, subject_id) VALUES (?, ?)',
    );
    for (const subject of delivered) insert.run(id, subject);
  }
  return id;
}

interface Row {
  id: string;
  participant_id: string;
  credential_id: string | null;
  client: string | null;
  surface: string;
  subject: string;
  outcome: string;
  volume: number;
  at: number;
}

const shape = (store: Store, row: Row): RecordedExposure => ({
  id: row.id,
  participant: row.participant_id,
  credential: row.credential_id,
  client: row.client,
  surface: row.surface,
  subject: row.subject,
  outcome: row.outcome,
  volume: row.volume,
  at: row.at,
  delivered: (
    store.db
      .prepare('SELECT subject_id FROM exposed_subjects WHERE exposure_id = ? ORDER BY subject_id')
      .all(row.id) as { subject_id: string }[]
  ).map((one) => one.subject_id),
});

/**
 * Lo que se ha llevado alguien, o todo el mundo, empezando por lo último.
 *
 * Esto es la mitad que le faltaba a la página de participantes: hasta ahora se
 * podía ver qué había escrito un agente y no qué se había llevado.
 */
export function exposuresOf(
  store: Store,
  options: { participant?: string | undefined; since?: number | undefined; most?: number | undefined } = {},
): RecordedExposure[] {
  const most = Math.max(1, Math.min(1000, options.most ?? 100));
  const rows = store.db
    .prepare(
      `SELECT * FROM exposures
        WHERE graph_id = ?
          AND (? IS NULL OR participant_id = ?)
          AND at >= ?
        ORDER BY at DESC, rowid DESC
        LIMIT ?`,
    )
    .all(
      store.graphId,
      options.participant ?? null,
      options.participant ?? null,
      options.since ?? 0,
      most,
    ) as unknown as Row[];
  return rows.map((row) => shape(store, row));
}

/**
 * Quién ha leído esto.
 *
 * La pregunta al revés, que es la que uno se hace cuando encuentra una página
 * que no debería haber salido de casa.
 */
export function whoRead(store: Store, subject: string, most = 100): RecordedExposure[] {
  const rows = store.db
    .prepare(
      `SELECT e.* FROM exposures e
         JOIN exposed_subjects s ON s.exposure_id = e.id
        WHERE e.graph_id = ? AND s.subject_id = ?
        ORDER BY e.at DESC, e.rowid DESC
        LIMIT ?`,
    )
    .all(store.graphId, subject, Math.max(1, Math.min(1000, most))) as unknown as Row[];
  return rows.map((row) => shape(store, row));
}

export interface SeenClient {
  /** Cómo se declaró. Nulo cuando no dijo nada. */
  client: string | null;
  participant: string;
  /** Cuántas entregas, y cuánto midieron en total. */
  deliveries: number;
  volume: number;
  firstAt: number;
  lastAt: number;
}

/**
 * Quién ha estado leyendo, agrupado por cómo se declaró.
 *
 * Es lo que la página de la puerta MCP pone al lado de cada conexión declarada:
 * lo que se decidió a un lado, lo que pasó al otro. Donde las dos columnas no
 * coinciden —una conexión declarada como un agente que lee como el dueño— es
 * donde está el agujero, y verlo es todo el punto de la página.
 */
export function clientsSeen(store: Store, since = 0): SeenClient[] {
  const rows = store.db
    .prepare(
      `SELECT client, participant_id, COUNT(*) AS n, SUM(volume) AS volume,
              MIN(at) AS first_at, MAX(at) AS last_at
         FROM exposures
        WHERE graph_id = ? AND at >= ?
        GROUP BY client, participant_id
        ORDER BY last_at DESC`,
    )
    .all(store.graphId, since) as unknown as {
    client: string | null;
    participant_id: string;
    n: number;
    volume: number;
    first_at: number;
    last_at: number;
  }[];
  return rows.map((row) => ({
    client: row.client,
    participant: row.participant_id,
    deliveries: row.n,
    volume: row.volume ?? 0,
    firstAt: row.first_at,
    lastAt: row.last_at,
  }));
}
