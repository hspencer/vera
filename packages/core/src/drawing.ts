// Lo dibujado a mano: cómo se escribe en un bloque y cómo se vuelve una figura.
//
// Ver specs/hand-drawing.allium. Un dibujo es un bloque cuyo texto son sus
// trazos, dentro de una valla que dice `dibujo`. No hay archivo aparte ni tabla
// aparte: así hereda gratis la historia del bloque, el deshacer, la proyección a
// Markdown y la autoría, que es todo lo que Vera ya sabe hacer con un bloque.
//
// ## El formato
//
// Un trazo por renglón. El primer punto va entero —`x,y,presión`, con la presión
// de 0 a 100— y los demás van respecto del anterior: `dx,dy`, y `,±dp` sólo
// cuando la presión cambia. Los deltas son números de una o dos cifras porque la
// mano se mueve poco entre muestra y muestra, y de ahí sale casi todo el ahorro.
//
//     ```dibujo
//     120,340,62 3,2 4,1,+8 5,0 6,-1
//     -20,15,45 2,2 3,1
//     ```
//
// Se puede leer mirándolo, y añadir un trazo es una línea de diferencia en git.
// Las dos cosas se decidieron midiendo: ver @invariant TheEncodingIsCheapAndStillATextFile.
//
// ## Lo que no lleva
//
// Ni color ni grosor. La tinta es el color del texto de la página y el papel su
// fondo, los dos del tema, que cambia; el grosor sale de la presión. Por eso la
// figura se dibuja con `currentColor` y nada más: un dibujo hecho de día se lee
// de noche.

/** Un punto por donde pasó la mano, con la fuerza que llevaba. */
export interface Point {
  x: number;
  y: number;
  /** Entre 0 y 1, tal como la informa el aparato. */
  pressure: number;
}

/** El recorrido entre apoyar y levantar. */
export type Stroke = Point[];

export interface Extents {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** La valla que dice que un bloque es un dibujo. */
export const DRAWING_FENCE = /^\s*```+\s*dibujo\s*$/i;

/** ¿Este bloque es un dibujo? Lo dice su primera línea. */
export function looksLikeDrawing(content: string): boolean {
  return DRAWING_FENCE.test(content.split('\n')[0] ?? '');
}

/*
 * La presión, guardada en centésimas.
 *
 * Un entero de 0 a 100 y no un decimal: la diferencia entre 0.62 y 0.623 no la
 * ve nadie, y escribir tres cifras de más por punto son ocho kilobytes de más
 * por dibujo en un registro que sólo sabe añadir.
 */
const centi = (pressure: number): number =>
  Math.max(0, Math.min(100, Math.round(pressure * 100)));

/**
 * Escribe los trazos como el texto de un bloque, valla incluida.
 *
 * Sin trazos no hay dibujo y no hay bloque: mirar el lienzo y salir no escribe
 * nada. @invariant AnEmptyCanvasWritesNothing.
 */
export function writeDrawing(strokes: readonly Stroke[]): string {
  const lines: string[] = [];
  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    const pieces: string[] = [];
    let px = 0;
    let py = 0;
    let pp = -1;
    stroke.forEach((point, index) => {
      const x = Math.round(point.x);
      const y = Math.round(point.y);
      const p = centi(point.pressure);
      if (index === 0) {
        pieces.push(`${x},${y},${p}`);
      } else {
        const dp = p === pp ? '' : `,${p - pp >= 0 ? '+' : ''}${p - pp}`;
        pieces.push(`${x - px},${y - py}${dp}`);
      }
      px = x;
      py = y;
      pp = p;
    });
    lines.push(pieces.join(' '));
  }
  if (lines.length === 0) return '';
  return `\`\`\`dibujo\n${lines.join('\n')}\n\`\`\``;
}

/**
 * Lee los trazos de un bloque.
 *
 * Tolerante a propósito: lo que no se entienda se salta, y si no queda nada se
 * devuelve una lista vacía para que quien llame lo presente como el bloque de
 * código que es. @invariant WhatCannotBeReadAsADrawingIsReadAsText — un dibujo
 * roto no se arregla solo ni se vacía: se ve lo que hay.
 */
