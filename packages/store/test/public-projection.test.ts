import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { VeraGraph } from '@vera/core';
import type { Change } from '@vera/core';
import { projectPublicSite, publicPathFor } from '../src/public-projection.ts';

const OWNER = 'participant:herbert';
const temporary: string[] = [];
const scratch = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'vera-public-'));
  temporary.push(directory);
  return directory;
};

after(() => {
  for (const directory of temporary) rmSync(directory, { recursive: true, force: true });
});

function graph(): VeraGraph {
  const graph = VeraGraph.create({ name: 'mind' });
  graph.addParticipant({ id: OWNER, name: 'Herbert', kind: 'human' });
  graph.admit(OWNER);
  let sequence = 0;
  const write = (change: Change): string => {
    const outcome = graph.submitOperation({ originId: `public:${++sequence}`, participant: OWNER, change });
    if (outcome.status !== 'applied') throw new Error(JSON.stringify(outcome));
    return outcome.subjectId;
  };
  const visible = write({ kind: 'create_page', title: 'Página pública', visibility: 'public' });
  write({ kind: 'create_block', page: visible, parent: null, position: 0, content: 'Texto <visible>' });
  const privatePage = write({ kind: 'create_page', title: 'Secreto irrepetible', visibility: 'private' });
  write({ kind: 'create_block', page: privatePage, parent: null, position: 0, content: 'No debe salir' });
  write({ kind: 'create_block', page: visible, parent: null, position: 1, content: 'Ver [[Secreto irrepetible]]' });
  return graph;
}

function publicPage(corpus: VeraGraph): string {
  const page = corpus.pages().find((candidate) => candidate.title === 'Página pública');
  assert.ok(page);
  return page.id;
}

describe('proyección pública', () => {
  it('genera sólo páginas públicas y escapa su HTML', () => {
    const target = scratch();
    const corpus = graph();
    const summary = projectPublicSite(corpus, target, {
      canonicalDomain: 'https://vera.mediafranca.net',
      siteTitle: 'Vera',
      publishedPages: new Set([publicPage(corpus)]),
    });
    assert.equal(summary.pages, 1);
    assert.deepEqual(readdirSync(target).sort(), ['index.html', 'pagina-publica']);
    const page = readFileSync(join(target, 'pagina-publica', 'index.html'), 'utf8');
    assert.match(page, /<p>Texto &lt;visible&gt;<\/p>/);
    assert.match(page, /https:\/\/vera\.mediafranca\.net\/pagina-publica\//);
  });

  it('no filtra título, contenido ni manifiesto de páginas privadas', () => {
    const target = scratch();
    const corpus = graph();
    projectPublicSite(corpus, target, {
      canonicalDomain: 'https://vera.mediafranca.net',
      siteTitle: 'Vera',
      publishedPages: new Set([publicPage(corpus)]),
    });
    const all = [
      readFileSync(join(target, 'index.html'), 'utf8'),
      readFileSync(join(target, 'pagina-publica', 'index.html'), 'utf8'),
    ].join('\n');
    assert.doesNotMatch(all, /data-page="Secreto irrepetible"|No debe salir|block:|page:/);
    assert.match(all, /<span class="wiki unavailable">Secreto irrepetible<\/span>/);
    assert.ok(!readdirSync(target).includes('manifest.json'));
  });

  it('produce rutas estables sin diacríticos', () => {
    assert.equal(publicPathFor('Vera — Instanciación'), 'vera-instanciacion');
  });

  it('proyecta la marca como favicon, icono instalable y vista social', () => {
    const target = scratch();
    const branding = scratch();
    for (const filename of [
      'apple-touch-icon.png',
      'favicon.ico',
      'icon-16.png',
      'icon-32.png',
      'icon-192.png',
      'icon-512.png',
      'icon-maskable-512.png',
    ]) {
      writeFileSync(join(branding, filename), filename);
    }
    const corpus = graph();
    projectPublicSite(corpus, target, {
      canonicalDomain: 'https://vera.mediafranca.net',
      siteTitle: 'Vera',
      publishedPages: new Set([publicPage(corpus)]),
      brandingAssets: branding,
    });

    const index = readFileSync(join(target, 'index.html'), 'utf8');
    assert.match(index, /rel="manifest" href="\/site\.webmanifest"/);
    assert.match(index, /rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
    assert.match(index, /property="og:image" content="https:\/\/vera\.mediafranca\.net\/icon-512\.png"/);
    assert.equal(readFileSync(join(target, 'icon-512.png'), 'utf8'), 'icon-512.png');
    const manifest = JSON.parse(readFileSync(join(target, 'site.webmanifest'), 'utf8')) as {
      name: string;
      icons: Array<{ purpose: string }>;
    };
    assert.equal(manifest.name, 'Vera');
    assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  });

  it('proyecta una página publicada como entry point del sitio', () => {
    const corpus = graph();
    const page = publicPage(corpus);
    const target = scratch();
    projectPublicSite(corpus, target, {
      canonicalDomain: 'https://vera.mediafranca.net',
      siteTitle: 'Vera',
      publishedPages: new Set([page]),
      entryPoint: page,
    });
    const index = readFileSync(join(target, 'index.html'), 'utf8');
    assert.match(index, /<h1>Página pública<\/h1>/);
    assert.match(index, /<p>Texto &lt;visible&gt;<\/p>/);
    assert.match(index, /rel="canonical" href="https:\/\/vera\.mediafranca\.net\/"/);
  });

  it('rechaza un entry point privado o no asignado al sitio', () => {
    const corpus = graph();
    assert.throws(
      () =>
        projectPublicSite(corpus, scratch(), {
          canonicalDomain: 'https://vera.mediafranca.net',
          siteTitle: 'Vera',
          publishedPages: new Set(),
          entryPoint: publicPage(corpus),
        }),
      /entry point must be an explicitly published public page/,
    );
  });

  it('omite una página pública no asignada a este sitio', () => {
    const corpus = graph();
    const target = scratch();
    const summary = projectPublicSite(corpus, target, {
      canonicalDomain: 'https://vera.mediafranca.net',
      siteTitle: 'Vera',
      publishedPages: new Set(),
    });
    assert.equal(summary.pages, 0);
    assert.deepEqual(readdirSync(target), ['index.html']);
    assert.doesNotMatch(readFileSync(join(target, 'index.html'), 'utf8'), /Página pública/);
  });

  it('rechaza dos títulos que producirían la misma dirección', () => {
    const corpus = graph();
    const first = corpus.submitOperation({
      originId: 'public:collision:first',
      participant: OWNER,
      change: { kind: 'create_page', title: 'Alpha & beta', visibility: 'public' },
    });
    const second = corpus.submitOperation({
      originId: 'public:collision:second',
      participant: OWNER,
      change: { kind: 'create_page', title: 'Alpha + beta', visibility: 'public' },
    });
    assert.equal(first.status, 'applied');
    assert.equal(second.status, 'applied');
    assert.throws(
      () =>
        projectPublicSite(corpus, scratch(), {
          canonicalDomain: 'https://vera.mediafranca.net',
          siteTitle: 'Vera',
          publishedPages: new Set(corpus.pages().map((page) => page.id)),
        }),
      /public path collision/,
    );
  });
});
