// Pruebas del servidor contra HTTP real, no contra el manejador en aislamiento.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { listen } from '../src/server.ts';

let base: string;
let running: ReturnType<typeof listen>;

const PORT = 4271;
const OWNER = 'participant:herbert';

before(() => {
  running = listen({ port: PORT, databasePath: ':memory:' });
  base = `http://localhost:${PORT}`;
});

after(async () => {
  await running.close();
});

let counter = 0;
async function post(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${base}/operations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

async function write(change: unknown, origin?: string): Promise<string> {
  counter += 1;
  const { status, json } = await post({
    originId: origin ?? `http:${counter}`,
    participant: OWNER,
    channel: 'typed_text',
    change,
  });
  assert.equal(status, 201, `esperaba 201, fue ${status}: ${JSON.stringify(json)}`);
  return json['subjectId'] as string;
}

async function get(path: string): Promise<unknown> {
  const response = await fetch(`${base}${path}`);
  return response.json();
}

describe('POST /operations', () => {
  it('aplica una operación válida y devuelve su secuencia', async () => {
    const { status, json } = await post({
      originId: 'op-uno',
      participant: OWNER,
      change: { kind: 'create_page', title: 'Amereida', visibility: 'private' },
    });
    assert.equal(status, 201);
    assert.equal(json['status'], 'applied');
    assert.equal(typeof json['sequence'], 'number');
  });

  it('devuelve duplicate al reenviar el mismo origin_id, sin aplicar dos veces', async () => {
    const change = { kind: 'create_page', title: 'Idempotente', visibility: 'private' };
    const first = await post({ originId: 'op-fijo', participant: OWNER, change });
    const second = await post({ originId: 'op-fijo', participant: OWNER, change });

    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.json['status'], 'duplicate');
    assert.equal(second.json['sequence'], first.json['sequence']);

    const pages = (await get('/pages')) as { title: string }[];
    assert.equal(pages.filter((p) => p.title === 'Idempotente').length, 1);
  });

  it('rechaza con 422 lo que el dominio no acepta', async () => {
    const { status, json } = await post({
      originId: 'op-sin-pagina',
      participant: OWNER,
      change: { kind: 'edit_block', block: 'no-existe', content: 'x' },
    });
    assert.equal(status, 422);
    assert.equal(json['status'], 'rejected');
  });

  it('rechaza con 400 un cuerpo malformado', async () => {
    assert.equal((await post({ participant: OWNER })).status, 400);
    assert.equal((await post({ originId: 'x', participant: OWNER })).status, 400);
    assert.equal(
      (await post({ originId: 'x', participant: OWNER, change: { kind: 'link_pages' } })).status,
      400,
      'link_pages ya no es parte del vocabulario',
    );
  });

  it('rechaza voz autenticada sin evidencia', async () => {
    const { status } = await post({
      originId: 'op-voz',
      participant: OWNER,
      channel: 'authenticated_voice',
      change: { kind: 'create_page', title: 'Dicha', visibility: 'private' },
    });
    assert.equal(status, 422);
  });

  it('acepta voz autenticada con evidencia', async () => {
    const { status } = await post({
      originId: 'op-voz-ok',
      participant: OWNER,
      channel: 'authenticated_voice',
      evidence: { reference: 'audio:sha256-abc', capturedAt: 1_754_000_000_000 },
      change: { kind: 'create_page', title: 'Dicha con prueba', visibility: 'private' },
    });
    assert.equal(status, 201);
  });

  it('rechaza a un participante sin membresía', async () => {
    const { status } = await post({
      originId: 'op-ajeno',
      participant: 'participant:desconocido',
      change: { kind: 'create_page', title: 'Ajena', visibility: 'private' },
    });
    assert.equal(status, 422);
  });
});

