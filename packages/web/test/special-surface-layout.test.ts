import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('superficies especiales', () => {
  it('reemplazan las áreas del mapa y ocupan la columna completa', () => {
    const rule = styles.match(/#vera-root\.special-surface\s*\{([^}]+)\}/)?.[1] ?? '';
    assert.match(rule, /grid-template-columns:\s*1fr/);
    assert.match(rule, /grid-template-areas:\s*'bar'\s*'text'/);
  });
});
