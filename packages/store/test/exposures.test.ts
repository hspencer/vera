// El registro de exposición.
//
// Lo que se prueba aquí no es que la tabla guarde filas, sino que el registro
// conteste las dos preguntas por las que existe: qué se llevó alguien, y quién
// se llevó esto. Ver specs/mcp-server.allium, contrato WhatWasReadIsRecorded.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { openStore, saveParticipant } from '../src/store.ts';
import { exposuresOf, recordExposure, whoRead } from '../src/exposures.ts';

const OWNER = 'participant:herbert';
const COTITO = 'participant:cotito';

function freshStore() {
  const store = openStore({ path: ':memory:', graphName: 'mind' });
  saveParticipant(store, { id: OWNER, name: 'Herbert', kind: 'human' });
  saveParticipant(store, { id: COTITO, name: 'Cotito', kind: 'agent' });
  return store;
}

describe('el registro de exposición', () => {
  it('anota quién se llevó qué, y no la respuesta', () => {
    const store = freshStore();
    recordExposure(store, {
      participant: COTITO,
      client: 'openclaw',
      surface: 'GET /pages/:id',
      subject: 'page:1',
      delivered: ['page:1', 'block:1', 'block:2'],
      volume: 4096,
      at: 1000,
    });
    const [only] = exposuresOf(store);
    assert.equal(only?.participant, COTITO);
    assert.equal(only?.client, 'openclaw');
    assert.equal(only?.volume, 4096);
    assert.deepEqual(only?.delivered, ['block:1', 'block:2', 'page:1']);
    // El texto entregado no está en ninguna parte: guardarlo dejaría una
    // segunda copia del corpus dentro del registro que existe para vigilarlo.
    assert.ok(!JSON.stringify(only).includes('content'));
  });

  it('contesta qué se llevó alguien, lo último primero', () => {
    const store = freshStore();
    for (const at of [10, 30, 20]) {
      recordExposure(store, {
        participant: at === 30 ? OWNER : COTITO,
        surface: 'GET /search',
        subject: `busca ${at}`,
        at,
      });
    }
    assert.deepEqual(
      exposuresOf(store).map((one) => one.at),
      [30, 20, 10],
    );
    assert.deepEqual(
      exposuresOf(store, { participant: COTITO }).map((one) => one.at),
      [20, 10],
    );
  });

  it('y contesta la pregunta al revés: quién ha leído esto', () => {
    // La que uno se hace al encontrar una página que no debería haber salido.
    const store = freshStore();
    recordExposure(store, {
      participant: COTITO,
      surface: 'GET /search',
      subject: 'contraseña',
      delivered: ['page:privada', 'page:otra'],
      at: 10,
    });
    recordExposure(store, {
      participant: OWNER,
      surface: 'GET /pages/:id',
      subject: 'page:otra',
      delivered: ['page:otra'],
      at: 20,
    });
    assert.deepEqual(
      whoRead(store, 'page:privada').map((one) => one.participant),
      [COTITO],
    );
    assert.deepEqual(
      whoRead(store, 'page:otra').map((one) => one.participant),
      [OWNER, COTITO],
    );
  });

  it('una lectura sin credencial se anota como lo que es, sin credencial', () => {
    // Hoy el cliente web entra sin credencial y se le supone el dueño. Eso es
    // cierto y se registra tal cual, en vez de disimular la ausencia inventando
    // una credencial que no hubo.
    const store = freshStore();
    recordExposure(store, { participant: OWNER, surface: 'GET /pages', subject: '', at: 1 });
    assert.equal(exposuresOf(store)[0]?.credential, null);
  });

  it('lo mismo entregado dos veces en una llamada es una cosa entregada', () => {
    const store = freshStore();
    recordExposure(store, {
      participant: COTITO,
      surface: 'GET /search',
      subject: 'vera',
      delivered: ['page:1', 'page:1', 'page:1'],
      at: 1,
    });
    assert.deepEqual(exposuresOf(store)[0]?.delivered, ['page:1']);
  });
});
