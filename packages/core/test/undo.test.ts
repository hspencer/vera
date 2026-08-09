// Deshacer se calcula sobre el registro, así que estas pruebas son sobre un
// registro: se escribe un puñado de operaciones y se comprueba qué contrarias
// salen de ellas.
//
// La frase que las ordena: deshacer tiene que devolver exactamente el momento
// anterior, o no servir. Un deshacer que deja algo parecido es peor que ninguno,
// porque quien lo pulsa deja de mirar.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GESTURE_GAP, blockBefore, contraryOf, invert, lastGesture } from '../src/undo.ts';
import type { Change, Operation } from '../src/types.ts';

let ticking = 0;
const op = (
  sequence: number,
  change: Change,
  options: { by?: string; at?: number; subject?: string } = {},
): Operation =>
  ({
    id: `op:${sequence}`,
    originId: `origin:${sequence}`,
    sequence,
    appliedAt: options.at ?? (ticking += 100),
    subjectId: options.subject ?? ('block' in change ? String(change.block) : `subject:${sequence}`),
    submission: {
      submittedBy: options.by ?? 'participant:herbert',
      channel: 'typed_text',
      change,
    },
  }) as unknown as Operation;

/** Un mundo donde todo existe y nada cuelga de nada, salvo lo que se diga. */
const world = (children: Record<string, string[]> = {}, gone: string[] = []) => ({
  childrenOf: (block: string) => children[block] ?? [],
  exists: (block: string) => !gone.includes(block),
});

describe('lastGesture', () => {
  it('junta lo que pasó seguido', () => {
    // Unir dos bloques con un retroceso son cinco operaciones, y quien pulsó una
    // tecla espera deshacer una cosa.
    const log = [
      op(1, { kind: 'edit_block', block: 'block:a', content: 'hola' }, { at: 1000 }),
      op(2, { kind: 'move_block', block: 'block:b', page: 'page:1', parent: 'block:a', position: 0 }, { at: 1050 }),
      op(3, { kind: 'remove_block', block: 'block:c' }, { at: 1100 }),
    ];
    assert.deepEqual(lastGesture(log).map((one) => one.sequence), [1, 2, 3]);
  });

  it('un silencio largo separa dos gestos', () => {
    const log = [
      op(1, { kind: 'edit_block', block: 'block:a', content: 'antes' }, { at: 1000 }),
      op(2, { kind: 'edit_block', block: 'block:a', content: 'después' }, { at: 1000 + GESTURE_GAP + 1 }),
    ];
    assert.deepEqual(lastGesture(log).map((one) => one.sequence), [2]);
  });

  it('escribir una frase seguida es un solo gesto', () => {
    // La escritura guarda sola tras novecientos milisegundos de silencio.
    const log = [
      op(1, { kind: 'edit_block', block: 'block:a', content: 'una' }, { at: 1000 }),
      op(2, { kind: 'edit_block', block: 'block:a', content: 'una frase' }, { at: 1900 }),
      op(3, { kind: 'edit_block', block: 'block:a', content: 'una frase seguida' }, { at: 2800 }),
    ];
    assert.equal(lastGesture(log).length, 3);
  });

  it('otra mano corta el gesto', () => {
    const log = [
      op(1, { kind: 'edit_block', block: 'block:a', content: 'mío' }, { at: 1000 }),
      op(2, { kind: 'edit_block', block: 'block:b', content: 'suyo' }, { at: 1050, by: 'participant:local-model' }),
    ];
    // Lo último es de otra mano: sin decir de quién, no hay gesto propio que devolver.
    assert.deepEqual(lastGesture(log, { by: 'participant:herbert' }), []);
  });

  it('de un registro vacío no sale ningún gesto', () => {
    assert.deepEqual(lastGesture([]), []);
  });
});

