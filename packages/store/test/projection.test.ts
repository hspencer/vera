// Pruebas de la proyección Markdown.
//
// La obligación central es el determinismo: proyectar dos veces el mismo estado
// produce bytes idénticos, o el `git diff` deja de significar nada.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { VeraGraph } from '@vera/core';
import type { Change } from '@vera/core';
import { filenameFor, projectGraph, projectionIsDeterministic } from '../src/projection.ts';

const OWNER = 'participant:herbert';
const temporary: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vera-projection-'));
  temporary.push(dir);
  return dir;
}

after(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

function populated(): VeraGraph {
  const graph = VeraGraph.create({ name: 'mind' });
  graph.addParticipant({ id: OWNER, name: 'Herbert', kind: 'human' });
  graph.admit(OWNER);

  let n = 0;
  const write = (change: Change): string => {
    n += 1;
    const outcome = graph.submitOperation({ originId: `o${n}`, participant: OWNER, change });
    if (outcome.status !== 'applied') throw new Error(JSON.stringify(outcome));
    return outcome.subjectId;
  };

  const page = write({ kind: 'create_page', title: 'Amereida', visibility: 'public' });
  write({ kind: 'set_property', page, propertyKey: 'lang', propertyValue: 'es' });
  write({ kind: 'set_property', page, propertyKey: 'status', propertyValue: 'draft' });
  const root = write({
    kind: 'create_block',
    page,
    parent: null,
    position: 0,
    content: 'el mar interior',
  });
  write({ kind: 'create_block', page, parent: root, position: 0, content: 'una observación' });
  write({
    kind: 'create_block',
    page,
    parent: null,
    position: 1,
    content: 'primera línea\nsegunda línea',
  });
  write({ kind: 'create_page', title: '2024-02-26', visibility: 'private' });
  return graph;
}

describe('proyección', () => {
  it('separa páginas de journals por su título de fecha', () => {
    const dir = scratch();
    const summary = projectGraph(populated(), dir);
    assert.equal(summary.pages, 1);
    assert.equal(summary.journals, 1);
    assert.ok(readdirSync(join(dir, 'journals')).includes('2024_02_26.md'));
    assert.ok(readdirSync(join(dir, 'pages')).includes('Amereida.md'));
  });

  it('escribe las propiedades en la cabecera y los bloques con tabuladores', () => {
    const dir = scratch();
    projectGraph(populated(), dir);
    const text = readFileSync(join(dir, 'pages', 'Amereida.md'), 'utf8');

    assert.ok(text.startsWith('lang:: es\nstatus:: draft\n\n'));
    assert.ok(text.includes('- el mar interior\n\t- una observación'));
  });

  it('indenta la continuación de un bloque multilínea a dos espacios', () => {
    const dir = scratch();
    projectGraph(populated(), dir);
    const text = readFileSync(join(dir, 'pages', 'Amereida.md'), 'utf8');
    assert.ok(text.includes('- primera línea\n  segunda línea'));
  });

  it('no escribe metadata técnica de identidad', () => {
    const dir = scratch();
    projectGraph(populated(), dir);
    for (const folder of ['pages', 'journals']) {
      for (const name of readdirSync(join(dir, folder))) {
        const text = readFileSync(join(dir, folder, name), 'utf8');
        assert.ok(!/(^|[^a-z-])id:: /m.test(text), `${name} filtró un id::`);
        assert.ok(!text.includes('collapsed::'), `${name} filtró estado de interfaz`);
      }
    }
  });

  it('lleva la identidad de cada bloque al manifiesto', () => {
    const dir = scratch();
    const graph = populated();
    projectGraph(graph, dir);

    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
      pages: { title: string; blocks: string[] }[];
    };
    const amereida = manifest.pages.find((p) => p.title === 'Amereida');
    assert.equal(amereida?.blocks.length, 3);
    for (const id of amereida?.blocks ?? []) {
      assert.notEqual(graph.block(id), undefined, 'el manifiesto nombra bloques que existen');
    }
  });

  it('produce bytes idénticos al proyectar dos veces', () => {
    const graph = populated();
    assert.ok(projectionIsDeterministic(graph, scratch(), scratch()));
  });

  it('sigue siendo determinista tras reproducir el log', () => {
    const graph = populated();
    const a = scratch();
    const b = scratch();
    projectGraph(graph, a);
    projectGraph(graph.replayFromLog(), b);

    for (const folder of ['pages', 'journals']) {
      for (const name of readdirSync(join(a, folder))) {
        assert.equal(
          readFileSync(join(a, folder, name), 'utf8'),
          readFileSync(join(b, folder, name), 'utf8'),
          `${name} difiere entre el grafo vivo y el reproducido`,
        );
      }
    }
  });

  it('cambia sólo el archivo que cambió', () => {
    const graph = populated();
    const before = scratch();
    projectGraph(graph, before);
    const journalBefore = readFileSync(join(before, 'journals', '2024_02_26.md'), 'utf8');

    const target = graph.allBlocks()[0];
    assert.ok(target);
    graph.submitOperation({
      originId: 'edicion',
      participant: OWNER,
      change: { kind: 'edit_block', block: target.stableId, content: 'otra cosa' },
    });

    const after = scratch();
    projectGraph(graph, after);

    assert.equal(
      readFileSync(join(after, 'journals', '2024_02_26.md'), 'utf8'),
      journalBefore,
      'una edición en una página no toca las demás',
    );
    assert.notEqual(
      readFileSync(join(after, 'pages', 'Amereida.md'), 'utf8'),
      readFileSync(join(before, 'pages', 'Amereida.md'), 'utf8'),
    );
  });

  it('escapa lo que no cabe en un nombre de archivo', () => {
    assert.equal(filenameFor('Escuela/Taller'), 'Escuela___Taller.md');
    assert.equal(filenameFor('Survey: results'), 'Survey%3A results.md');
    assert.equal(filenameFor('Amereida'), 'Amereida.md');
  });

  it('no borra el .git del repositorio de proyección', () => {
    const dir = scratch();
    projectGraph(populated(), dir);
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    projectGraph(populated(), dir);
    assert.ok(existsSync(join(dir, '.git', 'HEAD')), 'la historia sobrevive a una reproyección');
  });
});
