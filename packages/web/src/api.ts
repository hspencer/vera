// Cliente HTTP del servidor de Vera.
//
// Toda escritura pasa por submitOperation, igual que en el servidor y en el
// dominio: el cliente no tiene ninguna vía propia para cambiar el grafo.

import type { GraphData } from './graph/types.ts';
import type { Recording } from './voice.ts';

export interface PageSummary {
  id: string;
  title: string;
  visibility: 'private' | 'public';
  blockCount: number;
  linkCount: number;
}

export interface BlockView {
  stableId: string;
  parent: string | null;
  position: number;
  content: string;
}

/**
 * Una ruta del Markdown y el objeto al que resuelve. El bloque sigue diciendo
 * `../assets/foo.png`; la traducción ocurre al presentar, así que la fuente no
 * se toca y la proyección Markdown sigue siendo portable fuera de Vera.
 */
export interface AssetView {
  path: string;
  url: string;
  mediaType: string;
}

/** Una referencia `((stable_id))` ya resuelta al bloque que nombra. */
export interface BlockRefView {
  id: string;
  page: string;
  excerpt: string;
}

export interface PageView {
  id: string;
  title: string;
  visibility: 'private' | 'public';
  createdAt: number;
  originCreatedAt: number | null;
  lastEditedAt: number | null;
  properties: { key: string; value: string }[];
  /**
   * Lo que el corpus ya contesta a cada clave de esta página, por uso.
   *
   * Es lo que se ofrece en el desplegable. Vocabulario observado y no declarado:
   * la ontología que lo gobernaría todavía no existe, y hasta que exista lo que
   * el corpus dice es mejor guía que una lista inventada.
   */
  domains: Record<string, { value: string; uses: number }[]>;
  blocks: BlockView[];
  assets: AssetView[];
  blockRefs: BlockRefView[];
  /** Los bloques que este participante tiene plegados. No es contenido. */
  folded: string[];
  /** Los títulos nombrados desde esta página que todavía no tienen página. */
  pendingLinks?: string[];
  /** La denominación de origen: qué bloques vinieron de qué grabación. */
  spokenOrigins: { block: string; recording: string }[];
  /**
   * Lo hablado que tiene lugar en esta página: la grabación y el bloque que le
   * guarda el sitio mientras se recorre la cascada.
   *
   * @guarantee NothingSpokenIsStrandedFromTheWriting: viaja con la página para
   * que el audio se vea donde se habló.
   */
  recordings?: Recording[];
  /**
   * De qué mano salió el texto de cada bloque, indexado por su identidad.
   *
   * @invariant GeneratedContentIsAlwaysDistinguishable: viaja con la página, no
   * en una petición aparte, porque distinguir lo escrito de lo generado tiene
   * que costar lo mismo que leer.
   */
  authorship: Record<
    string,
    { participant: string; kind: 'human' | 'agent' | null; channel: string; writtenAt: number }
  >;
  backlinks: Backlink[];
  /** A quién nombra esta página: una fila por página nombrada, no por mención. */
  references: Reference[];
  /** Lo que esta página afirma sobre otras. */
  crossingsOut: CrossingRow[];
  /** Y lo que otras afirman sobre ella, leído desde este lado. */
  crossingsIn: CrossingRow[];
}

/**
 * Una relación explicada, lista para leerse en su columna.
 *
 * `reads` es el término tal como se lee desde esta página: el término en la
 * columna de salientes y su recíproco en la de entrantes. Lo que A afirma es que
 * contradice a B; lo que B tiene que leer es que es contradicha por A.
 */
export interface CrossingRow {
  /** El bloque que lleva lo dicho, y que es lo que se edita para cambiarla. */
  connective: string;
  /** Lo dicho. */
  said: string;
  /** El bloque desde el que se afirma. */
  fromBlock: string;
  fromPage: string;
  /** La página del otro extremo, nula mientras nadie la haya escrito. */
  toPage: string | null;
  targetTitle: string;
  /** Cómo se llama la otra página desde aquí. */
  title: string;
  sense: 'directed' | 'mutual';
  term: string | null;
  reads: string | null;
  /** El extracto del bloque desde el que se afirma: el sujeto de la afirmación. */
  says: string;
}

