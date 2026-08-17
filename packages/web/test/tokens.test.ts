import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { session } from '../src/tokens.ts';

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const previous = globalThis.localStorage;
afterEach(() => { globalThis.localStorage = previous; });

describe('vista del mapa publicado', () => {
  it('nace en 3D y recuerda una elección pública sin tocar la privada', () => {
    const storage = new MemoryStorage();
    globalThis.localStorage = storage as unknown as Storage;

    assert.equal(session.publicGraphView(), 'graph_3d');
    session.setPublicGraphView('graph_2d');
    assert.equal(session.publicGraphView(), 'graph_2d');
    assert.equal(session.graphView(), 'graph_2d');
    assert.equal(storage.getItem('vera.graphView'), null);
  });
});
