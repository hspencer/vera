// Un recorrido, leído en su propia página.
//
// No hay una vista de lectura aparte y no debe haberla. Componer un recorrido es
// editar su página —reordenar es mover un bloque, podar es borrarlo, afinar un
// nodo es reescribir una referencia— y una vista que reemplazara el texto
// obligaría a salir de ella para escribir, que es justo lo que se está haciendo.
// @guarantee ComposingIsWritingAndNothingElse.
//
// Así que se decora en vez de reemplazar. Los bloques siguen siendo bloques y se
// editan como siempre; lo que se añade es lo que un recorrido tiene y una página
// cualquiera no: las paradas numeradas, la costura entre una y la siguiente, y de
// qué clase es cada tramo.
//
// La costura es la única cosa que un recorrido dibujado dice y uno leído no: un
// tramo por donde el corpus ya iba se dibuja continuo, y uno a campo través se
// dibuja discontinuo. Lo que se ve entonces es la aportación con forma —cuánto de
// este argumento lo sostenía ya el corpus y cuánto lo pone quien lo escribió—.
// @guarantee TheStitchesAreVisibleWhereThereWasNoSeam.
//
// Ver specs/trail.allium y packages/core/src/trail.ts.

import type { Trail, TrailCrossing } from '@vera/core';

/** Cómo se dibuja un bloque de un recorrido. */
export interface TrailMark {
  /** El número de la parada que empieza aquí, si empieza alguna. */
  ordinal: number | null;
  /** Esa parada, ¿lleva todavía a alguna parte? */
  broken: boolean;
  /**
   * De qué clase es el tramo que llega hasta aquí.
   *
   * Nulo antes de la primera parada: lo que se lee ahí abre el recorrido y no
   * cruza nada.
   */
  arriving: TrailCrossing['kind'] | null;
  /** Y si ese tramo no tiene nada dicho todavía. */
  silent: boolean;
  /** Este bloque es lo que el guía escribió entre dos paradas. */
  connective: boolean;
}

/**
 * Qué le toca a cada bloque.
 *
 * Se calcula del recorrido que el servidor ya leyó, y no se vuelve a leer el
 * texto aquí: dos sitios calculando la misma ruta acabarían calculando rutas
 * distintas, y la del servidor es la que se publica y la que se dibuja en el
 * mapa.
 */
export function trailMarks(trail: Trail): Map<string, TrailMark> {
  const marks = new Map<string, TrailMark>();

  const mark = (block: string): TrailMark => {
    const held = marks.get(block);
    if (held !== undefined) return held;
    const fresh: TrailMark = {
      ordinal: null,
      broken: false,
      arriving: null,
      silent: false,
      connective: false,
    };
    marks.set(block, fresh);
    return fresh;
  };

  for (const node of trail.route) {
    const one = mark(node.block);
    // El primero gana: un bloque con dos referencias enseña el número de la
    // primera, que es la que se lee al empezar la línea.
    if (one.ordinal === null) {
      one.ordinal = node.ordinal;
      one.broken = node.page === null;
    }
  }

  for (const crossing of trail.crossings) {
    const arriving = mark(crossing.to.block);
    arriving.arriving = crossing.kind;
    arriving.silent = !crossing.spokenFor;
    /*
     * Y los bloques por los que pasa el tramo.
     *
     * La costura no es una marca junto a la parada a la que llega: es la raya
     * que corre al lado de lo que se lee mientras se va de una a la siguiente.
     * Puesta sólo en la parada, la distinción entre continua y discontinua era
     * un centímetro de raya y no se leía.
     */
    for (const block of crossing.blocks) {
      const one = mark(block);
      one.connective = true;
      one.arriving = crossing.kind;
      one.silent = !crossing.spokenFor;
    }
  }

  return marks;
}

/**
 * La cinta que dice de qué va esto, encima del texto.
 *
 * Lleva el propósito —lo único que un recorrido pide y una página normal no— y
 * la forma del argumento en números: cuántas paradas, y cuántos de sus tramos van
 * por donde el corpus ya iba. No es una barra de progreso: un recorrido puede
 * querer dos paradas seguidas sin nada entre ellas y eso también es decir algo.
 * @guarantee TheGapsAreNotAllTheSameGap.
 */
export function renderTrailBand(trail: Trail): HTMLElement {
  const band = document.createElement('section');
  band.className = 'trail-band';

  const head = document.createElement('div');
  head.className = 'trail-head';
  const what = document.createElement('span');
  what.className = 'trail-what';
  what.textContent = 'recorrido';
  head.append(what);

  if (trail.intent !== null && trail.intent !== '') {
    const intent = document.createElement('span');
    intent.className = 'trail-intent';
    intent.textContent = trail.intent;
    head.append(intent);
  }
  band.append(head);

  const onPath = trail.crossings.filter((one) => one.kind === 'by_path').length;
  const open = trail.crossings.length - onPath;
  const silent = trail.crossings.filter((one) => !one.spokenFor).length;

  const said = document.createElement('p');
  said.className = 'trail-shape';
  const parts = [
    `${trail.route.length} ${trail.route.length === 1 ? 'parada' : 'paradas'}`,
    open === 0
      ? 'todos sus tramos van por caminos que ya existían'
      : onPath === 0
        ? 'ninguno de sus tramos existía en el corpus'
        : `${open} de ${trail.crossings.length} tramos van a campo través`,
  ];
  if (trail.broken.length > 0) {
    parts.push(
      `${trail.broken.length} ${trail.broken.length === 1 ? 'puente cortado' : 'puentes cortados'}`,
    );
  }
  if (silent > 0) parts.push(`${silent} sin nada escrito todavía`);
  if (!trail.argues) parts.push('todavía no afirma nada: es una lista de enlaces');
  said.textContent = parts.join(' · ');
  band.append(said);

  return band;
}
