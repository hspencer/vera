// Pruebas de lo que una página nombra y el corpus ya tiene.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formalizationOf, mentionsOf } from '../src/mentions.ts';

const corpus = [
  { id: 'page:1', title: 'Ciudad Abierta', backlinks: 12 },
  { id: 'page:2', title: 'Amereida', backlinks: 3 },
  { id: 'page:3', title: 'Diseño', backlinks: 0 },
  { id: 'page:4', title: '2026-08-07', backlinks: 40 },
  { id: 'page:5', title: 'e', backlinks: 99 },
];

const block = (stableId: string, content: string) => ({ stableId, content });

describe('mentionsOf', () => {
  it('encuentra una página nombrada y propone el enlace', () => {
    const found = mentionsOf([block('block:1', 'Fuimos a Ciudad Abierta el jueves.')], corpus);
    assert.equal(found.length, 1);
    assert.equal(found[0]?.title, 'Ciudad Abierta');
    assert.equal(found[0]?.next, 'Fuimos a [[Ciudad Abierta]] el jueves.');
  });

  it('encuentra el nombre aunque esté escrito de otra forma, y respeta cómo se escribió', () => {
    // El grafo resuelve el enlace sin distinguir mayúsculas ni tildes, así que
    // no hace falta corregirle a nadie cómo escribió una palabra.
    const found = mentionsOf([block('block:1', 'fuimos a ciudad abierta ayer')], corpus);
    assert.equal(found[0]?.title, 'Ciudad Abierta');
    assert.equal(found[0]?.next, 'fuimos a [[ciudad abierta]] ayer');
  });

  it('un título de una sola palabra sólo cuenta escrito igual', () => {
    // «Diseño» en mitad de una frase se parece a un nombre propio; «diseño» es
    // una palabra común, y enlazar cada vez que alguien la escribe entierra los
    // enlaces que sí significan algo.
    assert.equal(mentionsOf([block('block:1', 'hablamos de Diseño')], corpus).length, 1);
    assert.deepEqual(mentionsOf([block('block:1', 'hablamos de diseño')], corpus), []);
    assert.deepEqual(mentionsOf([block('block:1', 'hablamos de Diseno')], corpus), []);
  });

  it('una página cuyo título es una palabra común en minúscula no se busca', () => {
    const comun = [{ id: 'page:9', title: 'lenguaje', backlinks: 30 }];
    assert.deepEqual(mentionsOf([block('block:1', 'el lenguaje de la obra')], comun), []);
  });

  it('no vuelve a envolver lo que ya es enlace', () => {
    const found = mentionsOf([block('block:1', 'Fuimos a [[Ciudad Abierta]] el jueves.')], corpus);
    assert.deepEqual(found, []);
  });

  it('no toca lo que está dentro de una dirección o de código', () => {
    const found = mentionsOf(
      [
        block('block:1', 'https://ejemplo.cl/ciudad-abierta/index.html'),
        block('block:2', '`Ciudad Abierta`'),
      ],
      corpus,
    );
    assert.deepEqual(found, []);
  });

  it('no parte una palabra por dentro', () => {
    const found = mentionsOf([block('block:1', 'rediseñoso y diseñador')], corpus);
    assert.deepEqual(found, []);
  });

  it('no enlaza fechas ni títulos demasiado cortos', () => {
    const found = mentionsOf([block('block:1', 'el 2026-08-07 pasó algo, y e también')], corpus);
    assert.deepEqual(found, []);
  });

  it('no propone dos cambios sobre el mismo bloque', () => {
    // Cada mención se propone como el texto entero del bloque: aceptar dos
    // dejaría sólo la segunda y el primer enlace desaparecería.
    const found = mentionsOf([block('block:1', 'Ciudad Abierta y Amereida')], corpus);
    assert.equal(found.length, 1);
  });

  it('propone antes lo que el corpus ya enlaza más', () => {
    const found = mentionsOf(
      [block('block:1', 'sobre Diseño'), block('block:2', 'sobre Ciudad Abierta')],
      corpus,
    );
    assert.deepEqual(
      found.map((one) => one.title),
      ['Diseño', 'Ciudad Abierta'],
    );
    // El orden dentro de un bloque sí lo decide cuánto se enlaza cada título.
    const juntos = mentionsOf([block('block:1', 'Diseño y Ciudad Abierta')], corpus);
    assert.equal(juntos[0]?.title, 'Ciudad Abierta');
  });

  it('no propone enlazar la página consigo misma', () => {
    const found = mentionsOf([block('block:1', 'sobre Amereida')], corpus, { self: 'page:2' });
    assert.deepEqual(found, []);
  });

  it('una misma página no se propone dos veces', () => {
    const found = mentionsOf(
      [block('block:1', 'Ciudad Abierta'), block('block:2', 'otra vez Ciudad Abierta')],
      corpus,
    );
    assert.equal(found.length, 1);
  });

  it('no propone más de las que se pidieron', () => {
    const muchos = Array.from({ length: 20 }, (_, at) => ({
      id: `page:${at + 10}`,
      title: `Tema número ${at}`,
      backlinks: at,
    }));
    const blocks = muchos.map((one, at) => block(`block:${at}`, `habla de ${one.title} y más`));
    assert.equal(mentionsOf(blocks, muchos, { most: 3 }).length, 3);
  });

  it('no se rompe con una página vacía', () => {
    assert.deepEqual(mentionsOf([], corpus), []);
    assert.deepEqual(mentionsOf([block('block:1', '   ')], corpus), []);
  });

  it('no toca la clave de una propiedad', () => {
    const found = mentionsOf([block('block:1', 'Diseño:: algo')], corpus);
    assert.deepEqual(found, []);
  });
});

describe('formalizationOf', () => {
  it('formaliza con un clic también un concepto común escrito en minúsculas', () => {
    const found = formalizationOf(
      block('block:1', 'la hospitalidad radical aparece sin enlace'),
      { id: 'page:9', title: 'hospitalidad radical', backlinks: 2 },
    );
    assert.equal(found?.next, 'la [[hospitalidad radical]] aparece sin enlace');
    assert.equal(found?.block, 'block:1');
  });

  it('no ofrece formalizar una aparición que ya está enlazada', () => {
    assert.equal(
      formalizationOf(
        block('block:1', 'ver [[hospitalidad radical]]'),
        { id: 'page:9', title: 'hospitalidad radical', backlinks: 2 },
      ),
      null,
    );
  });
});
