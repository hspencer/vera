// La bandeja de salida: lo pendiente, guardado donde sobrevive a cerrar.
//
// Ver specs/offline-reconciliation.allium, fase 2. @invariant
// LocalDurabilityPrecedesSavedFeedback: Vera dice que un cambio está guardado
// sólo cuando ese cambio y su identidad de origen pueden sobrevivir a cerrar y
// volver a abrir la aplicación en este aparato.
//
// Hasta ahora lo pendiente vivía en un `Set` en memoria, y el indicador lo decía
// con todas sus letras: «lo escrito sigue en el editor, pero aún no está
// guardado». Era honesto y era una pérdida esperando: quien cerrara la pestaña
// sin red perdía lo escrito sin más aviso que ese.
//
// Lo que hace segura una bandeja no es la bandeja: es que reenviar sea inocuo.
// @invariant OriginIdentityIsTheIdempotencyKey — cada cambio lleva un origen
// estable, y reenviarlo devuelve lo que ya pasó en vez de volver a pasar. Sin
// eso, reintentar obligaría a elegir entre duplicar y perder.
//
// El almacén se inyecta para que esto se pueda probar sin navegador: IndexedDB
// no existe en node, y una bandeja sin pruebas es justo la clase de cosa que
// falla el día que hace falta.

import type { Change } from './api.ts';

/** Un cambio aplicado en casa que todavía no es canónico. */
export interface Pending {
  originId: string;
  change: Change;
  channel: 'typed_text' | 'drawn' | 'walked';
  /** Cuándo se aplicó aquí. Fija el orden en que saldrá. */
  at: number;
  /**
   * En qué estado quedó.
   *
   * `rejected` se guarda y no se borra: @invariant PreserveRejectedLocalChange —
   * lo que el dominio rechazó sigue siendo trabajo de alguien, y tirarlo en
   * silencio sería perderlo dos veces.
   */
  status: 'local' | 'sending' | 'rejected';
  reason?: string;
}

/** Lo mínimo que la bandeja necesita de un almacén durable. */
export interface Durable {
  put(pending: Pending): Promise<void>;
  drop(originId: string): Promise<void>;
  all(): Promise<Pending[]>;
}

/**
 * Lo pendiente, en el orden en que salió de la mano.
 *
 * @guidance de rule SubmitNextLocalChange: los cambios dejan el aparato en su
 * orden local. Reordenarlos por conveniencia rompería secuencias que sólo tienen
 * sentido juntas —crear un bloque y escribir dentro— y el segundo llegaría a un
 * sitio que todavía no existe.
 */
export function inOrder(pending: readonly Pending[]): Pending[] {
  return [...pending].sort((a, b) => (a.at === b.at ? a.originId.localeCompare(b.originId) : a.at - b.at));
}

/**
 * El siguiente que se puede mandar.
 *
 * Lo rechazado no se reintenta: el dominio ya dijo que no y volver a preguntarle
 * daría la misma respuesta. Espera a que una persona decida qué hacer con ello.
 */
export function nextToSend(pending: readonly Pending[]): Pending | null {
  return inOrder(pending).find((one) => one.status !== 'rejected') ?? null;
}

/**
 * Qué decir del conjunto, sin mirar los logs ni adivinar por la demora.
 *
 * @invariant SilenceNeverPretendsToBeSuccess. Y el orden importa: un rechazo
 * pide atención aunque todo lo demás esté al día, así que se mira primero.
 */
export function stateOf(
  pending: readonly Pending[],
  connection: 'online' | 'offline',
): { status: 'synchronised' | 'local' | 'offline' | 'attention_required'; pending: number } {
  const rejected = pending.filter((one) => one.status === 'rejected').length;
  const waiting = pending.filter((one) => one.status !== 'rejected').length;
  if (rejected > 0) return { status: 'attention_required', pending: waiting };
  if (waiting === 0) return { status: 'synchronised', pending: 0 };
  return { status: connection === 'offline' ? 'offline' : 'local', pending: waiting };
}

/**
 * La bandeja sobre un almacén durable cualquiera.
 *
 * Guarda una copia en memoria además de escribir: leer el estado de la
 * sincronización ocurre en cada pulsación y no puede costar una vuelta al
 * almacén. La copia se rehace al abrir, con lo que hubiera quedado.
 */
export function createOutbox(store: Durable) {
  let held: Pending[] = [];

  return {
    /** Lo que quedó de la última vez. Ver rule ReturnPendingChangeAfterRestart. */
    async restore(): Promise<Pending[]> {
      held = inOrder(await store.all()).map((one) =>
        // Lo que se quedó a medio mandar vuelve a estar sólo aplicado aquí:
        // reenviarlo es inocuo, así que la incertidumbre no se convierte ni en
        // pérdida ni en duplicado.
        one.status === 'sending' ? { ...one, status: 'local' } : one,
      );
      for (const one of held) if (one.status === 'local') await store.put(one);
      return [...held];
    },

    async remember(pending: Pending): Promise<void> {
      held = [...held.filter((one) => one.originId !== pending.originId), pending];
      await store.put(pending);
    },

    async mark(originId: string, status: Pending['status'], reason?: string): Promise<void> {
      const found = held.find((one) => one.originId === originId);
      if (found === undefined) return;
      const next: Pending = { ...found, status, ...(reason === undefined ? {} : { reason }) };
      held = held.map((one) => (one.originId === originId ? next : one));
      await store.put(next);
    },

    /** Confirmado por el corpus: deja de ser pendiente y deja de ocupar sitio. */
    async settle(originId: string): Promise<void> {
      held = held.filter((one) => one.originId !== originId);
      await store.drop(originId);
    },

    pending(): Pending[] {
      return [...held];
    },
  };
}

export type Outbox = ReturnType<typeof createOutbox>;

/**
 * El almacén de verdad: IndexedDB.
 *
 * Una base y un almacén, con el origen por clave. No hay índices ni versiones
 * que migrar porque no hay nada que consultar: la bandeja se lee entera al abrir
 * y se ordena en memoria, y entera son unas pocas decenas de cambios.
 */
export function indexedDb(name = 'vera-outbox'): Durable {
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('pending', { keyPath: 'originId' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

  const run = async <T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction('pending', mode);
      const request = act(transaction.objectStore('pending'));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  };

  return {
    put: (pending) => run<void>('readwrite', (store) => store.put(pending)),
    drop: (originId) => run<void>('readwrite', (store) => store.delete(originId)),
    all: () => run<Pending[]>('readonly', (store) => store.getAll()),
  };
}

/**
 * Y el almacén que no guarda nada, para cuando IndexedDB no está.
 *
 * Un navegador en privado, un permiso denegado, un disco lleno. Sin esto, no
 * poder guardar lo pendiente rompería también el aplicar en casa, que es lo que
 * de verdad importa. Con esto se degrada a lo que había antes —lo pendiente vive
 * en memoria— y quien mira tiene que poder enterarse: ver `durableOrNot`.
 */
export function inMemory(): Durable {
  const held = new Map<string, Pending>();
  return {
    put: async (pending) => void held.set(pending.originId, pending),
    drop: async (originId) => void held.delete(originId),
    all: async () => [...held.values()],
  };
}

/** El almacén durable si se puede abrir, y el de memoria si no, diciendo cuál. */
export async function durableOrNot(): Promise<{ store: Durable; durable: boolean }> {
  if (typeof indexedDB === 'undefined') return { store: inMemory(), durable: false };
  try {
    const store = indexedDb();
    await store.all();
    return { store, durable: true };
  } catch {
    return { store: inMemory(), durable: false };
  }
}
