// Las teclas estructurales. Entra texto, cursor y vecindad; sale la decisión.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  onFirstLine,
  onLastLine,
  resolveArrow,
  resolveBackspaceAtStart,
  resolveDelimiter,
  resolveEnter,
  resolveTab,
  type Neighbourhood,
} from '../src/keys.ts';

/** Un bloque suelto, sin vecinos. Cada prueba cambia lo que le importa. */
function near(overrides: Partial<Neighbourhood> = {}): Neighbourhood {
  return {
    block: 'block:b',
    parent: null,
    index: 0,
    hasChildren: false,
    previousSibling: null,
    previousVisible: null,
    nextVisible: null,
    grandparent: null,
    parentIndex: 0,
    ...overrides,
  };
}

describe('Enter', () => {
  it('parte por el cursor y el bloque conserva la cabeza', () => {
    const outcome = resolveEnter('unodos', 4, 4, near({ index: 2 }));
    assert.deepEqual(outcome, {
      kind: 'partir',
      head: 'unod',
      tail: 'os',
      parent: null,
      position: 3,
    });
  });

  it('un bloque con hijos gana un primer hijo, no un hermano', () => {
    // Es donde va la línea siguiente cuando se escribe dentro de una lista.
    const outcome = resolveEnter('padre', 5, 5, near({ hasChildren: true }));
    assert.deepEqual(outcome, {
      kind: 'partir',
      head: 'padre',
      tail: '',
      parent: 'block:b',
      position: 0,
    });
  });

  it('con el cursor al final crea un bloque vacío detrás', () => {
    const outcome = resolveEnter('texto', 5, 5, near({ index: 1 }));
    assert.equal(outcome.kind, 'partir');
    if (outcome.kind === 'partir') {
      assert.equal(outcome.head, 'texto');
      assert.equal(outcome.tail, '');
      assert.equal(outcome.position, 2);
    }
  });

  it('con el cursor al principio empuja un vacío encima y no parte', () => {
    // Partir le quitaría al texto su identidad, sus hijos y sus referencias.
    const outcome = resolveEnter('texto', 0, 0, near({ index: 3, parent: 'block:p' }));
    assert.deepEqual(outcome, {
      kind: 'insertar-encima',
      parent: 'block:p',
      position: 3,
    });
  });

  it('en un bloque vacío parte igual, que es crear el siguiente', () => {
    const outcome = resolveEnter('', 0, 0, near());
    assert.equal(outcome.kind, 'partir');
  });

  it('con texto seleccionado, lo seleccionado desaparece en la partición', () => {
    const outcome = resolveEnter('unodostres', 3, 6, near());
    assert.equal(outcome.kind, 'partir');
    if (outcome.kind === 'partir') {
      assert.equal(outcome.head, 'uno');
      assert.equal(outcome.tail, 'tres');
    }
  });
});

describe('Tab', () => {
  it('hace del bloque un hijo del hermano de encima', () => {
    const outcome = resolveTab(true, near({ previousSibling: 'block:a' }));
    assert.equal(outcome.kind, 'indentar');
    if (outcome.kind === 'indentar') assert.equal(outcome.parent, 'block:a');
  });

  it('sin hermano encima no hay dónde entrar', () => {
    const outcome = resolveTab(true, near({ previousSibling: null }));
    assert.equal(outcome.kind, 'rechazo');
  });

  it('Shift-Tab lo sube al nivel del abuelo, detrás de su antiguo padre', () => {
    const outcome = resolveTab(
      false,
      near({ parent: 'block:p', grandparent: 'block:g', parentIndex: 2 }),
    );
    assert.deepEqual(outcome, { kind: 'desindentar', parent: 'block:g', position: 3 });
  });

  it('en el primer nivel no se puede desindentar más', () => {
    const outcome = resolveTab(false, near({ parent: null }));
    assert.equal(outcome.kind, 'rechazo');
  });
});

