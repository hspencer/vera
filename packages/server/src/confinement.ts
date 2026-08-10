// El cerco de una credencial.
//
// Traducido de specs/confined-writing.allium. Una credencial cercada escribe sin
// que nadie revise, a cambio de no poder salir de casa: crea páginas de una
// clase concedida, escribe dentro de las que ella plantó, y no borra nada.
//
// El trato se sostiene sobre una sola cosa: que todo lo que hace se puede leer
// después. Cada operación deja el estado anterior en el registro, así que una
// página escrita de más se corrige leyéndola. Borrar es el único acto que rompe
// eso —deja una ausencia, y una ausencia no se revisa—, y por eso está fuera del
// trato aunque la credencial traiga el alcance `discard`.
//
// Vive en el servidor y no en el dominio por la misma razón que las credenciales:
// core.allium excluye el mecanismo de autenticación. El grafo sabe quién escribió
// y con qué canal; no sabe con qué llave se abrió la puerta.

import type { Store } from '@vera/store';

/** Los cambios que dejan una ausencia. Los mismos que gobierna el alcance `discard`. */
const DISCARDS = new Set(['remove_block', 'remove_page']);

export interface Confinement {
  token: string;
  /** La clase de cosa que puede crear, con la palabra del corpus. */
  kind: string;
  /** Con qué se marca su procedencia. Nulo cuando no se quiso marcar nada. */
  source: string | null;
  grantedBy: string;
  grantedAt: number;
}

interface Row {
  token_id: string;
  kind: string;
  source: string | null;
  granted_by: string;
  granted_at: number;
}

const toConfinement = (row: Row): Confinement => ({
  token: row.token_id,
  kind: row.kind,
  source: row.source,
  grantedBy: row.granted_by,
  grantedAt: row.granted_at,
});

/** El cerco de una credencial, si la cercaron. */
export function confinementOf(store: Store, token: string): Confinement | null {
  const row = store.db
    .prepare(
      `SELECT token_id, kind, source, granted_by, granted_at
       FROM confinements WHERE token_id = ? AND graph_id = ?`,
    )
    .get(token, store.graphId) as Row | undefined;
  return row === undefined ? null : toConfinement(row);
}

export function confinements(store: Store): Confinement[] {
  const rows = store.db
    .prepare(
      `SELECT token_id, kind, source, granted_by, granted_at
       FROM confinements WHERE graph_id = ? ORDER BY granted_at DESC`,
    )
    .all(store.graphId) as unknown as Row[];
  return rows.map(toConfinement);
}

/** Cercar una credencial, o cambiarle el cerco. */
export function grantConfinement(
  store: Store,
  said: { token: string; kind: string; source: string | null; grantedBy: string },
): Confinement {
  const at = Date.now();
  store.db
    .prepare(
      `INSERT INTO confinements (token_id, graph_id, kind, source, granted_by, granted_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (token_id) DO UPDATE SET kind = excluded.kind, source = excluded.source,
                                            granted_by = excluded.granted_by,
                                            granted_at = excluded.granted_at`,
    )
    .run(said.token, store.graphId, said.kind, said.source, said.grantedBy, at);
  return { token: said.token, kind: said.kind, source: said.source, grantedBy: said.grantedBy, grantedAt: at };
}

/**
 * Quitar el cerco.
 *
 * No borra lo que la credencial escribió ni le quita la procedencia a esas
 * páginas: es un hecho pasado. Lo que cambia es de aquí en adelante — y hacia
 * dónde, porque una credencial sin cerco escribe donde quiera. Quitar un cerco
 * es ampliar un permiso, no retirarlo.
 */
export function withdrawConfinement(store: Store, token: string): boolean {
  const done = store.db
    .prepare('DELETE FROM confinements WHERE token_id = ? AND graph_id = ?')
    .run(token, store.graphId);
  return done.changes > 0;
}

/**
 * Quién plantó una página.
 *
 * Se contesta con el registro: el participante que sometió su `create_page`. No
 * hay tabla de propiedad que mantener, y por eso esto no puede decir algo
 * distinto de lo que pasó.
 *
 * Por participante y no por credencial, y es una decisión que la implementación
 * obligó a tomar: el registro de operaciones guarda con qué identidad se escribió
 * y no con qué llave. Resulta ser además lo correcto — dos credenciales del mismo
 * participante son el mismo escritor con dos llaves, y separarlas impediría que
 * ChatGPT en el portátil corrigiera lo que escribió ChatGPT en el escritorio—.
 * Lo que sí queda separado es lo que importa: dos participantes distintos nunca
 * comparten territorio.
 */
