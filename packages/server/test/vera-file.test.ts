// La portabilidad se prueba atravesando HTTP: el archivo que descarga una Vera
// tiene que poder incorporarlo otra, incluidos los bytes de sus objetos.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listen } from '../src/server.ts';

const OWNER = 'participant:owner';
const PORT_A = 4291;
const PORT_B = 4292;
let root = '';
let source: ReturnType<typeof listen>;
let destination: ReturnType<typeof listen>;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'vera-file-'));
  source = listen({ port: PORT_A, databasePath: ':memory:', objectsRoot: join(root, 'a'), owner: { id: OWNER, name: 'Dueña' } });
  destination = listen({ port: PORT_B, databasePath: ':memory:', objectsRoot: join(root, 'b'), owner: { id: OWNER, name: 'Dueña' } });
});

after(async () => {
  await source.close();
  await destination.close();
  rmSync(root, { recursive: true, force: true });
});

async function write(base: string, originId: string, change: unknown): Promise<string> {
  const response = await fetch(`${base}/operations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ originId, participant: OWNER, channel: 'typed_text', change }),
  });
  const body = await response.json() as { subjectId?: string; reason?: string };
  assert.equal(response.status, 201, body.reason);
  return body.subjectId as string;
}

describe('archivo .vera', () => {
  it('descarga e incorpora páginas, bloques, propiedades, glosas y assets', async () => {
    const a = `http://localhost:${PORT_A}`;
    const b = `http://localhost:${PORT_B}`;
    const page = await write(a, 'portable:page', { kind: 'create_page', title: 'Archivo portátil', visibility: 'private' });
    const upload = await fetch(`${a}/media`, {
      method: 'POST',
      headers: { 'content-type': 'image/png', 'x-filename': 'mínimo.png' },
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
    });
    assert.equal(upload.status, 201);
    const asset = await upload.json() as { path: string };
    const block = await write(a, 'portable:block', {
      kind: 'create_block', page, parent: null, position: 0,
      content: `una imagen ![mínima](${asset.path})`,
    });
    await write(a, 'portable:property', { kind: 'set_property', page, propertyKey: 'tipo', propertyValue: 'prueba' });
    await write(a, 'portable:gloss', { kind: 'set_block_gloss', block, content: 'una glosa' });

    const downloaded = await fetch(`${a}/graph.vera`);
    assert.equal(downloaded.status, 200);
    assert.match(downloaded.headers.get('content-disposition') ?? '', /\.vera/);
    const bytes = await downloaded.arrayBuffer();

    const imported = await fetch(`${b}/import/vera`, { method: 'POST', body: bytes });
    const report = await imported.json() as { pages?: number; assets?: number; error?: string };
    assert.equal(imported.status, 201, report.error);
    assert.equal(report.pages, 1);
    assert.equal(report.assets, 1);

    const pages = await fetch(`${b}/pages`).then((response) => response.json()) as { id: string; title: string }[];
    const brought = pages.find((one) => one.title === 'Archivo portátil');
    assert.ok(brought);
    const view = await fetch(`${b}/pages/${encodeURIComponent(brought.id)}`).then((response) => response.json()) as {
      blocks: { content: string }[];
      properties: { key: string; value: string }[];
      glosses: Record<string, { content: string }>;
      assets: { url: string }[];
    };
    assert.equal(view.blocks[0]?.content, `una imagen ![mínima](${asset.path})`);
    assert.deepEqual(view.properties, [{ key: 'tipo', value: 'prueba' }]);
    assert.equal(Object.values(view.glosses)[0]?.content, 'una glosa');
    assert.equal(view.assets.length, 1);
    const object = await fetch(`${b}${view.assets[0]?.url}`);
    assert.deepEqual(Buffer.from(await object.arrayBuffer()), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  });

  it('rechaza un archivo que no es Vera sin cambiar el corpus', async () => {
    const b = `http://localhost:${PORT_B}`;
    const before = await fetch(`${b}/pages`).then((response) => response.json()) as unknown[];
    const response = await fetch(`${b}/import/vera`, { method: 'POST', body: 'cualquier cosa' });
    assert.equal(response.status, 422);
    const after = await fetch(`${b}/pages`).then((answer) => answer.json()) as unknown[];
    assert.equal(after.length, before.length);
  });
});
