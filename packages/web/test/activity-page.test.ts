import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const activity = readFileSync(new URL('../src/activity-page.ts', import.meta.url), 'utf8');

describe('Vera: Registro de Actividad', () => {
  it('separa cambios y eliminaciones en pestañas accesibles', () => {
    assert.match(activity, /setAttribute\('role', 'tablist'\)/);
    assert.match(activity, /textContent = 'Creaciones y ediciones'/);
    assert.match(activity, /textContent = `Eliminaciones \(\$\{view\.deletedPages\.length\}\)`/);
    assert.match(activity, /setAttribute\('role', 'tabpanel'\)/);
  });

  it('enlaza las páginas vivas y presenta el extracto recibido del registro', () => {
    assert.match(activity, /block === null \? '' : `#\$\{encodeURIComponent\(block\)\}`/);
    assert.match(activity, /excerpt\.className = 'activity-excerpt'/);
    assert.match(activity, /excerpt\.textContent = one\.excerpt/);
  });

  it('da a cada participante una dirección durable y filtra toda la paginación', () => {
    assert.match(activity, /participantActivityPath\(participant: string\)/);
    assert.match(activity, /searchParams\.get\('participant'\)/);
    assert.match(activity, /api\.activity\(undefined, participant\)/);
    assert.match(activity, /api\.activity\(cursor, participant\)/);
    assert.match(activity, /Contribuciones de \$\{view\.participant\.name\}/);
  });

  it('reserva la restauración para las tumbas sin fabricarles enlace', () => {
    const deletedRow = activity.match(/function deletedRow[\s\S]*?return row;\n}/)?.[0] ?? '';
    assert.match(activity, /deletedRow\(one, restore, refresh\)/);
    assert.match(deletedRow, /button\.textContent = 'restaurar'/);
    assert.doesNotMatch(deletedRow, /link\.href/);
  });
});
