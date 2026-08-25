// Lo que la página de la puerta dicta para conectar una IA de otro equipo.
//
// La configuración no se escribe a mano en ninguna parte: se arma de los datos
// de este despliegue. Lo que se prueba aquí es que armarla no invente nada y que
// cambiar cómo arranca la puerta cambie las dos formas a la vez.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { remoteLaunch } from '../src/mcp-page.ts';
import type { MCPConnect } from '../src/api.ts';

const connect = (overrides: Partial<MCPConnect> = {}): MCPConnect => ({
  transport: 'stdio',
  command: '/usr/bin/node',
  args: ['--experimental-strip-types', '--no-warnings', '/home/quien/vera/packages/mcp/src/main.ts'],
  cwd: '/home/quien/vera',
  url: 'http://127.0.0.1:4173',
  reachableAt: 'https://vera.una-tailnet.ts.net',
  node: 'v24.18.0',
  login: 'quien@maquina',
  remoteCredential: null,
  present: true,
  ...overrides,
});

describe('la configuración para otro equipo', () => {
  it('lanza ssh contra este equipo, y no node', () => {
    // El proceso corre aquí: por eso no hay que instalar nada allá.
    const said = JSON.parse(remoteLaunch(connect(), 'claude-desktop'));
    assert.equal(said.mcpServers.vera.command, '/usr/bin/ssh');
    assert.ok(said.mcpServers.vera.args.includes('quien@maquina'));
  });

  it('la orden remota es la misma línea que se lanzaría aquí', () => {
    const one = connect();
    const said = JSON.parse(remoteLaunch(one, 'claude-desktop'));
    const order = said.mcpServers.vera.args.at(-1);
    assert.ok(order.endsWith(`'${one.command}' ${one.args.map((arg) => `'${arg}'`).join(' ')}`));
  });

  it('cambiar cómo arranca la puerta cambia también esto', () => {
    // Se arma de `command` y `args` en vez de repetir las banderas, para que no
    // haya un segundo sitio que se quede atrás.
    const otro = connect({ command: '/opt/node', args: ['--flamante', '/otra/main.ts'] });
    const order = JSON.parse(remoteLaunch(otro, 'x')).mcpServers.vera.args.at(-1);
    assert.ok(order.includes("'/opt/node' '--flamante' '/otra/main.ts'"));
  });

  it('lleva el nombre del cliente, que es lo único que se decide', () => {
    const order = JSON.parse(remoteLaunch(connect(), 'otro')).mcpServers.vera.args.at(-1);
    assert.ok(order.startsWith("VERA_CLIENT='otro' "));
  });

  it('dicta TOML nativo para Codex y evita confirmaciones redundantes', () => {
    const said = remoteLaunch(connect(), 'codex-andrei');
    assert.match(said, /^\[mcp_servers\.vera\]/);
    assert.match(said, /default_tools_approval_mode = "auto"/);
    assert.match(said, /required = true/);
  });

  it('abre en Alexei una credencial cifrada declarada, sin copiar el secreto', () => {
    const said = remoteLaunch(
      connect({
        remoteCredential: {
          client: 'codex-andrei',
          file: '/seguro/vera-codex.cred',
          name: 'vera-codex',
        },
      }),
      'codex-andrei',
    );
    assert.match(said, /VERA_SYSTEMD_CREDENTIAL_FILE='\/seguro\/vera-codex\.cred'/);
    assert.match(said, /VERA_SYSTEMD_CREDENTIAL_NAME='vera-codex'/);
    assert.ok(!said.includes('VERA_TOKEN='));
  });

  it('el nombre del cliente no puede convertirse en una orden del shell remoto', () => {
    const order = JSON.parse(remoteLaunch(connect(), "otro'; touch /tmp/nope; '"))
      .mcpServers.vera.args.at(-1);
    assert.match(order, /^VERA_CLIENT='otro'"'"'; touch \/tmp\/nope; '"'"'' /);
  });

  it('no lleva VERA_URL: el proceso nace al lado de Vera', () => {
    // Ponerla sería apuntar a la dirección de fuera desde dentro de casa, que es
    // el rodeo que esta forma existe para evitar.
    assert.ok(!remoteLaunch(connect(), 'x').includes('VERA_URL'));
  });

  it('falla en vez de esperar una contraseña que nadie puede escribir', () => {
    // Una app sin terminal no tiene dónde preguntarla: sin BatchMode, ssh se
    // queda colgado y el cliente informa de un servidor que no arrancó.
    const args = JSON.parse(remoteLaunch(connect(), 'x')).mcpServers.vera.args;
    assert.ok(args.includes('BatchMode=yes'));
  });
});
