import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isPresentation } from '../src/presentation.ts';

describe('páginas que se pueden presentar', () => {
  it('reconoce el tipo gobernado aunque cambien mayúsculas o acentos', () => {
    assert.equal(isPresentation([{ key: 'tipo', value: 'Presentación' }], 'tipo'), true);
    assert.equal(isPresentation([{ key: 'TIPO', value: 'presentacion' }], 'tipo'), true);
  });

  it('no convierte una página ordinaria en presentación', () => {
    assert.equal(isPresentation([{ key: 'tipo', value: 'Concepto' }], 'tipo'), false);
    assert.equal(isPresentation([], 'tipo'), false);
  });
});
