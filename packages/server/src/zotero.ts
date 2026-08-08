// Hablar con Zotero.
//
// Es la primera conexión de Vera con un servicio de fuera, y por eso este
// archivo también es el molde: lo que sabe hacer es preguntar quién soy, buscar,
// y traer un ítem. Nada de escribir —@guarantee ZoteroRemainsBibliographicAuthority,
// de bibliographic-integration.allium: la bibliografía se gobierna en Zotero y
// Vera la agrega; ninguna función de aquí manda nada de vuelta.
//
// La clave no vive en este archivo ni en ninguna variable de entorno: la guarda
// la página de servicio, fuera del log, y llega como argumento. Ver
// specs/service-connections.allium y packages/store/src/secrets.ts.
//
// La API de Zotero es HTTP con una cabecera. Se usa `fetch` a secas: una
// biblioteca cliente para tres peticiones sería una dependencia que hay que
// mantener para no ganar nada.

const API = 'https://api.zotero.org';
const VERSION = '3';

/** Cuánto se espera a Zotero. Una búsqueda que no vuelve no puede colgar la escritura. */
const PATIENCE = 20_000;

export interface ZoteroIdentity {
  /** El identificador numérico de quien es dueño de la clave. */
  userId: number;
  username: string;
  /** Qué puede hacer esta clave, dicho por Zotero y no por nosotros. */
  access: { library: boolean; notes: boolean; write: boolean; groups: number };
}

export interface ZoteroItem {
  key: string;
  version: number;
  itemType: string;
  title: string;
  /** Los autores tal como Zotero los da, ya legibles. */
  creators: string[];
  date: string | null;
  publication: string | null;
  publisher: string | null;
  doi: string | null;
  isbn: string | null;
  url: string | null;
  /** El resumen, cuando lo hay. Es lo que hace útil una página bibliográfica. */
  abstract: string | null;
  /** Las etiquetas de Zotero, que son suyas y viajan como vinieron. */
  tags: string[];
}

export type ZoteroFailure = { error: string };

interface Creator {
  creatorType?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
}

/** Un autor dicho como se lee: «Apellido, Nombre», o el nombre entero si viene junto. */
function creatorName(creator: Creator): string {
  if (typeof creator.name === 'string' && creator.name.trim() !== '') return creator.name.trim();
  const last = (creator.lastName ?? '').trim();
  const first = (creator.firstName ?? '').trim();
  if (last === '') return first;
  return first === '' ? last : `${last}, ${first}`;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Lee un ítem tal como Zotero lo da y deja lo que a Vera le sirve. */
export function readItem(raw: Record<string, unknown>): ZoteroItem | null {
  const data = (raw['data'] ?? raw) as Record<string, unknown>;
  const key = textOrNull(data['key']);
  if (key === null) return null;
  const creators = Array.isArray(data['creators']) ? (data['creators'] as Creator[]) : [];
  const tags = Array.isArray(data['tags'])
    ? (data['tags'] as { tag?: string }[]).map((one) => one.tag ?? '').filter((one) => one !== '')
    : [];
  return {
    key,
    version: typeof data['version'] === 'number' ? data['version'] : 0,
    itemType: textOrNull(data['itemType']) ?? 'document',
    // Un ítem sin título existe —una nota, un adjunto suelto— y no puede quedar
    // sin nombre: sin esto acabaría siendo una página llamada «».
    title: textOrNull(data['title']) ?? textOrNull(data['note'])?.slice(0, 80) ?? `Ítem ${key}`,
    creators: creators.map(creatorName).filter((one) => one !== ''),
    date: textOrNull(data['date']),
    publication:
      textOrNull(data['publicationTitle']) ??
      textOrNull(data['bookTitle']) ??
      textOrNull(data['proceedingsTitle']),
    publisher: textOrNull(data['publisher']),
    doi: textOrNull(data['DOI']),
    isbn: textOrNull(data['ISBN']),
    url: textOrNull(data['url']),
    abstract: textOrNull(data['abstractNote']),
    tags,
  };
}

async function askZotero(
  path: string,
  key: string,
  query: Record<string, string> = {},
): Promise<{ body: unknown; total: number } | ZoteroFailure> {
  const url = new URL(`${API}${path}`);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);

  let answer: Response;
  try {
    answer = await fetch(url, {
      headers: {
        // La clave va en la cabecera y no en la dirección: una dirección se
        // guarda en registros, en historiales y en cualquier intermediario que
        // haya por el camino.
        'Zotero-API-Key': key,
        'Zotero-API-Version': VERSION,
      },
      signal: AbortSignal.timeout(PATIENCE),
    });
  } catch (error) {
    const why = error instanceof Error ? error.message : 'error desconocido';
    return { error: `no se pudo hablar con Zotero: ${why}` };
  }

  if (answer.status === 403) {
    return { error: 'Zotero rechazó la clave: no tiene permiso para esto' };
  }
  if (answer.status === 404) {
    return { error: 'Zotero no encontró eso' };
  }
  if (!answer.ok) {
    return { error: `Zotero respondió ${answer.status}` };
  }

  try {
    const body: unknown = await answer.json();
    const said = answer.headers.get('Total-Results');
    return { body, total: said === null ? 0 : Number(said) };
  } catch {
    return { error: 'Zotero contestó algo que no es JSON' };
  }
}

