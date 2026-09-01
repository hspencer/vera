import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const renderer = readFileSync(new URL('../src/graph/renderD4.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('interacción de D4', () => {
  it('acusa el cambio de foco antes de esperar el nuevo vecindario', () => {
    assert.match(renderer, /const focusNow = \(\): void =>/);
    assert.match(renderer, /focusNow\(\);\s*onClickPage\(node\.id\)/);
  });

  it('no transforma el SVG que contiene foreignObject', () => {
    const rule = styles.match(/\.d4-map\s*\{[^}]*\}/s)?.[0] ?? '';
    assert.doesNotMatch(rule, /animation\s*:/);
    assert.doesNotMatch(styles, /@keyframes\s+d4-arrive/);
  });
});