export function plantedBy(store: Store, page: string): string | null {
  const row = store.db
    .prepare(
      `SELECT participant_id FROM operations
       WHERE subject_id = ? AND change_kind = 'create_page' AND graph_id = ?
       ORDER BY sequence ASC LIMIT 1`,
    )
    .get(page, store.graphId) as { participant_id: string } | undefined;
  return row?.participant_id ?? null;
}

/** Una página que alguien pidió que se fuera, con su motivo y quién lo pidió. */
export interface DiscardRequest {
  page: string;
  title: string;
  /** El motivo, que es el valor de la propiedad. Nunca vacío: sin motivo no hay marca. */
  reason: string;
  /** Quién la marcó y cuándo, derivados del registro. */
  by: string | null;
  byName: string | null;
  at: number | null;
}

/**
 * Las páginas marcadas para borrar.
 *
 * @guarantee WhatWasMarkedIsFoundWithoutLookingForIt: se ven juntas o no se ven.
 * Una marca que hubiera que buscar página por página es una marca que nadie
 * atiende, y entonces la máquina habrá dicho algo que nadie oyó — peor que no
 * poder decirlo, porque además parecía que servía.
 *
 * Quién marcó y cuándo salen del registro y no de columnas nuevas: la operación
 * que escribió la propiedad ya lleva su autor y su fecha. Derivarlo es lo que
 * impide que diga algo distinto de lo que pasó.
 */
export function discardRequests(
  store: Store,
  said: {
    key: string;
    pages: readonly { id: string; title: string }[];
    propertiesOf: (page: string) => readonly { key: string; value: string }[];
    nameOf: (participant: string) => string | null;
  },
): DiscardRequest[] {
  const wanted = said.key.trim().toLowerCase();
  const marked: DiscardRequest[] = [];

  for (const page of said.pages) {
    const found = said
      .propertiesOf(page.id)
      .find((one) => one.key.trim().toLowerCase() === wanted);
    if (found === undefined || found.value.trim() === '') continue;

    const row = store.db
      .prepare(
        `SELECT participant_id, applied_at FROM operations
         WHERE subject_id = ? AND change_kind = 'set_property' AND graph_id = ?
         ORDER BY sequence DESC LIMIT 1`,
      )
      .get(page.id, store.graphId) as
      | { participant_id: string; applied_at: number }
      | undefined;

    marked.push({
      page: page.id,
      title: page.title,
      reason: found.value.trim(),
      by: row?.participant_id ?? null,
      byName: row === undefined ? null : said.nameOf(row.participant_id),
      at: row?.applied_at ?? null,
    });
  }

  return marked.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

/** Lo que un cerco no deja hacer, dicho, o null cuando deja. */
export interface FenceRefusal {
  error: string;
  status: number;
}

/**
 * Si un cambio cabe dentro del cerco.
 *
 * @guarantee RefusalsSayWhy: cada negativa dice qué cerco es y qué quedaba
 * fuera. Un «no permitido» a secas obliga a adivinar si falta un alcance, si la
 * página es de otro o si la clase no era ésa, y un agente que adivina reintenta.
 */
export function fenceRefusal(
  store: Store,
  fence: Confinement,
  participant: string,
  change: { readonly kind: string; readonly page?: string | undefined; readonly block?: string | undefined },
  pageOfBlock: (block: string) => string | null,
): FenceRefusal | null {
  /*
   * Borrar, nunca. Se comprueba contra el cerco y no contra la falta de alcance,
   * @invariant TheFenceOutranksTheScope: comprobarlo sólo cuando falta `discard`
   * dejaría el agujero abierto para el día en que alguien conceda los tres
   * alcances de un tirón sin pensarlo.
   */
  if (DISCARDS.has(change.kind)) {
    return {
      status: 403,
      // @invariant TheRefusalOffersTheMark: se dice qué sí se puede hacer, o el
      // agente reintenta lo mismo, o se calla y la página inútil se queda.
      error:
        'una credencial cercada no borra. Para pedir que esta página se vaya, ' +
        'escríbele la propiedad de marca con el motivo, y una persona decide.',
    };
  }

  // Crear es lo que el cerco concede. De qué clase nace no lo decide el agente:
  // lo pone Vera al aplicar. Ver `ConfinedCredentialPlantsAPage`.
  if (change.kind === 'create_page') return null;

  const page =
    change.page ?? (change.block === undefined ? null : pageOfBlock(change.block));
  if (page === null) {
    return {
      status: 403,
      error: 'una credencial cercada sólo escribe en páginas que ella creó, y este cambio no dice en cuál.',
    };
  }

  const planted = plantedBy(store, page);
  if (planted !== participant) {
    return {
      status: 403,
      error:
        `esta página no la creó ${participant}, así que queda fuera de su cerco. ` +
        `Ese cerco concede crear páginas de clase «${fence.kind}» y escribir dentro de ellas.`,
    };
  }

  return null;
}
