// Las cosas por hacer.
//
// Una tarea es un bloque que empieza por su marca: `[ ]` por hacer, `[/]`
// haciéndose, `[x]` hecho. La marca vive en el texto y no en una propiedad, y de
// ahí sale todo lo demás: la proyección Markdown resulta ser una lista de tareas
// de verdad —de las que cualquier otro programa dibuja como casillas—, cambiar de
// estado es `edit_block` y por tanto tiene historia y deshacer sin inventar nada,
// y es el mismo mecanismo que Vera ya usa con `#etiqueta`, que se escribe en el
// texto y se consulta como dato.
//
// Sólo la primera línea. Un bloque con la marca arriba y tres párrafos debajo es
// una tarea con sus notas dentro, que es como la gente escribe: la tarea es el
// renglón y lo demás es lo que hay que saber para hacerla.
//
// El plazo no está aquí: es una propiedad del bloque, `plazo:: 2026-08-20`, y
// como un día es una página, resuelve a un enlace. Preguntar qué vence hoy es
// abrir hoy y mirar quién apunta ahí.
//
// Ver specs/tasks.allium.

/** Los tres estados, y no más. Ver el enum del spec y por qué son tres. */
export const TASK_STATES = ['por hacer', 'haciendo', 'hecho'] as const;

export type TaskState = (typeof TASK_STATES)[number];

/** Con qué se escribe cada estado. */
export const MARKS: Record<TaskState, string> = {
  'por hacer': '[ ]',
  haciendo: '[/]',
  hecho: '[x]',
};

/** Y cómo se lee cada marca. `[X]` mayúscula vale: la escriben otros programas. */
const STATE_OF: Record<string, TaskState> = {
  ' ': 'por hacer',
  '/': 'haciendo',
  '-': 'haciendo',
  x: 'hecho',
  X: 'hecho',
};

/** La propiedad de bloque con que se dice cuándo hay que tenerlo hecho. */
export const DEADLINE_KEY = 'plazo';

/*
 * La marca, y nada más que la marca.
 *
 * Exacta y al principio de la primera línea. @invariant NothingElseBecomesATask:
 * un bloque que empieza citando `[algo]`, una lista pegada de fuera o un enlace
 * `[[así]]` siguen siendo lo que eran. Una gramática que captura de más convierte
 * texto ajeno en casillas que nadie puso.
 */
const MARK = /^\[([ \/xX-])\](\s|$)/;

export interface Task {
  state: TaskState;
  /**
   * Lo que queda del bloque cuando se le quita la marca.
   *
   * El bloque entero menos la marca, no sólo su primer renglón: lo que cuelga
   * debajo es parte de la tarea y tiene que volver íntegro al escribirla.
   */
  said: string;
}

/** ¿Este bloque es una tarea? Lo dice su primera línea, o no lo es. */
export function readTask(content: string): Task | null {
  const found = MARK.exec(content);
  if (found === null) return null;
  const state = STATE_OF[found[1] ?? ''];
  if (state === undefined) return null;
  // Un solo espacio tras la marca, si lo hay. Escribir vuelve a ponerlo, así que
  // `[ ]comprar` se normaliza a `[ ] comprar` en el primer pulso — que es un
  // cambio del texto, queda en la historia, y es lo que hay que querer: dos
  // formas de escribir lo mismo acaban leyéndose distinto.
  return { state, said: content.slice(found[0].length - (found[2] === '' ? 0 : 1)).replace(/^ /, '') };
}

/** Escribe una tarea: la marca, un espacio, y lo que diga. */
export function writeTask(state: TaskState, said: string): string {
  return said === '' ? MARKS[state] : `${MARKS[state]} ${said}`;
}

/**
 * El estado siguiente, en rueda.
 *
 * Por hacer, haciendo, hecho, y otra vez por hacer. Volver atrás desde «hecho»
 * es un pulso más y no un gesto distinto: son tres y el orden es el del trabajo.
 */
export function nextState(state: TaskState): TaskState {
  const at = TASK_STATES.indexOf(state);
  return TASK_STATES[(at + 1) % TASK_STATES.length] as TaskState;
}

/*
 * Lo que el corpus traía escrito de Logseq.
 *
 * Cinco marcadores para tres estados: `TODO` y `LATER` son la misma cosa —lo
 * segundo era la variante del flujo alternativo de Logseq— y `DOING` y `NOW`
 * también. Sostener cinco para diferenciar algo que este corpus nunca diferenció
 * sería copiar el vocabulario de otro programa en vez de traducirlo.
 */
const LEGACY: Record<string, TaskState> = {
  TODO: 'por hacer',
  LATER: 'por hacer',
  DOING: 'haciendo',
  NOW: 'haciendo',
  DONE: 'hecho',
};

const LEGACY_MARK = /^(TODO|LATER|DOING|NOW|DONE)(\s|$)/;

/*
 * `DEADLINE: <2024-03-22 Fri>` y su hermano `SCHEDULED:`.
 *
 * Los dos se vuelven plazo. Logseq distinguía cuándo empezar de cuándo acabar y
 * este corpus no usó nunca la distinción: mantener dos fechas para separar algo
 * que nadie separó es inventar trabajo, y quien las quiera separadas lo dirá
 * escribiéndolo.
 */
const LEGACY_DATE = /^\s*(?:DEADLINE|SCHEDULED):\s*<(\d{4}-\d{2}-\d{2})[^>]*>\s*$/;

export interface Converted {
  content: string;
  /** El día, en el formato con que nacen los días de la bitácora. */
  deadline: string | null;
}

/**
 * Traduce un bloque de Logseq a una tarea de Vera.
 *
 * Null cuando no había nada que traducir, que es la respuesta correcta y no un
 * fallo: @invariant WhatIsNotUnderstoodIsLeftAlone. Convertir a medias un bloque
 * es peor que no convertirlo —lo saca de la lista de lo pendiente sin ponerlo en
 * ninguna otra—.
 */
export function convertLegacy(content: string): Converted | null {
  const found = LEGACY_MARK.exec(content);
  if (found === null) return null;
  const state = LEGACY[found[1] ?? ''];
  if (state === undefined) return null;

  let deadline: string | null = null;
  const kept: string[] = [];
  for (const [at, line] of content.split('\n').entries()) {
    const date = LEGACY_DATE.exec(line);
    if (date !== null) {
      // La primera gana: dos fechas en un bloque es Logseq diciendo dos cosas
      // distintas, y la que importa es la que vence.
      deadline ??= date[1] ?? null;
      continue;
    }
    kept.push(at === 0 ? line.slice(found[0].length).replace(/^\s+/, '') : line);
  }

  return {
    content: writeTask(state, kept.join('\n').replace(/\n+$/, '')),
    deadline,
  };
}

/** ¿Este bloque trae una tarea de Logseq sin convertir? */
export function looksLegacy(content: string): boolean {
  return LEGACY_MARK.test(content);
}
