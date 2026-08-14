// Emite la credencial raíz desde la máquina, fuera de HTTP.
//
// Un proxy que corre en esta misma máquina también conecta por loopback. Por
// eso la posesión del socket no demuestra posesión de la máquina: esta vía abre
// directamente la base que el operador nombra y nunca se monta en el servidor.

import { loadGraph, openStore } from '@vera/store';

import { issueCredential } from './credentials.ts';

const databasePath = process.argv[2];
const label = process.argv[3]?.trim() || 'dueño local';

if (databasePath === undefined || databasePath.trim() === '') {
  console.error('uso: npm run owner:credential -- <base.sqlite> [etiqueta]');
  process.exitCode = 2;
} else {
  const store = openStore({ path: databasePath, graphName: 'mind' });
  try {
    const graph = loadGraph(store, 'mind');
    const owner = graph.owner;
    if (owner === null) throw new Error('este grafo no tiene una persona propietaria');

    const issued = issueCredential(store, {
      participant: owner,
      scopes: ['read', 'write', 'discard'],
      label,
      issuedBy: owner,
      expiresAt: null,
    });

    // El secreto se muestra una sola vez. La persona decide dónde custodiarlo.
    process.stdout.write(`${issued.secret}\n`);
  } finally {
    store.close();
  }
}
