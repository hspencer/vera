// Un bloque que se procesa a sí mismo: lo escrito es el pedido y la respuesta
// ocupa su sitio.
//
// «Procesar la página» mira una página y propone; esto es más corto y más
// directo: se escribe «hazme una lista de compras con tomate cherry, quesos,
// coliflor y after shave», se pide procesar, y el bloque pasa a ser la lista con
// sus ítems colgando. El pedido no se pierde —queda en las revisiones del bloque
// y en el log, como cualquier edición— pero deja de estar a la vista, porque lo
// que uno quiere leer después es la lista y no lo que pidió.
//
// Quien firma eso no es el bibliotecario. El bibliotecario tiene criterio sobre
// el corpus, propone vocabulario y migraciones, y lo que dice se lee como suyo.
// Esto otro es un modelo que contesta lo que se le pregunta y que mañana será un
// modelo distinto: firma como `participant:local-model`, y por eso la autoría del
// bloque cambia de mano en cuanto se procesa. La distinción no es ceremonia —es
// la única forma de que dentro de un año se pueda saber qué escribió una persona,
// qué escribió el bibliotecario y qué salió de una máquina que ya no está.
//
// @invariant TheModelIsLocalOrThereIsNone, de controlled-ontology.allium: el
// modelo corre en esta máquina o no hay modelo. Un cuaderno no manda lo que uno
// escribe a un servidor ajeno para que se lo ordene.

import type { ParticipantId } from '@vera/core';

/**
 * Quién firma lo que el modelo contesta.
 *
 * El identificador nombra el papel —el modelo local— y no el modelo: cambiar de
 * qwen a lo que venga no puede reescribir la autoría de lo que ya está escrito.
 * Cuál contestó de verdad lo dice el log, con su fecha.
 */
export const LOCAL_MODEL = 'participant:local-model' as ParticipantId;
export const LOCAL_MODEL_NAME = 'Modelo local';

/**
 * El pedido, tal como se le dice al modelo.
 *
 * Con el formato mandado en la propia instrucción y no en una capa que después
 * lo arregle: un modelo pequeño obedece un formato explícito mucho mejor de lo
 * que obedece una petición vaga, y lo que llegue mal formado se lee igual —ver
 * `readAnswer`, que no se rompe con nada.
 *
 * Los hijos del bloque viajan como contexto porque a veces el pedido está
 * repartido: un bloque que dice «lista de compras» con seis bloques debajo es un
 * pedido de seis líneas, no de una.
 */
export function promptFor(said: string, context: readonly string[] = []): string {
  const extra =
    context.length === 0 ? '' : `\n\nLo que cuelga de ese bloque:\n${context.join('\n')}`;
  /*
   * Con un ejemplo delante, y no sólo con la regla dicha.
   *
   * Un modelo de tres mil millones de parámetros lee «la primera línea es un
   * título» y contesta una lista sin título; ve un ejemplo con título y lo
   * copia. Es la diferencia entre pedir un formato y enseñarlo, y aquí no hay
   * sitio para pedirlo dos veces: lo que salga se escribe en el cuaderno.
   */
  return (
    'Eres un ayudante que contesta dentro del cuaderno de notas de alguien. ' +
    'Recibes un pedido escrito en un bloque y devuelves la respuesta ya ordenada, ' +
    'lista para ocupar el sitio del pedido.\n\n' +
    'Formato obligatorio de tu respuesta:\n' +
    '- La primera línea es un título corto que nombre el resultado, sin guion delante.\n' +
    '- Debajo, un ítem por línea, cada uno empezando por «- ».\n' +
    '- Para agrupar, sangra los ítems con dos espacios por nivel.\n' +
    '- No saludes, no expliques lo que vas a hacer y no repitas el pedido.\n' +
    '- Contesta en el mismo idioma en que está escrito el pedido.\n\n' +
    'Ejemplo. Si el pedido fuera «apunta lo que hay que llevar al taller: ' +
    'martillo, clavos, lija fina y café», contestarías exactamente así:\n' +
    'Lo que hay que llevar al taller\n' +
    '- Herramientas\n' +
    '  - Martillo\n' +
    '  - Clavos\n' +
    '  - Lija fina\n' +
    '- Otros\n' +
    '  - Café\n\n' +
    `Pedido:\n${said}${extra}\n\nRespuesta:\n`
  );
}

