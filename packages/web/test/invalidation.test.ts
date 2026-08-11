import assert from 'node:assert/strict';
import test from 'node:test';

import { changesGraphMeaning } from '../src/invalidation.ts';

test('plain prose edits do not invalidate the graph', () => {
  assert.equal(changesGraphMeaning('una frase', 'una frase mejor escrita'), false);
});

test('formatting around the same references does not invalidate the graph', () => {
  assert.equal(changesGraphMeaning('mira [[Vera]] y #memoria', '**mira** [[Vera]] y #memoria'), false);
});

test('adding, removing or retargeting references invalidates the graph', () => {
  assert.equal(changesGraphMeaning('sin enlace', 'mira [[Vera]]'), true);
  assert.equal(changesGraphMeaning('mira [[Vera]]', 'mira [[Memex]]'), true);
  assert.equal(changesGraphMeaning('mira #memoria', 'mira #lectura'), true);
});

test('structural changes without content information invalidate the graph', () => {
  assert.equal(changesGraphMeaning(), true);
});
