// Arranca el servidor.
//   node packages/server/src/main.ts [puerto] [ruta-a-la-base]

import { listen } from './server.ts';

const port = Number(process.argv[2] ?? 4173);
const databasePath = process.argv[3] ?? 'data/vera.sqlite';

const { vera } = listen({
  port,
  databasePath,
  webRoot: 'packages/web/dist',
});

console.log(`Vera escucha en http://localhost:${port}`);
console.log(`  base:     ${databasePath}`);
console.log(`  páginas:  ${vera.graph.pages().length}`);
console.log(`  bloques:  ${vera.graph.allBlocks().length}`);
console.log(`  secuencia:${vera.graph.log().lastSequence}`);
