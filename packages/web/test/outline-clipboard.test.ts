import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseOutlineClipboard } from '../src/outline-clipboard.ts';

describe('portapapeles estructural', () => {
  it('reconstruye orden y profundidad de un outline Markdown', () => {
    assert.deepEqual(
      parseOutlineClipboard('- uno\n  - hijo\n    - nieto\n- dos'),
      [
        { content: 'uno', depth: 0 },
        { content: 'hijo', depth: 1 },
        { content: 'nieto', depth: 2 },
        { content: 'dos', depth: 0 },
      ],
    );
  });

  it('acepta la lista numerada como estructura sin guardar sus ordinales', () => {
    assert.deepEqual(
      parseOutlineClipboard('1. primero\n   1. hijo\n2. segundo'),
      [
        { content: 'primero', depth: 0 },
        { content: 'hijo', depth: 1 },
        { content: 'segundo', depth: 0 },
      ],
    );
  });

  it('reconstruye el formato que Vera misma copia para un bloque y sus hijos', () => {
    assert.deepEqual(parseOutlineClipboard('raíz\n- hijo\n  - nieto'), [
      { content: 'raíz', depth: 0 },
      { content: 'hijo', depth: 1 },
      { content: 'nieto', depth: 2 },
    ]);
  });

  it('no confunde texto corriente ni un guion aislado con un outline', () => {
    assert.equal(parseOutlineClipboard('una frase\ncon otra línea'), null);
    assert.equal(parseOutlineClipboard('- un solo guion que pertenece al texto'), null);
    assert.equal(parseOutlineClipboard('- uno\ncontinuación sin viñeta'), null);
  });

  it('rechaza saltos de más de un nivel porque no nombran un padre', () => {
    assert.equal(parseOutlineClipboard('- raíz\n    - nieto sin padre'), null);
  });
});
