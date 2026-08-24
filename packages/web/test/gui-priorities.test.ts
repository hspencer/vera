import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const graph = readFileSync(new URL('../src/graph/render.ts', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');
const outliner = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');

describe('prioridades de interfaz posteriores al móvil', () => {
  it('encuadra las cajas completas de los nombres del mapa', () => {
    assert.match(graph, /const bounds = data\.nodes\.map/);
    assert.match(graph, /dims\.get\(item\.id\)/);
    assert.match(graph, /if \(!allPlaced && heldTransform === null\)/);
  });

  it('expone pertenencia efectiva, personas y espacios inicialmente vacíos', () => {
    assert.match(settings, /Pertenencia efectiva/);
    assert.match(settings, /peopleDirectory\(spaces\)/);
    assert.match(settings, /Propiedad inicial \(opcional\)/);
    assert.match(settings, /drawPageSharing/);
  });

  it('separa ajustes comunes y avanzados y distingue controles repetidos', () => {
    assert.match(settings, /Apariencia avanzada/);
    assert.match(settings, /simpleTokens/);
    assert.match(graph, /Visualización del grafo de conocimiento/);
    assert.match(outliner, /acciones del bloque: \$\{blockSummary\}/);
  });
});
