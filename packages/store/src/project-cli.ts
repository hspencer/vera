// Proyecta la base canónica a un repositorio Markdown.
//   node packages/store/src/project-cli.ts data/vera.sqlite ../vera-graph

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { loadGraph, openStore } from './store.ts';
import { projectGraph } from './projection.ts';

const database = process.argv[2] ?? 'data/vera.sqlite';
const target = process.argv[3] ?? '../vera-graph';
const commit = process.argv.includes('--commit');

const store = openStore({ path: database, graphName: 'mind' });
const graph = loadGraph(store, 'mind');

const t0 = Date.now();
const summary = projectGraph(graph, target);
console.log(`proyectado a ${target} en ${Date.now() - t0} ms`);
console.log(`  páginas  ${summary.pages}`);
console.log(`  journals ${summary.journals}`);
console.log(`  bloques  ${summary.blocks}`);

if (commit) {
  if (!existsSync(join(target, '.git'))) {
    execFileSync('git', ['init', '-q'], { cwd: target });
  }
  execFileSync('git', ['add', '-A'], { cwd: target });
  const pending = execFileSync('git', ['status', '--porcelain'], { cwd: target }).toString();
  if (pending.trim() === '') {
    console.log('\nsin cambios que registrar: la proyección es idéntica a la anterior');
  } else {
    execFileSync(
      'git',
      ['commit', '-q', '-m', `proyección hasta la secuencia ${graph.log().lastSequence}`],
      { cwd: target },
    );
    console.log(`\ncommit hasta la secuencia ${graph.log().lastSequence}`);
  }
}
store.close();