/** Una página que ésta nombra. `page` es nulo mientras nadie la haya escrito. */
export interface Reference {
  page: string | null;
  title: string;
  /** El bloque donde se la nombra por primera vez, que es donde se presenta. */
  block: string;
  excerpt: string;
}

export interface Backlink {
  page: string;
  block: string;
  /** Título de la página que refiere, para poder nombrarla sin otra petición. */
  title: string;
  /** Texto del bloque donde ocurre la referencia. */
  excerpt: string;
}

export interface Hit {
  page: string;
  block: string | null;
  field: string;
  excerpt: string;
  rank: number;
}

/** Una propiedad declarada, con qué clase de campo es. */
export interface PropertyDeclared {
  name: string;
  field: string | null;
  many: boolean;
  role: string | null;
  values: string[];
  says: string | null;
}

/** Una clase de cosa, con qué propiedades la constituyen. */
export interface ObjectDeclared {
  name: string;
  properties: string[];
  says: string | null;
}

export interface OntologyView {
  properties: PropertyDeclared[];
  objects: ObjectDeclared[];
  names: Record<string, string>;
  fields: string[];
  /** Las que el corpus usa sin haberlas declarado, con cuántas veces. */
  undeclared: { key: string; uses: number }[];
}

/** Lo que se sabe de una clave guardada sin enseñarla. */
export interface ServiceSecret {
  name: string;
  /** Los últimos caracteres, para reconocerla. Vacío si es demasiado corta. */
  tail: string;
  savedAt: number;
  lastUsedAt: number | null;
}

/** Una conexión con algo de fuera, gobernada por una página del corpus. */
export interface ServiceView {
  id: string;
  title: string;
  service: string;
  library: string | null;
  collections: string[];
  secrets: ServiceSecret[];
  /** Cuántas páginas del corpus vinieron de ahí. Se cuenta, no se guarda. */
  pages: number;
}

export interface ServiceCheck {
  page: string;
  service: string;
  library: string;
  declared: boolean;
  identity: {
    userId: number;
    username: string;
    access: { library: boolean; notes: boolean; write: boolean; groups: number };
  };
}

/** Un ítem bibliográfico tal como se ofrece para citarlo. */
export interface ServiceItem {
  key: string;
  version: number;
  itemType: string;
  title: string;
  creators: string[];
  date: string | null;
  publication: string | null;
  publisher: string | null;
  doi: string | null;
  isbn: string | null;
  url: string | null;
  abstract: string | null;
  tags: string[];
  /** Si ya está en el corpus, qué página es. Nulo si todavía no vino. */
  alreadyHere: { page: string; version: number } | null;
}

export interface ServiceSearch {
  page: string;
  library: string;
  total: number;
  items: ServiceItem[];
}

export interface BroughtItem {
  page: string;
  title: string;
  created: boolean;
  refreshed: boolean;
}

export type Change =
  | { kind: 'create_page'; title: string; visibility: 'private' | 'public' }
  | { kind: 'rename_page'; page: string; title: string }
  | { kind: 'set_page_visibility'; page: string; visibility: 'private' | 'public' }
  // Sólo se borra una página vacía. Vaciarla es una secuencia de `remove_block`,
  // cada uno ordenado y auditable por separado, y ese es el punto: borrar una
  // página no es un acto único que se traga cuanto hubiera dentro sin dejar
  // rastro de qué había.
  | { kind: 'remove_page'; page: string }
  | { kind: 'create_block'; page: string; parent: string | null; position: number; content: string }
  | { kind: 'edit_block'; block: string; content: string }
  // Indentar, desindentar y mudar a los hijos de un bloque que se fusiona son
  // todos el mismo cambio: el bloque pasa a colgar de otro padre, en un índice.
  | { kind: 'move_block'; block: string; page: string; parent: string | null; position: number }
  | { kind: 'remove_block'; block: string }
  // El front matter de una página son propiedades, y se editan como todo lo
  // demás: enviando una operación.
  | { kind: 'set_property'; page?: string; block?: string; propertyKey: string; propertyValue: string }
  | { kind: 'remove_property'; page?: string; block?: string; propertyKey: string };

