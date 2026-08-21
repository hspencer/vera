import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import config from '../vite.config.ts';

describe('actualizaciones de la PWA', () => {
  it('conserva los assets con huella que todavía puede pedir un armazón anterior', () => {
    assert.equal(typeof config, 'object');
    if (typeof config !== 'object') return;
    assert.equal(config.build?.emptyOutDir, false);
  });
});
