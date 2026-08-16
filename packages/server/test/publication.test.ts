// Publicar por HTTP persiste el sitio y mantiene su proyección estática al día.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';

import { listen } from '../src/server.ts';

const PORT = 4284;
const PREVIEW_PORT = 4285;
const OWNER = 'participant:herbert';
const output = mkdtempSync(join(tmpdir(), 'vera-public-http-'));
const web = mkdtempSync(join(tmpdir(), 'vera-public-web-'));
let base: string;
let running: ReturnType<typeof listen>;
let sequence = 0;

before(() => {
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>La misma Vera</title><div id="vera-root"></div>');
  running = listen({
    port: PORT,
    databasePath: ':memory:',
    owner: { id: OWNER, name: 'Herbert' },
    webRoot: web,
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
  rmSync(web, { recursive: true, force: true });
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

async function throughCanonical(path: string, method = 'GET'): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const asked = request(
      { host: '127.0.0.1', port: PORT, path, method, headers: { host: 'publica.example' } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      },
    );
    asked.on('error', reject);
    asked.end();
  });
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
    const hidden = await write({
      kind: 'create_page',
      title: 'Secreta',
      visibility: 'private',
    });
    await write({
      kind: 'create_block',
      page: hidden.subjectId,
      parent: null,
      position: 0,
      content: 'arsenal privado',
    });
    await write({ kind: 'edit_block', block, content: 'Segunda versión y [[Secreta]]' });

    const previewBase = `http://localhost:${PREVIEW_PORT}`;
    const preview = await fetch(`${previewBase}/`);
    assert.equal(preview.status, 200);
    assert.match(await preview.text(), /La misma Vera/);

    const health = await fetch(`${previewBase}/health`).then((response) => response.json()) as {
      access: string;
      entryPoint: string;
      pages: number;
    };
    assert.equal(health.access, 'anybody');
    assert.equal(health.entryPoint, page);
    assert.equal(health.pages, 1);

    const visible = await fetch(`${previewBase}/pages`).then((response) => response.json()) as {
      id: string;
      title: string;
    }[];
    assert.deepEqual(visible.map((one) => one.id), [page]);
    assert.equal((await fetch(`${previewBase}/pages/${encodeURIComponent(hidden.subjectId)}`)).status, 404);
    assert.equal((await fetch(`${previewBase}/exposures`)).status, 404);
    assert.equal((await fetch(`${previewBase}/operations`, { method: 'POST' })).status, 405);

    const ownerPreview = await fetch(`${base}/health`, {
      headers: { cookie: 'vera-view=anybody' },
    }).then((response) => response.json()) as { access: string; canViewOwner: boolean; pages: number };
    assert.equal(ownerPreview.access, 'anybody');
    assert.equal(ownerPreview.canViewOwner, true);
    assert.equal(ownerPreview.pages, 1);
    assert.equal(
      (await fetch(`${base}/operations`, {
        method: 'POST',
        headers: { cookie: 'vera-view=anybody' },
      })).status,
      405,
    );

    const canonical = await throughCanonical('/health');
    const canonicalHealth = JSON.parse(canonical.body) as {
      access: string;
      canViewOwner: boolean;
      pages: number;
    };
    assert.equal(canonicalHealth.access, 'anybody');
    assert.equal(canonicalHealth.canViewOwner, false);
    assert.equal(canonicalHealth.pages, 1);
    assert.equal(
      (await throughCanonical('/operations', 'POST')).status,
      405,
    );

    const publicPage = await fetch(`${previewBase}/pages/${encodeURIComponent(page)}`).then(
      (response) => response.json(),
    ) as { pendingLinks: string[]; references: { title: string; page: string | null }[] };
    assert.deepEqual(publicPage.pendingLinks, ['Secreta']);
    assert.equal(publicPage.references.find((one) => one.title === 'Secreta')?.page, null);

    const search = await fetch(`${previewBase}/search?q=arsenal`).then((response) => response.json()) as unknown[];
    assert.deepEqual(search, []);

    const edited = await write({ kind: 'edit_block', block, content: 'Tercera versión' });
    assert.equal(edited.httpStatus, 201);
    assert.match(readFileSync(join(output, 'index.html'), 'utf8'), /Tercera versión/);
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
    assert.doesNotMatch(readFileSync(join(output, 'index.html'), 'utf8'), /Tercera versión/);

    const privateNow = await write({ kind: 'set_page_visibility', page, visibility: 'private' });
    assert.equal(privateNow.httpStatus, 201);
  });
});
