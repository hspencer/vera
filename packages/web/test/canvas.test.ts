import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extendStroke } from '../src/canvas.ts';

const point = (x: number, y: number, pressure = 0.5) => ({ x, y, pressure });

describe('la recta del lienzo', () => {
  it('conserva sólo comienzo y extremo aunque la mano siga moviéndose', () => {
    const stroke = [point(10, 20, 0.2)];
    extendStroke(stroke, point(30, 40, 0.4), true);
    extendStroke(stroke, point(50, 60, 0.8), true);
    assert.deepEqual(stroke, [point(10, 20, 0.2), point(50, 60, 0.8)]);
  });

  it('al entrar Shift a mitad de un trazo descarta las muestras intermedias', () => {
    const stroke = [point(0, 0), point(3, 2), point(8, 7)];
    extendStroke(stroke, point(20, 20, 0.9), true);
    assert.deepEqual(stroke, [point(0, 0), point(20, 20, 0.9)]);
  });

  it('sin Shift sigue siendo un trazo a mano alzada', () => {
    const stroke = [point(0, 0)];
    extendStroke(stroke, point(3, 2), false);
    extendStroke(stroke, point(8, 7), false);
    assert.equal(stroke.length, 3);
  });
});
