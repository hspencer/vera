import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listen } from '../src/server.ts';
import { digestOf } from '../src/credentials.ts';

const PORT = 4288;
const OWNER = 'participant:herbert';
let base: string;
let publicBase: string;
let running: ReturnType<typeof listen>;
let sequence = 0;

before(() => {
  running = listen({ port: PORT, publicPreviewPort: PORT + 1,
    databasePath: ':memory:', owner: { id: OWNER, name: 'Herbert' } });
  base = `http://localhost:${PORT}`;
  publicBase = `http://localhost:${PORT + 1}`;
});
after(async () => running.close());

async function call(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', ...headers },
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
    const passkey = await call('/human-auth/registration/options', 'POST', {
      enrollment: redeemed.json['enrollment'], secret: redeemed.json['enrollmentSecret'],
    });
    assert.equal(passkey.status, 200, JSON.stringify(passkey.json));
    assert.equal(passkey.json['rp']['id'], 'localhost');
    assert.equal(passkey.json['authenticatorSelection']['userVerification'], 'required');
    assert.equal((await call(`/invitations/${encodeURIComponent(invitation)}/redeem`, 'POST', {
      secret: proof, name: 'Otra',
    })).status, 409);
  });

  it('un secreto incorrecto no revela siquiera el nombre del espacio', async () => {
    const issued = await call('/shared-spaces/doctorado/invitations', 'POST', { permissions: ['read'] });
    const invitation = issued.json['id'] as string;
    assert.equal((await call(`/invitations/${encodeURIComponent(invitation)}?secret=falso`)).status, 404);
  });

  it('permite elegir la vigencia y usa siete días por omisión', async () => {
    const before = Date.now();
    const standard = await call('/shared-spaces/doctorado/invitations', 'POST', { permissions: ['read'] });
    assert.ok(standard.json['expiresAt'] >= before + 7 * 24 * 60 * 60 * 1000);

    const short = await call('/shared-spaces/doctorado/invitations', 'POST', {
      permissions: ['read'], lifetimeMs: 60 * 60 * 1000,
    });
    assert.ok(short.json['expiresAt'] >= before + 60 * 60 * 1000);
    assert.ok(short.json['expiresAt'] < before + 2 * 60 * 60 * 1000);

    const arbitrary = await call('/shared-spaces/doctorado/invitations', 'POST', {
      permissions: ['read'], lifetimeMs: 365 * 24 * 60 * 60 * 1000,
    });
    assert.equal(arbitrary.status, 400);
  });

  it('no entrega el subgrafo restringido sin una sesión humana', async () => {
    assert.equal((await call('/s/doctorado/api/pages')).status, 401);
    assert.equal((await call('/s/doctorado/api/pages/no-existe')).status, 401);
  });

  it('permite cambiar la audiencia de un espacio existente y volver a restringirla', async () => {
    const open = await call('/shared-spaces/doctorado', 'PATCH', {
      name: 'Doctorado', slug: 'doctorado', selectorKey: 'espacio', selectorValue: 'doctorado',
      audience: 'anybody',
    });
    assert.equal(open.status, 200);
    assert.equal(open.json['audience'], 'anybody');
    const closed = await call('/shared-spaces/doctorado', 'PATCH', {
      name: 'Doctorado', slug: 'doctorado', selectorKey: 'espacio', selectorValue: 'doctorado',
      audience: 'restricted',
    });
    assert.equal(closed.status, 200);
    assert.equal(closed.json['audience'], 'restricted');
  });

  it('entrega anónimamente sólo las páginas del selector cuando la audiencia es pública', async () => {
    const poem = await write({ kind: 'create_page', title: 'Poema', visibility: 'private' });
    await write({ kind: 'set_property', page: poem, propertyKey: 'concepto', propertyValue: 'Axis Mundae' });
    const near = await write({ kind: 'create_page', title: 'Documento cercano', visibility: 'private' });
    await write({ kind: 'set_property', page: near, propertyKey: 'concepto', propertyValue: 'Axis Mundi' });
    const made = await call('/shared-spaces', 'POST', {
      name: 'Axis Mundae', slug: 'axis-mundae', selectorKey: 'concepto',
      selectorValue: 'Axis Mundae', audience: 'anybody',
    });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.equal(made.json['audience'], 'anybody');
    const pages = await call('/s/axis-mundae/api/pages');
    assert.equal(pages.status, 200);
    assert.deepEqual((pages.json['pages'] as any[]).map((page) => page.title), ['Poema']);
    assert.equal((await call(`/s/axis-mundae/api/pages/${encodeURIComponent(near)}`)).status, 404);
    const publicPages = await fetch(`${publicBase}/s/axis-mundae/api/pages`);
    assert.equal(publicPages.status, 200);
    assert.equal(((await publicPages.json() as any).pages as any[]).length, 1);
    assert.equal((await fetch(`${publicBase}/s/doctorado/api/pages`)).status, 404);
  });

  it('el ámbito de un espacio no contamina las demás URL del dominio público', async () => {
    const fromSpace = await fetch(`${publicBase}/pages`, {
      headers: { referer: `${publicBase}/s/axis-mundae/p/Poema` },
    });
    assert.equal(fromSpace.status, 200);
    assert.deepEqual((await fromSpace.json() as any[]).map((page) => page.title), ['Poema']);

    const outsideSpace = await fetch(`${publicBase}/pages`, {
      // Simula un navegador que todavía conserva la cookie emitida por una
      // versión anterior. Sin una ruta/referente de espacio debe ser ignorada.
      headers: { cookie: 'vera_public_space=axis-mundae' },
    });
    assert.equal(outsideSpace.status, 200);
    assert.deepEqual(await outsideSpace.json(), []);

    const shell = await fetch(`${publicBase}/s/axis-mundae/`);
    assert.match(shell.headers.get('set-cookie') ?? '', /vera_public_space=;.*Max-Age=0/);
  });

  it('el mapa público muestra el espacio completo y conserva sus componentes aisladas', async () => {
    const second = await write({ kind: 'create_page', title: 'Segundo poema', visibility: 'private' });
    await write({ kind: 'set_property', page: second, propertyKey: 'concepto', propertyValue: 'Axis Mundae' });
    const cover = await write({ kind: 'create_page', title: 'Portada aislada', visibility: 'private' });
    await write({ kind: 'set_property', page: cover, propertyKey: 'concepto', propertyValue: 'Axis Mundae' });
    const first = running.vera.graph.pageTitled('Poema')!;
    await write({ kind: 'create_block', page: first.id, parent: null, position: 0, content: '[[Segundo poema]]' });

    const response = await fetch(`${publicBase}/graph/${encodeURIComponent(cover)}?depth=0`, {
      headers: { referer: `${publicBase}/s/axis-mundae/p/Portada%20aislada` },
    });
    assert.equal(response.status, 200);
    const graph = await response.json() as any;
    assert.deepEqual(new Set(graph.nodes.map((node: any) => node.name)),
      new Set(['Poema', 'Segundo poema', 'Portada aislada']));
    assert.deepEqual(graph.links.map((link: any) => [link.source, link.target].sort()),
      [[first.id, second].sort()]);
  });

  it('con sesión entrega lo interior y trata lo exterior como inexistente', async () => {
    const outside = await write({ kind: 'create_page', title: 'Secreto exterior', visibility: 'private' });
    const issued = await call('/shared-spaces/doctorado/invitations', 'POST', { permissions: ['read'] });
    const redeemed = await call(`/invitations/${encodeURIComponent(issued.json['id'])}/redeem`, 'POST', {
      secret: issued.json['secret'], name: 'Lectora',
    });
    const session = 'vera_session_prueba';
    const now = Date.now();
    running.vera.store.db.prepare(`INSERT INTO human_sessions
      (id,participant_id,proof_digest,status,began_at,expires_at,last_seen_at)
      VALUES (?,?,?,'active',?,?,?)`).run('session:test', redeemed.json['participant'],
        digestOf(session), now, now + 60_000, now);
    const headers = { cookie: `vera_session=${session}` };
    const pages = await call('/s/doctorado/api/pages', 'GET', undefined, headers);
    assert.equal(pages.status, 200);
    assert.deepEqual((pages.json['pages'] as any[]).map((page) => page.title), ['Dentro']);
    assert.equal((await call(`/s/doctorado/api/pages/${encodeURIComponent(outside)}`, 'GET', undefined, headers)).status, 404);
  });

  it('administra criterio, invitaciones, participantes y revocaciones', async () => {
    const pending = await call('/shared-spaces/doctorado/invitations', 'POST', { permissions: ['read'], intendedContact: 'Ada' });
    let admin = await call('/shared-spaces');
    assert.equal(admin.status, 200);
    const space = (admin.json['spaces'] as any[]).find((one) => one.slug === 'doctorado');
    assert.equal(space.pageCount, 1);
    assert.ok(space.invitations.some((one: any) => one.intendedContact === 'Ada' && one.status === 'pending'));
    assert.ok(space.participants.some((one: any) => one.name === 'Lectora' && one.status === 'active'));

    assert.equal((await call(`/shared-spaces/doctorado/invitations/${encodeURIComponent(pending.json['id'])}`, 'DELETE')).status, 200);
    const reader = space.participants.find((one: any) => one.name === 'Lectora');
    assert.equal((await call(`/shared-spaces/doctorado/participants/${encodeURIComponent(reader.participant)}/sessions`, 'DELETE')).status, 200);
    assert.equal((await call(`/shared-spaces/doctorado/grants/${encodeURIComponent(reader.grant)}`, 'DELETE')).status, 200);

    const changed = await call('/shared-spaces/doctorado', 'PATCH', {
      name: 'Vera', slug: 'vera', selectorKey: 'concepto', selectorValue: 'Vera',
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.json));
    admin = await call('/shared-spaces');
    assert.equal((admin.json['spaces'] as any[])[0].slug, 'vera');
    assert.equal((admin.json['spaces'] as any[])[0].pageCount, 0);
  });
});
