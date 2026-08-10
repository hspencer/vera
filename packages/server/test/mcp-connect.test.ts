// Los datos de conexión de esta instancia, calculados y no escritos.
//
// El módulo existe para que la página no lleve una prosa con la ruta y el puerto
// dentro, que mentiría el día que se mueva cualquiera de los dos. Lo que se
// prueba aquí es que lo calculado salga de donde dice salir.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mcpConnect } from '../src/mcp-connect.ts';

/** Como si el módulo viviera en `<raíz>/packages/server/src`, que es donde vive. */
const here = '/casa/vera/packages/server/src';
const door = '/casa/vera/packages/mcp/src/main.ts';

const ask = (overrides: Partial<Parameters<typeof mcpConnect>[0]> = {}) =>
  mcpConnect({
    here,
    port: 4173,
    execPath: '/usr/bin/node',
    nodeVersion: 'v24.18.0',
    user: 'quien',
    host: 'maquina',
    exists: (path) => path === door,
    ...overrides,
  });

describe('los datos de conexión', () => {
  it('encuentra la puerta subiendo desde el módulo, y no desde el directorio de trabajo', () => {
    // Desde donde corre el proceso no se sabe dónde está el repositorio; desde
    // dónde vive este archivo, sí.
    const said = ask();
    assert.equal(said.cwd, '/casa/vera');
    assert.ok(said.args.includes(door));
    assert.equal(said.present, true);
  });

  it('dice que no está cuando no está, en vez de dictar una ruta que no existe', () => {
    assert.equal(ask({ exists: () => false }).present, false);
  });

  it('la dirección es la de casa, con el puerto que se está escuchando', () => {
    assert.equal(ask({ port: 8080 }).url, 'http://127.0.0.1:8080');
  });

  it('la dirección de fuera no se adivina', () => {
    // Vera escucha en loopback y quien la publica elige el frente: esa dirección
    // la sabe quien la configuró, no este proceso.
    assert.equal(ask().reachableAt, null);
    assert.equal(ask({ reachableAt: 'https://v.ts.net' }).reachableAt, 'https://v.ts.net');
  });

  it('con qué se entra desde otro equipo sale de quién corre y dónde', () => {
    assert.equal(ask().login, 'quien@maquina');
  });

  it('el comando es la ruta entera de node y no la palabra', () => {
    // Un cliente MCP no hereda el PATH de nadie: «node» a secas no se encuentra.
    assert.equal(ask().command, '/usr/bin/node');
  });

  it('las dos banderas van siempre: sin ellas el aviso se lee como un fallo', () => {
    const said = ask();
    assert.ok(said.args.includes('--experimental-strip-types'));
    assert.ok(said.args.includes('--no-warnings'));
  });
});
