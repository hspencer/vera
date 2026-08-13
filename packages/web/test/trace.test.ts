import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { dropped, loadTrace, movedTo, saveTrace, walked, type TraceStep } from '../src/trace.ts';

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

  it('al volver a abrir limpia repintados antiguos, pero conserva los regresos reales', () => {
    const storage = memoryStorage();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    saveTrace([
      steps[0]!,
      { ...steps[0]!, at: 2 },
      steps[1]!,
      steps[2]!,
    ]);
    assert.deepEqual(loadTrace().map((step) => step.page), ['a', 'b', 'a']);
    assert.deepEqual(JSON.parse(storage.getItem('vera.navigationTrace') ?? '[]').map((step: TraceStep) => step.page), ['a', 'b', 'a']);
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

describe('lo que es andar y lo que no', () => {
  it('un bucle son dos llegadas y las dos cuentan', () => {
    // La razón de que esto no deduplique: volver a una página por otro camino
    // dice algo, y colapsar las dos llegadas en una lo borraría justo ahí.
    const walking = walked(steps, { page: 'b', from: 'a', gesture: 'followed_reference', at: 4 });
    assert.deepEqual(walking.map((step) => step.page), ['a', 'b', 'a', 'b']);
  });

  it('pero llegar donde ya se estaba no es llegar', () => {
    /*
     * @invariant RedrawingAPageIsNotWalkingToIt. Estaba sostenido por convención
     * —quien redibuja no pasa gesto— y bastó un camino que sí lo pasara para
     * romperlo: pulsar un enlace a un ancla movía el fragmento de la dirección,
     * el enrutador lo leía como una llegada, y el rastro terminaba con la misma
     * página repetida una vez por clic.
     */
    const still = walked(steps, { page: 'a', from: 'a', gesture: 'followed_reference', at: 4 });
    assert.deepEqual(still, steps);
  });

  it('ni volver a abrir por la dirección la que ya estaba abierta', () => {
    // Sin `from` no hay de dónde venir, así que lo dice el rastro: si el último
    // paso ya estaba ahí, nadie anduvo.
    const same = walked(steps, { page: 'a', from: null, gesture: 'opened_directly', at: 4 });
    assert.deepEqual(same, steps);
  });

  it('y llegar de fuera a otra página sigue siendo llegar', () => {
    const arrived = walked(steps, { page: 'c', from: null, gesture: 'opened_directly', at: 4 });
    assert.equal(arrived.length, 4);
  });
});
