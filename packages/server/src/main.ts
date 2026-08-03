// Arranca el servidor.
//   node packages/server/src/main.ts [puerto] [base] [host] [almacén-de-objetos]
//
// Lo que no venga en la línea de comandos se lee de `.env` en la raíz del
// repositorio. El orden es ese —argumento, luego entorno, luego el valor por
// defecto— porque quien escribe un argumento lo escribió para esta corrida, y
// una configuración de archivo no puede pisarlo.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listen } from './server.ts';
import { modelPresence } from './model.ts';
import { transcriberDiagnosis } from './transcribe.ts';

/**
 * La configuración de esta instancia, si la hay.
 *
 * `.env` no se versiona: lleva los secretos de una instancia concreta. Lo que sí
 * se versiona es `.env.example`, que dice qué hay que llenar sin decir con qué.
 * Que falte no es un error: los valores por defecto bastan para correr Vera en
 * la máquina de quien la escribe.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const setting = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
};

const port = Number(process.argv[2] ?? setting('VERA_PORT') ?? 4173);
const databasePath = process.argv[3] ?? setting('VERA_DATABASE') ?? 'data/vera.sqlite';
// Loopback por defecto; poner '0.0.0.0' aquí es una decisión consciente, y hoy
// una que abre el grafo a quien alcance el puerto: las personas todavía no se
// autentican. Ver identity-access.allium.
const host = process.argv[4] ?? setting('VERA_HOST') ?? '127.0.0.1';
// Configurable para que una instancia de pruebas no escriba en el almacén real.
const objectsRoot = process.argv[5] ?? setting('VERA_OBJECTS') ?? 'objects';
const webRoot = setting('VERA_WEB_ROOT') ?? 'packages/web/dist';

const { vera } = listen({ port, databasePath, host, webRoot, objectsRoot });

console.log(`Vera escucha en http://localhost:${port}`);
console.log(`  base:     ${databasePath}`);
console.log(`  páginas:  ${vera.graph.pages().length}`);
console.log(`  bloques:  ${vera.graph.allBlocks().length}`);
console.log(`  secuencia:${vera.graph.log().lastSequence}`);

// Escuchar fuera de loopback sin que las personas se autentiquen entrega el
// grafo a cualquiera que alcance el puerto. Se dice al arrancar, cada vez.
if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
  console.log(`  aviso:    escuchando en ${host}, y las personas todavía no se autentican:`);
  console.log('            cualquiera que alcance este puerto escribe como el dueño');
}

// La voz depende de dos binarios ajenos: mejor saberlo ahora que al grabar.
const voz = await transcriberDiagnosis();
if (voz.ready) {
  console.log(`  voz:      ${voz.whisper}`);
} else {
  console.log('  voz:      no disponible');
  if (voz.ffmpeg === null) console.log('    falta ffmpeg (o apunta VERA_FFMPEG al binario)');
  if (voz.whisper === null) console.log('    falta whisper.cpp (o apunta VERA_WHISPER al binario)');
  if (voz.model === null) console.log('    falta el modelo (o apunta VERA_WHISPER_MODEL a uno)');
}

// El modelo con que se leen las páginas. Que falte no impide nada: procesar hace
// la parte de los enlaces igual y dice cuál no pudo hacer.
const lector = await modelPresence();
console.log(
  lector.ready
    ? `  lectura:  ${lector.model}`
    : '  lectura:  sin modelo local (procesar sólo resolverá enlaces)',
);
