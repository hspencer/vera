import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listen } from '../src/server.ts';

const PORT = 4288;
const OWNER = 'participant:herbert';
let base: string;
let running: ReturnType<typeof listen>;
let sequence = 0;

before(() => {
  running = listen({ port: PORT, databasePath: ':memory:', owner: { id: OWNER, name: 'Herbert' } });
  base = `http://localhost:${PORT}`;
});
after(async () => running.close());

async function call(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, json: await response.json() as Record<string, any> };
}

async function write(change: unknown): Promise<string> {
  sequence += 1;
  const reply = await call('/operations', 'POST', { originId: `shared:${sequence}`, change });
  assert.equal(reply.status, 201, JSON.stringify(reply.json));
  return reply.json['subjectId'] as string;
}

describe('primer corte vertical de espacios compartidos', () => {
  it('delimita exactamente las páginas que llevan la propiedad', async () => {
    const inside = await write({ kind: 'create_page', title: 'Dentro', visibility: 'private' });
    await write({ kind: 'set_property', page: inside, propertyKey: 'espacio', propertyValue: 'doctorado' });
    await write({ kind: 'create_page', title: 'Fuera', visibility: 'private' });
    const made = await call('/shared-spaces', 'POST', {
      name: 'Doctorado', slug: 'doctorado', selectorKey: 'espacio', selectorValue: 'doctorado',
    });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const pages = await call('/shared-spaces/doctorado/pages');
    assert.deepEqual((pages.json['pages'] as any[]).map((page) => page.title), ['Dentro']);
  });

  it('muestra el secreto de invitación una vez, lo canjea y no permite repetirlo', async () => {
    const issued = await call('/shared-spaces/doctorado/invitations', 'POST', { permissions: ['read'] });
    assert.equal(issued.status, 201, JSON.stringify(issued.json));
    assert.match(issued.json['secret'], /^vera_inv_/);
    const invitation = issued.json['id'] as string;
    const proof = issued.json['secret'] as string;

    const preview = await call(`/invitations/${encodeURIComponent(invitation)}?secret=${encodeURIComponent(proof)}`);
    assert.equal(preview.json['space'], 'Doctorado');
    assert.deepEqual(preview.json['permissions'], ['read']);

    const redeemed = await call(`/invitations/${encodeURIComponent(invitation)}/redeem`, 'POST', {
      secret: proof, name: 'Invitada',
    });
    assert.equal(redeemed.status, 201, JSON.stringify(redeemed.json));
    assert.match(redeemed.json['enrollmentSecret'], /^vera_enroll_/);
    assert.equal((await call(`/invitations/${encodeURIComponent(invitation)}/redeem`, 'POST', {
      secret: proof, name: 'Otra',
    })).status, 409);
  });

  it('un secreto incorrecto no revela siquiera el nombre del espacio', async () => {
    const issued = await call('/shared-spaces/doctorado/invitations', 'POST', { permissions: ['read'] });
    const invitation = issued.json['id'] as string;
    assert.equal((await call(`/invitations/${encodeURIComponent(invitation)}?secret=falso`)).status, 404);
  });
});
