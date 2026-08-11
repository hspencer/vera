// Deshacer lo último, sin guardar nada de más.
//
// Vera no lleva una pila de deshacer en memoria y no le hace falta: el registro
// de operaciones ya tiene todos los estados anteriores de todo. Lo que falta no
// es guardar más, es saber leer hacia atrás. Deshacer, aquí, es calcular la
// operación contraria mirando lo que el registro ya dice y aplicarla como
// cualquier otra escritura.
//
// De ahí salen dos cosas que importan:
//
//   - No se borra nada del registro. Deshacer añade, como todo lo demás, y por
//     eso queda dicho quién deshizo y cuándo. Un deshacer que borrara del log
//     rompería la única promesa que sostiene todo: que lo que pasó se puede
//     volver a leer.
//
//   - Deshacer se puede deshacer, sin código nuevo. La operación contraria es
//     una operación, y la suya se calcula igual.
//
// ## Qué es «lo último»
//
// Un gesto y no una operación. Escribir «hola» es una operación; unir dos
// bloques con un retroceso son cinco —tres mudanzas de hijos, un texto pegado y
// un bloque borrado— y quien pulsó una tecla espera deshacer una cosa. Un gesto
// es una tanda seguida de operaciones de la misma mano, sin pausas largas en
// medio. La pausa se mide y no se declara: es lo que separa dos intenciones.
//
// Ver specs/undo.allium.

import type { Change, Operation } from './types.ts';

/**
 * Cuánto silencio separa dos gestos.
 *
 * Dos segundos y medio. La escritura guarda sola tras novecientos milisegundos
 * de silencio, así que escribir una frase seguida produce operaciones a menos de
 * esa distancia y se deshace de una vez; levantar la vista y volver a escribir
 * produce dos gestos, que es lo que quien escribe entiende que hizo.
 */
export const GESTURE_GAP = 2_500;

/*
 * De dónde vino una operación de deshacer.
 *
 * Las contrarias se envían con un origen que lo dice: `undo:<gesto>:<tanda>:<n>`.
 * No es decoración —el origen es la identidad de la operación y se guarda— y de
 * él salen dos cosas que hacen falta: que una tanda de contrarias se reconozca
 * como una sola, y que nunca se mezcle con el gesto que estaba deshaciendo.
 */
export const UNDO_ORIGIN = /^(undo|undo-back):(\d+):(\d+):/;

/**
 * Qué tanda es una operación, cuando pertenece a una.
 *
 * Sin esto, deshacer algo y volver a pulsar deshacer en el mismo segundo tomaba
 * las dos cosas por un solo gesto —lo hecho y lo deshecho— y las contrarias se
 * cancelaban entre sí: el estado no se movía y parecía que deshacer no
 * funcionaba. Un deshacer es siempre su propio gesto, y por eso deshacerlo
 * rehace.
 */
export function runOf(operation: Operation): string | null {
  const found = UNDO_ORIGIN.exec(operation.originId);
  return found === null ? null : `${found[1]}:${found[3]}`;
}

/**
 * La última tanda de operaciones de una misma mano.
 *
 * Se lee el registro desde el final hacia atrás y se para en el primer hueco: en
 * la primera operación de otra mano, o en el primer silencio largo. Devuelve las
 * operaciones en el orden en que ocurrieron.
 */
export function lastGesture(
  operations: readonly Operation[],
  options: { by?: string; gap?: number; before?: number; page?: string } = {},
): Operation[] {
  const gap = options.gap ?? GESTURE_GAP;
  const where = pagesOf(operations);
  const ordered = operations
    .filter((one) => options.before === undefined || one.sequence < options.before)
    .filter((one) => options.page === undefined || pageOf(one, where) === options.page)
    .slice()
    .sort((a, b) => a.sequence - b.sequence);

  const last = ordered.at(-1);
  if (last === undefined) return [];
  const hand = options.by ?? last.submission.submittedBy;
  if (last.submission.submittedBy !== hand) return [];

  const run = runOf(last);
  const gesture: Operation[] = [last];
  for (let index = ordered.length - 2; index >= 0; index -= 1) {
    const one = ordered[index];
    const next = gesture[0];
    if (one === undefined || next === undefined) break;
    if (one.submission.submittedBy !== hand) break;
    // Una tanda de contrarias es un gesto entero y no se mezcla con nada más,
    // pase el tiempo que pase entre sus pasos.
    if (runOf(one) !== run) break;
    if (run === null && next.appliedAt - one.appliedAt > gap) break;
    gesture.unshift(one);
  }
  return gesture;
}

