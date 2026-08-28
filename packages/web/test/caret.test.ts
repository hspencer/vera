// Dónde cae el cursor al señalar una palabra, y qué se mueve para verlo.
//
// Ver specs/block-editing.allium: @invariant TheCaretBeginsWhereItWasPut y
// @invariant WhatIsBeingWrittenStaysInSight. Lo que se prueba aquí es la
// aritmética; que el navegador mida bien no se puede probar sin navegador, y
// justamente por eso la decisión no vive dentro del navegador.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { scrollDeltaFor, sourceOffsetFor, type Sight } from '../src/caret.ts';

/** Dónde queda, en el fuente, el sitio donde se pulsó sobre lo dibujado. */
const landing = (source: string, visible: string, at: number): number | null =>
  sourceOffsetFor(source, visible, at);

describe('el cursor cae donde se señaló', () => {
  it('en un texto sin marcas, en el mismo sitio', () => {
    const said = 'la travesía empieza en Punta Arenas';
    assert.equal(landing(said, said, 3), 3);
    assert.equal(landing(said, said, 0), 0);
  });

  it('salta las marcas que el dibujo se comió', () => {
    // Se pulsa la «e» de «empieza», que en lo dibujado va tras «la travesía ».
    const source = 'la **travesía** empieza';
    const visible = 'la travesía empieza';
    assert.equal(source.slice(landing(source, visible, 12) ?? 0), 'empieza');
  });

  it('y las de un enlace, con su dirección entera dentro', () => {
    const source = 'ver [la carta](https://example.org/una/direccion/larga) y volver';
    const visible = 'ver la carta y volver';
    assert.equal(source.slice(landing(source, visible, 13) ?? 0), 'y volver');
  });

  it('y las de una referencia a página', () => {
    const source = 'lo dice [[Amereida]] al principio';
    const visible = 'lo dice Amereida al principio';
    assert.equal(source.slice(landing(source, visible, 17) ?? 0), 'al principio');
  });

  it('y la marca de una tarea, que va delante de todo', () => {
    // El bloque de una tarea dibuja su texto sin la marca, así que el fuente
    // lleva cuatro caracteres que en pantalla no están.
    const source = '[ ] comprar el pan';
    const visible = 'comprar el pan';
    assert.equal(source.slice(landing(source, visible, 8) ?? 0), 'el pan');
  });

  it('el final del texto es el final del texto', () => {
    /*
     * Y no la última letra visible. Pulsar detrás de la última palabra de un
     * texto que acaba en marcado dejaba el cursor delante de los asteriscos, y
     * lo que se escribiera seguía en negrita sin que nadie lo hubiera pedido.
     */
    const source = 'y quedó **así**';
    const visible = 'y quedó así';
    assert.equal(landing(source, visible, visible.length), source.length);
  });

  it('una lista con párrafos debajo, que es donde se descarrilaba', () => {
    /*
     * El caso real que lo destapó. Un bloque con viñetas y párrafos sangrados
     * dibuja dos espacios donde el fuente lleva un salto de línea y una sangría,
     * y ninguno donde el fuente separa dos ítems. Emparejando blanco a blanco,
     * el segundo espacio dibujado se saltaba una palabra entera y el desfase
     * crecía hasta que la cuenta se declaraba perdida: el cursor se iba al final
     * del bloque, que es exactamente lo que esto viene a arreglar.
     */
    const source =
      '- **`ItIsTheSameEveryTime`** — la lectura no usa modelo,\n' +
      '  ni red, ni azar: sale su estructura.\n' +
      '- **`TheModelIsLocal`** — un corpus no sale de casa.';
    const visible =
      'ItIsTheSameEveryTime — la lectura no usa modelo,  ni red, ni azar: sale su estructura.' +
      'TheModelIsLocal — un corpus no sale de casa.';
    const at = visible.indexOf('TheModelIsLocal');
    // El cursor queda delante de la palabra señalada, no al final del ítem
    // anterior: entre las dos hay un salto de línea, un guion y tres marcas.
    assert.equal(source.slice(landing(source, visible, at) ?? 0, 999).slice(0, 15), 'TheModelIsLocal');
  });

  it('un blanco vale por cualquier blanco', () => {
    // El dibujo colapsa los espacios y convierte los saltos en espacio. Comparar
    // el blanco exacto descarrilaba el emparejamiento en el primer párrafo con
    // sangría, que en este corpus es casi el primero.
    const source = 'primera línea\n   segunda línea';
    const visible = 'primera línea segunda línea';
    assert.equal(source.slice(landing(source, visible, 14) ?? 0), 'segunda línea');
  });

  it('lo que no viene de este texto se dice, no se inventa', () => {
    /*
     * Un bloque cuyo cuerpo es una tabla, un diagrama o la respuesta a una
     * consulta dibuja algo que no es su fuente. Ahí el sitio pulsado no dice
     * nada del fuente, y contestar un número igual sería poner el cursor en
     * cualquier parte sin que quien escribe pueda enterarse.
     */
    assert.equal(landing('? tipo=proyecto ; tabla', 'Vera Lectogram PICTOS Guemil', 12), null);
  });

  it('y el rótulo de un bloque citado es de los que no se saben', () => {
    /*
     * Queda escrito porque es el límite de esto y no un descuido: el texto de
     * un bloque citado lo trae el dibujo del bloque citado, no el fuente de
     * éste, así que señalar dentro de la cita no dice nada de dónde poner el
     * cursor aquí. Se contesta que no se sabe, y quien llama manda el cursor al
     * final, que es lo que hacía siempre.
     */
    const source = 'como dice ((block:12)) en su momento';
    const visible = 'como dice el pan nuestro de cada día en su momento';
    assert.equal(landing(source, visible, 20), null);
  });
});

