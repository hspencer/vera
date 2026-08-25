// Con qué datos se enchufa una IA a esta instancia.
//
// Los formularios de «agregar servidor MCP» piden todos lo mismo con nombres
// distintos: tipo de transporte, comando, argumentos, variables de entorno y
// directorio de trabajo. Ninguno de esos valores es una decisión: son hechos de
// este despliegue —dónde está el binario de node, dónde está el repositorio, en
// qué puerto escucha Vera— y por eso se calculan y no se escriben.
//
// Escribirlos como prosa en la página sería tener dos sitios diciendo lo mismo,
// y el día que se mueva el repositorio o cambie el puerto la página mentiría con
// toda confianza. Es la misma razón por la que el estado de una clave de Zotero
// tampoco está escrito en ningún bloque.
//
// Ver specs/mcp-server.allium y packages/mcp/README.md.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface MCPConnect {
  /** El único que hay hoy. `stdio` no es una URL: es un proceso que el cliente lanza. */
  transport: 'stdio';
  /** La ruta absoluta del binario, no la palabra «node»: no depende del PATH del cliente. */
  command: string;
  args: string[];
  /** Desde dónde conviene lanzarlo. */
  cwd: string;
  /** Lo que el proceso tiene que saber para encontrar esta Vera. */
  url: string;
  /**
   * Y por dónde se la alcanza desde otro equipo, cuando alguien lo declaró.
   *
   * No se adivina. Vera escucha en loopback y quien la publica elige el frente
   * —`tailscale serve` en esta instalación—; esa dirección la sabe quien la
   * configuró, no el proceso que corre detrás. Sin declararla se dice que no se
   * sabe, que es mejor que ofrecer una dirección que puede no existir.
   */
  reachableAt: string | null;
  node: string;
  /**
   * Con qué se entra a este equipo desde otro para lanzar la puerta aquí.
   *
   * Un cliente MCP que corre en otro equipo tiene dos maneras de llegar: tener el
   * repositorio también allí y apuntar `VERA_URL` a la dirección alcanzable, o
   * lanzar el proceso aquí por una tubería, que es lo que hace `ssh`. La segunda
   * no obliga a mantener una segunda copia del código al día, y el proceso nace
   * al lado de Vera, así que el loopback por omisión ya es el correcto.
   *
   * Es un hecho de este despliegue como los demás —quién corre el servidor y cómo
   * se llama la máquina—, no una decisión que alguien deba escribir.
   */
  login: string;
  /** Credencial cifrada que el proceso remoto puede abrir aquí, sin copiarla al cliente. */
  remoteCredential: { client: string; file: string; name: string } | null;
  /**
   * Si la puerta está donde se dice que está.
   *
   * Un panel que dicta una ruta sin comprobarla manda a alguien a pelearse con
   * un formulario que nunca iba a funcionar.
   */
  present: boolean;
}

/**
 * Los datos de conexión de esta instancia.
 *
 * `here` es el directorio del módulo que llama —`packages/server/src`—, de donde
 * salen la raíz del repositorio y la puerta. Se pasa en vez de calcularse aquí
 * para que esto se pueda probar sin fingir un sistema de archivos.
 */
export function mcpConnect(options: {
  here: string;
  port: number;
  execPath: string;
  nodeVersion: string;
  /** Quién corre el servidor y en qué máquina, para el arranque desde otro equipo. */
  user: string;
  host: string;
  reachableAt?: string | null;
  remoteCredential?: { client: string; file: string; name: string } | null;
  exists?: (path: string) => boolean;
}): MCPConnect {
  const exists = options.exists ?? existsSync;
  const root = resolve(options.here, '..', '..', '..');
  const door = resolve(root, 'packages', 'mcp', 'src', 'main.ts');

  return {
    transport: 'stdio',
    command: options.execPath,
    /*
     * Las dos banderas no son decoración.
     *
     * La puerta es TypeScript y se ejecuta sin compilar; `--no-warnings` calla el
     * aviso experimental que node escribe en la salida de error, que algunos
     * clientes leen como que el servidor falló al arrancar.
     */
    args: ['--experimental-strip-types', '--no-warnings', door],
    cwd: root,
    url: `http://127.0.0.1:${options.port}`,
    reachableAt: options.reachableAt ?? null,
    node: options.nodeVersion,
    login: `${options.user}@${options.host}`,
    remoteCredential: options.remoteCredential ?? null,
    present: exists(door),
  };
}