describe('blockBefore', () => {
  const log = [
    op(1, { kind: 'create_block', page: 'page:1', parent: null, position: 0, content: 'primero' }, { subject: 'block:a' }),
    op(2, { kind: 'edit_block', block: 'block:a', content: 'segundo' }),
    op(3, { kind: 'move_block', block: 'block:a', page: 'page:1', parent: 'block:x', position: 2 }),
    op(4, { kind: 'edit_block', block: 'block:a', content: 'tercero' }),
  ];

  it('devuelve el estado justo antes de una operación', () => {
    assert.equal(blockBefore(log, 'block:a', 4)?.content, 'segundo');
    assert.equal(blockBefore(log, 'block:a', 3)?.parent, null);
    assert.equal(blockBefore(log, 'block:a', 4)?.parent, 'block:x');
  });

  it('antes de nacer no había nada', () => {
    assert.equal(blockBefore(log, 'block:a', 1), null);
  });

  it('mudar no cambia lo que dice, y editar no lo mueve', () => {
    const then = blockBefore(log, 'block:a', 4);
    assert.equal(then?.content, 'segundo');
    assert.equal(then?.position, 2);
  });
});

describe('contraryOf', () => {
  it('la contraria de escribir es lo que decía antes', () => {
    const log = [
      op(1, { kind: 'create_block', page: 'page:1', parent: null, position: 0, content: 'lo de antes' }, { subject: 'block:a' }),
      op(2, { kind: 'edit_block', block: 'block:a', content: 'lo de ahora' }),
    ];
    const said = contraryOf(log, log[1]!, world());
    assert.deepEqual('change' in said ? said.change : null, {
      kind: 'edit_block',
      block: 'block:a',
      content: 'lo de antes',
    });
  });

  it('la contraria de mudar es volver a donde estaba', () => {
    const log = [
      op(1, { kind: 'create_block', page: 'page:1', parent: 'block:p', position: 3, content: 'x' }, { subject: 'block:a' }),
      op(2, { kind: 'move_block', block: 'block:a', page: 'page:1', parent: 'block:q', position: 0 }),
    ];
    const said = contraryOf(log, log[1]!, world());
    assert.deepEqual('change' in said ? said.change : null, {
      kind: 'move_block',
      block: 'block:a',
      page: 'page:1',
      parent: 'block:p',
      position: 3,
    });
  });

  it('la contraria de borrar devuelve el texto en su sitio', () => {
    const log = [
      op(1, { kind: 'create_block', page: 'page:1', parent: null, position: 2, content: 'lo borrado' }, { subject: 'block:a' }),
      op(2, { kind: 'remove_block', block: 'block:a' }),
    ];
    const said = contraryOf(log, log[1]!, world({}, ['block:a']));
    // Y vuelve con su propia identidad: si volviera con otra, lo que le apuntaba
    // con `((id))` seguiría apuntando al que se fue, y las contrarias que vengan
    // detrás nombrarían un padre que ya no existe.
    assert.deepEqual('change' in said ? said.change : null, {
      kind: 'create_block',
      page: 'page:1',
      parent: null,
      position: 2,
      content: 'lo borrado',
      stableId: 'block:a',
    });
  });

  it('no se quita un bloque que ahora tiene cosas colgando', () => {
    const log = [
      op(1, { kind: 'create_block', page: 'page:1', parent: null, position: 0, content: 'padre' }, { subject: 'block:a' }),
    ];
    const said = contraryOf(log, log[0]!, world({ 'block:a': ['block:hijo'] }));
    assert.match('refusal' in said ? said.refusal : '', /colgando/);
  });

  it('la contraria de poner una propiedad que no estaba es quitarla', () => {
    const log = [
      op(1, { kind: 'set_property', page: 'page:1', propertyKey: 'tipo', propertyValue: 'Idea' }, { subject: 'page:1' }),
    ];
    const said = contraryOf(log, log[0]!, world());
    assert.deepEqual('change' in said ? said.change : null, {
      kind: 'remove_property',
      page: 'page:1',
      propertyKey: 'tipo',
    });
  });

  it('y la de cambiarla es devolverle el valor anterior', () => {
    const log = [
      op(1, { kind: 'set_property', page: 'page:1', propertyKey: 'tipo', propertyValue: 'Idea' }, { subject: 'page:1' }),
      op(2, { kind: 'set_property', page: 'page:1', propertyKey: 'tipo', propertyValue: 'Proyecto' }, { subject: 'page:1' }),
    ];
    const said = contraryOf(log, log[1]!, world());
    assert.deepEqual('change' in said ? said.change : null, {
      kind: 'set_property',
      page: 'page:1',
      propertyKey: 'tipo',
      propertyValue: 'Idea',
    });
  });

  it('las propiedades de un bloque y las de una página no se confunden', () => {
    const log = [
      op(1, { kind: 'set_property', page: 'page:1', propertyKey: 'tipo', propertyValue: 'Idea' }, { subject: 'page:1' }),
      op(2, { kind: 'set_property', block: 'block:a', propertyKey: 'tipo', propertyValue: 'Otra' }, { subject: 'block:a' }),
    ];
    const said = contraryOf(log, log[1]!, world());
    // La del bloque no estaba antes, aunque la página tuviera una con el mismo nombre.
    assert.deepEqual('change' in said ? said.change : null, {
      kind: 'remove_property',
      block: 'block:a',
      propertyKey: 'tipo',
    });
  });

  it('la contraria de renombrar es el nombre de antes', () => {
    const log = [
      op(1, { kind: 'create_page', title: 'Vera:Recorridos', visibility: 'private' }, { subject: 'page:1' }),
      op(2, { kind: 'rename_page', page: 'page:1', title: 'Vera — Recorridos' }, { subject: 'page:1' }),
    ];
    const said = contraryOf(log, log[1]!, world());
    assert.deepEqual('change' in said ? said.change : null, {
      kind: 'rename_page',
      page: 'page:1',
      title: 'Vera:Recorridos',
    });
  });

  it('devolver una página entera no es deshacer, y se dice', () => {
    const log = [op(1, { kind: 'remove_page', page: 'page:1' }, { subject: 'page:1' })];
    const said = contraryOf(log, log[0]!, world());
    assert.match('refusal' in said ? said.refusal : '', /restaurarla/);
  });
});

