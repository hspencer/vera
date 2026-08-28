import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { selectedSiblingMove } from '../src/selection-movement.ts';

describe('mover un tramo de bloques', () => {
  it('sube el tramo moviendo al hermano anterior detrás de él', () => {
    assert.deepEqual(selectedSiblingMove(['a', 'b', 'c', 'd'], ['b', 'c'], true), {
      block: 'a', position: 2,
    });
  });

  it('baja el tramo moviendo al hermano siguiente delante de él', () => {
    assert.deepEqual(selectedSiblingMove(['a', 'b', 'c', 'd'], ['b', 'c'], false), {
      block: 'd', position: 1,
    });
  });

  it('no inventa movimiento en un borde ni para una selección discontinua', () => {
    assert.equal(selectedSiblingMove(['a', 'b', 'c'], ['a', 'b'], true), null);
    assert.equal(selectedSiblingMove(['a', 'b', 'c'], ['a', 'c'], false), null);
  });
});
