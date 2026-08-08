import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MOST_ITEMS, promptFor, readAnswer } from '../src/answer.ts';

/*
 * Lo que el modelo contesta se escribe en el cuaderno de alguien.
 *
 * Ésa es la frase que ordena estas pruebas. No hay panel donde revisar antes ni
 * botón de deshacer después, así que lo que aquí se acepte va a acabar siendo
 * bloques: lo que importa no es que el caso bonito funcione sino que ninguno de
 * los feos pase.
 */
describe('readAnswer', () => {
  it('lee un título con sus ítems', () => {
    const read = readAnswer('Lista de compras\n- Tomate cherry\n- Quesos');
    assert.equal(read?.title, 'Lista de compras');
    assert.deepEqual(read?.items, [
      { text: 'Tomate cherry', depth: 0 },
      { text: 'Quesos', depth: 0 },
    ]);
  });

  it('lee la sangría como jerarquía', () => {
    const read = readAnswer(
      'Lista de compras\n- Verduras\n  - Tomate cherry\n  - Coliflor\n- Lácteos\n  - Quesos',
    );
    assert.deepEqual(read?.items.map((one) => one.depth), [0, 1, 1, 0, 1]);
    assert.equal(read?.items[1]?.text, 'Tomate cherry');
  });

  it('la sangría se lee por escalones, no contando espacios', () => {
    // Tres espacios y luego cinco: son dos niveles, no uno y medio y dos y medio.
    const read = readAnswer('Cosas\n- Uno\n   - Dos\n     - Tres\n- Cuatro');
    assert.deepEqual(read?.items.map((one) => one.depth), [0, 1, 2, 0]);
  });

  it('sin título, el primer ítem lo es', () => {
    // Es lo que hace un modelo pequeño la mitad de las veces, y perder la
    // primera línea por eso sería perder lo que se pidió.
    const read = readAnswer('- Tomate cherry\n- Quesos\n- Coliflor');
    assert.equal(read?.title, 'Tomate cherry');
    assert.deepEqual(read?.items.map((one) => one.text), ['Quesos', 'Coliflor']);
  });

  it('una sola línea es un bloque y nada más', () => {
    const read = readAnswer('París es la capital de Francia.');
    assert.equal(read?.title, 'París es la capital de Francia.');
    assert.deepEqual(read?.items, []);
  });

  it('una línea suelta entre ítems no se pierde', () => {
    const read = readAnswer('Cosas\n- Uno\n  - Dos\nesto no lleva guion\n- Tres');
    assert.deepEqual(read?.items.map((one) => one.text), [
      'Uno',
      'Dos',
      'esto no lleva guion',
      'Tres',
    ]);
  });

  it('las vallas de código no son la respuesta', () => {
    const read = readAnswer('```\nLista\n- Uno\n```');
    assert.equal(read?.title, 'Lista');
    assert.deepEqual(read?.items.map((one) => one.text), ['Uno']);
  });

  it('el rótulo del programa no es una respuesta', () => {
    /*
     * Pasó de verdad: llama-cli corta el eco del prompt por la mitad, el
     * recorte falló, y su logo, su versión y su menú de comandos acabaron
     * escritos como 28 bloques dentro de un día. Esto es la segunda puerta.
     */
    assert.equal(readAnswer('Loading model... |\n\nbuild      : b10242\n- algo'), null);
    assert.equal(readAnswer('available commands:\n/exit or Ctrl+C\n- algo'), null);
    assert.equal(readAnswer('▄▄ ▄▄\n██ ██\nLista\n- Uno'), null);
  });

  it('lo vacío no es una respuesta', () => {
    assert.equal(readAnswer(''), null);
    assert.equal(readAnswer('\n\n   \n'), null);
  });

  it('no puede convertir un bloque en doscientos', () => {
    const many = ['Muchas cosas', ...Array.from({ length: 300 }, (_, i) => `- cosa ${i}`)];
    const read = readAnswer(many.join('\n'));
    assert.equal(read?.items.length, MOST_ITEMS);
  });
});

describe('promptFor', () => {
  it('lleva el pedido tal como se escribió', () => {
    const prompt = promptFor('hazme una lista de compras con tomate cherry');
    assert.match(prompt, /hazme una lista de compras con tomate cherry/);
  });

  it('lo que cuelga del bloque viaja como contexto', () => {
    // Un pedido a veces está repartido: «lista de compras» con seis bloques
    // debajo es un pedido de seis líneas, no de una.
    const prompt = promptFor('lista de compras', ['tomate cherry', 'quesos']);
    assert.match(prompt, /tomate cherry/);
    assert.match(prompt, /quesos/);
  });

  it('enseña el formato con un ejemplo y no sólo con la regla', () => {
    const prompt = promptFor('lo que sea');
    assert.match(prompt, /Lo que hay que llevar al taller/);
    assert.match(prompt, /\n {2}- Martillo/);
  });
});
