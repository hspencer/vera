// Procesar: qué direcciones se leen de un texto.
//
// Lo que se prueba aquí es el extractor y no las peticiones: pedirle algo a un
// servidor ajeno dentro de una prueba la volvería lenta, frágil y dependiente de
// que un tercero siga en pie.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { urlsIn } from '../src/process.ts';

describe('las direcciones de un texto', () => {
  it('encuentra una suelta', () => {
    assert.deepEqual(urlsIn('ver https://ejemplo.cl/a hoy'), ['https://ejemplo.cl/a']);
  });

  it('no se lleva la puntuación que cierra la frase', () => {
    // Sin esto se pediría `https://ejemplo.cl/a.` que no es lo que nadie escribió.
    assert.deepEqual(urlsIn('está en https://ejemplo.cl/a.'), ['https://ejemplo.cl/a']);
    assert.deepEqual(urlsIn('¿en https://ejemplo.cl/a?'), ['https://ejemplo.cl/a']);
  });

  it('no se lleva el paréntesis del Markdown', () => {
    assert.deepEqual(urlsIn('[algo](https://ejemplo.cl/a)'), ['https://ejemplo.cl/a']);
  });

  it('conserva los paréntesis que son de la dirección', () => {
    // Wikipedia los usa a menudo, y recortarlos daría una página distinta.
    const url = 'https://es.wikipedia.org/wiki/Mercurio_(planeta)';
    assert.deepEqual(urlsIn(`ver ${url} ahora`), [url]);
  });

  it('no repite la misma dos veces', () => {
    assert.deepEqual(urlsIn('https://ejemplo.cl y https://ejemplo.cl'), ['https://ejemplo.cl']);
  });

  it('ignora lo que no es http', () => {
    assert.deepEqual(urlsIn('mailto:a@b.cl y ftp://x.cl'), []);
  });

  it('encuentra varias', () => {
    assert.equal(urlsIn('https://a.cl/1 y https://b.cl/2 y https://c.cl/3').length, 3);
  });
});

describe('lo que el corpus real trae pegado a una dirección', () => {
  it('quita los invisibles y el paréntesis que queda debajo', () => {
    // Caso literal del corpus: un espacio de ancho cero después del paréntesis
    // que cierra un enlace Markdown. `\s` no lo cuenta como espacio, así que la
    // dirección se llevaba los dos y se pedía una página que no existe.
    const escrito = '[Talking Mats](https://assistive.co.nz/product/talking-mats/)​';
    assert.deepEqual(urlsIn(escrito), ['https://assistive.co.nz/product/talking-mats/']);
  });

  it('quita una marca de dirección de texto al final', () => {
    assert.deepEqual(urlsIn('ver https://ejemplo.cl/a‎'), ['https://ejemplo.cl/a']);
  });
});
