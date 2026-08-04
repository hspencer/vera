// Importa un grafo Logseq y lo deja escrito en la base canónica.
//
//   node packages/importer/src/persist.ts <grafo> [base] [objetos]
//
// Quién queda como dueño de lo importado sale de VERA_OWNER / VERA_OWNER_NAME,
// igual que en el servidor. No hay valor por defecto a propósito: importar es
// escribir decenas de miles de operaciones, y todas quedan firmadas por alguien.

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VeraGraph, checkInvariants } from '@vera/core';
import {
  loadGraph,
  openStore,
  recordAllOperations,
  recordMedia,
  saveParticipant,
  setFold,
} from '@vera/store';
import { mediaTypeFor, putObject, sniffMediaType } from '@vera/store/objects';

import { importLogseqGraph } from './import.ts';

// El mismo `.env` que lee el servidor. Sin esto, quien lo hubiera llenado tenía
// que repetir el dueño en la línea de comandos para importar, y ya sabemos qué
// pasa cuando dos sitios declaran la misma cosa.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const source = process.argv[2];
if (source === undefined) {
  console.error('falta la ruta del grafo Logseq a importar');
  process.exit(1);
}
const target = process.argv[3] ?? process.env['VERA_DATABASE'] ?? 'data/vera.sqlite';
const objects = process.argv[4] ?? process.env['VERA_OBJECTS'] ?? 'objects';

const OWNER = process.env['VERA_OWNER'];
const OWNER_NAME = process.env['VERA_OWNER_NAME'] ?? OWNER;
if (OWNER === undefined || OWNER_NAME === undefined) {
  console.error('declara VERA_OWNER y VERA_OWNER_NAME antes de importar: todo lo');
  console.error('que se importe queda firmado por esa persona, y no se puede');
  console.error('cambiar después sin reescribir de quién es lo ya escrito.');
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) rmSync(`${target}${suffix}`, { force: true });

const store = openStore({ path: target, graphName: 'mind' });
saveParticipant(store, { id: OWNER, name: OWNER_NAME, kind: 'human' });

const graph = VeraGraph.create({ name: 'mind', id: store.graphId });
graph.addParticipant({ id: OWNER, name: OWNER_NAME, kind: 'human' });
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

// El plegado que traía el corpus es estado del participante, no contenido. Sin
// sembrarlo, la migración devolvería el corpus entero desplegado de golpe.
//
// @invariant OnlyParentsFold: se filtra aquí y no al leerlo, porque cuando
// aparece el `collapsed::` de un bloque sus hijos todavía no se han creado.
// El corpus trae 21 marcas sobre bloques que hoy no tienen hijos; plegarlos
// sería guardar un estado que la interfaz no puede ni mostrar ni deshacer.
let plegados = 0;
let plegadosSinHijos = 0;
for (const block of report.foldedBlocks) {
  if (graph.childrenOf(block).length === 0) {
    plegadosSinHijos += 1;
    continue;
  }
  setFold(store, OWNER, block, true);
  plegados += 1;
}

const n = (t: string) => (store.db.prepare(`SELECT count(*) c FROM ${t}`).get() as { c: number }).c;
console.log(`\nEN LA BASE  ${target}`);
for (const t of ['pages', 'blocks', 'property_assignments', 'page_links', 'block_tags', 'operations', 'revisions', 'unported_queries', 'media', 'media_references', 'block_collapse_state']) {
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
  `  plegados recuperados: ${plegados}` +
    `${plegadosSinHijos > 0 ? `, ${plegadosSinHijos} descartados por no tener hijos` : ''}`,
);
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
