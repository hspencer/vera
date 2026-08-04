// Ejecuta la importación e imprime el informe de pérdida.
//
//   node packages/importer/src/cli.ts <grafo> [límite-de-archivos]

import { VeraGraph, checkInvariants } from '@vera/core';
import { importLogseqGraph } from './import.ts';

const source = process.argv[2];
if (source === undefined) {
  console.error('falta la ruta del grafo Logseq a leer');
  process.exit(1);
}

// Esto sólo lee y reporta: no persiste nada. El participante es una etiqueta
// para el reporte, no una identidad que quede escrita en ninguna parte.
const READER = process.env['VERA_OWNER'] ?? 'participant:lector';
const limit = process.argv[3] === undefined ? undefined : Number(process.argv[3]);

const graph = VeraGraph.create({ name: 'mind' });
graph.addParticipant({ id: READER, name: process.env['VERA_OWNER_NAME'] ?? 'Lector', kind: 'human' });
graph.admit(READER);

const started = Date.now();
const report = importLogseqGraph({
  source,
  participant: READER,
  graph,
  ...(limit === undefined ? {} : { limit }),
});
const elapsed = Date.now() - started;

const pct = (part: number, whole: number): string =>
  whole === 0 ? '—' : `${((part / whole) * 100).toFixed(1)}%`;
const row = (label: string, value: string | number): void =>
  console.log(`  ${label.padEnd(34)} ${String(value).padStart(10)}`);

console.log(`\nINFORME DE PÉRDIDA — ${source}`);
console.log(`${'='.repeat(58)}\n`);

console.log('LEÍDO');
row('archivos leídos', report.filesRead);
row('archivos ilegibles', report.unreadableFiles.length);
console.log('\nPÁGINAS');
row('vistas', report.pagesSeen);
row('creadas', `${report.pagesCreated} (${pct(report.pagesCreated, report.pagesSeen)})`);
row('rechazadas', report.pagesRejected.length);
row('calificadas por ruta al colisionar', report.pagesQualifiedByPath.length);
console.log('\nBLOQUES');
row('vistos', report.blocksSeen);
row('creados', `${report.blocksCreated} (${pct(report.blocksCreated, report.blocksSeen)})`);
row('vacíos omitidos', report.emptyBlocksSkipped);
row('rechazados', report.blocksRejected.length);
row('identidades adoptadas del corpus', report.adoptedStableIds);
console.log('\nPROPIEDADES');
row('vistas', report.propertiesSeen);
row('creadas', `${report.propertiesCreated} (${pct(report.propertiesCreated, report.propertiesSeen)})`);
row('estados collapsed a interfaz', report.collapseStatesDropped);
console.log('\nRELACIONES DERIVADAS');
row('enlaces', report.linksSeen);
row('  resueltos', `${report.linksResolved} (${pct(report.linksResolved, report.linksSeen)})`);
row('  esperando su página', report.linksWaiting);
row('etiquetas', report.tagsSeen);
console.log('\nMEDIOS');
row('referencias a assets', report.assetsReferenced);
row('encontrados', report.assetsFound);
row('ausentes', report.assetsMissing.length);
row('bytes únicos', `${(report.assetBytes / 1e6).toFixed(1)} MB`);
console.log('\nPRESERVADO SIN TRADUCIR');
for (const [macro, n] of Object.entries(report.macrosPreserved).sort((a, b) => b[1] - a[1])) {
  row(`{{${macro}}}`, n);
}
row('queries Logseq registradas', report.unportedQueries);
row('  macros de query sin registro propio', report.queryMacrosBeyondFirstPerBlock);
row('líneas de preámbulo conservadas', report.preambleLinesKept);

console.log('\nESTADO DEL GRAFO');
row('páginas', graph.pages().length);
row('bloques', graph.allBlocks().length);
row('operaciones en el log', graph.operations().length);
row('revisiones', graph.revisions().length);

const violations = checkInvariants(graph);
console.log('\nINVARIANTES');
row('violaciones', violations.length);
for (const v of violations.slice(0, 10)) console.log(`    ✖ ${v.invariant}: ${v.detail}`);

console.log(`\ntiempo: ${elapsed} ms\n`);

if (report.assetsMissing.length > 0) {
  console.log(`assets ausentes (primeros 5): ${report.assetsMissing.slice(0, 5).join(', ')}`);
}
if (report.pagesRejected.length > 0) {
  console.log(`\npáginas rechazadas (primeras 10):`);
  for (const p of report.pagesRejected.slice(0, 10)) console.log(`  ${p.title} — ${p.reason}`);
}
