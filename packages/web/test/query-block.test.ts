// La parte de la respuesta que no toca el DOM: cómo se dice una fecha.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { saidDate } from '../src/query-block.ts';

const AT = new Date(2026, 7, 7, 12, 0, 0).getTime(); // 7 de agosto de 2026, mediodía

describe('saidDate', () => {
  it('lo de hoy se nombra, no se fecha', () => {
    assert.equal(saidDate(new Date(2026, 7, 7, 9, 30).getTime(), AT), 'hoy');
  });

  it('y lo de ayer también', () => {
    assert.equal(saidDate(new Date(2026, 7, 6, 23, 59).getTime(), AT), 'ayer');
  });

  it('lo de este año se dice sin año, que es el que se sobreentiende', () => {
    assert.equal(saidDate(new Date(2026, 6, 31).getTime(), AT), '31 jul');
  });

  it('lo de otro año lo lleva', () => {
    assert.equal(saidDate(new Date(2025, 0, 9).getTime(), AT), '9 ene 2025');
  });

  it('una página sin fecha no dice nada, en vez de decir «nunca»', () => {
    assert.equal(saidDate(null, AT), '');
  });

  it('la medianoche de hoy sigue siendo hoy', () => {
    assert.equal(saidDate(new Date(2026, 7, 7, 0, 0, 0).getTime(), AT), 'hoy');
  });
});
