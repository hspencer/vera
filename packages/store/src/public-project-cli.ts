// Genera un sitio HTML estático exclusivamente con las páginas públicas.
//   npm run project:public -- data/vera.sqlite ../vera-public https://vera.mediafranca.net --page page:123

import { loadGraph, openStore } from './store.ts';
import { projectPublicSite } from './public-projection.ts';

const database = process.argv[2] ?? 'data/vera.sqlite';
const target = process.argv[3] ?? '../vera-public';
const canonicalDomain = process.argv[4] ?? 'https://vera.mediafranca.net';
const publishedPages = new Set<string>();
let entryPoint: string | undefined;
for (let at = 5; at < process.argv.length; at += 1) {
  if (process.argv[at] === '--entry-point' && process.argv[at + 1] !== undefined) {
    entryPoint = process.argv[at + 1]!;
    at += 1;
    continue;
  }
  if (process.argv[at] !== '--page' || process.argv[at + 1] === undefined) {
    throw new Error('cada selección se declara como --page <page-id>');
  }
  publishedPages.add(process.argv[at + 1]!);
  at += 1;
}
if (publishedPages.size === 0) {
  throw new Error('el sitio no se construye sin publicaciones explícitas: falta --page <page-id>');
}

const store = openStore({ path: database, graphName: 'mind' });
try {
  const graph = loadGraph(store, 'mind');
  const summary = projectPublicSite(graph, target, {
    canonicalDomain,
    siteTitle: 'Vera',
    publishedPages,
    ...(entryPoint === undefined ? {} : { entryPoint }),
  });
  console.log(`sitio público proyectado a ${target}`);
  console.log(`  páginas ${summary.pages}`);
  console.log(`  archivos ${summary.files.length}`);
} finally {
  store.close();
}
