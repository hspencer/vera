// Las cosas por hacer.
//
// Lo que se fija aquí es la gramática de la marca: que capture exactamente lo
// que es una tarea y ni un carácter más, que escribir y leer sean inversas —de
// eso depende que pulsar no toque nada del bloque salvo su estado— y que las
// tareas que el corpus traía de Logseq se traduzcan sin perder lo que decían.
//
// Ver specs/tasks.allium.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fc from 'fast-check';

import {
  MARKS,
  TASK_STATES,
  convertLegacy,
  looksLegacy,
  nextState,
  readTask,
  writeTask,
} from '../src/task.ts';

describe('la marca', () => {
  it('dice en qué estado está', () => {
    assert.deepEqual(readTask('[ ] comprar cemento'), { state: 'por hacer', said: 'comprar cemento' });
    assert.deepEqual(readTask('[/] comprar cemento'), { state: 'haciendo', said: 'comprar cemento' });
    assert.deepEqual(readTask('[x] comprar cemento'), { state: 'hecho', said: 'comprar cemento' });
  });

  it('acepta lo que escriben otros programas', () => {
    // `[X]` en mayúscula y `[-]` para lo empezado: vienen de fuera y significan
    // lo mismo. Rechazarlos convertiría una lista pegada en texto muerto.
    assert.equal(readTask('[X] hecho')?.state, 'hecho');
    assert.equal(readTask('[-] a medias')?.state, 'haciendo');
  });

  it('sólo al principio, y sólo exacta', () => {
    /*
     * @invariant NothingElseBecomesATask. Una gramática que captura de más
     * convierte texto ajeno en casillas que nadie puso, y eso se descubre
     * cuando ya hay doscientas.
     */
    assert.equal(readTask('lo dijo [ ] en su libro'), null);
    assert.equal(readTask('[[Ciudad Abierta]] es una página'), null);
    assert.equal(readTask('[nota] al pie'), null);
    assert.equal(readTask('[  ] dos espacios'), null);
    assert.equal(readTask('[ ]sin espacio'), null);
    assert.equal(readTask(''), null);
  });

  it('una tarea sin texto es una tarea vacía y no un no-tarea', () => {
    // El corpus tiene bloques que dicen sólo `TODO`, escritos para rellenar
    // después. Siguen siendo lo pendiente que alguien anotó.
    assert.deepEqual(readTask('[ ]'), { state: 'por hacer', said: '' });
  });

  it('lo que cuelga debajo es parte de la tarea', () => {
    // La tarea es el renglón y lo demás es lo que hay que saber para hacerla.
    const said = readTask('[ ] llamar a Ramón\ntiene el número nuevo\nprefiere por la tarde');
    assert.equal(said?.said, 'llamar a Ramón\ntiene el número nuevo\nprefiere por la tarde');
  });
});

describe('escribir y leer', () => {
  it('son inversas, que es lo que permite pulsar sin tocar nada más', () => {
    // @invariant WhatIsWrittenIsWhatIsRead.
    fc.assert(
      fc.property(
        fc.constantFrom(...TASK_STATES),
        fc.string({ minLength: 0, maxLength: 80 }).filter((one) => !/^\s/.test(one)),
        (state, said) => {
          const read = readTask(writeTask(state, said));
          assert.equal(read?.state, state);
          assert.equal(read?.said, said);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('pulsar avanza en rueda y vuelve al principio', () => {
    assert.equal(nextState('por hacer'), 'haciendo');
    assert.equal(nextState('haciendo'), 'hecho');
    assert.equal(nextState('hecho'), 'por hacer');
  });

  it('tres pulsos dejan el bloque como estaba', () => {
    const said = '[ ] comprar cemento';
    let now = said;
    for (let n = 0; n < 3; n += 1) {
      const task = readTask(now);
      assert.ok(task !== null);
      now = writeTask(nextState(task.state), task.said);
    }
    assert.equal(now, said);
  });

  it('cada estado se escribe con su marca y no con otra', () => {
    for (const state of TASK_STATES) {
      assert.ok(writeTask(state, 'x').startsWith(MARKS[state]));
    }
  });
});

describe('lo que venía de Logseq', () => {
  it('cinco marcadores se vuelven tres estados', () => {
    assert.equal(convertLegacy('TODO comprar cemento')?.content, '[ ] comprar cemento');
    assert.equal(convertLegacy('LATER certificados')?.content, '[ ] certificados');
    assert.equal(convertLegacy('DOING registrar la marca')?.content, '[/] registrar la marca');
    assert.equal(convertLegacy('NOW esto')?.content, '[/] esto');
    assert.equal(convertLegacy('DONE design information sheet')?.content, '[x] design information sheet');
  });

  it('la fecha de Logseq se vuelve plazo y sale del texto', () => {
    const said = convertLegacy('LATER Certificados\nDEADLINE: <2024-03-22 Fri>');
    assert.equal(said?.content, '[ ] Certificados');
    assert.equal(said?.deadline, '2024-03-22');
  });

  it('SCHEDULED cuenta igual: este corpus nunca separó empezar de acabar', () => {
    const said = convertLegacy('TODO mandar el informe\nSCHEDULED: <2025-01-09 Thu>');
    assert.equal(said?.deadline, '2025-01-09');
    assert.equal(said?.content, '[ ] mandar el informe');
  });

  it('un TODO solo sigue siendo una tarea vacía', () => {
    assert.equal(convertLegacy('TODO')?.content, '[ ]');
  });

  it('lo que no se entiende se queda como estaba', () => {
    // @invariant WhatIsNotUnderstoodIsLeftAlone: convertir a medias un bloque lo
    // saca de la lista de lo pendiente sin ponerlo en ninguna otra.
    assert.equal(convertLegacy('WAITING por respuesta'), null);
    assert.equal(convertLegacy('el TODO de ayer'), null);
    assert.equal(convertLegacy('TODOS los presentes'), null);
    assert.equal(convertLegacy('CANCELED aquello'), null);
  });

  it('lo ya convertido no se vuelve a convertir', () => {
    assert.equal(convertLegacy('[ ] comprar cemento'), null);
    assert.equal(looksLegacy('[ ] comprar cemento'), false);
    assert.equal(looksLegacy('TODO comprar cemento'), true);
  });

  it('las notas que colgaban del bloque siguen colgando', () => {
    const said = convertLegacy('TODO llamar a Ramón\nDEADLINE: <2026-09-01 Tue>\ntiene el número nuevo');
    assert.equal(said?.content, '[ ] llamar a Ramón\ntiene el número nuevo');
    assert.equal(said?.deadline, '2026-09-01');
  });
});
