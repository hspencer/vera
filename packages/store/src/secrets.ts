// El secreto de un servicio, y sólo el secreto.
//
// Vera se conecta a cosas de fuera —Zotero, hoy— y una página especial gobierna
// cada conexión: qué servicio es, con qué biblioteca habla, qué colecciones
// trae, cuándo se sincronizó por última vez. Todo eso es conocimiento, se edita
// como cualquier bloque y vive en el corpus, que era el punto: nada de esto
// escondido en un JSON que hay que ir a buscar con un editor de texto.
//
// El secreto es lo único que no. No porque sea más importante sino porque es de
// otra clase: es un valor que hay que poder presentar, no algo que se sepa. Y el
// log de Vera es append-only, que es exactamente lo que lo hace auditable y
// exactamente lo que lo vuelve mal sitio para una clave: escrita una vez, no se
// puede desescribir. Rotarla no la borra, borrar el bloque tampoco, y el
// Markdown que uno copia o descarga se la lleva puesta.
//
// Así que vive aquí: en una tabla que no entra al log, no se proyecta, no se
// indexa y no se publica. Olvidar una clave la borra de verdad, que es lo único
// que «olvidar» puede significar tratándose de un secreto.
//
// Ver specs/service-connections.allium.

import type { Store } from './store.ts';

export interface SecretStatus {
  /** Qué credencial es. Casi siempre «clave». */
  name: string;
  /**
   * Los últimos caracteres, para reconocerla sin enseñarla.
   *
   * Ni el secreto entero ni nada: quien tiene tres claves de Zotero necesita
   * poder saber cuál puso aquí, y para eso bastan cuatro caracteres. Menos de
   * ocho no se enseña ninguno, porque de un secreto corto cuatro caracteres son
   * medio secreto.
   */
  tail: string;
  savedAt: number;
  lastUsedAt: number | null;
}

interface Row {
  name: string;
  secret: string;
  saved_at: number;
  last_used_at: number | null;
}

function tailOf(secret: string): string {
  return secret.length < 8 ? '' : secret.slice(-4);
}

/** Guarda —o reemplaza— el secreto de una página de servicio. */
export function saveSecret(
  store: Store,
  page: string,
  name: string,
  secret: string,
  at: number,
): void {
  store.db
    .prepare(
      `INSERT INTO service_secrets (graph_id, page_id, name, secret, saved_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, NULL)
       ON CONFLICT (graph_id, page_id, name)
       DO UPDATE SET secret = excluded.secret, saved_at = excluded.saved_at, last_used_at = NULL`,
    )
    .run(store.graphId, page, name, secret, at);
}

/**
 * Lo devuelve para usarlo, y anota que se usó.
 *
 * La fecha de último uso no es estadística: es lo que deja ver que una conexión
 * que uno cree viva lleva tres meses sin hablar con nadie.
 */
export function useSecret(store: Store, page: string, name: string, at: number): string | null {
  const row = store.db
    .prepare(
      `SELECT name, secret, saved_at, last_used_at FROM service_secrets
       WHERE graph_id = ? AND page_id = ? AND name = ?`,
    )
    .get(store.graphId, page, name) as Row | undefined;
  if (row === undefined) return null;
  store.db
    .prepare(
      `UPDATE service_secrets SET last_used_at = ?
       WHERE graph_id = ? AND page_id = ? AND name = ?`,
    )
    .run(at, store.graphId, page, name);
  return row.secret;
}

/**
 * El secreto entero, para que quien lo puso pueda mirarlo.
 *
 * Que no se enseñe por defecto y que no se pueda ver nunca son cosas distintas,
 * y sólo la primera es prudencia. La segunda convierte a Vera en el único sitio
 * del mundo donde uno guarda una clave suya y luego no puede leerla: al rotarla
 * en Zotero hay que comparar, al depurar una conexión hay que ver cuál se pegó, y
 * si no se puede, la respuesta es guardarla además en otra parte —que es tener
 * dos copias, una de ellas fuera de aquí—. Un gestor de contraseñas la enseña
 * cuando su dueño la pide, y por eso funciona.
 *
 * No se toca la fecha de último uso: mirarla no es usarla, y confundir las dos
 * cosas haría que una conexión muerta pareciera viva por haberla mirado.
 */
export function revealSecret(store: Store, page: string, name: string): string | null {
  const row = store.db
    .prepare(
      `SELECT secret FROM service_secrets WHERE graph_id = ? AND page_id = ? AND name = ?`,
    )
    .get(store.graphId, page, name) as { secret: string } | undefined;
  return row?.secret ?? null;
}

/** Lo que se puede contar de un secreto sin contarlo. */
export function secretsOf(store: Store, page: string): SecretStatus[] {
  const rows = store.db
    .prepare(
      `SELECT name, secret, saved_at, last_used_at FROM service_secrets
       WHERE graph_id = ? AND page_id = ? ORDER BY name`,
    )
    .all(store.graphId, page) as unknown as Row[];
  return rows.map((row) => ({
    name: row.name,
    tail: tailOf(row.secret),
    savedAt: row.saved_at,
    lastUsedAt: row.last_used_at,
  }));
}

/** Olvidar de verdad: la fila se va y no queda rastro en ninguna parte. */
export function forgetSecret(store: Store, page: string, name: string): boolean {
  const done = store.db
    .prepare(`DELETE FROM service_secrets WHERE graph_id = ? AND page_id = ? AND name = ?`)
    .run(store.graphId, page, name);
  return Number(done.changes) > 0;
}
