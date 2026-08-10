// La página de la puerta MCP, leída como tabla.
//
// Una fila por conexión, y dos mitades en cada fila: a la izquierda lo que se
// decidió —cómo se llama, cómo se declara el cliente, con qué identidad debería
// entrar, qué se le concede—, a la derecha lo que pasó —con qué identidad entró
// de verdad, cuándo leyó por última vez, cuánto se llevó—.
//
// Las de la izquierda se corrigen pulsándolas y escriben en el bloque del que
// salieron. Las de la derecha no se tocan: salen del registro de exposición y no
// son decisiones, son hechos. Que estén en la misma fila es el motivo de que la
// página exista: hoy tres conexiones declaran un cliente y leen como el dueño,
// y eso sólo se ve poniendo las dos columnas juntas.
//
// Ver packages/server/src/mcp-page.ts y specs/mcp-server.allium.

import { api, type Change, type MCPConnection, type SeenClient } from './api.ts';
import { cellIn, editableCell, observedCell, rowIn, section } from './table.ts';

/** ¿Esta página gobierna la puerta MCP? Se responde con lo que la página trae. */
export function isMCPPage(properties: readonly { key: string; value: string }[]): boolean {
  return properties.some(
    (one) => one.key === 'special-kind' && one.value.trim().toLowerCase() === 'mcp',
  );
}

export type Write = (change: Change) => Promise<boolean>;

/** Una fecha dicha como se dice de viva voz. */
function when(stamp: number | null): string {
  if (stamp === null) return 'nunca';
  const minutes = Math.floor((Date.now() - stamp) / 60_000);
  if (minutes < 1) return 'ahora mismo';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  return new Date(stamp).toISOString().slice(0, 10);
}

/** Cuánta memoria se llevó, en unidades que una persona puede pesar. */
function weigh(characters: number): string {
  if (characters <= 0) return '—';
  if (characters < 10_000) return `${characters} caracteres`;
  const pages = characters / 2_000;
  return pages < 10
    ? `≈${pages.toFixed(1)} páginas de texto`
    : `≈${Math.round(pages)} páginas de texto`;
}

/**
 * Cómo se dice un cliente en una celda.
 *
 * Un `user-agent` entero son ciento veinte caracteres de los que sirven cuatro.
 * Se reduce a qué programa es y dónde corre, que es lo que uno necesita para
 * reconocer si esa lectura fue suya. Lo que no se reconozca viaja tal cual y
 * recortado: preferible una cadena fea que una conexión escondida detrás de un
 * «otro».
 */
export function shortClient(said: string | null): string {
  if (said === null || said.trim() === '') return 'no dijo nada';
  if (!said.startsWith('Mozilla/')) return said.length > 28 ? `${said.slice(0, 27)}…` : said;
  const where = /Macintosh/.test(said)
    ? 'Mac'
    : /Windows/.test(said)
      ? 'Windows'
      : /Android/.test(said)
        ? 'Android'
        : /iPhone|iPad/.test(said)
          ? 'iOS'
          : /Linux/.test(said)
            ? 'Linux'
            : '';
  const what = /Firefox/.test(said)
    ? 'Firefox'
    : /Edg\//.test(said)
      ? 'Edge'
      : /Chrome/.test(said)
        ? 'Chrome'
        : /Safari/.test(said)
          ? 'Safari'
          : 'navegador';
  return where === '' ? what : `${what} en ${where}`;
}

/** Cuántas veces ha leído y cuándo fue la última, en una celda. */
function reading(seen: SeenClient | null): string {
  if (seen === null) return '';
  const times = seen.deliveries === 1 ? '1 vez' : `${seen.deliveries} veces`;
  return `${times} · ${when(seen.lastAt)}`;
}