describe('invert', () => {
  it('las contrarias van del final hacia el principio', () => {
    const log = [
      op(1, { kind: 'create_block', page: 'page:1', parent: null, position: 0, content: 'a' }, { subject: 'block:a' }),
      op(2, { kind: 'edit_block', block: 'block:a', content: 'b' }),
      op(3, { kind: 'edit_block', block: 'block:a', content: 'c' }),
    ];
    const said = invert(log, [log[1]!, log[2]!], world());
    assert.ok('changes' in said);
    assert.deepEqual(
      said.changes.map((one) => ('content' in one ? one.content : null)),
      ['b', 'a'],
    );
  });

  it('el mundo se mira como va a estar, no como está', () => {
    /*
     * Un gesto que crea un bloque y le mete tres hijos dentro. Mirando el
     * presente, la contraria de la creación se rechazaría —el bloque parece
     * lleno—, pero para cuando le toque, las contrarias de las mudanzas ya
     * habrán sacado a los hijos. Es el caso que apareció el primer día que se
     * usó esto de verdad.
     */
    const log = [
      op(1, { kind: 'create_block', page: 'page:1', parent: null, position: 3, content: 'nuevo padre' }, { subject: 'block:nuevo' }),
      op(2, { kind: 'move_block', block: 'block:h1', page: 'page:1', parent: 'block:nuevo', position: 0 }),
      op(3, { kind: 'move_block', block: 'block:h2', page: 'page:1', parent: 'block:nuevo', position: 1 }),
    ];
    const antes = [
      op(0, { kind: 'create_block', page: 'page:1', parent: 'block:viejo', position: 0, content: 'h1' }, { subject: 'block:h1' }),
      op(0.5 as number, { kind: 'create_block', page: 'page:1', parent: 'block:viejo', position: 1, content: 'h2' }, { subject: 'block:h2' }),
    ];
    const said = invert([...antes, ...log], log, world({ 'block:nuevo': ['block:h1', 'block:h2'] }));
    assert.ok('changes' in said, 'refusal' in said ? said.refusal : '');
    assert.equal(said.changes.at(-1)?.kind, 'remove_block');
  });

  it('si una no se sabe deshacer, no se deshace ninguna', () => {
    // Media reversión deja un estado que nadie eligió y del que nadie se acuerda.
    const log = [
      op(1, { kind: 'edit_block', block: 'block:huérfano', content: 'sin historia' }),
      op(2, { kind: 'remove_page', page: 'page:1' }, { subject: 'page:1' }),
    ];
    const said = invert(log, log, world());
    assert.ok('refusal' in said);
  });
});
