import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');

describe('superficies especiales', () => {
  it('reemplazan las áreas del mapa y ocupan la columna completa', () => {
    const rule = styles.match(/#vera-root\.special-surface\s*\{([^}]+)\}/)?.[1] ?? '';
    assert.match(rule, /grid-template-columns:\s*1fr/);
    assert.match(rule, /grid-template-areas:\s*'bar'\s*'text'/);
  });

  it('administra los espacios compartidos en una ruta completa desde configuración', () => {
    assert.match(main, /pathname === '\/compartir'/);
    assert.match(settings, /onOpenSharing/);
    assert.match(settings, /renderSharingAdministration/);
    assert.doesNotMatch(settings, /id: 'compartir', label: 'Compartir'/);
  });
});
