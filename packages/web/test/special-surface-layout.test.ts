import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');
const mcp = readFileSync(new URL('../src/mcp-page.ts', import.meta.url), 'utf8');

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

  it('vincula desde la propia puerta las tres guías de conexión por proveedor', () => {
    assert.match(mcp, /Vera — conectar OpenAI por MCP/);
    assert.match(mcp, /Vera — conectar Claude por MCP/);
    assert.match(mcp, /Vera — conectar Gemini por MCP/);
    assert.match(mcp, /aria-label', 'guías para conectar inteligencias artificiales'/);
  });

  it('cuenta la espera de una búsqueda comprometida y la cierra en éxito o fallo', () => {
    assert.match(main, /countInto\(status, `Buscando “\$\{query\}”…`, 'search:corpus'\)/);
    assert.match(main, /counting\.close\('failed'\)/);
    assert.match(main, /counting\.close\(\)/);
  });

  it('hace visible el trabajo global sin tapar la interfaz y respeta movimiento reducido', () => {
    assert.match(styles, /html\[data-working='true'\]::after/);
    assert.match(styles, /pointer-events:\s*none/);
    assert.match(styles, /html\[data-working-slow='true'\]::after/);
    assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  });
});
