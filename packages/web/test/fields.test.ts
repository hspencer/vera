import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { replaceSeparated, separatedQuery } from '../src/fields.ts';

describe('autocompletado de respuestas separadas', () => {
  it('busca sólo el concepto situado junto al cursor', () => {
    assert.equal(separatedQuery('diseño, mem, soberanía', 11, ','), 'mem');
  });

  it('sustituye un concepto sin borrar los demás', () => {
    assert.deepEqual(replaceSeparated('diseño, mem, soberanía', 11, 'memoria', ','), {
      value: 'diseño, memoria, soberanía',
      cursor: 15,
    });
  });

  it('completa el concepto nuevo escrito después de una coma', () => {
    assert.deepEqual(replaceSeparated('diseño, hyp', 11, 'Hypomnemata', ','), {
      value: 'diseño, Hypomnemata',
      cursor: 19,
    });
  });
});
