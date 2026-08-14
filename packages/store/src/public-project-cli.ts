// Genera un sitio HTML estático exclusivamente con las páginas públicas.
//   npm run project:public -- data/vera.sqlite ../vera-public https://vera.mediafranca.net

import { loadGraph, openStore } from './store.ts';
import { projectPublicSite } from './public-projection.ts';

const database = process.argv[2] ?? 'data/vera.sqlite';
const target = process.argv[3] ?? '../vera-public';
const canonicalDomain = process.argv[4] ?? 'https://vera.mediafranca.net';

const store = openStore({ path: database, graphName: 'mind' });
try {
  const graph = loadGraph(store, 'mind');
  const summary = projectPublicSite(graph, target, {
    canonicalDomain,
    siteTitle: 'Vera de Herbert Spencer',
  });
  console.log(`sitio público proyectado a ${target}`);
  console.log(`  páginas ${summary.pages}`);
  console.log(`  archivos ${summary.files.length}`);
} finally {
  store.close();
}