/** Una página que cumple una pregunta, con lo que hace falta para leerla. */
export interface QueryHit {
  id: string;
  title: string;
  /** Lo que la página dice ser, para la columna de la tabla. Puede no decirlo. */
  type: string | null;
  /** De qué trata, ya partido: cada respuesta es una y lleva a su página. */
  topic: string[];
  /** Cuándo nació. */
  created: number;
  /** Cuándo se la tocó por última vez. */
  updated: number | null;
  /** Dónde lo dice, cuando la pregunta era por texto. */
  says: { block: string; excerpt: string } | null;
}

/** Por qué columna se está mirando una tabla, y en qué sentido. */
export interface QuerySort {
  by: 'title' | 'type' | 'topic' | 'created' | 'updated';
  desc: boolean;
}

export type QueryAnswer =
  | {
      view: 'list' | 'table';
      /** La pregunta tal como Vera la entendió, vuelta a escribir. */
      asked: string;
      /** Cómo llama este corpus a lo que las columnas enseñan. */
      names: { kind: string; topic: string };
      sort: QuerySort;
      count: number;
      pages: QueryHit[];
      /** Cuántas cumplen y no viajaron. Recortar en silencio sería mentir. */
      more: number;
    }
  | { error: string; at: number; near: string };

export type SubmitResult =
  | { status: 'applied'; sequence: number; subjectId: string }
  | { status: 'duplicate'; sequence: number; subjectId: string }
  | { status: 'rejected'; reason: string };

/**
 * Identificador de origen. Se genera aquí, en el dispositivo, porque es la
 * clave de idempotencia: reenviar la misma operación tras un corte de red no
 * puede aplicarla dos veces.
 */
function originId(): string {
  return `web:${crypto.randomUUID()}`;
}

