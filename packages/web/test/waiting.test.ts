// Cuánto lleva pasando lo que está pasando.
//
// Lo que se fija aquí es que el número no mienta: que no aparezca antes de que
// haya algo que esperar, que lo que se promete salga de lo medido y no de una
// invención, y que una espera rarísima no arrastre lo que se le dice a nadie las
// veinte veces siguientes.

import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

/** Un almacenamiento de mentira: estas pruebas no corren en un navegador. */
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as unknown as Storage;

const { remember, saySeconds, usuallyTakes } = await import('../src/waiting.ts');

beforeEach(() => store.clear());

describe('lo que suele tardar', () => {
  it('no se sabe hasta que se ha medido', () => {
    // Y mientras no se sabe, no se dice: inventar un «suele tardar» es
    // exactamente la clase de promesa que hace desconfiar de todas las demás.
    assert.equal(usuallyTakes('modelo'), null);
  });

  it('es la mediana y no la media', () => {
    /*
     * Una llamada que un día se fue a noventa segundos porque la máquina estaba
     * ocupada no debe cambiar lo que se promete las veinte veces siguientes. La
     * mediana la ignora; la media la arrastra.
     */
    for (const took of [20_000, 21_000, 19_000, 90_000, 20_500]) remember('modelo', took);
    assert.equal(usuallyTakes('modelo'), 20_500);
  });

  it('olvida lo viejo: lo que tardaba hace un mes ya no es esta máquina', () => {
    for (let n = 0; n < 12; n += 1) remember('modelo', 5_000);
    for (let n = 0; n < 7; n += 1) remember('modelo', 30_000);
    assert.equal(usuallyTakes('modelo'), 30_000);
  });

  it('lo instantáneo no se recuerda: no era una espera', () => {
    remember('rápido', 120);
    assert.equal(usuallyTakes('rápido'), null);
  });

  it('cada espera se recuerda por su cuenta', () => {
    remember('modelo', 20_000);
    remember('enlaces', 2_000);
    assert.equal(usuallyTakes('modelo'), 20_000);
    assert.equal(usuallyTakes('enlaces'), 2_000);
  });

  it('sin almacenamiento se sigue contando, sólo se pierde la memoria', () => {
    const held = globalThis.localStorage;
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: () => {
        throw new Error('no hay');
      },
      setItem: () => {
        throw new Error('no hay');
      },
    } as unknown as Storage;
    assert.doesNotThrow(() => remember('modelo', 20_000));
    assert.equal(usuallyTakes('modelo'), null);
    (globalThis as unknown as { localStorage: Storage }).localStorage = held;
  });
});

describe('decir un tiempo', () => {
  it('en segundos mientras quepan', () => {
    assert.equal(saySeconds(900), '1 s');
    assert.equal(saySeconds(20_400), '20 s');
    assert.equal(saySeconds(59_000), '59 s');
  });

  it('y en minutos cuando ya no', () => {
    // «94 s» obliga a dividir mentalmente; nadie mide una espera larga así.
    assert.equal(saySeconds(94_000), '1 min 34 s');
    assert.equal(saySeconds(120_000), '2 min');
  });
});
