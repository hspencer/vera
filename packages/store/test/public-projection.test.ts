import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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
  return graph;
}

describe('proyección pública', () => {
  it('genera sólo páginas públicas y escapa su HTML', () => {
    const target = scratch();
    const summary = projectPublicSite(graph(), target, {
      canonicalDomain: 'https://vera.mediafranca.net',
      siteTitle: 'Vera de Herbert',
    });
    assert.equal(summary.pages, 1);
    assert.deepEqual(readdirSync(target).sort(), ['index.html', 'pagina-publica']);
    const page = readFileSync(join(target, 'pagina-publica', 'index.html'), 'utf8');
    assert.match(page, /<p>Texto &lt;visible&gt;<\/p>/);
    assert.match(page, /https:\/\/vera\.mediafranca\.net\/pagina-publica\//);
  });

  it('no filtra título, contenido ni manifiesto de páginas privadas', () => {
    const target = scratch();
    projectPublicSite(graph(), target, {
      canonicalDomain: 'https://vera.mediafranca.net',
      siteTitle: 'Vera de Herbert',
    });
    const all = [
      readFileSync(join(target, 'index.html'), 'utf8'),
      readFileSync(join(target, 'pagina-publica', 'index.html'), 'utf8'),
    ].join('\n');
    assert.doesNotMatch(all, /Secreto irrepetible|No debe salir|block:|page:/);
    assert.ok(!readdirSync(target).includes('manifest.json'));
  });

  it('produce rutas estables sin diacríticos', () => {
    assert.equal(publicPathFor('Vera — Instanciación'), 'vera-instanciacion');
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
          siteTitle: 'Vera de Herbert',
        }),
      /public path collision/,
    );
  });
});