export async function renderMCP(
  write: Write,
): Promise<{ element: HTMLElement; declaring: Set<string> } | null> {
  const door = await api.mcp().catch(() => null);
  if (door === null || door.id === null) return null;

  const element = document.createElement('div');
  element.className = 'governing-tables';

  /** Escribir una propiedad del bloque que declara, o quitarla si queda vacía. */
  const put = (block: string, key: string) => async (next: string): Promise<boolean> =>
    write(
      next.trim() === ''
        ? { kind: 'remove_property', block, propertyKey: key }
        : { kind: 'set_property', block, propertyKey: key, propertyValue: next.trim() },
    );

  const declaring = new Set<string>();

  if (door.connections.length > 0) {
    const table = section(element, {
      note:
        'Lo de la izquierda se decide aquí y se corrige pulsándolo. Lo de la derecha ' +
        'sale del registro de exposición: es lo que pasó, y no se edita.',
      headers: ['Conexión', 'Se declara', 'Permiso', 'Debería ser', 'Entra como', 'Ha leído'],
    });

    for (const one of door.connections) {
      declaring.add(one.block);
      const row = rowIn(table, one.block);
      let at = 0;

      editableCell(
        cellIn(row, at++),
        { shows: one.name, label: 'el nombre de la conexión', placeholder: 'sin nombre' },
        (next) => write({ kind: 'edit_block', block: one.block, content: next.trim() }),
      );

      editableCell(
        cellIn(row, at++),
        { shows: one.client, label: 'cómo se declara el cliente', placeholder: 'sin declarar' },
        put(one.block, 'cliente'),
      );

      editableCell(
        cellIn(row, at++),
        { shows: one.permission ?? '', label: 'qué se le concede', placeholder: 'sin decir' },
        put(one.block, 'permiso'),
        [
          { value: 'leer', hint: 'lo que la puerta hace hoy' },
          { value: 'leer y proponer', hint: 'cuando exista el camino de propuestas' },
          { value: 'todo', hint: 'la excepción de la casa' },
        ],
      );

      /*
       * Se enseña el nombre y se corrige el identificador.
       *
       * «Herbert» es lo que se lee y `participant:herbert` es lo que se declara:
       * poner el identificador en la celda la haría ilegible, y poner el nombre
       * en la propiedad rompería la comparación con lo que el registro anota.
       */
      editableCell(
        cellIn(row, at++),
        {
          shows: one.participantName ?? '',
          edits: one.participant ?? '',
          label: 'con qué identidad debería entrar',
          placeholder: 'sin decir',
        },
        put(one.block, 'participante'),
      );

      // Lo observado. La marca de aviso aparece cuando la identidad con que
      // entra no es la que la fila declara: es el agujero, dicho en su sitio.
      const wrong =
        one.seen !== null && one.participant !== null && one.seen.participant !== one.participant;
      const asks = cellIn(row, at++);
      observedCell(
        asks,
        one.seen === null ? '' : wrong ? `${one.seen.name} ⚠` : one.seen.name,
        one.seen === null
          ? 'todavía no ha leído nada'
          : wrong
            ? `declarada como ${one.participant} y entra como ${one.seen.participant}: lo que lea queda anotado con ese nombre`
            : 'entra con la identidad declarada',
      );
      asks.classList.toggle('governing-warn', wrong);

      observedCell(
        cellIn(row, at++),
        reading(one.seen),
        one.seen === null ? 'todavía no ha leído nada' : `${weigh(one.seen.volume)} en total`,
      );
    }
  }

  /*
   * Y quien entró sin tener fila.
   *
   * Va aparte y debajo, no mezclado: son cosas de distinta clase —una es lo que
   * se decidió y la otra lo que apareció— y juntarlas haría que un cliente
   * cualquiera se leyera como una conexión aprobada. Aquí está para que se le
   * dé fila o se le cierre la puerta, que es la decisión que toca.
   */
  if (door.undeclared.length > 0) {
    const table = section(element, {
      title: 'Sin declarar',
      note:
        'Leyó sin tener fila arriba. El navegador con que estás leyendo esto sale aquí, ' +
        'y eso está bien: lo que hay que mirar es lo que no reconozcas.',
      headers: ['Se declaró como', 'Entró como', 'Ha leído', 'Se llevó'],
    });
    for (const one of [...door.undeclared].sort((a, b) => b.lastAt - a.lastAt)) {
      const row = rowIn(table);
      // El `user-agent` entero va en el título: recortado en la celda para poder
      // recorrer la tabla, entero al posarse encima para poder identificarlo.
      observedCell(cellIn(row, 0), shortClient(one.client), one.client ?? undefined);
      observedCell(cellIn(row, 1), one.name);
      observedCell(cellIn(row, 2), reading(one));
      observedCell(cellIn(row, 3), weigh(one.volume));
    }
  }

  if (declaring.size === 0 && door.undeclared.length === 0) return null;
  return { element, declaring };
}

export type { MCPConnection };