/**
 * Lo que el programa dice de sí mismo y no es una respuesta.
 *
 * Si el recorte de `ask` falla —una versión nueva de llama-cli, otro rótulo—, lo
 * que llega aquí es el logo, la versión y el menú de comandos, y sin esta
 * comprobación eso acaba escrito en el cuaderno de alguien. Pasó una vez: 28
 * bloques con el arranque del programa dentro de un día.
 */
const NOISE = /Loading model|available commands|^\s*build\s+:|llama_|^\s*[▄█▀]/im;

/** Cuántos bloques como mucho puede hacer nacer una respuesta. */
export const MOST_ITEMS = 60;

export interface AnswerItem {
  text: string;
  /** Cuántos niveles por debajo del título. Cero es hijo directo. */
  depth: number;
}

export interface ReadAnswer {
  /** Lo que pasa a ser el bloque. */
  title: string;
  items: AnswerItem[];
}

/**
 * Lee lo que el modelo contestó, sin exigirle que lo haya hecho bien.
 *
 * Un modelo de tres mil millones de parámetros obedece el formato casi siempre, y
 * «casi siempre» no es una base sobre la que escribir en el cuaderno de nadie.
 * Así que: si no hay título, el primer ítem lo es; si no hay ítems, lo contestado
 * es el bloque entero y no cuelga nada. Nunca se pierde una línea.
 */
export function readAnswer(text: string): ReadAnswer | null {
  if (NOISE.test(text)) return null;

  const lines = text
    .split('\n')
    // Las vallas de código que a veces envuelven la respuesta no son la respuesta.
    .filter((line) => !/^\s*```/.test(line))
    .filter((line) => line.trim() !== '');
  if (lines.length === 0) return null;

  const asItem = (line: string): { text: string; spaces: number } | null => {
    const found = /^(\s*)[-*•]\s+(.*)$/.exec(line);
    if (found === null) return null;
    // Un tabulador cuenta por dos espacios: quien sangra con tabuladores quiere
    // decir lo mismo que quien sangra con dos.
    const spaces = (found[1] ?? '').replace(/\t/g, '  ').length;
    return { text: (found[2] ?? '').trim(), spaces };
  };

  let title = '';
  let rest = lines;
  const first = asItem(lines[0] ?? '');
  if (first === null) {
    title = (lines[0] ?? '').replace(/^#+\s*/, '').trim();
    rest = lines.slice(1);
  } else {
    // Sin título: el primer ítem lo es, y lo demás cuelga de él.
    title = first.text;
    rest = lines.slice(1);
  }
  if (title === '') return null;

  /*
   * La sangría se lee por escalones y no por espacios.
   *
   * Contar espacios y dividir por dos convierte una sangría de tres en un nivel
   * y medio. Lo que importa es el orden relativo: cada sangría nueva es un nivel
   * más adentro, y volver a una conocida es volver a su nivel.
   */
  const steps: number[] = [];
  const items: AnswerItem[] = [];
  for (const line of rest) {
    const item = asItem(line);
    if (item === null) {
      // Una línea que no es un ítem cuelga donde iba el último, como prosa suya.
      items.push({ text: line.trim(), depth: items.at(-1)?.depth ?? 0 });
      continue;
    }
    while (steps.length > 0 && (steps.at(-1) ?? 0) > item.spaces) steps.pop();
    if (steps.length === 0 || (steps.at(-1) ?? 0) < item.spaces) steps.push(item.spaces);
    items.push({ text: item.text, depth: steps.length - 1 });
  }

  /*
   * Un tope, porque lo que salga se escribe.
   *
   * Un modelo que se enrolla no puede convertir un bloque en doscientos. Lo que
   * pase de aquí se corta y quien pidió la lista lo ve corto, que es un
   * resultado pobre pero legible; lo otro es una página que hay que limpiar a
   * mano.
   */
  return { title, items: items.slice(0, MOST_ITEMS) };
}
