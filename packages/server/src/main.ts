// Arranca el servidor.
//   node packages/server/src/main.ts [puerto] [base] [host] [almacén-de-objetos]

import { listen } from './server.ts';

const port = Number(process.argv[2] ?? 4173);
const databasePath = process.argv[3] ?? 'data/vera.sqlite';
// Loopback por defecto; pasar '0.0.0.0' aquí es una decisión consciente.
const host = process.argv[4] ?? '127.0.0.1';
// Configurable para que una instancia de pruebas no escriba en el almacén real.
const objectsRoot = process.argv[5] ?? 'objects';

const { vera } = listen({
  port,
  databasePath,
  host,
  webRoot: 'packages/web/dist',
  objectsRoot,
});

console.log(`Vera escucha en http://localhost:${port}`);
console.log(`  base:     ${databasePath}`);
console.log(`  páginas:  ${vera.graph.pages().length}`);
console.log(`  bloques:  ${vera.graph.allBlocks().length}`);
console.log(`  secuencia:${vera.graph.log().lastSequence}`);
