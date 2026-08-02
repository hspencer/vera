// Arranca el servidor.
//   node packages/server/src/main.ts [puerto] [ruta-a-la-base] [host]

import { listen } from './server.ts';

const port = Number(process.argv[2] ?? 4173);
const databasePath = process.argv[3] ?? 'data/vera.sqlite';
// Loopback por defecto; pasar '0.0.0.0' aquí es una decisión consciente.
const host = process.argv[4] ?? '127.0.0.1';

const { vera } = listen({
  port,
  databasePath,
  host,
  webRoot: 'packages/web/dist',
});

console.log(`Vera escucha en http://localhost:${port}`);
console.log(`  base:     ${databasePath}`);
console.log(`  páginas:  ${vera.graph.pages().length}`);
console.log(`  bloques:  ${vera.graph.allBlocks().length}`);
console.log(`  secuencia:${vera.graph.log().lastSequence}`);