/**
 * En qué página ocurrió cada operación, según el propio registro.
 *
 * Hace falta leerlo del registro y no del grafo porque un bloque borrado ya no
 * está en el grafo y su operación sigue teniendo que poder situarse. La página
 * viaja en la carga de `create_block` y de `move_block`, y de ahí se hereda.
 */
export function pagesOf(operations: readonly Operation[]): Map<string, string> {
  const where = new Map<string, string>();
  for (const one of operations.slice().sort((a, b) => a.sequence - b.sequence)) {
    const change = one.submission.change;
    switch (change.kind) {
      case 'create_page':
        where.set(one.subjectId, one.subjectId);
        break;
      case 'create_block':
        where.set(one.subjectId, change.page);
        break;
      case 'move_block':
        where.set(change.block, change.page);
        break;
      default:
        break;
    }
  }
  return where;
}

/** Sobre qué página recae una operación, si se puede saber. */
export function pageOf(operation: Operation, where: Map<string, string>): string | null {
  const change = operation.submission.change;
  if ('page' in change && typeof change.page === 'string') return change.page;
  if ('block' in change && typeof change.block === 'string') {
    return where.get(change.block) ?? null;
  }
  return where.get(operation.subjectId) ?? null;
}

/**
 * El registro entero, partido en gestos.
 *
 * Una pasada de principio a fin: misma mano, misma página, sin silencios largos,
 * y una tanda de contrarias siempre aparte.
 *
 * Misma página, y esto no es un detalle. Sin ello, dos cosas que ocurren a la
 * vez en sitios distintos —otra ventana abierta, un guion escribiendo mientras
 * alguien teclea— se leen como un solo gesto, y deshacer se lleva por delante
 * trabajo que no tenía nada que ver con lo que se quería deshacer. Pasó el
 * primer día que esto se usó de verdad.
 */
export function gesturesIn(
  operations: readonly Operation[],
  options: { by?: string; gap?: number; page?: string } = {},
): Operation[][] {
  const gap = options.gap ?? GESTURE_GAP;
  const where = pagesOf(operations);
  const ordered = operations
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .filter((one) => options.page === undefined || pageOf(one, where) === options.page);
  const gestures: Operation[][] = [];
  for (const one of ordered) {
    if (options.by !== undefined && one.submission.submittedBy !== options.by) {
      // Lo de otra mano no forma gesto propio y además corta el que venía.
      if (gestures.at(-1) !== undefined) gestures.push([]);
      continue;
    }
    const open = gestures.at(-1);
    const last = open?.at(-1);
    const together =
      open !== undefined &&
      last !== undefined &&
      last.submission.submittedBy === one.submission.submittedBy &&
      runOf(last) === runOf(one) &&
      (runOf(one) !== null || one.appliedAt - last.appliedAt <= gap);
    if (together && open !== undefined) open.push(one);
    else gestures.push([one]);
  }
  return gestures.filter((one) => one.length > 0);
}

/** A qué gesto apunta una tanda de contrarias: el último número que deshizo. */
function undidSequence(gesture: readonly Operation[]): number | null {
  const found = UNDO_ORIGIN.exec(gesture[0]?.originId ?? '');
  return found === null ? null : Number(found[2]);
}

/**
 * Cuál es el gesto que toca deshacer ahora.
 *
 * No siempre es el último: si ya se deshizo, hay que seguir hacia atrás, y las
 * propias tandas de contrarias no se deshacen por aquí —eso es rehacer y tiene
 * su propio gesto—. Pulsar deshacer tres veces tiene que ir tres pasos atrás y
 * no rebotar entre dos estados, que es lo que hacía antes de esto.
 *
 * Se camina el registro hacia atrás llevando la cuenta de qué gestos ya están
 * deshechos. Una tanda que deshizo a otra tanda las cancela: eso es un rehacer, y
 * deja al gesto de abajo otra vez en pie.
 */
export function nextToUndo(
  operations: readonly Operation[],
  options: { by?: string; gap?: number; page?: string } = {},
): Operation[] {
  const gestures = gesturesIn(operations, options);
  const endOf = (gesture: readonly Operation[]): number => gesture.at(-1)?.sequence ?? 0;
  const undone = new Set<number>();
  const cancelled = new Set<number>();

  for (let index = gestures.length - 1; index >= 0; index -= 1) {
    const gesture = gestures[index];
    if (gesture === undefined) continue;
    const undid = undidSequence(gesture);
    if (undid !== null) {
      // Es una tanda de contrarias. Si ya la cancelaron —alguien la deshizo—, no
      // cuenta; si no, deja deshecho lo que nombra.
      if (cancelled.has(endOf(gesture))) continue;
      if (gestures.some((other) => endOf(other) === undid && undidSequence(other) !== null)) {
        cancelled.add(undid);
      } else {
        undone.add(undid);
      }
      continue;
    }
    if (undone.has(endOf(gesture))) continue;
    return gesture;
  }
  return [];
}

