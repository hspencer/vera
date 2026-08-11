import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { dropped, loadTrace, movedTo, saveTrace, type TraceStep } from '../src/trace.ts';

const originalStorage = globalThis.localStorage;

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

const steps: TraceStep[] = [
  { page: 'a', from: null, gesture: 'opened_directly', at: 1 },
  { page: 'b', from: 'a', gesture: 'followed_reference', at: 2 },
  { page: 'a', from: 'b', gesture: 'returned', at: 3 },
];

afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage });
});

describe('rastro durable y componible', () => {
  it('sobrevive completo, incluyendo llegadas repetidas', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage() });
    saveTrace(steps);
    assert.deepEqual(loadTrace(), steps);
  });

  it('conserva el gesto al reordenar y permite podar una llegada', () => {
    const arranged = movedTo(steps, 2, 0);
    assert.equal(arranged[0]?.gesture, 'returned');
    assert.deepEqual(dropped(arranged, 1).map((step) => step.page), ['a', 'b']);
  });

  it('un valor local roto no impide abrir Vera', () => {
    const storage = memoryStorage();
    storage.setItem('vera.navigationTrace', '{no');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    assert.deepEqual(loadTrace(), []);
  });
});
