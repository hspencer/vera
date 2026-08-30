// Autoriza al dueño a matricular una passkey nueva, desde la máquina.
//
// specs/shared-space-access.allium, rule OwnerAuthorizesOwnAuthenticatorFromMachine
// y rule FreshInstanceBeginsOwnerAuthenticationBootstrap.
//
// Como issue-owner.ts, abre la base directamente y nunca se monta en el
// servidor: la posesión del socket no demuestra posesión de la máquina, así
// que esta vía tiene que quedar fuera de HTTP por completo.

import { loadGraph, openStore } from '@vera/store';

import { beginOwnerBootstrap } from './owner-bootstrap.ts';

const databasePath = process.argv[2];

if (databasePath === undefined || databasePath.trim() === '') {
  console.error('uso: npm run owner:enroll-passkey -- <base.sqlite>');
  process.exitCode = 2;
} else {
  const store = openStore({ path: databasePath, graphName: 'mind' });
  try {
    const graph = loadGraph(store, 'mind');
    const owner = graph.owner;
    if (owner === null) throw new Error('este grafo no tiene una persona propietaria');

    const { enrollment, enrollmentSecret, expiresAt } = beginOwnerBootstrap(store, owner);

    // El secreto se muestra una sola vez, como el de issue-owner.ts. La ruta es
    // relativa: se pega detrás de donde sea que esta instancia esté sirviendo.
    process.stdout.write(
      `/enroll-owner/${encodeURIComponent(enrollment)}?secret=${encodeURIComponent(enrollmentSecret)}\n`,
    );
    process.stdout.write(`vence: ${new Date(expiresAt).toLocaleString()}\n`);
  } finally {
    store.close();
  }
}
