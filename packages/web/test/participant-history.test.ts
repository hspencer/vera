import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const outliner = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');

describe('autoría navegable en el historial de un bloque', () => {
  it('enlaza el nombre con el registro del participante estable', () => {
    assert.match(outliner, /author\.href = participantActivityPath\(state\.participant\)/);
    assert.match(outliner, /author\.textContent = state\.by/);
  });
});
