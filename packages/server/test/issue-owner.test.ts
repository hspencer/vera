import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadGraph, openStore, saveParticipant } from '@vera/store';

import { resolveSecret } from '../src/credentials.ts';

describe('credencial raíz fuera de la red', () => {
  it('la emite para la persona propietaria abriendo su base local', () => {
    const database = join(mkdtempSync(join(tmpdir(), 'vera-owner-')), 'vera.sqlite');
    const store = openStore({ path: database, graphName: 'mind' });
    saveParticipant(store, { id: 'participant:herbert', name: 'Herbert', kind: 'human' });
    store.close();

    const secret = execFileSync(
      process.execPath,
      ['packages/server/src/issue-owner.ts', database, 'navegador local'],
      { cwd: process.cwd(), encoding: 'utf8' },
    ).trim();

    const reopened = openStore({ path: database, graphName: 'mind' });
    const graph = loadGraph(reopened, 'mind');
    assert.equal(graph.owner, 'participant:herbert');
    const resolved = resolveSecret(reopened, secret);
    assert.equal(resolved.ok, true);
    if (resolved.ok) {
      assert.equal(resolved.credential.participant, 'participant:herbert');
      assert.deepEqual(resolved.credential.scopes, ['discard', 'read', 'write']);
    }
    reopened.close();
  });
});
