import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { removePageAndBlocks } from '../src/remove-page.ts';
import type { BlockView, Change } from '../src/api.ts';

const block = (stableId: string, parent: string | null): BlockView => ({
  stableId,
  parent,
  position: 0,
  content: stableId,
});

describe('removePageAndBlocks', () => {
  it('borra las hojas antes que sus padres y la página al final', async () => {
    const written: Change[] = [];
    const done = await removePageAndBlocks(
      {
        id: 'page:one',
        blocks: [block('parent', null), block('leaf', 'parent'), block('root', null)],
      },
      async (change) => {
        written.push(change);
        return true;
      },
    );

    assert.equal(done, true);
    assert.deepEqual(written, [
      { kind: 'remove_block', block: 'leaf' },
      { kind: 'remove_block', block: 'parent' },
      { kind: 'remove_block', block: 'root' },
      { kind: 'remove_page', page: 'page:one' },
    ]);
  });

  it('se detiene si un bloque no se pudo borrar', async () => {
    const written: Change[] = [];
    const done = await removePageAndBlocks(
      { id: 'page:one', blocks: [block('parent', null), block('leaf', 'parent')] },
      async (change) => {
        written.push(change);
        return change.kind !== 'remove_block' || change.block !== 'leaf';
      },
    );

    assert.equal(done, false);
    assert.deepEqual(written, [{ kind: 'remove_block', block: 'leaf' }]);
  });

  it('borra directamente una página vacía', async () => {
    const written: Change[] = [];
    const done = await removePageAndBlocks({ id: 'page:empty', blocks: [] }, async (change) => {
      written.push(change);
      return true;
    });

    assert.equal(done, true);
    assert.deepEqual(written, [{ kind: 'remove_page', page: 'page:empty' }]);
  });
});
