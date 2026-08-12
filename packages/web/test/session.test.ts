// La sesión de edición. Entra lo que el participante escribe, sale lo que hay
// que guardar. Sin DOM y sin red.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createSession } from '../src/session.ts';

describe('createSession', () => {
  it('empieza limpia', () => {
    const session = createSession('original');
    assert.equal(session.buffer(), 'original');
    assert.equal(session.dirty(), false);
    assert.deepEqual(session.pending(), { action: 'nada' });
  });

  it('escribir la ensucia y da algo que guardar', () => {
    const session = createSession('original');
    session.type('otra cosa');
    assert.equal(session.dirty(), true);
    assert.deepEqual(session.pending(), { action: 'guardar', content: 'otra cosa' });
  });

  describe('la pausa de escritura', () => {
    it('no escribe cuando no hay nada que decir', () => {
      // Sin esto, detenerse a pensar pondría una operación en el log.
      const session = createSession('original');
      session.type('original');
      assert.deepEqual(session.pending(), { action: 'nada' });
    });

    it('ignora un espacio suelto al final', () => {
      const session = createSession('texto');
      session.type('texto  ');
      assert.deepEqual(session.pending(), { action: 'nada' });
    });

    it('y tampoco lo guarda cuando hay algo más que guardar', () => {
      /*
       * Era la otra mitad, y faltaba: comparar ya ignoraba el blanco del final,
       * pero lo que viajaba al grafo era el buffer entero. Un bloque quedaba
       * guardado con su salto de línea, y como el campo enseña el fuente exacto
       * —@invariant EditingRevealsTheSource—, al abrirlo le crecían dos
       * renglones vacíos por debajo que no estaban al leerlo.
       */
      const session = createSession('texto');
      session.type('texto corregido\n');
      assert.deepEqual(session.pending(), { action: 'guardar', content: 'texto corregido' });
    });

    it('pero el blanco del principio se queda, que ahí sí significa', () => {
      // Una sangría puede ser código en Markdown. La del final no es nada en
      // ninguna parte.
      const session = createSession('texto');
      session.type('    con sangría');
      assert.deepEqual(session.pending(), { action: 'guardar', content: '    con sangría' });
    });

    it('escribir un renglón nuevo no se entera de nada', () => {
      /*
       * Lo que importa de recortar al guardar y no en el campo: se pulsa Enter,
       * la pausa guarda sin el salto, y lo que se escribe después se guarda
       * entero. Y no hay reenvíos, porque la comparación ya ignoraba ese blanco.
       */
      const session = createSession('primera');
      session.type('primera\n');
      // Pulsar Enter no cambia nada que guardar, así que no pone una operación
      // en el registro por haber empezado un renglón.
      assert.deepEqual(session.pending(), { action: 'nada' });
      session.type('primera\nsegunda');
      assert.deepEqual(session.pending(), { action: 'guardar', content: 'primera\nsegunda' });
      session.settled('primera\nsegunda');
      // Y otro Enter después tampoco reenvía lo mismo.
      session.type('primera\nsegunda\n');
      assert.deepEqual(session.pending(), { action: 'nada' });
    });

    it('deja de pedir guardado una vez confirmado', () => {
      const session = createSession('a');
      session.type('b');
      const first = session.pending();
      assert.deepEqual(first, { action: 'guardar', content: 'b' });
      session.settled('b');
      assert.deepEqual(session.pending(), { action: 'nada' });
      assert.equal(session.dirty(), false);
    });

    it('lo que se escribe después de confirmar vuelve a pedir guardado', () => {
      const session = createSession('a');
      session.type('b');
      session.settled('b');
      session.type('c');
      assert.deepEqual(session.pending(), { action: 'guardar', content: 'c' });
    });
  });

  describe('salir del bloque', () => {
    it('guarda lo que quedaba pendiente', () => {
      const session = createSession('a');
      session.type('b');
      assert.deepEqual(session.leave(), { action: 'guardar', content: 'b' });
    });

    it('no escribe si la pausa ya lo había guardado', () => {
      // @invariant TypingIsNeverLost llevado al otro extremo: tampoco se guarda
      // dos veces lo mismo.
      const session = createSession('a');
      session.type('b');
      session.settled('b');
      assert.deepEqual(session.leave(), { action: 'nada' });
    });

    it('no ofrece descartar, porque el texto ya está en el grafo', () => {
      const session = createSession('original');
      session.type('escrito');
      session.settled('escrito');
      session.leave();
      assert.equal(session.saved(), 'escrito');
    });
  });

  describe('cuando el guardado falla', () => {
    it('lo pendiente sigue pendiente', () => {
      const session = createSession('a');
      session.type('b');
      session.failed();
      assert.deepEqual(
        session.pending(),
        { action: 'guardar', content: 'b' },
        'un fallo de red no puede dar por guardado lo que no llegó',
      );
    });

    it('salir después de un fallo vuelve a intentarlo', () => {
      const session = createSession('a');
      session.type('b');
      session.failed();
      assert.deepEqual(session.leave(), { action: 'guardar', content: 'b' });
    });

    it('lo escrito durante el fallo no se pierde', () => {
      const session = createSession('a');
      session.type('b');
      session.failed();
      session.type('b y más');
      assert.deepEqual(session.leave(), { action: 'guardar', content: 'b y más' });
    });
  });
});
