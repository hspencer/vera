// Los trazos de un dibujo son el texto de su bloque, así que lo que estas
// pruebas fijan es un formato: lo que se escribe tiene que volver a leerse igual,
// y lo que no se entienda no puede llevarse por delante lo que sí.
//
// Ver specs/hand-drawing.allium.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fc from 'fast-check';

import {
  drawingSvg,
  extentsOf,
  looksLikeDrawing,
  outlineOf,
  readDrawing,
  writeDrawing,
  type Stroke,
} from '../src/drawing.ts';

const point = (x: number, y: number, pressure = 0.5) => ({ x, y, pressure });

describe('escribir y leer un dibujo', () => {
  it('lo escrito se vuelve a leer igual', () => {
    const strokes: Stroke[] = [
      [point(120, 340, 0.62), point(123, 342, 0.7), point(128, 343, 0.7)],
      [point(100, 355, 0.45), point(102, 357, 0.45)],
    ];
    const said = writeDrawing(strokes);
    assert.deepEqual(readDrawing(said), strokes);
  });

  it('el primer punto va entero y los demás respecto del anterior', () => {
    // De ahí sale el ahorro: la mano se mueve poco entre muestra y muestra, así
    // que casi todos los números son de una o dos cifras.
    const said = writeDrawing([[point(120, 340, 0.62), point(123, 342, 0.62)]]);
    assert.match(said, /^```dibujo\n120,340,62 3,2\n```$/);
  });

  it('la presión sólo se escribe cuando cambia', () => {
    const igual = writeDrawing([[point(0, 0, 0.5), point(1, 1, 0.5), point(2, 2, 0.5)]]);
    assert.equal(igual.split('\n')[1], '0,0,50 1,1 1,1');
    const cambia = writeDrawing([[point(0, 0, 0.5), point(1, 1, 0.62)]]);
    assert.equal(cambia.split('\n')[1], '0,0,50 1,1,+12');
  });

  it('un trazo por renglón: añadir uno es una línea de diferencia', () => {
    const uno = writeDrawing([[point(0, 0), point(1, 1)]]);
    const dos = writeDrawing([[point(0, 0), point(1, 1)], [point(9, 9), point(8, 8)]]);
    // La diferencia entre los dos textos es exactamente el renglón nuevo.
    assert.equal(dos.replace(uno.slice(0, uno.lastIndexOf('\n```')), ''), '\n9,9,50 -1,-1\n```');
  });

  it('sin trazos no hay dibujo, y por tanto no hay bloque', () => {
    // @invariant AnEmptyCanvasWritesNothing: mirar el lienzo no es escribir.
    assert.equal(writeDrawing([]), '');
    assert.equal(writeDrawing([[]]), '');
  });

  it('lo que no dice ser un dibujo no se lee como uno', () => {
    assert.deepEqual(readDrawing('un párrafo cualquiera'), []);
    assert.deepEqual(readDrawing('```js\nconst a = 1\n```'), []);
    assert.equal(looksLikeDrawing('```dibujo\n0,0,50\n```'), true);
    assert.equal(looksLikeDrawing('```mermaid\ngraph TD\n```'), false);
  });

  it('un dibujo roto no se vacía: se lee lo que se entienda', () => {
    // @invariant WhatCannotBeReadAsADrawingIsReadAsText, mirado desde dentro:
    // lo que sobrevive sobrevive, y quien llame decide qué hacer con el resto.
    const roto = '```dibujo\n0,0,50 3,2 qué,tal 4,4\nesto no son números\n```';
    const strokes = readDrawing(roto);
    assert.equal(strokes.length, 1);
    assert.deepEqual(strokes[0]?.map((one) => [one.x, one.y]), [[0, 0], [3, 2], [7, 6]]);
  });

  it('lo escrito y lo leído sobreviven a cualquier trazo', () => {
    /*
     * Escribir y leer tienen que ser inversas, y no sólo en el caso que a uno se
     * le ocurre: un dibujo son miles de puntos y basta uno mal escrito para que
     * el resto se desplace, porque cada punto se lee respecto del anterior.
     */
    fc.assert(
      fc.property(
        fc.array(
          fc.array(
            // Con prototipo, que es lo que devuelve leer: `fc.record` los hace
            // sin él y `deepEqual` compara también eso.
            fc
              .record({
                x: fc.integer({ min: -5000, max: 5000 }),
                y: fc.integer({ min: -5000, max: 5000 }),
                pressure: fc.integer({ min: 0, max: 100 }).map((one) => one / 100),
              })
              .map((one) => ({ x: one.x, y: one.y, pressure: one.pressure })),
            { minLength: 1, maxLength: 40 },
          ),
          { minLength: 1, maxLength: 10 },
        ),
        (strokes) => {
          assert.deepEqual(readDrawing(writeDrawing(strokes)), strokes);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('el recuadro de lo dibujado', () => {
  it('es el de los trazos y no el del lienzo', () => {
    // En una tableta se dibuja sobre toda la pantalla y casi siempre se usa un
    // trozo: el encuadre lo da lo dibujado.
    const extents = extentsOf([[point(100, 200), point(140, 260)]]);
    assert.deepEqual(extents, { left: 100, top: 200, width: 40, height: 60 });
  });

  it('crece lo que el trazo pueda engordar, o el borde queda cortado', () => {
    const extents = extentsOf([[point(10, 10), point(20, 20)]], 5);
    assert.deepEqual(extents, { left: 5, top: 5, width: 20, height: 20 });
  });

  it('de nada no sale un recuadro imposible', () => {
    assert.deepEqual(extentsOf([]), { left: 0, top: 0, width: 0, height: 0 });
  });
});

describe('la figura', () => {
  const strokes: Stroke[] = [[point(0, 0, 0.2), point(30, 0, 0.9), point(60, 10, 0.4)]];

  it('no dice de qué color es', () => {
    // @invariant NoColourIsStored. La tinta es el color del texto y el papel el
    // fondo de la página: los dos del tema, que cambia.
    const drawn = drawingSvg(strokes);
    assert.match(drawn?.svg ?? '', /fill="currentColor"/);
    assert.ok(!/#[0-9a-f]{3,6}/i.test(drawn?.svg ?? ''));
    assert.ok(!(drawn?.svg ?? '').includes('background'));
  });

  it('viene encuadrada en lo dibujado', () => {
    const drawn = drawingSvg(strokes, { margin: 8 });
    assert.match(drawn?.svg ?? '', /viewBox="-10\.1 -10\.1/);
  });

  it('una figura por trazo y no una por segmento', () => {
    // Miles de elementos en la página convierten leer una nota en una cuenta de
    // pintura que el navegador no puede pagar.
    const muchos: Stroke[] = Array.from({ length: 12 }, () => [point(0, 0), point(5, 5), point(9, 2)]);
    const drawn = drawingSvg(muchos);
    assert.equal((drawn?.svg.match(/<path /g) ?? []).length, 12);
  });

  it('el grosor sale de la presión y de nada más', () => {
    // Apretando, el contorno se separa más del recorrido.
    const flojo = outlineOf([point(0, 0, 0), point(20, 0, 0)]);
    const fuerte = outlineOf([point(0, 0, 1), point(20, 0, 1)]);
    const alturaDe = (d: string) => {
      const ys = [...d.matchAll(/-?[\d.]+ (-?[\d.]+)/g)].map((m) => Number(m[1]));
      return Math.max(...ys) - Math.min(...ys);
    };
    assert.ok(alturaDe(fuerte) > alturaDe(flojo) * 2);
  });

  it('un toque sin recorrido es un punto y se ve', () => {
    // Apoyar y levantar sin moverse es un gesto que la gente hace; el contorno
    // de un trazo de un solo punto es un polígono de área cero.
    const drawn = drawingSvg([[point(10, 10, 0.8)]]);
    assert.match(drawn?.svg ?? '', /a [\d.]+ [\d.]+ 0 1 0/);
  });

  it('de nada no sale figura', () => {
    assert.equal(drawingSvg([]), null);
  });
});
