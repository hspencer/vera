import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('edición dentro de la bitácora continua', () => {
  it('cada día anterior se redibuja por su propia identidad sin navegar al día activo', () => {
    assert.match(main, /renderOutliner\(slice, older, callbacksForJournalSlice\(older, slice\)/);
    const local = main.slice(
      main.indexOf('function callbacksForJournalSlice'),
      main.indexOf('/**\n * Lo que el outliner puede pedirle', main.indexOf('function callbacksForJournalSlice')),
    );
    assert.match(local, /api\.page\(page\.id\)/);
    assert.doesNotMatch(local, /openPage\(workspace\.activePage/);
  });
});