/**
 * Y cuál es la tanda que toca rehacer: la última que deshizo algo y sigue en pie.
 *
 * Rehacer es deshacer un deshacer, así que no hace falta máquina nueva: sale de
 * la misma. Lo que hace falta es no confundirlo con deshacer, o pulsar deshacer
 * dos veces rebotaría entre dos estados en vez de caminar hacia atrás.
 */
export function nextToRedo(
  operations: readonly Operation[],
  options: { by?: string; gap?: number; page?: string } = {},
): Operation[] {
  const gestures = gesturesIn(operations, options);
  const endOf = (gesture: readonly Operation[]): number => gesture.at(-1)?.sequence ?? 0;
  const cancelled = new Set<number>();
  for (let index = gestures.length - 1; index >= 0; index -= 1) {
    const gesture = gestures[index];
    if (gesture === undefined || undidSequence(gesture) === null) continue;
    if (cancelled.has(endOf(gesture))) continue;
    const undid = undidSequence(gesture);
    if (undid !== null && gestures.some((other) => endOf(other) === undid && undidSequence(other) !== null)) {
      // Deshizo a otro deshacer: es un rehacer, y cancela a aquél.
      cancelled.add(undid);
      continue;
    }
    return gesture;
  }
  return [];
}

/** Lo que se sabía de un bloque justo antes de una operación. */
interface BlockThen {
  page: string;
  parent: string | null;
  position: number;
  content: string;
}

/**
 * Reconstruye un bloque tal como estaba antes de cierta operación.
 *
 * Doblando su propia historia desde el principio: se nace en `create_block` y se
 * va cambiando con cada `edit_block` y cada `move_block` anterior. No hace falta
 * reproducir el grafo entero —eso serían sesenta mil operaciones para saber
 * dónde estaba un párrafo—, sólo las que hablan de él.
 */
export function blockBefore(
  operations: readonly Operation[],
  block: string,
  sequence: number,
): BlockThen | null {
  let held: BlockThen | null = null;
  for (const one of operations) {
    if (one.sequence >= sequence) break;
    const change = one.submission.change;
    if (change.kind === 'create_block' && one.subjectId === block) {
      held = {
        page: change.page,
        parent: change.parent,
        position: change.position,
        content: change.content,
      };
    } else if (change.kind === 'edit_block' && change.block === block && held !== null) {
      const was: BlockThen = held;
      held = { page: was.page, parent: was.parent, position: was.position, content: change.content };
    } else if (change.kind === 'move_block' && change.block === block && held !== null) {
      const was: BlockThen = held;
      held = {
        page: change.page,
        parent: change.parent,
        position: change.position,
        content: was.content,
      };
    } else if (change.kind === 'remove_block' && change.block === block) {
      held = null;
    }
  }
  return held;
}

/** Qué decía la glosa única justo antes de una revisión; vacío si aún no existía. */
function glossBefore(operations: readonly Operation[], block: string, sequence: number): string {
  let held = '';
  for (const one of operations) {
    if (one.sequence >= sequence) break;
    const change = one.submission.change;
    if (change.kind === 'set_block_gloss' && change.block === block) held = change.content;
  }
  return held;
}

/** El valor que tenía una propiedad justo antes de cierta operación. */
export function propertyBefore(
  operations: readonly Operation[],
  subject: { page?: string; block?: string },
  key: string,
  sequence: number,
): string | null {
  let held: string | null = null;
  for (const one of operations) {
    if (one.sequence >= sequence) break;
    const change = one.submission.change;
    if (change.kind !== 'set_property' && change.kind !== 'remove_property') continue;
    if (change.propertyKey !== key) continue;
    if ((change.page ?? null) !== (subject.page ?? null)) continue;
    if ((change.block ?? null) !== (subject.block ?? null)) continue;
    held = change.kind === 'set_property' ? change.propertyValue : null;
  }
  return held;
}

/** El título que tenía una página justo antes de cierta operación. */
export function titleBefore(
  operations: readonly Operation[],
  page: string,
  sequence: number,
): string | null {
  let held: string | null = null;
  for (const one of operations) {
    if (one.sequence >= sequence) break;
    const change = one.submission.change;
    if (change.kind === 'create_page' && one.subjectId === page) held = change.title;
    else if (change.kind === 'rename_page' && change.page === page) held = change.title;
  }
  return held;
}

