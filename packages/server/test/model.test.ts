// Extraer la respuesta del modelo de lo que la rodea.
//
// No se prueba el modelo —eso sería probar a Qwen, no a Vera— sino lo que Vera
// hace con lo que devuelva: un modelo desobediente es el caso normal, no la
// excepción.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { lastObjectIn } from '../src/model.ts';

describe('el objeto que el modelo devolvió', () => {
  it('lo encuentra cuando viene solo', () => {
    assert.deepEqual(lastObjectIn('{"types": ["Nota"], "concepts": ["a"]}'), {
      types: ['Nota'],
      concepts: ['a'],
    });
  });

  it('lo encuentra dentro de una valla de código', () => {
    const said = 'Aquí tienes:\n```json\n{"types": ["Idea"], "concepts": []}\n```\n¡Espero que sirva!';
    assert.deepEqual(lastObjectIn(said), { types: ['Idea'], concepts: [] });
  });

  it('ignora el ejemplo del prompt y toma la respuesta', () => {
    // El caso que falló de verdad: el prompt lleva un `{…}` de muestra, y una
    // expresión codiciosa abarcaba desde esa llave hasta la última del texto.
    const said = [
      'Responde con esta forma: {"types": ["…"], "concepts": ["…"]}',
      '{"types": ["Persona"], "concepts": ["diseño"]}',
    ].join('\n');
    assert.deepEqual(lastObjectIn(said), { types: ['Persona'], concepts: ['diseño'] });
  });

  it('no se queda con un objeto que no es el pedido', () => {
    assert.equal(lastObjectIn('{"otra": "cosa"}'), null);
  });

  it('sobrevive a un JSON roto y sigue buscando', () => {
    const said = '{"types": [roto}\n{"types": ["Nota"], "concepts": ["b"]}';
    assert.deepEqual(lastObjectIn(said), { types: ['Nota'], concepts: ['b'] });
  });

  it('dice que no hay nada cuando no lo hay', () => {
    assert.equal(lastObjectIn('No puedo clasificar esta página.'), null);
  });
});
