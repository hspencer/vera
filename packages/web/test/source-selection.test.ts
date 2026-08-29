import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sourceSelection } from '../src/source-selection.ts';

describe('sourceSelection', () => {
  it('conserva una selección literal de la lectura en la fuente', () => {
    assert.deepEqual(sourceSelection('antes **palabra** después', 'palabra', 10), {
      start: 8,
      end: 15,
    });
  });

  it('usa el lugar señalado para decidir entre repeticiones', () => {
    assert.deepEqual(sourceSelection('uno dos uno', 'uno', 11), { start: 8, end: 11 });
  });

  it('no inventa una selección cuando el render no aparece en la fuente', () => {
    assert.equal(sourceSelection('[nombre](https://example.test)', 'otro', 0), null);
  });

  it('rechaza una selección vacía', () => {
    assert.equal(sourceSelection('texto', '', 2), null);
  });
});
