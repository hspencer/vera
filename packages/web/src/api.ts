// Cliente HTTP del servidor de Vera.
//
// Toda escritura pasa por submitOperation, igual que en el servidor y en el
// dominio: el cliente no tiene ninguna vía propia para cambiar el grafo.

import type { GraphData } from './graph/types.ts';
import type { Recording } from './voice.ts';

export interface PageSummary {
  id: string;
  title: string;
  visibility: 'private' | 'public';
  blockCount: number;
  linkCount: number;
}

export interface BlockView {
  stableId: string;
  parent: string | null;
  position: number;
  content: string;
}

/**
 * Una ruta del Markdown y el objeto al que resuelve. El bloque sigue diciendo
 * `../assets/foo.png`; la traducción ocurre al presentar, así que la fuente no
 * se toca y la proyección Markdown sigue siendo portable fuera de Vera.
 */
export interface AssetView {
  path: string;
  url: string;
  mediaType: string;
}

/** Una referencia `((stable_id))` ya resuelta al bloque que nombra. */
export interface BlockRefView {
  id: string;
  page: string;
  excerpt: string;
}

export interface PageView {
  id: string;
  title: string;
  visibility: 'private' | 'public';
  properties: { key: string; value: string }[];
  blocks: BlockView[];
  assets: AssetView[];
  blockRefs: BlockRefView[];
  /** Los bloques que este participante tiene plegados. No es contenido. */
  folded: string[];
  /** Los títulos nombrados desde esta página que todavía no tienen página. */
  pendingLinks?: string[];
  /** La denominación de origen: qué bloques vinieron de qué grabación. */
  spokenOrigins: { block: string; recording: string }[];
  /**
   * Lo hablado que tiene lugar en esta página: la grabación y el bloque que le
   * guarda el sitio mientras se recorre la cascada.
   *
   * @guarantee NothingSpokenIsStrandedFromTheWriting: viaja con la página para
   * que el audio se vea donde se habló.
   */
  recordings?: Recording[];
  /**
   * De qué mano salió el texto de cada bloque, indexado por su identidad.
   *
   * @invariant GeneratedContentIsAlwaysDistinguishable: viaja con la página, no
   * en una petición aparte, porque distinguir lo escrito de lo generado tiene
   * que costar lo mismo que leer.
   */
  authorship: Record<
    string,
    { participant: string; kind: 'human' | 'agent' | null; channel: string; writtenAt: number }
  >;
  backlinks: Backlink[];
}

export interface Backlink {
  page: string;
  block: string;
  /** Título de la página que refiere, para poder nombrarla sin otra petición. */
  title: string;
  /** Texto del bloque donde ocurre la referencia. */
  excerpt: string;
}

export interface Hit {
  page: string;
  block: string | null;
  field: string;
  excerpt: string;
  rank: number;
}

export type Change =
  | { kind: 'create_page'; title: string; visibility: 'private' | 'public' }
  | { kind: 'rename_page'; page: string; title: string }
  | { kind: 'set_page_visibility'; page: string; visibility: 'private' | 'public' }
  | { kind: 'create_block'; page: string; parent: string | null; position: number; content: string }
  | { kind: 'edit_block'; block: string; content: string }
  // Indentar, desindentar y mudar a los hijos de un bloque que se fusiona son
  // todos el mismo cambio: el bloque pasa a colgar de otro padre, en un índice.
  | { kind: 'move_block'; block: string; page: string; parent: string | null; position: number }
  | { kind: 'remove_block'; block: string }
  // El front matter de una página son propiedades, y se editan como todo lo
  // demás: enviando una operación.
  | { kind: 'set_property'; page?: string; block?: string; propertyKey: string; propertyValue: string }
  | { kind: 'remove_property'; page?: string; block?: string; propertyKey: string };

export type SubmitResult =
  | { status: 'applied'; sequence: number; subjectId: string }
  | { status: 'duplicate'; sequence: number; subjectId: string }
  | { status: 'rejected'; reason: string };

/**
 * Identificador de origen. Se genera aquí, en el dispositivo, porque es la
 * clave de idempotencia: reenviar la misma operación tras un corte de red no
 * puede aplicarla dos veces.
 */
function originId(): string {
  return `web:${crypto.randomUUID()}`;
}

async function json<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${response.status} en ${path}`);
  return (await response.json()) as T;
}

export const api = {
  health: () =>
    json<{ graph: string; pages: number; blocks: number; lastSequence: number }>('/health'),

  pages: () => json<PageSummary[]>('/pages'),

  page: (id: string) => json<PageView>(`/pages/${encodeURIComponent(id)}`),

  /** Las páginas que gobiernan a Vera, por lo que declaran gobernar. */
  specialPages: () => json<{ id: string; title: string; kind: string }[]>('/special-pages'),

  search: (text: string) => json<Hit[]>(`/search?q=${encodeURIComponent(text)}`),

  /**
   * Plegar no es un cambio del grafo, así que no pasa por submit: no genera
   * operación ni revisión, y por eso tiene su propia ruta.
   */
  fold: (block: string, folded: boolean) =>
    fetch('/folds', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ participant: 'participant:herbert', block, folded }),
    }),

  graph: (centre: string, depth: number) =>
    json<GraphData>(`/graph/${encodeURIComponent(centre)}?depth=${depth}`),

  async submit(change: Change): Promise<SubmitResult> {
    const response = await fetch('/operations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        originId: originId(),
        participant: 'participant:herbert',
        channel: 'typed_text',
        change,
      }),
    });
    return (await response.json()) as SubmitResult;
  },
};