function visibilityBefore(
  operations: readonly Operation[],
  page: string,
  sequence: number,
): 'private' | 'public' | null {
  let held: 'private' | 'public' | null = null;
  for (const one of operations) {
    if (one.sequence >= sequence) break;
    const change = one.submission.change;
    if (change.kind === 'create_page' && one.subjectId === page) held = change.visibility;
    else if (change.kind === 'set_page_visibility' && change.page === page) held = change.visibility;
  }
  return held;
}

export type Inverse =
  | { change: Change; says: string }
  /**
   * Lo que no se sabe deshacer se dice, y no se hace a medias.
   *
   * Media reversión es peor que ninguna: deja un estado que nadie eligió y del
   * que nadie se acuerda.
   */
  | { refusal: string };

/**
 * La operación contraria a una, calculada sobre el registro.
 *
 * Lo que no aparece aquí —crear un bloque que ahora tiene hijos, borrar una
 * página— se rechaza por su nombre más abajo, en `invert`.
 */
export interface World {
  /** Quiénes cuelgan de ese bloque ahora mismo. */
  childrenOf(block: string): string[];
  exists(block: string): boolean;
}

export function contraryOf(
  operations: readonly Operation[],
  operation: Operation,
  world: World,
): Inverse {
  const change = operation.submission.change;
  switch (change.kind) {
    case 'create_block': {
      if (world.childrenOf(operation.subjectId).length > 0) {
        return { refusal: 'ese bloque ya tiene cosas colgando, y quitarlo se las llevaría' };
      }
      if (!world.exists(operation.subjectId)) {
        return { refusal: 'ese bloque ya no está' };
      }
      return { change: { kind: 'remove_block', block: operation.subjectId }, says: 'quitar el bloque que había nacido' };
    }

    case 'edit_block': {
      const before = blockBefore(operations, change.block, operation.sequence);
      if (before === null) return { refusal: 'no se sabe qué decía ese bloque antes' };
      return {
        change: { kind: 'edit_block', block: change.block, content: before.content },
        says: before.content.trim() === '' ? 'vaciar el bloque otra vez' : 'devolver el texto de antes',
      };
    }

    case 'set_block_gloss': {
      const before = glossBefore(operations, change.block, operation.sequence);
      return {
        change: { kind: 'set_block_gloss', block: change.block, content: before },
        says: before.trim() === '' ? 'vaciar la glosa otra vez' : 'devolver la glosa de antes',
      };
    }

    case 'move_block': {
      const before = blockBefore(operations, change.block, operation.sequence);
      if (before === null) return { refusal: 'no se sabe dónde estaba ese bloque antes' };
      return {
        change: {
          kind: 'move_block',
          block: change.block,
          page: before.page,
          parent: before.parent,
          position: before.position,
        },
        says: 'devolver el bloque a donde estaba',
      };
    }

    case 'remove_block': {
      const before = blockBefore(operations, change.block, operation.sequence);
      if (before === null) return { refusal: 'no se sabe qué decía el bloque que se borró' };
      return {
        change: {
          kind: 'create_block',
          page: before.page,
          parent: before.parent,
          position: before.position,
          content: before.content,
          /*
           * Vuelve con su propia identidad, y esto es lo que hace que deshacer
           * sirva de algo.
           *
           * Un bloque devuelto con identificador nuevo no es el mismo bloque:
           * lo que le apuntaba con `((id))` sigue apuntando al que se fue, y las
           * contrarias que vengan detrás —«devuelve este hijo a aquel padre»—
           * nombran un padre que ya no existe y fallan a media reversión. Eso
           * pasó el primer día.
           *
           * No contradice StableBlockAddress: esa promesa dice que un
           * identificador no se reasigna, y aquí no se reasigna nada. Vuelve el
           * mismo bloque al mismo nombre, que es justo lo que la promesa
           * protege. El dominio lo permite porque ya lo permitía para la
           * importación, y rechaza el identificador que esté en uso.
           */
          stableId: change.block,
        },
        says: 'devolver el bloque que se había borrado',
      };
    }

    case 'set_property': {
      const subject: { page?: string; block?: string } = {};
      if (change.page !== undefined) subject.page = change.page;
      if (change.block !== undefined) subject.block = change.block;
      const before = propertyBefore(operations, subject, change.propertyKey, operation.sequence);
      if (before === null) {
        return {
          change: { ...subject, kind: 'remove_property', propertyKey: change.propertyKey },
          says: `quitar «${change.propertyKey}», que no estaba`,
        };
      }
      return {
        change: { ...subject, kind: 'set_property', propertyKey: change.propertyKey, propertyValue: before },
        says: `devolver «${change.propertyKey}» a «${before}»`,
      };
    }

    case 'remove_property': {
      const subject: { page?: string; block?: string } = {};
      if (change.page !== undefined) subject.page = change.page;
      if (change.block !== undefined) subject.block = change.block;
      const before = propertyBefore(operations, subject, change.propertyKey, operation.sequence);
      if (before === null) return { refusal: `no se sabe qué decía «${change.propertyKey}»` };
      return {
        change: { ...subject, kind: 'set_property', propertyKey: change.propertyKey, propertyValue: before },
        says: `devolver «${change.propertyKey}»`,
      };
    }

    case 'rename_page': {
      const before = titleBefore(operations, change.page, operation.sequence);
      if (before === null) return { refusal: 'no se sabe cómo se llamaba antes' };
      return {
        change: { kind: 'rename_page', page: change.page, title: before },
        says: `volver a llamarla «${before}»`,
      };
    }

    case 'set_page_visibility': {
      const before = visibilityBefore(operations, change.page, operation.sequence);
      if (before === null) return { refusal: 'no se sabe si era pública o privada' };
      return {
        change: { kind: 'set_page_visibility', page: change.page, visibility: before },
        says: before === 'public' ? 'volver a hacerla pública' : 'volver a hacerla privada',
      };
    }

    case 'create_page': {
      return {
        change: { kind: 'remove_page', page: operation.subjectId },
        says: 'quitar la página que había nacido',
      };
    }

    /*
     * Una página borrada no vuelve por aquí.
     *
     * Borrar una página es vaciarla bloque a bloque y después quitarla, así que
     * deshacerlo entero significa rehacerla y volver a escribir dentro cada
     * bloque, cada uno con identidad nueva. Se puede —el registro lo tiene
     * todo— pero no es deshacer un gesto: es una restauración, y merece decirse
     * con otro nombre y pedirse a propósito.
     */
    case 'remove_page':
      return { refusal: 'devolver una página entera no es deshacer: es restaurarla, y todavía no se puede' };

    default:
      return { refusal: `todavía no se sabe deshacer ${(change as { kind: string }).kind}` };
  }
}