describe('lecturas', () => {
  it('entrega una página con sus bloques, propiedades y backlinks', async () => {
    const page = await write({ kind: 'create_page', title: 'Travesia', visibility: 'private' });
    await write({ kind: 'create_block', page, parent: null, position: 0, content: 'al desierto' });
    await write({ kind: 'set_property', page, propertyKey: 'lang', propertyValue: 'es' });

    const origin = await write({ kind: 'create_page', title: 'Origen', visibility: 'private' });
    await write({
      kind: 'create_block',
      page: origin,
      parent: null,
      position: 0,
      content: 'ver [[Travesia]]',
    });

    const detail = (await get(`/pages/${encodeURIComponent(page)}`)) as {
      title: string;
      blocks: { content: string }[];
      properties: { key: string; value: string }[];
      backlinks: { page: string; block: string }[];
    };

    assert.equal(detail.title, 'Travesia');
    assert.equal(detail.blocks.length, 1);
    assert.deepEqual(detail.properties, [{ key: 'lang', value: 'es' }]);
    assert.equal(detail.backlinks.length, 1);
    assert.equal(detail.backlinks[0]?.page, origin);
  });

  it('responde 404 para una página que no existe', async () => {
    const response = await fetch(`${base}/pages/no-existe`);
    assert.equal(response.status, 404);
  });

  it('busca sobre el grafo', async () => {
    await write({ kind: 'create_page', title: 'Buscable', visibility: 'private' });
    const hits = (await get('/search?q=Buscable')) as { page: string; field: string }[];
    assert.ok(hits.length >= 1);
    assert.equal(hits[0]?.field, 'page_title');
  });

  it('entrega el grafo en la forma que consume constel', async () => {
    const a = await write({ kind: 'create_page', title: 'NodoA', visibility: 'private' });
    await write({ kind: 'create_page', title: 'NodoB', visibility: 'private' });
    await write({
      kind: 'create_block',
      page: a,
      parent: null,
      position: 0,
      content: 'ver [[NodoB]]',
    });

    const data = (await get(`/graph/${encodeURIComponent(a)}?depth=1`)) as {
      nodes: { id: string; name: string; central: boolean; degree: number; blockCount: number }[];
      links: { source: string; target: string }[];
    };

    const centre = data.nodes.find((n) => n.central);
    assert.equal(centre?.id, a);
    assert.equal(centre?.name, 'NodoA');
    assert.ok(data.nodes.some((n) => n.name === 'NodoB'));
    assert.equal(data.links.length, 1);
    for (const node of data.nodes) {
      assert.equal(typeof node.degree, 'number');
      assert.equal(typeof node.blockCount, 'number');
    }
  });

  it('entrega el log desde una secuencia', async () => {
    const all = (await get('/ops?since=0')) as { sequence: number }[];
    assert.ok(all.length > 0);
    const tail = (await get(`/ops?since=${all.length - 1}`)) as { sequence: number }[];
    assert.ok(tail.length < all.length);
    assert.ok(tail.every((op) => op.sequence > all.length - 1));
  });

  it('no reporta ninguna violación de invariante', async () => {
    assert.deepEqual(await get('/invariants'), []);
  });

  it('rechaza cualquier método que no sea GET o POST', async () => {
    const response = await fetch(`${base}/pages`, { method: 'DELETE' });
    assert.equal(response.status, 405);
  });
});

describe('persistencia entre arranques', () => {
  it('reconstruye el grafo del log al volver a abrir la base', async () => {
    const path = `${process.env['TMPDIR'] ?? '/tmp'}/vera-restart-${Date.now()}.sqlite`;
    const first = listen({ port: PORT + 1, databasePath: path });
    const response = await fetch(`http://localhost:${PORT + 1}/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        originId: 'persistente',
        participant: OWNER,
        change: { kind: 'create_page', title: 'Sobrevive', visibility: 'private' },
      }),
    });
    assert.equal(response.status, 201);
    await first.close();

    const second = listen({ port: PORT + 2, databasePath: path });
    const pages = (await (await fetch(`http://localhost:${PORT + 2}/pages`)).json()) as {
      title: string;
    }[];
    assert.ok(
      pages.some((p) => p.title === 'Sobrevive'),
      'lo escrito antes del cierre sigue ahí',
    );
    await second.close();
  });
});
