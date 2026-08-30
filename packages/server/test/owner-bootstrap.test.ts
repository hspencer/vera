// specs/shared-space-access.allium:
//   rule OwnerAuthorizesOwnAuthenticatorFromMachine
//   rule FreshInstanceBeginsOwnerAuthenticationBootstrap
//   rule FirstOwnerPasskeyCompletesBootstrap
//
// Antes de esto, `AuthenticatedOwner` no tenía ninguna vía de alta propia: el
// único camino de ceremonia WebAuthn completa era `redeemInvitation`, pensado
// para invitados. Estas pruebas verifican que el dueño puede matricular su
// propia passkey por una puerta que nace de la máquina, sin pasar por ahí.

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { openStore, saveParticipant, type Store } from '@vera/store';

import { listen } from '../src/server.ts';
import { beginOwnerBootstrap, completeOwnerBootstrapIfDue, ownerBootstrapStatus } from '../src/owner-bootstrap.ts';

const OWNER = 'participant:herbert';

function freshStore(): Store {
  const store = openStore({ path: ':memory:', graphName: 'mind' });
  saveParticipant(store, { id: OWNER, name: 'Herbert', kind: 'human' });
  return store;
}

describe('el dueño se autoriza su propia passkey desde la máquina', () => {
  it('no hay bootstrap antes de que alguien lo inicie', () => {
    const store = freshStore();
    assert.equal(ownerBootstrapStatus(store), null);
    store.close();
  });

  it('beginOwnerBootstrap crea el registro de bootstrap y una matrícula pendiente', () => {
    const store = freshStore();
    const { enrollment, enrollmentSecret, expiresAt } = beginOwnerBootstrap(store, OWNER);

    assert.match(enrollment, /^enrollment:/);
    assert.match(enrollmentSecret, /^vera_enroll_/);
    assert.ok(expiresAt > Date.now());
    assert.equal(ownerBootstrapStatus(store), 'awaiting_first_passkey');

    const row = store.db.prepare(
      `SELECT participant_id, authorized_by, status FROM authenticator_enrollments WHERE id = ?`,
    ).get(enrollment) as { participant_id: string; authorized_by: string; status: string };
    assert.equal(row.participant_id, OWNER);
    assert.equal(row.authorized_by, OWNER, 'el dueño se autoriza a sí mismo, no una invitación de otro');
    assert.equal(row.status, 'pending');
    store.close();
  });

  it('llamarla otra vez no duplica el bootstrap, pero sí matricula de nuevo: es la recuperación', () => {
    const store = freshStore();
    const first = beginOwnerBootstrap(store, OWNER);
    const second = beginOwnerBootstrap(store, OWNER);

    assert.notEqual(first.enrollment, second.enrollment, 'cada llamada es una matrícula independiente');
    const bootstraps = store.db.prepare(
      `SELECT count(*) n FROM human_access_bootstrap WHERE graph_id = ?`,
    ).get(store.graphId) as { n: number };
    assert.equal(bootstraps.n, 1, 'una sola fila de bootstrap por grafo, sin importar cuántas matrículas se pidan');
    store.close();
  });

  it('completeOwnerBootstrapIfDue sólo transiciona cuando el participante es el dueño', () => {
    const store = freshStore();
    beginOwnerBootstrap(store, OWNER);
    assert.equal(ownerBootstrapStatus(store), 'awaiting_first_passkey');

    completeOwnerBootstrapIfDue(store, OWNER, 'participant:otra-persona');
    assert.equal(ownerBootstrapStatus(store), 'awaiting_first_passkey', 'otra identidad no completa el bootstrap del dueño');

    completeOwnerBootstrapIfDue(store, OWNER, OWNER);
    assert.equal(ownerBootstrapStatus(store), 'ready');
    store.close();
  });

  it('completar el bootstrap es idempotente: no falla si ya estaba listo', () => {
    const store = freshStore();
    beginOwnerBootstrap(store, OWNER);
    completeOwnerBootstrapIfDue(store, OWNER, OWNER);
    completeOwnerBootstrapIfDue(store, OWNER, OWNER);
    assert.equal(ownerBootstrapStatus(store), 'ready');
    store.close();
  });

  it('no hace falta haber empezado el bootstrap para que completarlo sea inocuo', () => {
    const store = freshStore();
    completeOwnerBootstrapIfDue(store, OWNER, OWNER);
    assert.equal(ownerBootstrapStatus(store), null);
    store.close();
  });
});

describe('npm run owner:enroll-passkey', () => {
  it('desde la máquina, imprime una ruta de matrícula usable y dice cuándo vence', () => {
    const database = join(mkdtempSync(join(tmpdir(), 'vera-owner-enroll-')), 'vera.sqlite');
    const store = openStore({ path: database, graphName: 'mind' });
    saveParticipant(store, { id: OWNER, name: 'Herbert', kind: 'human' });
    store.close();

    const printed = execFileSync(
      process.execPath,
      ['packages/server/src/enroll-owner-passkey.ts', database],
      { cwd: process.cwd(), encoding: 'utf8' },
    ).trim().split('\n');

    const [path] = printed;
    assert.match(path ?? '', /^\/enroll-owner\/enrollment%3A[0-9a-f]+\?secret=vera_enroll_/);
    assert.match(printed[1] ?? '', /^vence: /);

    const reopened = openStore({ path: database, graphName: 'mind' });
    assert.equal(ownerBootstrapStatus(reopened), 'awaiting_first_passkey');
    reopened.close();
  });
});

describe('la matrícula del dueño se usa por la misma puerta HTTP que un invitado, sin invitación', () => {
  const PORT = 4310;
  let running: ReturnType<typeof listen>;
  before(() => { running = listen({ port: PORT, databasePath: ':memory:', owner: { id: OWNER, name: 'Herbert' } }); });
  after(async () => running.close());

  it('/human-auth/registration/options acepta una matrícula creada desde la máquina', async () => {
    // Nada de /invitations/…/redeem: la matrícula sale directo de la base,
    // como la crearía `npm run owner:enroll-passkey` en una instancia real.
    const { enrollment, enrollmentSecret } = beginOwnerBootstrap(running.vera.store, OWNER);

    const response = await fetch(`http://localhost:${PORT}/human-auth/registration/options`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enrollment, secret: enrollmentSecret }),
    });
    const body = await response.json() as Record<string, any>;
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body['rp']['id'], 'localhost');
    assert.equal(body['authenticatorSelection']['userVerification'], 'required');
  });

  it('un secreto inventado no sirve para nada, igual que con una invitación', async () => {
    const { enrollment } = beginOwnerBootstrap(running.vera.store, OWNER);
    const response = await fetch(`http://localhost:${PORT}/human-auth/registration/options`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enrollment, secret: 'vera_enroll_inventado' }),
    });
    assert.equal(response.status, 409);
  });
});
