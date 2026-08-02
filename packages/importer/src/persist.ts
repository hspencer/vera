// Importa el corpus y lo deja escrito en la base canónica.
//
//   node packages/importer/src/persist.ts ../mind data/vera.sqlite

import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

import { VeraGraph, checkInvariants } from '@vera/core';
import { loadGraph, openStore, recordAllOperations, saveParticipant } from '@vera/store';

import { importLogseqGraph } from './import.ts';

const source = process.argv[2] ?? '../mind';
const target = process.argv[3] ?? 'data/vera.sqlite';
const OWNER = 'participant:herbert';

mkdirSync(dirname(target), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) rmSync(`${target}${suffix}`, { force: true });

const store = openStore({ path: target, graphName: 'mind' });
saveParticipant(store, { id: OWNER, name: 'Herbert', kind: 'human' });

const graph = VeraGraph.create({ name: 'mind', id: store.graphId });
graph.addParticipant({ id: OWNER, name: 'Herbert', kind: 'human' });
graph.admit(OWNER);

console.log(`leyendo ${source} …`);
const t0 = Date.now();
const report = importLogseqGraph({ source, participant: OWNER, graph });
const parsed = Date.now() - t0;

console.log(`persistiendo ${graph.operations().length} operaciones …`);
const t1 = Date.now();
recordAllOperations(store, graph);
const persisted = Date.now() - t1;

const n = (t: string) => (store.db.prepare(`SELECT count(*) c FROM ${t}`).get() as { c: number }).c;
console.log(`\nEN LA BASE  ${target}`);
for (const t of ['pages', 'blocks', 'property_assignments', 'page_links', 'block_tags', 'operations', 'revisions', 'unported_queries']) {
  console.log(`  ${t.padEnd(22)} ${String(n(t)).padStart(8)}`);
}

console.log(`\nreconstruyendo desde el log …`);
const t2 = Date.now();
const reloaded = loadGraph(store, 'mind');
const replayed = Date.now() - t2;

console.log(`  páginas   ${reloaded.pages().length} (memoria: ${graph.pages().length})`);
console.log(`  bloques   ${reloaded.allBlocks().length} (memoria: ${graph.allBlocks().length})`);
console.log(`  enlaces   ${reloaded.links().length} (memoria: ${graph.links().length})`);
console.log(`  violaciones de invariante: ${checkInvariants(reloaded).length}`);
console.log(`\n  parseo ${parsed} ms · persistencia ${persisted} ms · reproducción ${replayed} ms`);
console.log(`  enlaces resueltos: ${report.linksResolved}/${report.linksSeen}`);
store.close();