async function json<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${response.status} en ${path}`);
  return (await response.json()) as T;
}

export const api = {
  health: () =>
    json<{
      graph: string;
      pages: number;
      blocks: number;
      lastSequence: number;
      /** Cómo llama este corpus a las propiedades que Vera necesita conocer. */
      names: {
        kind: string;
        topic: string;
        explains: string;
        term: string;
        sense: string;
        day: string;
        created: string;
        updated: string;
        visible: string;
      };
      /** Y de qué servidores acepta incrustaciones. */
      embedHosts?: string[];
    }>('/health'),

  pages: () => json<PageSummary[]>('/pages'),

  /*
   * Las conexiones con servicios de fuera.
   *
   * Cada una es una página especial del corpus; lo que viaja aquí es lo que de
   * ella se puede saber sin abrirla, incluido el estado de su clave —que está
   * guardada o no lo está, cuándo se usó, y sus últimos caracteres— pero nunca
   * la clave. Ver specs/service-connections.allium.
   */
  services: () => json<ServiceView[]>('/services'),

  /**
   * De qué está hecho este corpus: sus propiedades y sus objetos.
   *
   * Sale de las dos páginas que lo declaran y se pide cuando hace falta, no al
   * arrancar: se editan como cualquier otra página, y una copia guardada al
   * principio de la sesión diría lo de antes.
   */
  ontology: () => json<OntologyView>('/ontology'),

  /**
   * Qué se desharía, sin deshacerlo.
   *
   * Existe para poder decirlo antes: «deshacer» a secas obliga a mirar la
   * pantalla después para saber qué pasó.
   */
  whatUndo: (page: string) =>
    json<{ says?: string[]; nothing?: string; operations?: number }>(
      `/undo?pagina=${encodeURIComponent(page)}`,
    ),

  /**
   * Y deshacerlo, que son operaciones nuevas y no un borrado del registro.
   *
   * Sobre la página que se está mirando: deshacer es «vuelve esto al momento
   * anterior», y «esto» es lo que se tiene delante.
   */
  undo: async (
    page: string,
    direction: 'deshacer' | 'rehacer' = 'deshacer',
  ): Promise<{ done?: string[]; nothing?: string; error?: string }> => {
    const again = direction === 'rehacer' ? '&rehacer' : '';
    const answer = await fetch(`/undo?pagina=${encodeURIComponent(page)}${again}`, {
      method: 'POST',
    });
    return (await answer.json().catch(() => ({ error: 'no se pudo deshacer' }))) as {
      done?: string[];
      nothing?: string;
      error?: string;
    };
  },

  /**
   * Guarda la clave de un servicio.
   *
   * No pasa por `POST /operations` y es deliberado: no es una operación, no deja
   * revisión y no viaja al Markdown ni a la proyección. El log es append-only, y
   * una clave escrita en él no se puede desescribir nunca.
   */
  saveSecret: async (page: string, secret: string, name = 'clave'): Promise<ServiceSecret[] | { error: string }> => {
    const answer = await fetch(`/services/${encodeURIComponent(page)}/secret`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, secret }),
    });
    const said = (await answer.json().catch(() => ({}))) as { secrets?: ServiceSecret[]; error?: string };
    return answer.ok && said.secrets !== undefined ? said.secrets : { error: said.error ?? 'no se pudo guardar' };
  },

  /** La borra de verdad: aquí olvidar significa olvidar. */
  forgetSecret: async (page: string, name = 'clave'): Promise<boolean> => {
    const answer = await fetch(
      `/services/${encodeURIComponent(page)}/secret?name=${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    );
    return answer.ok;
  },

  checkService: async (page: string): Promise<ServiceCheck | { error: string }> => {
    const answer = await fetch(`/services/${encodeURIComponent(page)}/check`, { method: 'POST' });
    const said = (await answer.json().catch(() => ({}))) as ServiceCheck & { error?: string };
    return answer.ok ? said : { error: said.error ?? 'no se pudo probar la conexión' };
  },

  searchService: async (page: string, text: string): Promise<ServiceSearch | { error: string }> => {
    const answer = await fetch(
      `/services/${encodeURIComponent(page)}/search?q=${encodeURIComponent(text)}`,
    );
    const said = (await answer.json().catch(() => ({}))) as ServiceSearch & { error?: string };
    return answer.ok ? said : { error: said.error ?? 'no se pudo buscar' };
  },

  bringItem: async (page: string, item: string): Promise<BroughtItem | { error: string }> => {
    const answer = await fetch(`/services/${encodeURIComponent(page)}/bring`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item }),
    });
    const said = (await answer.json().catch(() => ({}))) as BroughtItem & { error?: string };
    return answer.ok ? said : { error: said.error ?? 'no se pudo traer' };
  },

  page: (id: string) => json<PageView>(`/pages/${encodeURIComponent(id)}`),

  /** Las páginas que gobiernan a Vera, por lo que declaran gobernar. */
  specialPages: () => json<{ id: string; title: string; kind: string }[]>('/special-pages'),

  search: (text: string) => json<Hit[]>(`/search?q=${encodeURIComponent(text)}`),

  /**
   * Le pregunta al grafo.
   *
   * La pregunta va en el cuerpo y no en la dirección: una dirección se guarda
   * —en el historial, en lo que se copia al compartir— y una consulta puede
   * nombrar a una persona o un asunto que no tiene por qué quedar escrito fuera
   * del corpus.
   */
  query: async (source: string, sort?: QuerySort): Promise<QueryAnswer> => {
    try {
      const response = await fetch('/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // El orden viaja aparte de la pregunta: es cómo se está mirando y no qué
        // se seleccionó, así que no se escribe en el bloque de nadie.
        body: JSON.stringify(sort === undefined ? { source } : { source, sort }),
      });
      return (await response.json()) as QueryAnswer;
    } catch {
      return { error: 'no se pudo preguntar: el servidor no contestó', at: 0, near: '' };
    }
  },

  /**
   * Trae un documento de fuera y devuelve la página que salió de él.
   *
   * Los bytes van en el cuerpo y el nombre en una cabecera, como en las
   * grabaciones: al lado de un binario no cabe nada más. El nombre se codifica
   * porque una cabecera HTTP no admite acentos, y los archivos de alguien que
   * escribe en español los llevan.
   */
  importDocument: async (
    file: File,
  ): Promise<
    { page: string; title: string; blocks: number; format: string; losses: string[] } | { error: string }
  > => {
    try {
      const response = await fetch('/import', {
        method: 'POST',
        headers: {
          'content-type': file.type || 'application/octet-stream',
          'x-filename': encodeURIComponent(file.name),
        },
        body: await file.arrayBuffer(),
      });
      const body = (await response.json()) as { error?: string } & Record<string, unknown>;
      if (!response.ok) return { error: body.error ?? `error ${response.status}` };
      return body as unknown as { page: string; title: string; blocks: number; format: string; losses: string[] };
    } catch {
      return { error: 'sin conexión con el servidor' };
    }
  },

  /**
   * Plegar no es un cambio del grafo, así que no pasa por submit: no genera
   * operación ni revisión, y por eso tiene su propia ruta.
   */
  fold: (block: string, folded: boolean) =>
    fetch('/folds', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ block, folded }),
    }),

  graph: (centre: string, depth: number) =>
    json<GraphData>(`/graph/${encodeURIComponent(centre)}?depth=${depth}`),

  async submit(change: Change): Promise<SubmitResult> {
    const response = await fetch('/operations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      /*
       * El cuerpo no dice quién escribe, y por eso funciona en cualquier
       * instancia.
       *
       * Lo decía —con un nombre fijo— y el servidor rechaza con 403 cuando el
       * cuerpo nombra a alguien que no es el dueño de ese grafo. En la instancia
       * donde ese nombre era el dueño no se notaba nunca; en cualquier otra,
       * toda escritura fallaba. Quién escribe lo decide el servidor a partir de
       * la credencial o, sin ella, del dueño del grafo: es lo que su propio
       * código ya declara, y afirmarlo aquí sólo podía contradecirlo.
       */
      body: JSON.stringify({
        originId: originId(),
        channel: 'typed_text',
        change,
      }),
    });

    /*
     * Un fallo del servidor también es una respuesta, y tiene que tener la misma
     * forma que un rechazo del dominio.
     *
     * Cuando persistir falla, el servidor contesta 500 con `{error, detail}` y
     * sin `status`. Quien llamaba leía `status`, veía `undefined`, lo tomaba por
     * «no rechazado» y seguía con un identificador vacío: el error que acababa
     * enseñándose era el de la operación siguiente, que no tenía nada que ver
     * con lo que había pasado. Una sola forma de respuesta lo evita en todos los
     * sitios a la vez, y no sólo donde alguien se acuerde de mirar.
     */
    const said = (await response.json()) as
      | SubmitResult
      | { error?: string; detail?: string };
    // Un rechazo del dominio ya viene con su motivo, y el motivo es lo único
    // que sirve: «una página ya lleva ese título» dice qué hacer, y «el servidor
    // contestó 422» no dice nada. Sólo se inventa una respuesta cuando el
    // servidor no mandó ninguna que se pueda leer.
    if ('status' in said) return said;
    const why = said.error ?? `el servidor contestó ${response.status}`;
    return { status: 'rejected', reason: said.detail === undefined ? why : `${why}: ${said.detail}` };
  },
};
