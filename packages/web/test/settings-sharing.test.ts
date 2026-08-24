import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const settings = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');

describe('administración de invitaciones', () => {
  it('permite eliminar definitivamente invitaciones de cualquier estado con confirmación', () => {
    assert.match(settings, /remove\.textContent = 'Eliminar'/);
    assert.match(settings, /¿Eliminar definitivamente esta invitación\?/);
    assert.match(settings, /también se revocará el acceso/);
    assert.match(settings, /invitations\/\$\{encodeURIComponent\(invitation\.id\)\}\/permanent/);
  });

  it('no deja que un enlace anterior se confunda con el recién creado', () => {
    assert.match(settings, /Invitación nueva · \$\{String\(made\.id\)\}/);
    assert.match(settings, /result\.replaceChildren\(issued\)/);
    assert.match(settings, /No se pudo copiar; el enlace quedó seleccionado/);
  });
});