/** Un editor cualquiera dentro de un visor de 600, con 24 de margen. */
const sight = (overrides: Partial<Sight> = {}): Sight => ({
  top: 100,
  height: 200,
  caret: 0,
  line: 24,
  view: 600,
  margin: 24,
  ...overrides,
});

describe('lo que se escribe se ve', () => {
  it('reserva arriba la toolbar además del margen tipográfico', () => {
    assert.equal(scrollDeltaFor(sight({
      top: -20, height: 900, caret: 72, topInset: 56,
    })), -4);
  });

  it('lo que ya se ve no se mueve', () => {
    // Y es la respuesta corriente. Un editor que recoloca la página en cada
    // pulsación es más difícil de leer que uno que la deja quieta.
    assert.equal(scrollDeltaFor(sight()), 0);
  });

  it('un bloque que cabe se enseña entero', () => {
    // Asomando por abajo: sube lo justo para que entre con su margen.
    assert.equal(scrollDeltaFor(sight({ top: 500, height: 200 })), 500 + 200 - (600 - 24));
    // Y asomando por arriba, baja.
    assert.equal(scrollDeltaFor(sight({ top: -30, height: 200 })), -30 - 24);
  });

  it('uno más alto que el visor se trae a la línea, no a su canto', () => {
    /*
     * Es el caso que motivó todo esto: un bloque de mil palabras no se puede
     * enseñar entero, y llevar la página a su principio o a su final deja el
     * cursor justamente donde no está.
     */
    const tall = sight({ top: -400, height: 1200, caret: 500 });
    // La línea está a 100 del borde de arriba del visor: dentro de la banda.
    assert.equal(scrollDeltaFor(tall), 0);
  });

  it('y con sitio por debajo para lo que viene', () => {
    // Escribiendo cerca del borde inferior: se baja hasta dejar un tercio libre.
    const tall = sight({ top: -400, height: 1200, caret: 980 });
    const moved = scrollDeltaFor(tall);
    assert.ok(moved > 0, 'algo tiene que moverse');
    const after = -400 + 980 - moved;
    assert.ok(after + 24 <= 600 - 200, 'queda un tercio del visor por debajo');
  });

  it('y no se corrige de más', () => {
    /*
     * Al salir de la banda se vuelve a su borde y no al centro. Centrar el
     * cursor en cada corrección da un salto que nadie pidió, y el salto ocurre
     * justo mientras se escribe.
     */
    const tall = sight({ top: -400, height: 1200, caret: 985 });
    const gentle = scrollDeltaFor(tall);
    const after = -400 + 985 - gentle;
    // Queda justo en el borde de la banda —a un tercio del suelo— y no en el
    // centro del visor, que es donde lo habría llevado corregir de más.
    assert.equal(after + 24, 600 - 200);
    assert.ok(after > 600 / 2, 'centrarlo habría movido más de lo que hacía falta');
  });

  it('la línea del cursor cabe entera, no por la mitad', () => {
    const tall = sight({ top: 0, height: 1200, caret: 380, line: 24, view: 400, margin: 8 });
    const moved = scrollDeltaFor(tall);
    assert.ok(moved > 0);
    assert.ok(380 - moved + 24 <= 400, 'la línea entera queda dentro');
  });
});
