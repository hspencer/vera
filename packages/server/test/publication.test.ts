// Publicar por HTTP persiste el sitio y mantiene su proyección estática al día.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import { listen } from '../src/server.ts';

const PORT = 4284;
const PREVIEW_PORT = 4285;
const OWNER = 'participant:herbert';
const output = mkdtempSync(join(tmpdir(), 'vera-public-http-'));
let base: string;
let running: ReturnType<typeof listen>;
let sequence = 0;

before(() => {
  running = listen({
    port: PORT,
    databasePath: ':memory:',
    owner: { id: OWNER, name: 'Herbert' },
    publicSite: { title: 'Vera', canonicalDomain: 'https://vera.mediafranca.net' },
    reachableAt: 'https://vera.tuatara-carat.ts.net',
    publicOutput: output,
    publicPreviewPort: PREVIEW_PORT,
  });
  base = `http://localhost:${PORT}`;
});

after(async () => {
  await running.close();
  rmSync(output, { recursive: true, force: true });
});

async function write(change: unknown): Promise<{
  httpStatus: number;
  subjectId: string;
  reason?: string;
}> {
  sequence += 1;
  const response = await fetch(`${base}/operations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      originId: `publication-http:${sequence}`,
      participant: OWNER,
      channel: 'typed_text',
      change,
    }),
  });
  const result = await response.json() as Record<string, unknown>;
  return { ...result, httpStatus: response.status } as {
    httpStatus: number;
    subjectId: string;
    reason?: string;
  };
}

describe('publicación del sitio personal', () => {
  it('publica, reconstruye al editar y retira sin borrar la página', async () => {
    const configuredResponse = await fetch(`${base}/publication-site`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Vera publicada',
        canonicalDomain: 'https://publica.example',
        entryPoint: null,
      }),
    });
    assert.equal(configuredResponse.status, 200);
    const configured = await configuredResponse.json() as {
      title: string;
      canonicalDomain: string;
      previewUrl: string;
      publications: unknown[];
    };
    assert.equal(configured.title, 'Vera publicada');
    assert.equal(configured.canonicalDomain, 'https://publica.example');
    assert.equal(
      configured.previewUrl,
      `https://${hostname().split('.')[0]?.toLowerCase()}.tuatara-carat.ts.net:${PREVIEW_PORT}/`,
    );
    assert.deepEqual(configured.publications, []);

    const created = await write({
      kind: 'create_page',
      title: 'Vera',
      visibility: 'public',
    });
    assert.equal(created.httpStatus, 201);
    const page = created.subjectId;
    const block = (
      await write({
        kind: 'create_block',
        page,
        parent: null,
        position: 0,
        content: 'Primera versión',
      })
    ).subjectId;

    const eligible = await fetch(`${base}/pages/${encodeURIComponent(page)}`).then((response) =>
      response.json(),
    ) as { publication: { publishedAt: number | null; path: string } };
    assert.equal(eligible.publication.publishedAt, null);
    assert.equal(eligible.publication.path, 'vera');

    const publishedResponse = await fetch(`${base}/publications/${encodeURIComponent(page)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'vera', entryPoint: true }),
    });
    assert.equal(publishedResponse.status, 201);
    const published = await publishedResponse.json() as {
      path: string;
      entryPoint: boolean;
      publishedAt: number;
    };
    assert.equal(published.path, 'vera');
    assert.equal(published.entryPoint, true);
    assert.equal(typeof published.publishedAt, 'number');
    const governed = await fetch(`${base}/publication-site`).then((response) => response.json()) as {
      entryPoint: string;
      publications: { page: string; url: string; firstRevision: string }[];
    };
    assert.equal(governed.entryPoint, page);
    assert.equal(governed.publications[0]?.page, page);
    assert.equal(governed.publications[0]?.url, 'https://publica.example/vera/');
    assert.equal(typeof governed.publications[0]?.firstRevision, 'string');
    assert.match(readFileSync(join(output, 'index.html'), 'utf8'), /Primera versión/);
    const preview = await fetch(`http://localhost:${PREVIEW_PORT}/`);
    assert.equal(preview.status, 200);
    assert.match(await preview.text(), /Primera versión/);
    assert.equal(
      (await fetch(`http://localhost:${PREVIEW_PORT}/pages`)).status,
      404,
      'the preview has no Vera API',
    );

    const edited = await write({ kind: 'edit_block', block, content: 'Segunda versión' });
    assert.equal(edited.httpStatus, 201);
    assert.match(readFileSync(join(output, 'index.html'), 'utf8'), /Segunda versión/);
    assert.doesNotMatch(readFileSync(join(output, 'index.html'), 'utf8'), /Primera versión/);

    const refused = await write({ kind: 'set_page_visibility', page, visibility: 'private' });
    assert.equal(refused.httpStatus, 422);
    assert.match(refused.reason ?? '', /withdrawn/i);

    const withdrawnResponse = await fetch(`${base}/publications/${encodeURIComponent(page)}`, {
      method: 'DELETE',
    });
    assert.equal(withdrawnResponse.status, 200);
    const withdrawn = await withdrawnResponse.json() as {
      publishedAt: number | null;
      entryPoint: boolean;
    };
    assert.equal(withdrawn.publishedAt, null);
    assert.equal(withdrawn.entryPoint, false);
    assert.doesNotMatch(readFileSync(join(output, 'index.html'), 'utf8'), /Segunda versión/);

    const privateNow = await write({ kind: 'set_page_visibility', page, visibility: 'private' });
    assert.equal(privateNow.httpStatus, 201);
  });
});
