import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const api = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('contribuir no finge editar el corpus', () => {
  it('envía propuestas antes de la réplica optimista y las nombra como en revisión', () => {
    const submit = api.slice(api.indexOf('async submit('), api.indexOf('submitCanonical('));
    assert.ok(submit.indexOf('if (proposeInsteadOfWriting)') < submit.indexOf('writeLocally?.'));
    assert.match(api, /fetch\('\/shared-proposals'/);
    assert.match(api, /phase: 'proposed'/);
    assert.match(main, /'en revisión'/);
    assert.match(main, /canContribute !== true/);
  });
});