export function readDrawing(content: string): Stroke[] {
  const lines = content.split('\n');
  if (!DRAWING_FENCE.test(lines[0] ?? '')) return [];
  const strokes: Stroke[] = [];
  for (const line of lines.slice(1)) {
    if (/^\s*```/.test(line)) break;
    const words = line.trim().split(/\s+/).filter((one) => one !== '');
    if (words.length === 0) continue;
    const stroke: Stroke = [];
    let x = 0;
    let y = 0;
    let p = 50;
    for (const word of words) {
      const parts = word.split(',');
      const numbers = parts.map((one) => Number(one));
      if (numbers.some((one) => !Number.isFinite(one))) continue;
      if (stroke.length === 0) {
        if (numbers.length < 3) continue;
        x = numbers[0] ?? 0;
        y = numbers[1] ?? 0;
        p = numbers[2] ?? 50;
      } else {
        if (numbers.length < 2) continue;
        x += numbers[0] ?? 0;
        y += numbers[1] ?? 0;
        // El tercero de un punto relativo es el cambio de presión, y viene con
        // signo. Sin él, la presión es la que traía.
        if (numbers.length > 2) p += numbers[2] ?? 0;
      }
      stroke.push({ x, y, pressure: Math.max(0, Math.min(100, p)) / 100 });
    }
    if (stroke.length > 0) strokes.push(stroke);
  }
  return strokes;
}

/**
 * El recuadro que ocupa lo dibujado, no el lienzo en que se dibujó.
 *
 * Es lo que decide de qué tamaño se ve: en una tableta se dibuja sobre toda la
 * pantalla y casi siempre se usa un trozo. Se le suma el grosor que el trazo
 * pueda alcanzar, o el borde de lo dibujado quedaría cortado por la mitad.
 */
export function extentsOf(strokes: readonly Stroke[], grow = 0): Extents {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const stroke of strokes) {
    for (const point of stroke) {
      if (point.x < left) left = point.x;
      if (point.y < top) top = point.y;
      if (point.x > right) right = point.x;
      if (point.y > bottom) bottom = point.y;
    }
  }
  if (left === Infinity) return { left: 0, top: 0, width: 0, height: 0 };
  return {
    left: left - grow,
    top: top - grow,
    width: right - left + grow * 2,
    height: bottom - top + grow * 2,
  };
}

export interface Nib {
  /** Lo más fino que puede ponerse el trazo, en unidades del dibujo. */
  least: number;
  /** Y lo más grueso, apretando del todo. */
  most: number;
}

export const NIB: Nib = { least: 1.1, most: 4.2 };

const width = (pressure: number, nib: Nib): number =>
  nib.least + (nib.most - nib.least) * Math.max(0, Math.min(1, pressure));

/**
 * El contorno de un trazo, como una figura que se rellena.
 *
 * Un trazo de grosor variable no se puede dibujar con una línea: una línea tiene
 * un grosor y aquí cambia en cada punto. Se recorre el trazo por un lado
 * separándose la mitad del grosor hacia la perpendicular, se vuelve por el otro,
 * y lo que queda es un polígono que se rellena con la tinta.
 *
 * Una figura por trazo y no una por segmento: un dibujo son miles de puntos, y
 * miles de elementos en la página convierten leer una nota en una cuenta de
 * pintura que el navegador no puede pagar.
 */
export function outlineOf(stroke: Stroke, nib: Nib = NIB): string {
  if (stroke.length === 0) return '';

  /*
   * Un toque sin recorrido es un punto, y un punto es un círculo.
   *
   * Sin este caso, apoyar y levantar sin moverse no dibujaba nada: el contorno
   * de un trazo de un solo punto es un polígono de área cero. Poner un punto es
   * un gesto que la gente hace.
   */
  if (stroke.length === 1) {
    const only = stroke[0]!;
    const r = width(only.pressure, nib) / 2;
    return (
      `M ${round(only.x - r)} ${round(only.y)} ` +
      `a ${round(r)} ${round(r)} 0 1 0 ${round(r * 2)} 0 ` +
      `a ${round(r)} ${round(r)} 0 1 0 ${round(-r * 2)} 0 Z`
    );
  }

  const left: string[] = [];
  const right: string[] = [];
  for (let index = 0; index < stroke.length; index += 1) {
    const point = stroke[index]!;
    const before = stroke[Math.max(0, index - 1)]!;
    const after = stroke[Math.min(stroke.length - 1, index + 1)]!;
    let dx = after.x - before.x;
    let dy = after.y - before.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) {
      dx = 1;
      dy = 0;
    } else {
      dx /= length;
      dy /= length;
    }
    const r = width(point.pressure, nib) / 2;
    // La perpendicular a la dirección de avance, a media anchura por cada lado.
    left.push(`${round(point.x - dy * r)} ${round(point.y + dx * r)}`);
    right.push(`${round(point.x + dy * r)} ${round(point.y - dx * r)}`);
  }
  right.reverse();
  return `M ${left.join(' L ')} L ${right.join(' L ')} Z`;
}

/** Dos decimales bastan: más cifras son bytes que nadie ve. */
function round(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export interface DrawnSvg {
  svg: string;
  extents: Extents;
}

/**
 * El dibujo entero, como una figura que se puede poner en la página.
 *
 * Con `currentColor` y sin fondo: la tinta la pone quien lo enseña y el papel es
 * el de la página. @invariant NoColourIsStored — nada de lo que se guarda dice
 * de qué color es esto.
 *
 * El `viewBox` es el recuadro de los trazos más un margen, así que la figura
 * viene ya encuadrada en lo dibujado y no en el lienzo donde se dibujó.
 * @invariant WhatIsShownIsEverythingThatWasDrawn.
 */
export function drawingSvg(
  strokes: readonly Stroke[],
  options: { margin?: number; nib?: Nib } = {},
): DrawnSvg | null {
  if (strokes.length === 0) return null;
  const nib = options.nib ?? NIB;
  const margin = options.margin ?? 8;
  const extents = extentsOf(strokes, nib.most / 2 + margin);
  if (extents.width <= 0 || extents.height <= 0) return null;

  const paths = strokes
    .map((stroke) => outlineOf(stroke, nib))
    .filter((one) => one !== '')
    .map((one) => `<path d="${one}"/>`)
    .join('');

  const box = `${round(extents.left)} ${round(extents.top)} ${round(extents.width)} ${round(extents.height)}`;
  return {
    extents,
    svg:
      `<svg class="drawing" viewBox="${box}" width="${round(extents.width)}" ` +
      `height="${round(extents.height)}" fill="currentColor" stroke="none" ` +
      `role="img" aria-label="dibujo a mano" focusable="false">${paths}</svg>`,
  };
}
