// La bandeja de salida: que lo pendiente sobreviva y salga en orden.
//
// Ver specs/offline-reconciliation.allium, fase 2. El almacén se inyecta, así que
// esto se prueba sin navegador: una bandeja sin pruebas es justo la clase de cosa
// que falla el día que hace falta.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createOutbox, inMemory, inOrder, nextToSend, stateOf, type Pending } from '../src/outbox.ts';

const pending = (originId: string, at: number, status: Pending['status'] = 'local'): Pending => ({
  originId,
  change: { kind: 'edit_block', block: 'block:a', content: originId },
  channel: 'typed_text',
  at,
  status,
});

describe('el orden en que sale lo pendiente', () => {
  it('sale en el orden en que salió de la mano', () => {
    // @guidance de rule SubmitNextLocalChange. Reordenar rompería secuencias que
    // sólo tienen sentido juntas: crear un bloque y escribir dentro.
    const said = inOrder([pending('c', 3), pending('a', 1), pending('b', 2)]);
    assert.deepEqual(said.map((one) => one.originId), ['a', 'b', 'c']);
  });

  it('dos en el mismo instante conservan un orden estable', () => {
    // Sin desempate, el orden dependería del almacén y dos aparatos con lo mismo
    // dentro mandarían cosas distintas.
    const a = inOrder([pending('b', 1), pending('a', 1)]).map((one) => one.originId);
    const b = inOrder([pending('a', 1), pending('b', 1)]).map((one) => one.originId);
    assert.deepEqual(a, b);
  });

  it('lo rechazado no se reintenta', () => {
    // El dominio ya dijo que no; volver a preguntarle daría lo mismo. Espera a
    // que una persona decida.
    const said = nextToSend([pending('a', 1, 'rejected'), pending('b', 2)]);
    assert.equal(said?.originId, 'b');
  });

  it('con todo rechazado no hay nada que mandar', () => {
    assert.equal(nextToSend([pending('a', 1, 'rejected')]), null);
  });
});

describe('qué se dice del conjunto', () => {
  it('sin nada pendiente, sincronizado', () => {
    assert.deepEqual(stateOf([], 'online'), { status: 'synchronised', pending: 0 });
  });

  it('con algo pendiente y red, está aquí y viajando', () => {
    assert.deepEqual(stateOf([pending('a', 1)], 'online'), { status: 'local', pending: 1 });
  });

  it('sin red lo dice, y dice cuánto espera', () => {
    assert.deepEqual(stateOf([pending('a', 1), pending('b', 2)], 'offline'), {
      status: 'offline',
      pending: 2,
    });
  });

  it('un rechazo pide atención aunque lo demás esté al día', () => {
    // @invariant SilenceNeverPretendsToBeSuccess: contar un rechazo como parte
    // del montón lo escondería detrás de un número que baja solo.
    assert.equal(stateOf([pending('a', 1, 'rejected')], 'online').status, 'attention_required');
  });
});

describe('sobrevivir a cerrar', () => {
  it('lo guardado vuelve al abrir', async () => {
    // @invariant LocalDurabilityPrecedesSavedFeedback.
    const store = inMemory();
    const one = createOutbox(store);
    await one.remember(pending('a', 1));
    await one.remember(pending('b', 2));

    const again = createOutbox(store);
    const back = await again.restore();
    assert.deepEqual(back.map((x) => x.originId), ['a', 'b']);
  });

  it('lo que se quedó a medio mandar vuelve a estar sólo aplicado aquí', async () => {
    // rule ReturnPendingChangeAfterRestart: reenviar es inocuo porque el origen
    // es la llave de idempotencia, así que la incertidumbre no se convierte ni en
    // pérdida ni en duplicado.
    const store = inMemory();
    await store.put(pending('a', 1, 'sending'));
    const back = await createOutbox(store).restore();
    assert.equal(back[0]?.status, 'local');
    // Y queda escrito así, no sólo en memoria: cerrar otra vez no lo devuelve a
    // «sending».
    assert.equal((await store.all())[0]?.status, 'local');
  });

  it('lo rechazado sobrevive con su motivo', async () => {
    // @invariant PreserveRejectedLocalChange: tirarlo en silencio sería perderlo
    // dos veces.
    const store = inMemory();
    const one = createOutbox(store);
    await one.remember(pending('a', 1));
    await one.mark('a', 'rejected', 'una página ya lleva ese título');

    const back = await createOutbox(store).restore();
    assert.equal(back[0]?.status, 'rejected');
    assert.equal(back[0]?.reason, 'una página ya lleva ese título');
  });

  it('lo confirmado deja de ocupar sitio', async () => {
    const store = inMemory();
    const one = createOutbox(store);
    await one.remember(pending('a', 1));
    await one.settle('a');
    assert.deepEqual(one.pending(), []);
    assert.deepEqual(await store.all(), []);
  });

  it('recordar dos veces el mismo origen no lo duplica', async () => {
    const store = inMemory();
    const one = createOutbox(store);
    await one.remember(pending('a', 1));
    await one.remember(pending('a', 1));
    assert.equal(one.pending().length, 1);
  });
});
