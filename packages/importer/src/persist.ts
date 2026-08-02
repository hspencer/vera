// Importa el corpus y lo deja escrito en la base canónica.
//
//   node packages/importer/src/persist.ts ../mind data/vera.sqlite objects

import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

import { VeraGraph, checkInvariants } from '@vera/core';
import {
  loadGraph,
  openStore,
  recordAllOperations,
  recordMedia,
  saveParticipant,
} from '@vera/store';
import { mediaTypeFor, putObject, sniffMediaType } from '@vera/store/objects';

import { importLogseqGraph } from './import.ts';

const source = process.argv[2] ?? '../mind';
const target = process.argv[3] ?? 'data/vera.sqlite';
const objects = process.argv[4] ?? 'objects';
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

// @invariant DirectIngestionIsSovereign: el binario referido por el corpus pasa
// a vivir dentro de Vera. Se copian los bytes tal cual, sin recomprimir ni
// convertir nada, que es lo que exige SourceFidelity.
console.log(`ingiriendo ${report.assetFiles.length} medios …`);
const t3 = Date.now();
let guardados = 0;
let compartidos = 0;
let ilegibles = 0;
const desmentidos: { path: string; declara: string; es: string }[] = [];
const at = Date.now();

for (const asset of report.assetFiles) {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(asset.file);
  } catch {
    ilegibles += 1;
    continue;
  }
  const stored = putObject(objects, bytes);
  if (stored.written) guardados += 1;
  else compartidos += 1;

  // La extensión declara un tipo; los primeros bytes dicen otro. Cuando se
  // contradicen mandan los bytes: registrar el tipo que dice el nombre sería
  // guardar una mentira y presentar como imagen algo que no lo es.
  const declared = mediaTypeFor(asset.file);
  const sniffed = sniffMediaType(bytes);
  const mediaType = sniffed !== null && sniffed !== declared ? sniffed : declared;
  if (sniffed !== null && sniffed !== declared) {
    desmentidos.push({ path: asset.path, declara: declared, es: sniffed });
  }

  recordMedia(store, {
    path: asset.path,
    hash: stored.hash,
    mediaType,
    byteSize: stored.byteSize,
    at,
  });
}
const ingested = Date.now() - t3;

const n = (t: string) => (store.db.prepare(`SELECT count(*) c FROM ${t}`).get() as { c: number }).c;
console.log(`\nEN LA BASE  ${target}`);
for (const t of ['pages', 'blocks', 'property_assignments', 'page_links', 'block_tags', 'operations', 'revisions', 'unported_queries', 'media', 'media_references']) {
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
console.log(
  `  medios en ${objects}/: ${guardados} guardados, ${compartidos} ya presentes` +
    `${ilegibles > 0 ? `, ${ilegibles} ilegibles` : ''}` +
    ` · ${(report.assetBytes / 1e6).toFixed(1)} MB · ingesta ${ingested} ms`,
);
if (report.assetsMissing.length > 0) {
  console.log(`  referencias sin archivo: ${report.assetsMissing.length}`);
  for (const missing of report.assetsMissing.slice(0, 5)) console.log(`    ${missing}`);
}
if (desmentidos.length > 0) {
  console.log(`  archivos cuya extensión miente: ${desmentidos.length}`);
  for (const bad of desmentidos) {
    console.log(`    ${bad.path}`);
    console.log(`      declara ${bad.declara} · es ${bad.es}`);
  }
}
if (report.assetsUnreferenced.length > 0) {
  console.log(
    `  archivos en assets/ que ningún bloque nombra: ${report.assetsUnreferenced.length}` +
      ' (no ingeridos)',
  );
  for (const orphan of report.assetsUnreferenced.slice(0, 5)) console.log(`    ${orphan}`);
}
store.close();
