import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PageView } from '../src/api.ts';
import { sameReadablePage } from '../src/page-validation.ts';

const page = (content: string, lastEditedAt = 10): PageView => ({
  id: 'page:hypomnemata',
  title: 'Hypomnemata',
  visibility: 'private',
  createdAt: 1,
  originCreatedAt: null,
  lastEditedAt,
  properties: [],
  blockProperties: {},
  domains: {},
  blocks: [{ stableId: 'block:1', parent: null, position: 0, content }],
  backlinks: [],
  references: [],
  crossingsOut: [],
  crossingsIn: [],
  assets: [],
  blockRefs: [],
  folded: [],
});

describe('retained page validation', () => {
  it('recognises an unchanged readable page', () => {
    assert.equal(sameReadablePage(page('cuaderno'), page('cuaderno')), true);
  });

  it('detects changed prose even when the block count stayed equal', () => {
    assert.equal(sameReadablePage(page(''), page('cuaderno')), false);
  });

  it('detects a changed canonical revision even when prose looks equal', () => {
    assert.equal(sameReadablePage(page('cuaderno'), page('cuaderno', 11)), false);
  });
});