describe('Backspace al inicio del bloque', () => {
  it('fusiona con el de encima y el cursor cae en la costura', () => {
    const outcome = resolveBackspaceAtStart('mundo', near({
      previousVisible: { block: 'block:a', content: 'hola ', hasChildren: false },
    }));
    assert.deepEqual(outcome, {
      kind: 'fusionar',
      into: 'block:a',
      content: 'hola mundo',
      caret: 5,
    });
  });

  it('si el de encima está vacío, desaparece él y no éste', () => {
    // Así el bloque que se edita conserva identidad, hijos y referencias.
    const outcome = resolveBackspaceAtStart('texto', near({
      previousVisible: { block: 'block:vacio', content: '', hasChildren: false },
    }));
    assert.deepEqual(outcome, { kind: 'quitar-encima', target: 'block:vacio' });
  });

  it('no quita el padre aunque esté vacío', () => {
    const outcome = resolveBackspaceAtStart('texto', near({
      parent: 'block:p',
      previousVisible: { block: 'block:p', content: '', hasChildren: false },
    }));
    assert.equal(outcome.kind, 'rechazo');
  });

  describe('negativas', () => {
    it('sin nada encima y con texto, rechaza en vez de perderlo', () => {
      const outcome = resolveBackspaceAtStart('tengo texto', near({ previousVisible: null }));
      assert.equal(outcome.kind, 'rechazo');
      if (outcome.kind === 'rechazo') assert.match(outcome.reason, /encima/);
    });

    it('sin nada encima y vacío, simplemente no hace nada', () => {
      const outcome = resolveBackspaceAtStart('', near({ previousVisible: null }));
      assert.deepEqual(outcome, { kind: 'ninguno' });
    });

    it('si ambos tienen hijos, el orden sería ambiguo y se rechaza', () => {
      const outcome = resolveBackspaceAtStart('texto', near({
        hasChildren: true,
        previousVisible: { block: 'block:a', content: 'otro', hasChildren: true },
      }));
      assert.equal(outcome.kind, 'rechazo');
      if (outcome.kind === 'rechazo') assert.match(outcome.reason, /ambigu/);
    });

    it('el bloque con hijos sí puede fusionarse en uno sin hijos', () => {
      const outcome = resolveBackspaceAtStart('texto', near({
        hasChildren: true,
        previousVisible: { block: 'block:a', content: 'otro', hasChildren: false },
      }));
      assert.equal(outcome.kind, 'fusionar');
    });

    it('toda negativa lleva una razón que se pueda decir', () => {
      const casos = [
        resolveBackspaceAtStart('t', near({ previousVisible: null })),
        resolveTab(true, near()),
        resolveTab(false, near()),
      ];
      for (const outcome of casos) {
        assert.equal(outcome.kind, 'rechazo');
        if (outcome.kind === 'rechazo') assert.ok(outcome.reason.length > 10, outcome.reason);
      }
    });
  });
});

describe('flechas', () => {
  it('arriba sale del bloque sólo desde la primera línea', () => {
    const vecino = near({
      previousVisible: { block: 'block:a', content: 'x', hasChildren: false },
    });
    assert.equal(resolveArrow(true, 'una\ndos', 5, vecino).kind, 'ninguno');
    assert.deepEqual(resolveArrow(true, 'una\ndos', 1, vecino), {
      kind: 'mover-foco',
      block: 'block:a',
      at: 'final',
    });
  });

  it('abajo sale sólo desde la última línea', () => {
    const vecino = near({ nextVisible: 'block:c' });
    assert.equal(resolveArrow(false, 'una\ndos', 1, vecino).kind, 'ninguno');
    assert.deepEqual(resolveArrow(false, 'una\ndos', 5, vecino), {
      kind: 'mover-foco',
      block: 'block:c',
      at: 'inicio',
    });
  });

  it('sin vecino no se va a ninguna parte', () => {
    assert.equal(resolveArrow(true, 'x', 0, near()).kind, 'ninguno');
    assert.equal(resolveArrow(false, 'x', 1, near()).kind, 'ninguno');
  });

  it('reconoce primera y última línea', () => {
    assert.equal(onFirstLine('a\nb', 1), true);
    assert.equal(onFirstLine('a\nb', 3), false);
    assert.equal(onLastLine('a\nb', 3), true);
    assert.equal(onLastLine('a\nb', 0), false);
  });
});

describe('autopar', () => {
  it('trae la pareja y deja el cursor en medio', () => {
    assert.deepEqual(resolveDelimiter('(', 'ab', 1, 1), { buffer: 'a()b', cursor: 2 });
  });

  it('envuelve lo seleccionado en vez de reemplazarlo', () => {
    assert.deepEqual(resolveDelimiter('`', 'uno dos', 0, 3), {
      buffer: '`uno` dos',
      cursor: 4,
    });
  });

  it('salta el cierre que ya está bajo el cursor', () => {
    // Sin esto, escribir el paréntesis de cierre daría `())`.
    assert.deepEqual(resolveDelimiter(')', 'a()', 2, 2), { buffer: 'a()', cursor: 3 });
  });

  it('un carácter cualquiera no lo maneja', () => {
    assert.equal(resolveDelimiter('x', 'ab', 1, 1), null);
  });

  it('un cierre sin su pareja delante tampoco', () => {
    assert.equal(resolveDelimiter(')', 'ab', 1, 1), null);
  });
});
