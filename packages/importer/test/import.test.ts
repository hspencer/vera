// Pruebas de la importación contra un corpus mínimo escrito en disco.
//
// Se ejercita sobre archivos reales, no sobre cadenas: la importación existe
// para leer un directorio y eso es lo que hay que probar.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { VeraGraph, checkInvariants } from '@vera/core';
import { importLogseqGraph } from '../src/import.ts';

const OWNER = 'participant:herbert';

let root: string;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'vera-import-'));
  mkdirSync(join(root, 'pages', 'Personas'), { recursive: true });
  mkdirSync(join(root, 'journals'), { recursive: true });
  mkdirSync(join(root, 'assets'), { recursive: true });

  writeFileSync(
    join(root, 'pages', 'Amereida.md'),
    [
      'status:: draft',
      'lang:: es',
      'public:: true',
      '',
      '- el mar interior, ver [[Travesia]]',
      '\t- una observación #ead',
      '\t  id:: 11111111-2222-3333-4444-555555555555',
      '- {{query (property status "draft")}}',
      '- ![foto](../assets/existe.png)',
      '- ![rota](../assets/no-existe.png)',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'pages', 'Travesia.md'),
    ['lang:: es', '', '- de vuelta a [[amereida]]', '- apunta a [[Nunca escrita]]'].join('\n'),
  );
  writeFileSync(join(root, 'pages', 'Ann Morrison.md'), '- la del primer nivel\n');
  writeFileSync(join(root, 'pages', 'Personas', 'Ann Morrison.md'), '- la de la carpeta\n');
  writeFileSync(join(root, 'journals', '2024_02_26.md'), '- Hoy instalo LogSeq\n');
  writeFileSync(join(root, 'assets', 'existe.png'), Buffer.alloc(64));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

function runImport(): { graph: VeraGraph; report: ReturnType<typeof importLogseqGraph> } {
  const graph = VeraGraph.create({ name: 'mind' });
  graph.addParticipant({ id: OWNER, name: 'Herbert', kind: 'human' });
  graph.admit(OWNER);
  const report = importLogseqGraph({ source: root, participant: OWNER, graph });
  return { graph, report };
}

describe('importación', () => {
  it('lee todas las páginas y los journals', () => {
    const { report } = runImport();
    assert.equal(report.filesRead, 5);
    assert.equal(report.pagesCreated, 5);
    assert.equal(report.pagesRejected.length, 0);
  });

  it('deja el grafo sin ninguna violación de invariante', () => {
    const { graph } = runImport();
    assert.deepEqual(checkInvariants(graph), []);
  });

  it('atribuye todo lo importado al canal import', () => {
    const { graph } = runImport();
    assert.ok(graph.revisions().length > 0);
    for (const revision of graph.revisions()) {
      assert.equal(revision.channel, 'import');
      assert.equal(revision.authoredBy, OWNER);
    }
  });

  it('hace pasar todo por el log de operaciones', () => {
    const { graph } = runImport();
    assert.equal(graph.operations().length, graph.revisions().length);
    const subjects = new Set(graph.operations().map((o) => o.subjectId));
    for (const page of graph.pages()) assert.ok(subjects.has(page.id));
    for (const block of graph.allBlocks()) assert.ok(subjects.has(block.stableId));
  });

  it('adopta la identidad que el corpus ya traía', () => {
    const { graph, report } = runImport();
    assert.equal(report.adoptedStableIds, 1);
    assert.notEqual(graph.block('11111111-2222-3333-4444-555555555555'), undefined);
  });

  it('reconstruye la jerarquía de bloques', () => {
    const { graph } = runImport();
    const page = graph.pages().find((p) => p.title === 'Amereida');
    assert.ok(page);
    const root = graph.blocksOf(page.id).find((b) => b.content.startsWith('el mar interior'));
    assert.ok(root);
    const children = graph.childrenOf(root.stableId);
    assert.equal(children.length, 1);
    assert.ok(children[0]?.content.startsWith('una observación'));
  });

  it('resuelve los enlaces sin reparar en mayúsculas', () => {
    const { graph } = runImport();
    const amereida = graph.pages().find((p) => p.title === 'Amereida');
    assert.ok(amereida);
    // Travesia escribe [[amereida]] en minúscula.
    assert.equal(graph.backlinks(amereida.id).length, 1);
  });

  it('conserva sin resolver la referencia a una página que no existe', () => {
    const { graph, report } = runImport();
    assert.equal(report.linksWaiting, 1);
    const waiting = graph.links().find((l) => l.target === null);
    assert.equal(waiting?.targetTitle, 'Nunca escrita');
    assert.equal(
      graph.pages().find((p) => p.title === 'Nunca escrita'),
      undefined,
      'una referencia pendiente no inventa la página',
    );
  });

  it('lleva public:: true a la visibilidad de la página', () => {
    const { graph } = runImport();
    assert.equal(graph.pages().find((p) => p.title === 'Amereida')?.visibility, 'public');
    assert.equal(graph.pages().find((p) => p.title === 'Travesia')?.visibility, 'private');
  });

  it('nombra el journal por su fecha', () => {
    const { graph } = runImport();
    assert.notEqual(
      graph.pages().find((p) => p.title === '2024-02-26'),
      undefined,
    );
  });

  it('califica por ruta sólo la página que colisiona', () => {
    const { graph, report } = runImport();
    assert.equal(report.pagesQualifiedByPath.length, 1);
    assert.notEqual(
      graph.pages().find((p) => p.title === 'Ann Morrison'),
      undefined,
      'la primera conserva el nombre corto para que los enlaces sigan resolviendo',
    );
    assert.notEqual(
      graph.pages().find((p) => p.title === 'Personas/Ann Morrison'),
      undefined,
    );
  });

  it('preserva la query de Logseq sin traducirla', () => {
    const { graph } = runImport();
    const unported = graph.unportedQueries();
    assert.equal(unported.length, 1);
    assert.equal(unported[0]?.sourceText, '{{query (property status "draft")}}');
    assert.equal(unported[0]?.portedTo, null);
  });

  it('distingue el asset que existe del que falta', () => {
    const { report } = runImport();
    assert.equal(report.assetsFound, 1);
    assert.deepEqual(report.assetsMissing, ['../assets/no-existe.png']);
    assert.equal(report.assetBytes, 64);
  });

  it('manda collapsed:: al estado de interfaz y no al contenido', () => {
    const { graph } = runImport();
    for (const block of graph.allBlocks()) {
      assert.ok(!block.content.includes('collapsed::'));
    }
  });

  it('es repetible: dos importaciones del mismo origen coinciden', () => {
    const first = runImport();
    const second = runImport();
    assert.deepEqual(
      second.graph.pages().map((p) => p.title).sort(),
      first.graph.pages().map((p) => p.title).sort(),
    );
    assert.equal(second.graph.allBlocks().length, first.graph.allBlocks().length);
    assert.equal(second.report.linksResolved, first.report.linksResolved);
  });

  it('reproduce desde el log el mismo estado que dejó la importación', () => {
    const { graph } = runImport();
    const replayed = graph.replayFromLog();
    assert.equal(replayed.pages().length, graph.pages().length);
    assert.equal(replayed.allBlocks().length, graph.allBlocks().length);
  });
});
