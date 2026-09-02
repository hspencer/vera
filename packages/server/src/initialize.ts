// Crea una memoria nueva con identidad humana explícita y contenido inicial.
// No elimina ni reemplaza bases existentes: la operación es idempotente y se
// niega a atribuir una memoria ya habitada a otra persona.

import { initializeStarterMemory } from './starter-memory.ts';

const databasePath = process.argv[2];
const ownerId = process.argv[3] ?? process.env['VERA_OWNER'];
const ownerName = process.argv[4] ?? process.env['VERA_OWNER_NAME'];

if (databasePath === undefined || ownerId === undefined || ownerName === undefined) {
  console.error('uso: npm run initialize -- <base.sqlite> <participant:id> "Nombre de la persona"');
  process.exitCode = 2;
} else {
  const report = initializeStarterMemory({ databasePath, owner: { id: ownerId, name: ownerName } });
  console.log(`Memoria inicial v${report.version}`);
  console.log(`  aplicadas:  ${report.applied}`);
  console.log(`  existentes: ${report.duplicates}`);
  console.log(`  páginas:    ${report.pages}`);
  console.log(`  bloques:    ${report.blocks}`);
}
