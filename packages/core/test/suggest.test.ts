// Autocompletar no es buscar.
//
// Buscar mira dentro del corpus y tarda lo que tarde; esto contesta con lo que ya
// está en memoria mientras alguien teclea, y por eso puede ir delante de cada
// pulsación. Lo que ofrece son páginas, que es lo que uno suele querer al
// escribir tres letras: ir a algo que ya sabe que existe.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { suggestTitles } from '../src/text.ts';

const pages = [
  { title: 'Vera — Manual' },
  { title: 'Vera' },
  { title: 'Ontología' },
  { title: 'Propiedades' },
  { title: 'PictoNet' },
  { title: 'Vera — Queries' },
  { title: 'Cotito' },
  { title: 'Accesibilidad cognitiva' },
];

const titles = (query: string, most?: number) =>
  suggestTitles(query, pages, most).map((one) => one.title);

describe('suggestTitles', () => {
  it('lo que empieza por lo escrito va antes que lo que sólo lo contiene', () => {
    assert.deepEqual(titles('vera'), ['Vera', 'Vera — Manual', 'Vera — Queries']);
  });

  it('el título exacto va primero, aunque no fuera el primero de la lista', () => {
    // Escribir el nombre entero de una página y que salga segunda es lo que hace
    // que uno deje de usar el buscador.
    assert.equal(titles('Vera')[0], 'Vera');
  });

  it('una palabra de en medio también completa', () => {
    // «manual» encuentra «Vera — Manual»: nadie recuerda los títulos por su
    // principio.
    assert.deepEqual(titles('manual'), ['Vera — Manual']);
  });

  it('sin tildes y sin mayúsculas encuentra igual', () => {
    assert.deepEqual(titles('ONTOLOGIA'), ['Ontología']);
    assert.deepEqual(titles('cognitiva'), ['Accesibilidad cognitiva']);
  });

  it('lo que aparece en cualquier parte va al final, pero aparece', () => {
    // «net» no empieza ninguna palabra de «PictoNet», y aun así es lo que se
    // estaba buscando.
    assert.deepEqual(titles('net'), ['PictoNet']);
  });

  it('sin nada escrito no ofrece nada', () => {
    assert.deepEqual(titles(''), []);
    assert.deepEqual(titles('   '), []);
  });

  it('lo que no encaja no se ofrece: una lista que siempre trae algo no dice nada', () => {
    assert.deepEqual(titles('zzzz'), []);
  });

  it('respeta el orden de entrada cuando dos encajan igual', () => {
    // Quien llama trae las páginas ordenadas por conectividad: qué tan central
    // es cada una en el corpus. Ese orden es información y no se pierde.
    const suyo = [{ title: 'Vera — Queries' }, { title: 'Vera — Manual' }];
    assert.deepEqual(
      suggestTitles('vera —', suyo).map((one) => one.title),
      ['Vera — Queries', 'Vera — Manual'],
    );
  });

  it('no ofrece más de lo que quepa', () => {
    assert.equal(titles('a', 2).length <= 2, true);
  });
});
