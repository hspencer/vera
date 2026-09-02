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

  it('da a geometría y tarjetas la misma transformación, directamente en iOS', () => {
    assert.match(renderer, /world\.attr\('transform', viewport\.toString\(\)\)/);
    assert.match(renderer, /selectAll<SVGForeignObjectElement, unknown>\('\.d4-card'\)[\s\S]*?\.attr\('transform', viewport\.toString\(\)\)/);
    assert.match(renderer, /svg\.append\('foreignObject'\)[\s\S]*?\.attr\('class', 'd4-card'\)/);
    assert.doesNotMatch(renderer, /world\.append\('foreignObject'\)/);
  });

  it('elige el hover por la franja colapsada e ignora la proyección desplegada', () => {
    assert.match(renderer, /foldedLines[\s\S]*?getBoundingClientRect\(\)/);
    assert.match(renderer, /classList\.add\('hovered'\)/);
    assert.doesNotMatch(styles, /\.d4-line:hover[\s,{]/);
    assert.match(styles, /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?\.d4-line-content \{ pointer-events: none; \}/);
  });

  it('eleva la tarjeta completa al leer un bloque', () => {
    assert.match(renderer, /const raiseReadingCards =/);
    assert.match(renderer, /for \(const foreign of reading\) d3\.select\(foreign\)\.raise\(\)/);
    assert.match(renderer, /raiseReadingCards\(foreign\.node\(\)\)/);
    assert.match(renderer, /for \(const sibling of foldedLines\)/);
  });
});