/**
 * ¿De quién es esta clave y qué puede hacer?
 *
 * Es la prueba de conexión: no trae nada del corpus de nadie y contesta lo justo
 * para que la página de servicio pueda decir «conectada como fulano». Que la
 * prueba sea esta petición y no una búsqueda vacía importa —una búsqueda que no
 * devuelve nada no distingue entre una clave mala y una biblioteca vacía.
 */
export async function whoami(key: string): Promise<ZoteroIdentity | ZoteroFailure> {
  const said = await askZotero('/keys/current', key);
  if ('error' in said) return said;
  const body = said.body as Record<string, unknown>;
  const userId = typeof body['userID'] === 'number' ? body['userID'] : null;
  if (userId === null) return { error: 'Zotero no dijo de quién es esta clave' };
  const access = (body['access'] ?? {}) as Record<string, unknown>;
  const user = (access['user'] ?? {}) as Record<string, unknown>;
  const groups = (access['groups'] ?? {}) as Record<string, unknown>;
  return {
    userId,
    username: textOrNull(body['username']) ?? String(userId),
    access: {
      library: user['library'] === true,
      notes: user['notes'] === true,
      write: user['write'] === true,
      groups: Object.keys(groups).length,
    },
  };
}

export interface ZoteroSearch {
  items: ZoteroItem[];
  /** Cuántos cumplen en total, que casi siempre son más de los que viajan. */
  total: number;
}

/**
 * Busca en la biblioteca, por lo que sea: autor, título, año.
 *
 * `qmode=titleCreatorYear` y no la búsqueda de todo el contenido: buscar dentro
 * del texto completo de los PDF devuelve el libro donde la palabra aparece una
 * vez de pasada, y lo que uno está haciendo al escribir `/zotero` es citar a
 * alguien que ya tiene en la cabeza.
 */
export async function search(
  key: string,
  library: string,
  text: string,
  limit = 20,
): Promise<ZoteroSearch | ZoteroFailure> {
  const said = await askZotero(`/${library}/items`, key, {
    q: text,
    qmode: 'titleCreatorYear',
    // Los adjuntos y las notas son de un ítem, no ítems que citar.
    itemType: '-attachment || note',
    sort: 'dateModified',
    limit: String(Math.max(1, Math.min(limit, 100))),
  });
  if ('error' in said) return said;
  const rows = Array.isArray(said.body) ? (said.body as Record<string, unknown>[]) : [];
  const items = rows.map(readItem).filter((one): one is ZoteroItem => one !== null);
  return { items, total: said.total === 0 ? items.length : said.total };
}

/** Un ítem concreto, entero. */
export async function item(
  key: string,
  library: string,
  itemKey: string,
): Promise<ZoteroItem | ZoteroFailure> {
  const said = await askZotero(`/${library}/items/${encodeURIComponent(itemKey)}`, key);
  if ('error' in said) return said;
  const read = readItem(said.body as Record<string, unknown>);
  return read ?? { error: 'Zotero contestó un ítem que no se puede leer' };
}

/**
 * Los hijos de un ítem: sus notas y sus anotaciones.
 *
 * Viajan aparte porque son otra cosa —lo que alguien escribió sobre la fuente,
 * no la fuente— y porque un ítem con doscientas anotaciones no puede hacer
 * esperar a quien sólo quería citarlo.
 */
export async function children(
  key: string,
  library: string,
  itemKey: string,
): Promise<{ notes: string[] } | ZoteroFailure> {
  const said = await askZotero(`/${library}/items/${encodeURIComponent(itemKey)}/children`, key, {
    itemType: 'note',
    limit: '50',
  });
  if ('error' in said) return said;
  const rows = Array.isArray(said.body) ? (said.body as Record<string, unknown>[]) : [];
  const notes = rows
    .map((row) => {
      const data = (row['data'] ?? {}) as Record<string, unknown>;
      return textOrNull(data['note']);
    })
    .filter((one): one is string => one !== null);
  return { notes };
}