export interface Undoing {
  /** Las contrarias, en el orden en que hay que aplicarlas. */
  changes: Change[];
  /** Lo que se va a hacer, dicho en palabras, para poder enseñarlo antes. */
  says: string[];
  /** Qué operaciones se están deshaciendo. */
  undoing: number[];
}

/**
 * Las contrarias de un gesto entero, del final hacia el principio.
 *
 * En orden inverso porque las operaciones de un gesto se apoyan unas en otras:
 * si una mudó un hijo y otra borró al padre, devolver al padre tiene que ocurrir
 * antes de devolverle el hijo. Y si una sola no se sabe deshacer, no se deshace
 * ninguna: media reversión deja un estado que nadie eligió.
 */
export function invert(
  operations: readonly Operation[],
  gesture: readonly Operation[],
  world: World,
): Undoing | { refusal: string } {
  /*
   * El mundo se mira como va a estar, no como está.
   *
   * Un gesto que creó un bloque y le metió tres hijos dentro no se puede
   * deshacer mirando el presente: al llegar a la contraria de la creación, el
   * bloque parece lleno y se rechazaría. Pero para entonces las tres contrarias
   * anteriores ya habrán sacado a los hijos. Así que las contrarias se calculan
   * contra un mundo que va cambiando con ellas, que es el único que dice la
   * verdad sobre cada paso.
   */
  const gone = new Set<string>();
  const reparented = new Map<string, string | null>();
  const ahead: World = {
    exists: (block) => !gone.has(block) && world.exists(block),
    childrenOf: (block) => {
      const held = world
        .childrenOf(block)
        .filter((child) => !gone.has(child) && (reparented.get(child) ?? block) === block);
      const arrived = [...reparented]
        .filter(([child, parent]) => parent === block && !gone.has(child))
        .map(([child]) => child);
      return [...new Set([...held, ...arrived])];
    },
  };

  const changes: Change[] = [];
  const says: string[] = [];
  for (const operation of [...gesture].reverse()) {
    const inverse = contraryOf(operations, operation, ahead);
    if ('refusal' in inverse) return { refusal: inverse.refusal };
    // Y el mundo avanza con cada contraria calculada.
    const change = inverse.change;
    if (change.kind === 'remove_block') gone.add(change.block);
    else if (change.kind === 'move_block') reparented.set(change.block, change.parent);
    changes.push(change);
    says.push(inverse.says);
  }
  return { changes, says, undoing: gesture.map((one) => one.sequence) };
}
