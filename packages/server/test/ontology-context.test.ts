import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { describeCandidates, relevantConcepts, type ConceptCandidate } from '../src/ontology-context.ts';

const candidate = (
  id: string,
  title: string,
  options: Partial<ConceptCandidate> = {},
): ConceptCandidate => ({
  id,
  title,
  uses: 0,
  backlinks: 0,
  linked: false,
  excerpt: null,
  ...options,
});

describe('recuperación de conceptos para el lector local', () => {
  it('una mención concreta manda sobre la popularidad global', () => {
    const found = relevantConcepts('La accesibilidad cognitiva organiza este proyecto', [
      candidate('page:diseño', 'Diseño', { uses: 500, backlinks: 800 }),
      candidate('page:aac', 'Accesibilidad cognitiva', { uses: 1 }),
    ]);
    assert.equal(found[0]?.id, 'page:aac');
  });

  it('un vínculo de la propia página trae el concepto aunque no repita su nombre', () => {
    const found = relevantConcepts('Una reflexión sobre estas prácticas', [
      candidate('page:vecino', 'Sondas digitales', { linked: true }),
      candidate('page:famosa', 'Diseño', { uses: 100 }),
    ]);
    assert.equal(found[0]?.id, 'page:vecino');
  });

  it('la popularidad sólo rellena el final de una recuperación acotada', () => {
    const found = relevantConcepts(
      'Texto sin una coincidencia literal',
      Array.from({ length: 40 }, (_, at) => candidate(`page:${at}`, `Concepto ${at}`, { uses: 40 - at })),
    );
    assert.equal(found.length, 24);
  });

  it('el prompt transporta identidad, título y evidencia sin confundirlos', () => {
    const text = describeCandidates([
      candidate('page:42', 'Accesibilidad', { uses: 7, backlinks: 3, excerpt: 'Diseño para comprender.' }),
    ]);
    assert.match(text, /page:42 \| Accesibilidad/);
    assert.match(text, /7 usos/);
    assert.match(text, /Diseño para comprender/);
  });
});
