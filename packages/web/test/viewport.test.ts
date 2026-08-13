import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { viewportDelta, type HeldViewport } from '../src/viewport.ts';

const held: HeldViewport = {
  scrollTop: 900,
  seats: [
    { block: 'block:b', top: 12 },
    { block: 'block:c', top: 70 },
    { block: 'block:a', top: -40 },
  ],
};

describe('conservar el lugar al redibujar', () => {
  it('corrige lo que se movió el bloque más cercano al borde', () => {
    assert.equal(viewportDelta(held, new Map([['block:b', 42]])), 30);
  });

  it('si el bloque fue eliminado usa el siguiente testigo visible', () => {
    assert.equal(viewportDelta(held, new Map([['block:c', 40]])), -30);
  });

  it('sin ningún testigo superviviente pide conservar el scroll numérico', () => {
    assert.equal(viewportDelta(held, new Map()), null);
  });
});
