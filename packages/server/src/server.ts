// Servidor local de Vera.
//
// Es deliberadamente pequeño: sin framework, sobre el HTTP que trae Node. La
// única entrada de escritura es POST /operations, que valida contra @vera/core
// y sólo entonces persiste. No hay ningún camino que escriba en la base sin
// pasar por ahí.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

import {
  VeraGraph,
  answersIn,
  checkInvariants,
  FIELD_KINDS,
  SPECIAL_KIND,
  invert,
  nextToRedo,
  nextToUndo,
  inverseOf,
  namesFromRoles,
  readObjectDeclarations,
  readPropertyDeclarations,
  readPropertyNames,
  readQuery,
  titleKey,
  writeQuery,
  STARTER_RELATIONS,
  CHANGE_KINDS as CORE_CHANGE_KINDS,
  CONTRIBUTION_CHANNELS,
} from '@vera/core';
import type {
  Change,
  ContributionChannel,
  DeclaredBlock,
  Operation,
  OriginEvidence,
  ParticipantId,
} from '@vera/core';
import {
  createRecording,
  foldedOnPage,
  loadGraph,
  discardAudio,
  mediaByHash,
  mediaReferences,
  openStore,
  placeRecording,
  recordOperation,
  recordMedia,
  recordingById,
  recordings,
  recordingsInPage,
  removeRecording,
  saveParticipant,
  saveWorkspace,
  setFold,
  setTranscript,
  setSpokenOrigin,
  spokenOriginsOnPage,
  workspaceOf,
  type Store,
} from '@vera/store';
import { HASH, objectPath, putObject } from '@vera/store/objects';
import { forgetSecret, saveSecret, secretsOf, useSecret } from '@vera/store/secrets';
import { parseDocument } from '@vera/importer/document';
import {
  SCOPES,
  bearerOf,
  issueCredential,
  listCredentials,
  resolveSecret,
  revokeCredential,
  scopeRefusal,
  type Credential,
  type Scope,
} from './credentials.ts';
import type { Reading } from './model.ts';
import {
  ask,
  readPage,
  mergeReadings,
  modelPresence,
  MOST_PASSES,
  READABLE_CHARS,
  STARTER_TYPES,
} from './model.ts';
import { LOCAL_MODEL, LOCAL_MODEL_NAME, promptFor, readAnswer } from './answer.ts';
import { mentionsOf } from './mentions.ts';
import { paperHtml, toPdf } from './paper.ts';
import {
  BIBLIOGRAPHY_NAMES,
  blocksFor,
  propertiesFor,
  servicePages,
  titleFor,
} from './services.ts';
import { children, item, search, whoami, type ZoteroItem } from './zotero.ts';
import { readLinks } from './process.ts';
import { describeStructure, readingPasses, readStructure } from './structure.ts';
import { describePlan, planTabularity } from './tabularity.ts';
import { transcribeAudio } from './transcribe.ts';
import { renderPage } from '@vera/store/projection';

const CHANGE_KINDS = new Set<string>(CORE_CHANGE_KINDS);

/*
 * Cuántas páginas viajan en una respuesta.
 *
 * Una pregunta puede seleccionar dos mil, y ninguna pantalla las lee. Se manda un
 * tramo y se dice cuántas quedaron fuera: recortar en silencio convertiría «hay
 * doscientas» en «hay doscientas y son éstas».
 */
const MOST_ANSWERS = 200;

// Del dominio y no repetida aquí: una lista copiada es una lista que se queda
// atrás el día que el vocabulario crece, y el borde HTTP rechazaría por
// desconocido algo que @vera/core acepta.
const CHANNELS: ReadonlySet<string> = new Set<string>(CONTRIBUTION_CHANNELS);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  // Las fuentes las sirve Vera. Sin su tipo declarado viajan como binario
  // cualquiera, y aunque el navegador suele tragárselo por el `format()` del
  // @font-face, no hay razón para servir algo diciendo que no se sabe qué es.
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

/*
 * Cuánto puede guardarse cada archivo del cliente.
 *
 * Sin decirlo, el navegador lo decide por su cuenta con una heurística, y una
 * Vera instalada como aplicación puede quedarse corriendo una versión de hace
 * días sin ninguna forma de enterarse. Que el código nuevo llegue a quien ya la
 * tiene abierta no es una optimización: es la diferencia entre arreglar algo y
 * que el arreglo exista sólo en el repositorio.
 *
 * La regla es el prefijo, no la forma del nombre. Todo lo que vite compila cae
 * en `/build/` con una huella en el nombre: no puede cambiar de contenido sin
 * cambiar de ruta, así que guardarlo un año no puede servir nunca una versión
 * equivocada. Fuera de ahí —el index, el manifiesto, el propio service worker,
 * los iconos, las fuentes— los nombres se repiten entre versiones, y por eso
 * hay que volver a preguntar por ellos cada vez.
 */
const FINGERPRINTED = '/build/';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

export interface ServerOptions {
  databasePath: string;
  /** Raíz de archivos estáticos del cliente. */
  webRoot?: string;
  /** Almacén de objetos direccionado por hash, donde viven los binarios. */
  objectsRoot?: string;
  owner?: { id: ParticipantId; name: string };
}

export interface VeraServer {
  handle(request: IncomingMessage, response: ServerResponse): void;
  graph: VeraGraph;
  store: Store;
  close(): void;
}

interface SubmitBody {
  originId?: unknown;
  participant?: unknown;
  channel?: unknown;
  evidence?: unknown;
  change?: unknown;
}

/** Quién resultó ser quien escribe, y por qué canal se registra lo que escriba. */
interface Submitter {
  participant: ParticipantId;
  channel: ContributionChannel | null;
  credential: Credential | null;
}

/**
 * Decide quién está escribiendo.
 *
 * @invariant IdentityComesFromTheCredential. Con credencial, el participante
 * sale de ella; lo que el cuerpo diga sólo puede coincidir o ser rechazado.
 * Nunca se honra una identidad distinta de la que la credencial nombra.
 *
 * Sin credencial se sigue asumiendo el dueño, que es lo que v0 hace desde el
 * principio y lo que docs/architecture.md declara: la aplicación corre en
 * localhost con un único participante propietario y su identidad todavía no se
 * demuestra. Lo que cambia hoy es que esa vía ya no puede escribir como otro:
 * para firmar como Cotito hace falta la credencial de Cotito.
 */
function authorise(
  store: Store,
  graph: VeraGraph,
  header: string | undefined,
  claimed: unknown,
  changeKind: string,
): { error: string; status: number } | Submitter {
  const secret = bearerOf(header);

  if (secret === null) {
    const owner = graph.owner;
    if (owner === null) return { error: 'this graph has no owner', status: 500 };
    if (typeof claimed === 'string' && claimed !== '' && claimed !== owner) {
      return {
        status: 403,
        error:
          `sin credencial sólo se escribe como ${owner}. ` +
          `Para escribir como ${claimed} hace falta su credencial.`,
      };
    }
    return { participant: owner, channel: null, credential: null };
  }

  const resolved = resolveSecret(store, secret);
  if (!resolved.ok) return { error: resolved.detail, status: 401 };

  const credential = resolved.credential;
  if (typeof claimed === 'string' && claimed !== '' && claimed !== credential.participant) {
    return {
      status: 403,
      error: `la credencial escribe como ${credential.participant}, no como ${claimed}`,
    };
  }

  const refusal = scopeRefusal(credential, changeKind);
  if (refusal !== null) return { error: refusal, status: 403 };

  // @invariant ChannelFollowsParticipantKind: el canal se deriva de qué es quien
  // escribe, no se lee del cuerpo. Un agente no puede presentar su generación
  // como texto tecleado ni aunque lo pida.
  const kind = graph.participant(credential.participant)?.kind;
  return {
    participant: credential.participant,
    channel: kind === 'agent' ? 'agent_generation' : null,
    credential,
  };
}

const EXCERPT = 140;

/** Una línea legible del bloque, sin arrastrar transcripciones enteras. */
function excerpt(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length <= EXCERPT ? flat : `${flat.slice(0, EXCERPT).trimEnd()}…`;
}

/** Valida la forma del cuerpo antes de dejarlo entrar al dominio. */
function readOperation(body: SubmitBody): { error: string } | {
  originId: string;
  channel: ContributionChannel;
  evidence?: OriginEvidence;
  change: Change;
} {
  if (typeof body.originId !== 'string' || body.originId === '') {
    return { error: 'originId must be a non-empty string' };
  }
  // `participant` ya no se exige ni se cree: quien escribe lo decide authorise()
  // a partir de la credencial. Si el cuerpo lo trae, es una afirmación que se
  // comprueba, y afirmarlo distinto se rechaza allí (@invariant
  // IdentityComesFromTheCredential).
  if (body.participant !== undefined && typeof body.participant !== 'string') {
    return { error: 'participant, if given, must be a string' };
  }
  const channel = body.channel ?? 'typed_text';
  if (typeof channel !== 'string' || !CHANNELS.has(channel)) {
    return { error: `channel must be one of ${[...CHANNELS].join(', ')}` };
  }
  const change = body.change;
  if (typeof change !== 'object' || change === null) return { error: 'change must be an object' };
  const kind = (change as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || !CHANGE_KINDS.has(kind)) {
    return { error: `change.kind must be one of ${[...CHANGE_KINDS].join(', ')}` };
  }

  let evidence: OriginEvidence | undefined;
  if (body.evidence !== undefined && body.evidence !== null) {
    const raw = body.evidence as { reference?: unknown; capturedAt?: unknown };
    if (typeof raw.reference !== 'string' || typeof raw.capturedAt !== 'number') {
      return { error: 'evidence needs a reference string and a capturedAt number' };
    }
    evidence = { reference: raw.reference, capturedAt: raw.capturedAt };
  }

  return {
    originId: body.originId,
    channel: channel as ContributionChannel,
    change: change as Change,
    ...(evidence === undefined ? {} : { evidence }),
  };
}

export function createVeraServer(options: ServerOptions): VeraServer {
  const store = openStore({ path: options.databasePath, graphName: 'mind' });

  /*
   * El grafo en memoria se reconstruye del log al arrancar y responde las
   * lecturas; el disco conserva la verdad.
   *
   * Y por eso puede volver a reconstruirse: `let` y no `const` porque cuando
   * persistir falla hay que rehacerlo. Ver más abajo, donde se recoge ese fallo.
   */
  let graph = loadGraph(store, 'mind');

  /*
   * De quién es este grafo lo dice el grafo, no la configuración.
   *
   * Un grafo con historia ya tiene dueño: es quien firmó lo que hay dentro, y
   * eso no lo puede cambiar una variable de entorno sin volver falsa la
   * procedencia de todo lo escrito. La configuración sólo decide para un grafo
   * que todavía no tiene a nadie, que es el caso de quien acaba de instalar.
   *
   * Antes había un nombre escrito aquí, así que toda instalación nueva nacía
   * firmando como el dueño de la primera. Ya no hay ninguno: sin grafo previo y
   * sin `VERA_OWNER`, Vera se planta en vez de inventar una identidad, porque
   * escribir durante días como otra persona es un error que no avisa.
   */
  const established = graph.owner;
  let owner: { id: ParticipantId; name: string };
  if (established !== null) {
    owner = { id: established, name: graph.participant(established)?.name ?? established };
  } else if (options.owner !== undefined) {
    owner = options.owner;
    saveParticipant(store, { id: owner.id, name: owner.name, kind: 'human' });
    graph.addParticipant({ id: owner.id, name: owner.name, kind: 'human' });
    graph.admit(owner.id);
  } else {
    throw new Error(
      'este grafo todavía no tiene dueño y nadie dijo quién es: ' +
        'declara VERA_OWNER y VERA_OWNER_NAME en .env, o corre `npm run setup`',
    );
  }

  const webRoot = options.webRoot === undefined ? null : resolve(options.webRoot);
  const objectsRoot = options.objectsRoot === undefined ? null : resolve(options.objectsRoot);

  // Las rutas del grafo y su objeto. Se leen una vez: el mapa cambia cuando se
  // ingiere un medio, no cuando se lee una página.
  const media = mediaReferences(store);

  /*
   * El vocabulario de relaciones, leído de donde manda.
   *
   * Vive en la página de ontología, bajo un bloque que empiece por «Relaciones»,
   * con un término por hijo y su recíproco detrás de un separador:
   *
   *     Relaciones iniciales
   *       profundiza · es profundizada por
   *       se opone a · se opone a
   *
   * Sin esa página, o sin ese bloque, rige lo que Vera trae —@invariant
   * DefaultsLiveInTheCode—, que es un mínimo para que explicar una relación no
   * exija antes construir un vocabulario.
   */
  /*
   * La página que gobierna el vocabulario.
   *
   * Se encuentra por `special-kind`, que es la única palabra que Vera no puede
   * dejar que declare el corpus: es con la que se encuentra la página donde el
   * corpus declara las demás.
   */
  const ontologyPage = () => governing('ontology');

  /*
   * Los hijos del bloque de la ontología que empieza por esa palabra.
   *
   * Se le quitan las almohadillas antes de mirar: un apartado de una página se
   * escribe como encabezado, y exigir el texto desnudo hacía que declarar algo
   * bien escrito no sirviera de nada — sin decirlo, además.
   */
  const opens = (content: string, opening: RegExp): boolean =>
    opening.test(content.trim().replace(/^#{1,6}\s+/, ''));

  const declared = (opening: RegExp): string[] => {
    const ontology = ontologyPage();
    if (ontology === undefined) return [];
    const heading = graph.blocksOf(ontology.id).find((block) => opens(block.content, opening));
    if (heading === undefined) return [];
    return graph
      .blocksOf(ontology.id)
      .filter((block) => block.parent === heading.stableId)
      .map((block) => block.content.trim())
      .filter((line) => line !== '');
  };

  /*
   * Cómo llama este corpus a las propiedades que el dominio necesita conocer.
   *
   * Se lee al arrancar y cada vez que hace falta, porque la página que las
   * declara se edita como cualquier otra y cambiarla no debería pedir reiniciar.
   */
  /*
   * Las páginas que dicen de qué está hecho este corpus.
   *
   * Se buscan por lo que declaran gobernar y no por su título: una página se
   * puede llamar como quiera y seguir siendo la de las propiedades. Ver
   * specs/special-pages.allium.
   */
  const governing = (kind: string) =>
    graph
      .pages()
      .find((candidate) =>
        graph
          .propertiesOf(candidate.id)
          .some((property) => property.key === SPECIAL_KIND && property.value === kind),
      );

  /*
   * Los bloques de una página especial que declaran algo.
   *
   * Un bloque declara cuando lleva propiedades colgando; la prosa que lo rodea
   * —lo que alguien escribió para explicar de qué va la página, por qué se
   * decidió tal cosa— no lleva ninguna y por eso no se lee como una declaración.
   * Así la página no necesita apartados con nombres mágicos, y quien la escribe
   * puede ordenarla como quiera.
   */
  const declaredIn = (kind: string): DeclaredBlock[] => {
    const page = governing(kind);
    if (page === undefined) return [];
    return graph
      .blocksOf(page.id)
      .map((block) => ({
        content: block.content,
        properties: graph
          .propertiesOf(block.stableId)
          .map((one) => ({ key: one.key, value: one.value })),
      }))
      .filter((block) => block.content.trim() !== '' && block.properties.length > 0);
  };

  /** Cada propiedad de este corpus, con qué clase de campo es. */
  const declaredProperties = () => readPropertyDeclarations(declaredIn('properties'));

  /** Cada clase de cosa, con qué propiedades la constituyen. */
  const declaredObjects = () => readObjectDeclarations(declaredIn('objects'));

  /*
   * Cómo llama este corpus a las propiedades que el dominio necesita conocer.
   *
   * Primero la página de propiedades, donde cada una dice su papel pegado a sí
   * misma; y si no hay ninguna, la lista de la ontología, que es como se
   * declaraba antes. Un corpus que ya lo escribió así no tiene por qué enterarse
   * de que Vera cambió de sitio.
   */
  const propertyNames = () => {
    const roles = declaredProperties().filter((one) => one.role !== null);
    if (roles.length > 0) return namesFromRoles(roles);
    return readPropertyNames(declared(/^Nombres de propiedades/i));
  };

  /*
   * Qué páginas vinieron de fuera, y de qué ítem cada una.
   *
   * Se deriva del corpus y no de una tabla: la procedencia está escrita en la
   * página que vino —`fuente:: zotero`, `zotero:: ABCD1234`— y por eso sobrevive
   * a exportar el corpus, a reconstruirlo del log y a mirarlo con un editor de
   * texto. Una tabla aparte diciendo lo mismo es una tabla que un día dice otra
   * cosa.
   */
  const broughtFrom = (source: string): Map<string, { page: string; version: number }> => {
    const found = new Map<string, { page: string; version: number }>();
    for (const page of graph.pages()) {
      const properties = graph.propertiesOf(page.id);
      const from = properties.find((one) => one.key === BIBLIOGRAPHY_NAMES.source);
      if (from === undefined || from.value.trim().toLowerCase() !== source) continue;
      const key = properties.find((one) => one.key === BIBLIOGRAPHY_NAMES.key);
      if (key === undefined) continue;
      const version = properties.find((one) => one.key === BIBLIOGRAPHY_NAMES.version);
      found.set(key.value.trim(), {
        page: page.id,
        version: Number(version?.value ?? 0) || 0,
      });
    }
    return found;
  };

  /*
   * Traer un ítem: se vuelve una página, o refresca la que ya era.
   *
   * Escribe por la puerta de siempre —una operación por cambio, con su autor y
   * su secuencia— y por el canal `import`, que es lo que este acto es: material
   * que viene de fuera. Firma quien es dueño del grafo, porque es quien pidió
   * traerlo; el ítem no lo escribió nadie de aquí, y eso lo dice la procedencia
   * que la página lleva puesta.
   */
  const bringItem = (
    found: ZoteroItem,
    library: string,
    notes: readonly string[],
  ): { page: string; title: string; created: boolean; refreshed: boolean } => {
    const stamp = Date.now();
    let step = 0;
    const write = (change: Change): string | null => {
      const outcome = graph.submitOperation({
        originId: `zotero:${found.key}:${stamp}:${(step += 1)}`,
        participant: owner.id,
        channel: 'import',
        change,
      });
      if (outcome.status !== 'applied') return null;
      recordOperation(store, graph, outcome.operation);
      return outcome.operation.subjectId;
    };

    const kind = propertyNames().kind;
    const held = broughtFrom('zotero').get(found.key);
    const properties = propertiesFor(found, library, kind, 'Referencia');

    if (held !== undefined) {
      /*
       * Ya estaba. Se refresca sólo si Zotero tiene algo más nuevo.
       *
       * Y se refrescan las propiedades, no los bloques: lo que alguien escribió
       * en esa página después de traerla es suyo, y una sincronización que lo
       * pisara convertiría el corpus en una copia de Zotero. @guarantee
       * VeraAggregatesResearchContext.
       */
      if (found.version > held.version) {
        for (const property of properties) {
          write({
            kind: 'set_property',
            page: held.page,
            propertyKey: property.key,
            propertyValue: property.value,
          });
        }
      }
      return {
        page: held.page,
        title: graph.page(held.page)?.title ?? found.title,
        created: false,
        refreshed: found.version > held.version,
      };
    }

    const title = titleFor(found, (name) => graph.pageTitled(name) !== undefined);
    const made = write({ kind: 'create_page', title, visibility: 'private' });
    if (made === null) throw new Error('el dominio rechazó crear la página del ítem');
    for (const property of properties) {
      write({
        kind: 'set_property',
        page: made,
        propertyKey: property.key,
        propertyValue: property.value,
      });
    }
    const blocks = blocksFor(found, notes);
    blocks.forEach((content, index) => {
      write({ kind: 'create_block', page: made, parent: null, position: index, content });
    });
    return { page: made, title, created: true, refreshed: false };
  };

  /*
   * Los medios que una página nombra, con a qué objeto resuelve cada ruta.
   *
   * El bloque conserva su `../assets/foo.png` —lo que mantiene portable la
   * proyección Markdown— y aquí viaja a qué apunta. Lo necesitan la vista de la
   * página y el papel del que sale un PDF.
   */
  const assetsOf = (pageId: string): { path: string; url: string; mediaType: string }[] => {
    const text = graph
      .blocksOf(pageId)
      .map((block) => block.content)
      .join('\n');
    return media
      .filter((entry) => text.includes(entry.path))
      .map((entry) => ({ path: entry.path, url: `/media/${entry.hash}`, mediaType: entry.mediaType }));
  };

  /*
   * De qué servidores acepta este corpus una incrustación.
   *
   * Ninguno por omisión: que algo de fuera corra dentro de una página propia no
   * puede decidirlo quien pegó la dirección —una dirección se copia sin mirar—,
   * así que lo decide el corpus, en la página que ya gobierna el resto de su
   * vocabulario. Ver specs/executable-content-sandbox.allium.
   */
  const embedHosts = (): string[] =>
    declared(/^Incrustaciones/i)
      .map((line) => line.replace(/^[-*·]\s*/, '').trim())
      // Un renglón puede llevar una explicación detrás del servidor; lo que vale
      // es la primera palabra, que es la que nombra a quien aloja.
      .map((line) => (line.split(/[\s—·]/)[0] ?? '').trim().toLowerCase())
      // Y sólo cuenta si tiene forma de servidor, para que el apartado pueda
      // llevar prosa entre los renglones sin que una frase acabe leyéndose como
      // un permiso.
      .filter((host) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host));
  graph.namesProperties(propertyNames());

  const relationVocabulary = (): { name: string; inverse: string }[] => {
    const ontology = ontologyPage();
    if (ontology === undefined) return STARTER_RELATIONS;

    const heading = graph
      .blocksOf(ontology.id)
      .find((block) => opens(block.content, /^Relaciones/i));
    if (heading === undefined) return STARTER_RELATIONS;

    const written = graph
      .blocksOf(ontology.id)
      .filter((block) => block.parent === heading.stableId)
      .map((block) => block.content.split(/\s+[·/|]\s+/).map((one) => one.trim()))
      .filter((pair) => pair[0] !== undefined && pair[0] !== '')
      // Un término sin recíproco escrito es su propio recíproco: se lee igual
      // desde los dos lados, que es lo que un simétrico hace.
      .map((pair) => ({ name: pair[0] as string, inverse: pair[1] ?? (pair[0] as string) }));

    return written.length > 0 ? written : STARTER_RELATIONS;
  };

  const send = (response: ServerResponse, status: number, payload: unknown): void => {
    const body = JSON.stringify(payload);
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
    });
    response.end(body);
  };

  const serveStatic = (response: ServerResponse, pathname: string): boolean => {
    if (webRoot === null) return false;
    const wanted = pathname === '/' ? '/index.html' : pathname;
    // normalize + prefijo: sin esto, `..` en la ruta saldría del directorio.
    const target = join(webRoot, normalize(wanted));
    if (!target.startsWith(webRoot) || !existsSync(target) || !statSync(target).isFile()) {
      return false;
    }
    response.writeHead(200, {
      'content-type': MIME[extname(target)] ?? 'application/octet-stream',
      'cache-control': wanted.startsWith(FINGERPRINTED) ? IMMUTABLE : REVALIDATE,
    });
    createReadStream(target).pipe(response);
    return true;
  };

  const handle = (request: IncomingMessage, response: ServerResponse): void => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (request.method === 'POST' && path === '/operations') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let body: SubmitBody;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as SubmitBody;
        } catch {
          send(response, 400, { error: 'the body must be JSON' });
          return;
        }

        const input = readOperation(body);
        if ('error' in input) {
          send(response, 400, input);
          return;
        }

        // Quién escribe se decide aquí y no se lee del cuerpo. Antes de esto, el
        // cuerpo declaraba su propio participante: cualquiera que alcanzara el
        // puerto podía firmar como Herbert o como Cotito.
        const who = authorise(
          store,
          graph,
          request.headers.authorization,
          body.participant,
          input.change.kind,
        );
        if ('error' in who) {
          send(response, who.status, { status: 'rejected', reason: who.error });
          return;
        }

        const outcome = graph.submitOperation({
          ...input,
          participant: who.participant,
          ...(who.channel === null ? {} : { channel: who.channel }),
        });
        if (outcome.status === 'rejected') {
          send(response, 422, { status: 'rejected', reason: outcome.reason });
          return;
        }
        if (outcome.status === 'duplicate') {
          // Reenviar no aplica dos veces: se devuelve lo que ya había.
          send(response, 200, {
            status: 'duplicate',
            sequence: outcome.operation.sequence,
            subjectId: outcome.operation.subjectId,
          });
          return;
        }

        // Persistir puede fallar por algo que el dominio no vio venir. La
        // transacción revierte sola, pero sin este intento la excepción subía
        // hasta el proceso y se llevaba el servidor por delante: una operación
        // que no se puede guardar tiene que devolver un error, no un reinicio.
        try {
          recordOperation(store, graph, outcome.operation);
        } catch (error) {
          /*
           * La memoria vuelve a ser la del disco.
           *
           * El dominio ya había aplicado el cambio cuando la escritura falló, y
           * la transacción sólo revierte el disco: sin esto quedaba un bloque
           * que existía en memoria y en ninguna parte más. Se dibujaba como
           * cualquier otro, todo lo que colgara de él fallaba con un error que
           * hablaba de otra cosa, y al reiniciar desaparecía sin que nadie
           * hubiera borrado nada.
           *
           * Reconstruir del log cuesta unos segundos y ocurre casi nunca. La
           * alternativa —seguir sirviendo un grafo que no es el que está
           * guardado— cuesta que ya no se sepa cuál de los dos es Vera.
           */
          graph = loadGraph(store, 'mind');
          send(response, 500, {
            error: 'no se pudo persistir la operación',
            detail: error instanceof Error ? error.message : String(error),
          });
          return;
        }

        send(response, 201, {
          status: 'applied',
          sequence: outcome.operation.sequence,
          subjectId: outcome.subjectId,
        });
      });
      return;
    }

    // -----------------------------------------------------------------------
    // Agentes y credenciales (agent-participation.allium)
    // -----------------------------------------------------------------------
    //
    // Administrar credenciales es cosa del dueño: surface CredentialAdministration.
    // Mientras la identidad humana no se demuestre, «el dueño» es quien llega sin
    // credencial, que es la misma asunción con la que v0 lleva funcionando. Lo
    // que no puede pasar —y ya no pasa— es que un portador de credencial se
    // emita otra: @invariant SovereignOwnerCredentials.

    const ownerOnly = (): { error: string } | null =>
      bearerOf(request.headers.authorization) === null
        ? null
        : { error: 'sólo el dueño administra credenciales, y no lo hace con una credencial' };

    /** Quién dice ser quien llama, para que un agente pueda comprobarlo. */
    if (request.method === 'GET' && path === '/agents/whoami') {
      const secret = bearerOf(request.headers.authorization);
      if (secret === null) {
        send(response, 200, { participant: graph.owner, kind: 'human', scopes: null });
        return;
      }
      const resolved = resolveSecret(store, secret);
      if (!resolved.ok) {
        send(response, 401, { error: resolved.detail, reason: resolved.reason });
        return;
      }
      send(response, 200, {
        participant: resolved.credential.participant,
        kind: graph.participant(resolved.credential.participant)?.kind ?? null,
        scopes: resolved.credential.scopes,
        label: resolved.credential.label,
      });
      return;
    }

    /** Admitir un agente en el grafo. rule OwnerInvitesParticipant. */
    if (request.method === 'POST' && path === '/agents') {
      const blocked = ownerOnly();
      if (blocked !== null) {
        send(response, 403, blocked);
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let body: { id?: unknown; name?: unknown };
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
        } catch {
          send(response, 400, { error: 'the body must be JSON' });
          return;
        }
        const id = typeof body.id === 'string' ? body.id.trim() : '';
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (id === '' || name === '') {
          send(response, 400, { error: 'un agente necesita id y name' });
          return;
        }
        if (graph.participant(id) !== undefined) {
          send(response, 409, { error: `${id} ya participa en este grafo` });
          return;
        }
        try {
          saveParticipant(store, { id, name, kind: 'agent' });
          graph.addParticipant({ id, name, kind: 'agent' });
          graph.admit(id);
        } catch (error) {
          send(response, 500, {
            error: 'no se pudo admitir el agente',
            detail: error instanceof Error ? error.message : String(error),
          });
          return;
        }
        send(response, 201, { id, name, kind: 'agent', status: 'active' });
      });
      return;
    }

    if (request.method === 'GET' && path === '/agents/credentials') {
      const blocked = ownerOnly();
      if (blocked !== null) {
        send(response, 403, blocked);
        return;
      }
      // @guarantee TheSecretIsShownOnce: aquí nunca hay secretos que mostrar.
      send(response, 200, listCredentials(store));
      return;
    }

    if (request.method === 'POST' && path === '/agents/credentials') {
      const blocked = ownerOnly();
      if (blocked !== null) {
        send(response, 403, blocked);
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let body: { participant?: unknown; scopes?: unknown; label?: unknown; expiresAt?: unknown };
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
        } catch {
          send(response, 400, { error: 'the body must be JSON' });
          return;
        }

        const participant = typeof body.participant === 'string' ? body.participant : '';
        const held = graph.participant(participant);
        if (held === undefined) {
          send(response, 404, { error: `no existe el participante ${participant}` });
          return;
        }
        if (held.kind !== 'agent') {
          send(response, 400, {
            error: 'las credenciales son para agentes; una persona no se autentica con un token',
          });
          return;
        }

        const asked = Array.isArray(body.scopes) ? body.scopes : [];
        const scopes = asked.filter((s): s is Scope => SCOPES.includes(s as Scope));
        if (scopes.length !== asked.length || scopes.length === 0) {
          send(response, 400, { error: `scopes debe ser un subconjunto de ${SCOPES.join(', ')}` });
          return;
        }

        const owner = graph.owner;
        if (owner === null) {
          send(response, 500, { error: 'this graph has no owner' });
          return;
        }

        try {
          const issued = issueCredential(store, {
            participant,
            scopes,
            label: typeof body.label === 'string' && body.label !== '' ? body.label : participant,
            issuedBy: owner,
            expiresAt: typeof body.expiresAt === 'number' ? body.expiresAt : null,
          });
          // La única vez que el secreto viaja. No se vuelve a poder leer.
          send(response, 201, { ...issued.credential, secret: issued.secret });
        } catch (error) {
          send(response, 500, {
            error: 'no se pudo emitir la credencial',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      });
      return;
    }

    if (request.method === 'POST' && /^\/agents\/credentials\/[^/]+\/revoke$/.test(path)) {
      const blocked = ownerOnly();
      if (blocked !== null) {
        send(response, 403, blocked);
        return;
      }
      const id = decodeURIComponent(path.split('/')[3] ?? '');
      const revoked = revokeCredential(store, id);
      if (revoked === null) {
        send(response, 404, { error: `no existe la credencial ${id}` });
        return;
      }
      send(response, 200, revoked);
      return;
    }

    // -----------------------------------------------------------------------
    // La cascada de validación desde la voz
    // -----------------------------------------------------------------------
    //
    // Tres cosas y nada más: grabar, transcribir —cuantas veces se quiera— y
    // borrar el audio. No hay estado que avanzar ni paso que completar; lo demás
    // es la edición ordinaria de un bloque ordinario.

    if (request.method === 'POST' && path === '/recordings') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const audio = Buffer.concat(chunks);
        if (audio.byteLength === 0) {
          send(response, 400, { error: 'no llegó audio' });
          return;
        }
        if (objectsRoot === null) {
          send(response, 500, { error: 'esta instancia no tiene almacén de objetos' });
          return;
        }

        const mediaType = String(request.headers['content-type'] ?? 'audio/webm').split(';')[0] ?? 'audio/webm';
        const duration = Number(request.headers['x-duration-ms'] ?? '');
        // El bloque donde se estaba escribiendo cuando se habló, si se habló
        // dentro de un documento. Va en una cabecera porque el cuerpo son los
        // bytes del audio y no cabe nada más.
        const inBlock = String(request.headers['x-in-block'] ?? '').trim();

        // El audio entra al mismo almacén direccionado por contenido que todo
        // lo demás: grabar dos veces lo mismo no lo guarda dos veces.
        const stored = putObject(objectsRoot, audio);
        const at = Date.now();
        recordMedia(store, {
          path: `recording/${stored.hash}`,
          hash: stored.hash,
          mediaType,
          byteSize: stored.byteSize,
          at,
        });

        // Quien habla y cuándo. Sin autenticación se asume el propietario, y la
        // referencia lo dice en vez de fingir que está probado.
        const recording = createRecording(store, {
          audioHash: stored.hash,
          mediaType,
          durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
          evidence: {
            reference: `speaker:${owner.id} (asumido, sin autenticación)`,
            capturedAt: at,
          },
          capturedBy: owner.id,
          placedInBlock: inBlock === '' ? null : inBlock,
        });

        if ('error' in recording) {
          send(response, 422, recording);
          return;
        }

        send(response, 201, recording);
      });
      return;
    }

    /*
     * Importar un documento: entra un archivo y sale una página.
     *
     * Ver specs/document-import.allium. El cuerpo son los bytes del archivo y el
     * nombre viaja en una cabecera, igual que en `/recordings`: no cabe nada más
     * al lado de un binario.
     *
     * Se lee entero antes de escribir nada. Si el archivo no se puede leer, el
     * grafo queda exactamente como estaba —@invariant NoPageSurvivesARefusal—, en
     * vez de dejar una página vacía con el nombre del archivo que alguien tenga
     * que ir a borrar después.
     */
    if (request.method === 'POST' && path === '/import') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const bytes = Buffer.concat(chunks);
        if (bytes.byteLength === 0) {
          send(response, 400, { error: 'no llegó ningún archivo' });
          return;
        }

        const filename = decodeURIComponent(String(request.headers['x-filename'] ?? '')).trim();
        if (filename === '') {
          send(response, 400, { error: 'el archivo tiene que venir con su nombre' });
          return;
        }
        const mediaType = String(request.headers['content-type'] ?? '').split(';')[0] ?? '';

        const parsed = parseDocument(bytes, filename, mediaType);
        if ('error' in parsed) {
          send(response, 422, parsed);
          return;
        }

        /*
         * El título sale del documento, y si no, de su nombre.
         *
         * @invariant ImportNeverMergesIntoAnExistingPage: cuando el título ya
         * está tomado, la importación nace aparte y con un título que la
         * distingue. Escribir dentro de una página que alguien ya tenía es una
         * pérdida que no se deshace mirando el registro.
         */
        const wanted = parsed.title ?? filename.replace(/\.[^.]+$/, '');
        let title = wanted;
        for (let attempt = 2; graph.pageTitled(title) !== undefined; attempt += 1) {
          title = `${wanted} (${attempt})`;
        }

        const write = (change: Change): string | { error: string } => {
          const outcome = graph.submitOperation({
            originId: `import:${Date.now()}:${made}`,
            participant: owner.id,
            // No lo escribió quien pulsó el botón y no lo escribió la máquina: lo
            // trajo. @invariant EverythingArrivesAsImport.
            channel: 'import',
            change,
          });
          if (outcome.status === 'rejected') return { error: outcome.reason };
          // Un duplicado no se vuelve a persistir: la operación ya está en el
          // registro y su sujeto es el mismo.
          if (outcome.status === 'applied') recordOperation(store, graph, outcome.operation);
          made += 1;
          return outcome.operation.subjectId;
        };

        let made = 0;
        const page = write({ kind: 'create_page', title, visibility: 'private' });
        if (typeof page !== 'string') {
          send(response, 422, page);
          return;
        }

        /*
         * De profundidades a padres.
         *
         * El padre de un trozo es el último trozo de profundidad menor que vino
         * antes que él. `open` guarda, para cada profundidad, cuál es ese bloque;
         * un trozo más somero borra lo que colgaba de él, porque lo que venga
         * después ya no es hijo de aquello.
         */
        const open = new Map<number, string>();
        let written = 0;
        for (const piece of parsed.pieces) {
          const depth = Math.max(0, piece.depth);
          let parent: string | null = null;
          for (let above = depth - 1; above >= 0; above -= 1) {
            const found = open.get(above);
            if (found !== undefined) {
              parent = found;
              break;
            }
          }
          const block = write({
            kind: 'create_block',
            page,
            parent,
            position: Number.MAX_SAFE_INTEGER,
            content: piece.content,
          });
          if (typeof block !== 'string') continue;
          open.set(depth, block);
          for (const level of [...open.keys()]) if (level > depth) open.delete(level);
          written += 1;
        }

        send(response, 201, {
          page,
          title,
          blocks: written,
          format: parsed.format,
          losses: parsed.losses,
        });
      });
      return;
    }

    /*
     * Transcribir escribe el texto del bloque.
     *
     * No deja una propuesta en un cajón que alguien tenga que aceptar: deja el
     * texto donde el texto va, por una operación ordinaria y firmada como lo que
     * es. Canal `authenticated_voice` con la evidencia de la grabación, que es lo
     * que el registro guardará de por vida sobre este texto.
     *
     * Volver a transcribir es esta misma ruta otra vez: reemplaza el texto y no
     * toca el audio.
     */
    if (request.method === 'POST' && /^\/recordings\/[^/]+\/transcribe$/.test(path)) {
      const id = decodeURIComponent(path.split('/')[2] ?? '');
      const held = recordingById(store, id);
      if (held === null) {
        send(response, 404, { error: 'no such recording' });
        return;
      }
      if (held.audioHash === null || objectsRoot === null) {
        send(response, 422, { error: 'esta grabación ya no tiene audio que transcribir' });
        return;
      }
      if (held.placedInBlock === null) {
        send(response, 422, { error: 'esta grabación no tiene bloque donde escribir' });
        return;
      }
      const block = held.placedInBlock;

      const audio = readFileSync(objectPath(objectsRoot, held.audioHash));
      void transcribeAudio(audio).then((outcome) => {
        if ('error' in outcome) {
          send(response, 502, outcome);
          return;
        }
        try {
          const written = graph.submitOperation({
            // Cada transcripción es una operación distinta: volver a transcribir
            // no puede confundirse con un reenvío de la anterior.
            originId: `voice:${id}:${Date.now()}`,
            participant: owner.id,
            channel: 'authenticated_voice',
            evidence: held.evidence,
            change: { kind: 'edit_block', block, content: outcome.text },
          });
          if (written.status !== 'applied') {
            send(response, 422, { error: `no se pudo escribir la transcripción: ${written.status}` });
            return;
          }
          recordOperation(store, graph, written.operation);
          setSpokenOrigin(store, block, id);
          const kept = setTranscript(store, id, outcome.text);
          send(response, 200, { recording: kept, block, text: outcome.text });
        } catch (error) {
          send(response, 500, {
            error: 'no se pudo escribir la transcripción',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      });
      return;
    }

    // Borrar el audio. En cualquier momento, transcrito o no, y sólo cuando se
    // pide exactamente eso. Exigir haber recorrido una cascada entera hacía a
    // Vera dueña de una grabación que no es suya.
    if (request.method === 'DELETE' && /^\/recordings\/[^/]+\/audio$/.test(path)) {
      const id = decodeURIComponent(path.split('/')[2] ?? '');
      const outcome = discardAudio(store, id);
      send(response, 'error' in outcome ? 422 : 200, outcome);
      return;
    }

    /*
     * Quitar la grabación entera, y no sólo su audio.
     *
     * Faltaba. `DELETE …/audio` suelta los bytes y deja la fila, y no había
     * ninguna ruta que borrara una grabación: una que perdiera su bloque quedaba
     * en la lista de voz sin lugar para siempre, porque nada podía sacarla de
     * ahí. Desde ahora el bloque se lleva la suya al morir, y esto queda para lo
     * que haya que barrer de antes.
     */
    if (request.method === 'DELETE' && /^\/recordings\/[^/]+$/.test(path)) {
      const id = decodeURIComponent(path.split('/')[2] ?? '');
      const outcome = removeRecording(store, id);
      send(response, 'error' in outcome ? 404 : 200, outcome);
      return;
    }

    // Dónde queda una grabación en la escritura. Se puede dar o quitar mientras
    // no se haya asentado; después el lugar es el de su contenido.
    if (request.method === 'POST' && /^\/recordings\/[^/]+\/place$/.test(path)) {
      const id = decodeURIComponent(path.split('/')[2] ?? '');
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let body: { block?: unknown } = {};
        try {
          if (chunks.length > 0) body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          send(response, 400, { error: 'the body must be JSON' });
          return;
        }
        const block = typeof body.block === 'string' && body.block !== '' ? body.block : null;
        const outcome = placeRecording(store, id, block);
        send(response, 'error' in outcome ? 422 : 200, outcome);
      });
      return;
    }

    // La presentación recordada de quien pregunta.
    //
    // @guarantee RememberedSessionPresentation: va con el participante y no con
    // el navegador, para que ajustar el sistema de diseño en una máquina no haya
    // que repetirlo en la siguiente.
    // Procesar una página: leerla y decir qué se ve en ella.
    //
    // Deliberado y sobre una página concreta, nunca de oficio. Salen
    // proposiciones y ninguna decisión: no escribe contenido, no cambia una
    // propiedad y no asienta un tipo.
    if (request.method === 'POST' && /^\/pages\/[^/]+\/process$/.test(path)) {
      const id = decodeURIComponent(path.split('/')[2] ?? '');
      const page = graph.page(id) ?? graph.pageTitled(id);
      if (page === undefined) {
        send(response, 404, { error: 'no such page' });
        return;
      }

      const text = graph
        .blocksOf(page.id)
        .map((block) => block.content)
        .join('\n');

      // El vocabulario sale de la página especial de ontología si existe, y de
      // los valores por defecto si no. @invariant DefaultsLiveInTheCode.
      const ontology = graph
        .pages()
        .find((candidate) =>
          graph
            .propertiesOf(candidate.id)
            .some((property) => property.key === 'special-kind' && property.value === 'ontology'),
        );
      const vocabulary =
        ontology === undefined
          ? STARTER_TYPES
          : (() => {
              // Los tipos son los hijos del bloque que los encabeza. Se leen del
              // texto porque la página es la fuente: si dice otra cosa mañana,
              // mañana rige otra cosa.
              const heading = graph
                .blocksOf(ontology.id)
                .find((block) => opens(block.content, /^Tipos iniciales/i));
              if (heading === undefined) return STARTER_TYPES;
              const listed = graph
                .blocksOf(ontology.id)
                .filter((block) => block.parent === heading.stableId)
                .flatMap((block) => block.content.split('·'))
                .map((word) => word.trim())
                .filter((word) => word !== '' && word.length < 40 && !word.includes(' a propósito'));
              return listed.length > 0 ? listed : STARTER_TYPES;
            })();

      /*
       * Procesar se cuenta mientras pasa, no al terminar.
       *
       * Antes era una sola respuesta al final: leer una página con veinte
       * enlaces y un modelo local tarda, y en todo ese rato la interfaz decía
       * «leyendo…» sin más. Quien mira no puede distinguir eso de algo colgado,
       * y lo que hace entonces es volver a pulsar.
       *
       * Se transmite en NDJSON —una línea por hecho, según ocurre— porque lo que
       * hace falta no es una barra que avanza sino saber qué está haciendo: qué
       * dirección está consultando ahora, cuál no contestó, si el modelo local
       * está ahí. Esa es la verbosidad que sirve.
       */
      response.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-store',
      });
      const say = (event: Record<string, unknown>): void => {
        response.write(`${JSON.stringify(event)}\n`);
      };

      const blocks = graph.blocksOf(page.id);
      say({ step: 'reading', blocks: blocks.length, chars: text.length });

      // Dónde vive cada dirección, para poder proponer el arreglo sobre el
      // bloque que la lleva y no sobre la página entera.
      const holder = (url: string): { block: string; content: string } | null => {
        // Sobre un bloque que la puesta en forma acaba de rehacer no se propone
        // nada: el texto que esta sugerencia arreglaría ya no es el suyo.
        const found = blocks.find(
          (block) => !remade.has(block.stableId) && block.content.includes(url),
        );
        return found === undefined ? null : { block: found.stableId, content: found.content };
      };

      /*
       * La forma de la página se lee primero, y se dice antes que nada.
       *
       * Ver specs/page-processing.allium. Son dos preguntas distintas —qué forma
       * tiene esto, y de qué trata— y hasta ahora iban juntas: el modelo recibía
       * todos los bloques concatenados con saltos de línea, sin identidades, sin
       * padres y sin posiciones. Para quien lo recibía no había documento, había
       * una sábana de texto, y de ahí salía que ninguna propuesta sobre la
       * estructura pudiera apuntar a nada.
       *
       * Esta mitad se contesta contando: no tiene modelo, no tiene red, no tiene
       * azar y no se trunca. Por eso ocurre aquí, síncrona, antes de esperar a
       * nadie —@invariant StructureIsReportedBeforeTheModelAnswers— y por eso
       * sigue estando aunque no haya modelo local instalado
       * —@invariant ItWorksWithoutAModel—, que hasta hoy se perdía con él sin
       * ninguna razón.
       *
       * @invariant ReadingDecidesNothing: esto describe la página y no la cambia.
       * Lo que se hace con lo encontrado sigue siendo una pregunta abierta, y las
       * observaciones viajan como observaciones y no como sugerencias aplicables.
       */
      const structure = readStructure(blocks);
      say({
        step: 'structure',
        summary: describeStructure(structure),
        blocks: structure.units.length,
        sections: structure.sections.filter((section) => section.heading !== null).length,
        chars: structure.chars,
        observations: structure.observations,
      });

      /*
       * La puesta en forma, que ocurre sin preguntar.
       *
       * Es la Fase B de «Vera — Procesamiento automático de páginas»: partir
       * párrafos largos, marcar títulos implícitos, enderezar jerarquías
       * torcidas, separar unidades pegadas y borrar los huecos. Ninguna añade ni
       * quita sentido, y por eso pueden aplicarse solas.
       *
       * El plan se calcula aquí y lo aplica el cliente, operación por operación,
       * contra POST /operations. No porque sea más cómodo: es que la única
       * entrada de escritura de Vera es ésa, y un endpoint de lectura que además
       * escribiera en la base abriría una segunda puerta que después nadie
       * audita. Así cada paso lleva su autoría, su canal y su secuencia, como
       * cualquier edición hecha a mano.
       */
      const plan = planTabularity(page.id, blocks, structure);
      say({
        step: 'plan',
        did: describePlan(plan.steps),
        changes: plan.steps.map((step) => step.change),
      });

      /*
       * El sentido de la página se lee de la página, no de su principio.
       *
       * Hasta ahora se le daban al modelo los primeros tres mil caracteres y el
       * resultado se presentaba como la lectura de la página: para una nota es
       * la nota, para una transcripción de dos horas es el saludo del principio.
       * Ahora la página se reparte en pases del tamaño que el modelo aguanta
       * —cortados por las secciones que la lectura estructural ya encontró—, se
       * lee cada uno, y lo que dijeron se junta contando.
       *
       * @invariant TheBeginningIsNotThePage y @invariant WhatDidNotFitIsCounted,
       * de specs/page-processing.allium: si el tope de pases deja algo fuera, se
       * cuenta y aparece en `notDone`.
       */
      const contentOf = new Map(blocks.map((block) => [block.stableId, block.content]));
      const reparto = readingPasses(structure, contentOf, {
        chars: READABLE_CHARS,
        passes: MOST_PASSES,
      });

      const asked: Promise<{ reading: Reading; notDone: string[] }> = (async () => {
        const notDone: string[] = [];
        if (reparto.left > 0) {
          notDone.push(
            `el modelo leyó ${reparto.passes.length} partes de la página y ${reparto.left} caracteres quedaron sin leer`,
          );
        }

        // Sin modelo no se pregunta ocho veces para fallar ocho veces: se dice
        // una. @invariant TheModelIsLocalOrThereIsNone.
        const presence = await modelPresence();
        if (!presence.ready) {
          say({ step: 'model', state: 'failed', why: 'no hay un modelo local instalado' });
          return { reading: { types: [], concepts: [] }, notDone: [...notDone, 'no hay un modelo local instalado'] };
        }

        const readings: Reading[] = [];
        for (const pass of reparto.passes) {
          say({
            step: 'model',
            state: 'asking',
            pass: pass.ordinal,
            of: reparto.passes.length,
            section: pass.title,
          });
          const understood = await readPage(page.title, pass.text, vocabulary);
          if ('error' in understood) {
            // Un pase que falla no cancela los demás: la parte de la página que
            // sí se pudo leer sigue valiendo, y la que no se dice.
            say({ step: 'model', state: 'failed', why: understood.error, pass: pass.ordinal });
            notDone.push(`la parte ${pass.ordinal} de la página no se pudo leer: ${understood.error}`);
            continue;
          }
          readings.push(understood);
        }

        const reading = mergeReadings(readings);
        say({ step: 'model', state: 'done', types: reading.types, concepts: reading.concepts });
        return { reading, notDone };
      })();

      const followed = readLinks(text, {}, (link, done, total) => {
        say({ step: 'link', done, total, url: link.url, title: link.title, kind: link.kind, unreachable: link.unreachable });
      });

      /*
       * Lo que esta página nombra y el corpus ya tiene.
       *
       * Una captura habla de una persona, de un taller o de un proyecto que en
       * Vera ya son páginas, y no las enlaza: queda escrita y no queda
       * encontrable. Desde el otro lado no se llega en absoluto, porque los
       * enlaces entrantes de esa página no la mencionan.
       *
       * Se busca contando y no con el modelo, así que ocurre aquí mismo, sin
       * esperar a nadie y esté o no instalado el binario. Lo que sale son
       * proposiciones: un nombre escrito en una frase no siempre es una
       * referencia a la página que se llama igual, y eso lo decide quien lee.
       */
      const known = graph.pages().map((one) => ({
        id: one.id,
        title: one.title,
        backlinks: graph.backlinks(one.id).length,
      }));
      /*
       * Lo que la forma tocó no se propone en la misma vuelta.
       *
       * Una sugerencia de enlace nombra un bloque y el texto que ese bloque
       * decía; si el plan acaba de partirlo o de marcarlo, ese texto ya no es el
       * suyo, y aplicar la sugerencia encima lo devolvería a como estaba. Se
       * calla y vuelve a proponerse la próxima vez, cuando la página se lea tal
       * como quedó.
       */
      const remade = new Set(plan.touched);
      const settled = blocks.filter((block) => !remade.has(block.stableId));
      const mentions = mentionsOf(settled, known, { self: page.id });

      say({
        step: 'mentions',
        found: mentions.length,
        titles: mentions.map((mention) => mention.title),
      });

      void Promise.all([followed, asked]).then(([linked, understood]) => {
        // @invariant TheModelIsLocalOrThereIsNone y @guarantee
        // ProcessingSaysWhatItDidAndWhatItCouldNot: lo que no se pudo hacer se
        // dice, porque un resultado parcial callado se lee como uno completo.
        const notDone = [...linked.notDone, ...understood.notDone];

        say({
          step: 'done',
          page: page.id,
          /*
           * Cómo llama este corpus a lo que se va a proponer.
           *
           * Viaja con el resultado en vez de que el cliente se sepa las palabras:
           * quien escribe en otra lengua no tiene por qué recibir sugerencias que
           * escriban `type` en sus páginas.
           */
          names: propertyNames(),
          // La estructura viaja también en el final, para que quien reciba el
          // resultado entero no tenga que haber ido guardando los pasos.
          structure: {
            blocks: structure.units.length,
            sections: structure.sections.length,
            chars: structure.chars,
            observations: structure.observations,
          },
          links: linked.links.map((link) => ({ ...link, ...(holder(link.url) ?? { block: null, content: null }) })),
          types: understood.reading.types,
          /*
           * Cada concepto dice si el corpus ya lo tiene.
           *
           * Un concepto que ya es una página del grafo une esta página a lo que
           * hay; uno que no, abre un nombre nuevo. Son dos cosas distintas y
           * quien revisa tiene que poder distinguirlas de un vistazo: aceptar
           * «diseño» cuando existe «Diseño» y no unirlos parte en dos un
           * vecindario que era uno.
           *
           * Se dice y no se decide: el valor que se propone es el título tal
           * como la página existente se llama, para que aceptar una y aceptar la
           * otra lleven al mismo sitio.
           */
          concepts: understood.reading.concepts
            .map((value) => {
              const held = graph.pageTitled(value);
              return {
                value: held?.title ?? value,
                page: held?.id ?? null,
                backlinks: held === undefined ? 0 : graph.backlinks(held.id).length,
              };
            })
            // Una página no trata de sí misma. El modelo lo propone a menudo
            // —lee «Amy Pavel» en el título y en cada línea— y aceptarlo sólo
            // añade un valor que no separa esta página de ninguna otra.
            .filter((concept) => concept.page !== page.id),
          mentions: mentions.map((mention) => ({
            title: mention.title,
            page: mention.page,
            block: mention.block,
            content: mention.content,
            next: mention.next,
            written: mention.written,
            backlinks: mention.backlinks,
          })),
          notDone,
        });
        response.end();
      });
      return;
    }

    // Las páginas que gobiernan a Vera.
    //
    // @invariant SpecialityIsDeclaredNotGuessed: una página es especial porque
    // lo dice en una propiedad que cualquiera puede leer y cambiar. Vera no
    // guarda una lista privada de títulos que trata distinto, porque una regla
    // que no se puede leer del corpus es una regla contra la que el corpus no se
    // puede auditar.
      /*
       * Las conexiones con servicios de fuera, con lo que se puede saber de
       * ellas sin abrir ninguna.
       *
       * El estado es derivado y no está escrito en ninguna parte: si hay clave
       * lo dice la tabla de secretos, cuándo se usó por última vez también, y
       * cuántas páginas vinieron de ahí se cuenta mirando el corpus. Escribirlo
       * en la página sería tener dos sitios diciendo lo mismo.
       */
      /*
       * De qué está hecho este corpus: sus propiedades y sus objetos.
       *
       * Sale de las dos páginas que lo declaran, leídas cada vez y no cacheadas:
       * se editan como cualquier otra página y cambiarlas no debería pedir
       * reiniciar. Ver specs/controlled-ontology.allium.
       */
      if (path === '/ontology') {
        send(response, 200, {
          properties: declaredProperties(),
          objects: declaredObjects(),
          names: propertyNames(),
          fields: FIELD_KINDS,
          /*
           * Y las que el corpus usa sin haberlas declarado.
           *
           * No es un reproche: casi todo lo que hay en un corpus vivo llegó sin
           * pedir permiso, y declarar es una decisión que se toma después. Está
           * aquí para que esa decisión se pueda tomar mirando, en vez de tener
           * que acordarse de qué se escribió alguna vez.
           */
          undeclared: (() => {
            const known = new Set(declaredProperties().map((one) => one.name.toLowerCase()));
            const counted = new Map<string, number>();
            /*
             * Sin mirar las páginas que gobiernan.
             *
             * `campo::`, `papel::`, `propiedades::` son la gramática con que se
             * declara, no propiedades del corpus, y contarlas aquí sería
             * pedirle a la ontología que se declare a sí misma para siempre.
             */
            const governed = new Set(
              ['ontology', 'properties', 'objects', 'presentation', 'instructions']
                .map((one) => governing(one)?.id)
                .filter((one): one is string => one !== undefined),
            );
            const subjects = [
              ...graph.pages().map((one) => one.id),
              ...graph
                .allBlocks()
                .filter((one) => !governed.has(one.page))
                .map((one) => one.stableId),
            ].filter((one) => !governed.has(one));
            for (const subject of subjects) {
              for (const property of graph.propertiesOf(subject)) {
                const key = property.key.trim();
                if (key === '' || known.has(key.toLowerCase())) continue;
                counted.set(key, (counted.get(key) ?? 0) + 1);
              }
            }
            return [...counted]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 60)
              .map(([key, uses]) => ({ key, uses }));
          })(),
        });
        return;
      }

      /*
       * La historia de un bloque: todo lo que dijo, y cuándo.
       *
       * Sale del registro, doblando su propia historia desde que nació. No hay
       * nada que guardar para esto —ya estaba guardado— y aun así no había forma
       * de mirarlo sin abrir la base de datos. Un corpus que promete que nada se
       * pierde tiene que poder enseñarlo, o la promesa hay que creérsela.
       */
      if (path.startsWith('/blocks/') && path.endsWith('/history')) {
        const id = decodeURIComponent(path.slice('/blocks/'.length, -'/history'.length));
        const log = graph.operations();
        const said: {
          sequence: number;
          at: number;
          by: string;
          channel: string;
          what: string;
          content: string | null;
        }[] = [];
        for (const one of log) {
          const change = one.submission.change;
          const mine =
            (change.kind === 'create_block' && one.subjectId === id) ||
            ((change.kind === 'edit_block' ||
              change.kind === 'move_block' ||
              change.kind === 'remove_block') &&
              change.block === id);
          if (!mine) continue;
          said.push({
            sequence: one.sequence,
            at: one.appliedAt,
            by: graph.participant(one.submission.submittedBy)?.name ?? one.submission.submittedBy,
            channel: one.submission.channel,
            what:
              change.kind === 'create_block'
                ? 'nació'
                : change.kind === 'edit_block'
                  ? 'se escribió'
                  : change.kind === 'move_block'
                    ? 'se mudó'
                    : 'se borró',
            content:
              change.kind === 'create_block' || change.kind === 'edit_block'
                ? change.content
                : null,
          });
        }
        send(response, 200, {
          block: id,
          alive: graph.block(id) !== undefined,
          now: graph.block(id)?.content ?? null,
          states: said,
        });
        return;
      }

      if (path === '/services') {
        const brought = broughtFrom('zotero');
        send(
          response,
          200,
          servicePages(graph, SPECIAL_KIND).map((service) => ({
            ...service,
            secrets: secretsOf(store, service.id),
            pages: service.service === 'zotero' ? brought.size : 0,
          })),
        );
        return;
      }

    if (request.method === 'GET' && path === '/special-pages') {
      const found = graph
        .pages()
        .map((page) => ({
          page,
          kind: graph
            .propertiesOf(page.id)
            .find((property) => property.key === SPECIAL_KIND)?.value,
        }))
        .filter((entry) => entry.kind !== undefined)
        .map((entry) => ({
          id: entry.page.id,
          title: entry.page.title,
          kind: String(entry.kind).trim().toLowerCase(),
        }));
      send(response, 200, found);
      return;
    }

    if (request.method === 'GET' && path === '/workspace') {
      send(response, 200, workspaceOf(store, owner.id));
      return;
    }

    if (request.method === 'PUT' && path === '/workspace') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          // Se acepta lo que se reconoce y se ignora lo demás: un cliente más
          // nuevo que mande un campo que este servidor no conoce no debe fallar.
          const patch: Parameters<typeof saveWorkspace>[2] = {};
          if (body['layout'] === 'text_only' || body['layout'] === 'graph_only' || body['layout'] === 'split') {
            patch.layout = body['layout'];
          }
          if (typeof body['dividerPosition'] === 'number' && Number.isFinite(body['dividerPosition'])) {
            patch.dividerPosition = Math.min(0.95, Math.max(0.05, body['dividerPosition']));
          }
          if (body['graphView'] === 'graph_2d' || body['graphView'] === 'graph_3d') {
            patch.graphView = body['graphView'];
          }
          if (body['colourScheme'] === 'light' || body['colourScheme'] === 'dark') {
            patch.colourScheme = body['colourScheme'];
          }
          if (typeof body['designTokens'] === 'string' || body['designTokens'] === null) {
            patch.designTokens = body['designTokens'];
          }
          if (typeof body['graphReach'] === 'number' && Number.isFinite(body['graphReach'])) {
            patch.graphReach = Math.min(4, Math.max(1, Math.round(body['graphReach'])));
          }
          send(response, 200, saveWorkspace(store, owner.id, patch));
        } catch {
          send(response, 400, { error: 'the body must be JSON' });
        }
      });
      return;
    }

    if (request.method === 'GET' && path === '/recordings') {
      // Con `page`, lo que tiene lugar en ella: es lo que deja ver el audio
      // donde se habló en vez de en un limbo aparte.
      const page = url.searchParams.get('page');
      send(response, 200, page === null ? recordings(store) : recordingsInPage(store, page));
      return;
    }

    if (request.method === 'GET' && /^\/recordings\/[^/]+$/.test(path)) {
      const held = recordingById(store, decodeURIComponent(path.split('/')[2] ?? ''));
      if (held === null) {
        send(response, 404, { error: 'no such recording' });
        return;
      }
      send(response, 200, held);
      return;
    }

    // Plegar no es un cambio del grafo, así que no pasa por /operations: no
    // genera operación ni revisión, y por eso tiene su propia ruta.
    /*
     * Un bloque que se procesa a sí mismo: lo escrito es el pedido.
     *
     * El bloque pasa a ser la respuesta y los ítems cuelgan de él. El pedido no
     * se pierde —queda en las revisiones del bloque, como cualquier edición— y
     * deja de estar a la vista, que es lo que se quiere: después uno vuelve a
     * leer la lista, no lo que pidió.
     *
     * Firma el modelo local y no Cotito, y no es una formalidad: Cotito tiene
     * criterio sobre el corpus y lo que dice se lee como suyo; esto es una
     * máquina contestando una pregunta, y mañana será otra máquina. Ver
     * answer.ts. La autoría del bloque cambia de mano al procesarlo, que es
     * exactamente lo que pasó.
     *
     * Se aplica y ya, sin panel de sugerencias: lo que quedó mal se corrige
     * escribiendo, como todo lo demás en Vera.
     */
    if (request.method === 'POST' && path.startsWith('/blocks/') && path.endsWith('/process')) {
      const id = decodeURIComponent(path.slice('/blocks/'.length, -'/process'.length));
      const block = graph.block(id);
      if (block === undefined) {
        send(response, 404, { error: 'no such block' });
        return;
      }
      const said = block.content.trim();
      if (said === '') {
        send(response, 422, { error: 'un bloque vacío no pide nada' });
        return;
      }

      const context = graph.childrenOf(block.stableId).map((child) => child.content);
      void ask(promptFor(said, context), { maxTokens: 700, timeoutMs: 300_000 }).then((answered) => {
        if ('error' in answered) {
          send(response, 503, answered);
          return;
        }
        const read = readAnswer(answered.text);
        if (read === null) {
          send(response, 502, { error: 'el modelo no contestó nada que se pueda escribir' });
          return;
        }

        /*
         * El modelo entra al grafo la primera vez que contesta.
         *
         * No se crea al arrancar: un grafo donde nunca se procesó un bloque no
         * tiene por qué llevar dentro un participante que no escribió nada.
         */
        if (graph.participant(LOCAL_MODEL) === undefined) {
          saveParticipant(store, { id: LOCAL_MODEL, name: LOCAL_MODEL_NAME, kind: 'agent' });
          graph.addParticipant({ id: LOCAL_MODEL, name: LOCAL_MODEL_NAME, kind: 'agent' });
          graph.admit(LOCAL_MODEL);
        }

        const stamp = Date.now();
        let step = 0;
        const write = (change: Change): string | null => {
          const outcome = graph.submitOperation({
            originId: `local-model:${block.stableId}:${stamp}:${(step += 1)}`,
            participant: LOCAL_MODEL,
            // @invariant TheChannelIsObservedAndNeverDeclared: un agente escribe
            // por este canal y no por otro, y por eso lo escrito se dibuja como
            // lo que es sin que nadie tenga que acordarse de marcarlo.
            channel: 'agent_generation',
            change,
          });
          if (outcome.status !== 'applied') return null;
          recordOperation(store, graph, outcome.operation);
          return outcome.operation.subjectId;
        };

        try {
          if (write({ kind: 'edit_block', block: block.stableId, content: read.title }) === null) {
            send(response, 422, { error: 'no se pudo escribir la respuesta en el bloque' });
            return;
          }

          /*
           * Los ítems, en orden y colgando de quien les toque.
           *
           * La pila guarda al último bloque escrito de cada nivel: un ítem de
           * nivel dos cuelga del último de nivel uno, que es lo que significa
           * estar sangrado debajo de él. Lo que ya colgaba del bloque se queda
           * donde estaba y lo nuevo nace detrás.
           */
          const stack: string[] = [block.stableId];
          for (const item of read.items) {
            const depth = Math.min(item.depth, stack.length - 1);
            stack.length = depth + 1;
            const parent = stack[depth] ?? block.stableId;
            const made = write({
              kind: 'create_block',
              page: block.page,
              parent,
              // Al final de lo que ya cuelgue de ese padre: lo que hubiera
              // debajo del bloque estaba antes y sigue estando.
              position: graph.childrenOf(parent).length,
              content: item.text,
            });
            if (made === null) break;
            stack.push(made);
          }

          send(response, 200, {
            block: block.stableId,
            title: read.title,
            items: read.items.length,
            participant: LOCAL_MODEL,
          });
        } catch (error) {
          send(response, 500, {
            error: 'no se pudo escribir lo que el modelo contestó',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      });
      return;
    }

    /*
     * Los servicios de fuera, gobernados desde el corpus.
     *
     * Una conexión vive en una página especial que se lee y se edita como
     * cualquier otra —qué servicio, qué biblioteca, qué se trae— y lo único que
     * no está ahí es el secreto, que vive fuera del log porque un log
     * append-only no sabe olvidar. Ver services.ts, secrets.ts y
     * specs/service-connections.allium.
     */
    if (path.startsWith('/services/')) {
      const rest = path.slice('/services/'.length);
      const slash = rest.lastIndexOf('/');
      const named = decodeURIComponent(slash === -1 ? rest : rest.slice(0, slash));
      const what = slash === -1 ? '' : rest.slice(slash + 1);
      const page = graph.page(named) ?? graph.pageTitled(named);
      if (page === undefined) {
        send(response, 404, { error: 'no such page' });
        return;
      }
      const service = servicePages(graph, SPECIAL_KIND).find((one) => one.id === page.id);
      if (service === undefined) {
        send(response, 422, {
          error: `«${page.title}» no declara ser un servicio: le falta special-kind:: service y servicio::`,
        });
        return;
      }

      /*
       * Guardar el secreto, y olvidarlo.
       *
       * Entra por aquí y no por `POST /operations` a propósito: no es una
       * operación, no genera revisión y no se puede replicar. Olvidarlo lo borra
       * de verdad, que es lo único que «olvidar» significa tratándose de una
       * clave.
       */
      if (request.method === 'PUT' && what === 'secret') {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          let body: { name?: unknown; secret?: unknown };
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
          } catch {
            send(response, 400, { error: 'the body must be JSON' });
            return;
          }
          const secret = typeof body.secret === 'string' ? body.secret.trim() : '';
          const name = typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : 'clave';
          if (secret === '') {
            send(response, 400, { error: 'una clave vacía no es una clave' });
            return;
          }
          saveSecret(store, page.id, name, secret, Date.now());
          send(response, 200, { page: page.id, secrets: secretsOf(store, page.id) });
        });
        return;
      }

      if (request.method === 'DELETE' && what === 'secret') {
        const name = url.searchParams.get('name') ?? 'clave';
        const gone = forgetSecret(store, page.id, name);
        send(response, gone ? 200 : 404, gone ? { page: page.id, secrets: secretsOf(store, page.id) } : { error: 'ahí no había ninguna clave guardada' });
        return;
      }

      // De aquí en adelante hace falta la clave. Sin ella no se pregunta nada:
      // una petición sin credencial a un servicio de fuera es una petición que
      // igualmente le dice que aquí hay alguien.
      const key = useSecret(store, page.id, 'clave', Date.now());
      if (key === null) {
        send(response, 428, { error: `«${page.title}» todavía no tiene una clave guardada` });
        return;
      }
      if (service.service !== 'zotero') {
        send(response, 501, { error: `Vera todavía no sabe hablar con ${service.service}` });
        return;
      }

      /** Con qué biblioteca hablar: la declarada, o la de quien es dueño de la clave. */
      const libraryOf = async (): Promise<string | { error: string }> => {
        if (service.library !== null) return service.library;
        const who = await whoami(key);
        if ('error' in who) return who;
        return `users/${who.userId}`;
      };

      /*
       * Probar la conexión: quién soy y qué puedo.
       *
       * Es esta petición y no una búsqueda vacía: una búsqueda que no devuelve
       * nada no distingue entre una clave mala y una biblioteca vacía.
       */
      if (request.method === 'POST' && what === 'check') {
        void whoami(key).then((who) => {
          if ('error' in who) {
            send(response, 502, who);
            return;
          }
          send(response, 200, {
            page: page.id,
            service: service.service,
            identity: who,
            library: service.library ?? `users/${who.userId}`,
            declared: service.library !== null,
          });
        });
        return;
      }

      /** Buscar en la biblioteca: autor, título, año. */
      if (request.method === 'GET' && what === 'search') {
        const text = (url.searchParams.get('q') ?? '').trim();
        if (text === '') {
          send(response, 400, { error: 'no se busca nada sin decir qué' });
          return;
        }
        void libraryOf().then(async (library) => {
          if (typeof library !== 'string') {
            send(response, 502, library);
            return;
          }
          const found = await search(key, library, text);
          if ('error' in found) {
            send(response, 502, found);
            return;
          }
          /*
           * Cada resultado dice si ya está en el corpus.
           *
           * Sin esto, citar dos veces el mismo libro crea dos páginas, y quien
           * busca no tiene forma de saberlo hasta que ya pasó.
           */
          const here = broughtFrom('zotero');
          send(response, 200, {
            page: page.id,
            library,
            total: found.total,
            items: found.items.map((one) => ({ ...one, alreadyHere: here.get(one.key) ?? null })),
          });
        });
        return;
      }

      /*
       * Traer un ítem: se vuelve una página del corpus, con su procedencia.
       *
       * Si ya estaba, no nace otra: se refresca la que hay cuando Zotero tiene
       * una versión más nueva, y si no, se devuelve tal cual. @invariant
       * ZoteroRecordIdentityIsUniqueWithinLibrary.
       */
      if (request.method === 'POST' && what === 'bring') {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          let body: { item?: unknown };
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
          } catch {
            send(response, 400, { error: 'the body must be JSON' });
            return;
          }
          const itemKey = typeof body.item === 'string' ? body.item.trim() : '';
          if (itemKey === '') {
            send(response, 400, { error: 'no se dijo qué ítem traer' });
            return;
          }
          void libraryOf().then(async (library) => {
            if (typeof library !== 'string') {
              send(response, 502, library);
              return;
            }
            const found = await item(key, library, itemKey);
            if ('error' in found) {
              send(response, 502, found);
              return;
            }
            const notes = await children(key, library, itemKey);
            try {
              const made = bringItem(found, library, 'notes' in notes ? notes.notes : []);
              send(response, 200, made);
            } catch (error) {
              send(response, 500, {
                error: 'no se pudo escribir la página del ítem',
                detail: error instanceof Error ? error.message : String(error),
              });
            }
          });
        });
        return;
      }

      send(response, 404, { error: 'no such service route' });
      return;
    }

    /*
     * Deshacer lo último.
     *
     * No hay pila de deshacer y no hace falta: el registro ya tiene todos los
     * estados anteriores de todo, y deshacer es calcular la operación contraria
     * leyéndolo hacia atrás. Lo que se aplica son operaciones nuevas —queda
     * dicho quién deshizo y cuándo— y por eso deshacer se puede deshacer sin una
     * línea de código más. Ver core/undo.ts y specs/undo.allium.
     *
     * `GET` dice qué se desharía, sin tocar nada, para poder enseñarlo antes de
     * hacerlo. `POST` lo hace.
     */
    if ((request.method === 'GET' || request.method === 'POST') && path === '/undo') {
      const log = graph.operations();
      const world = {
        childrenOf: (block: string) => graph.childrenOf(block).map((one) => one.stableId),
        exists: (block: string) => graph.block(block) !== undefined,
      };

      /*
       * Sólo se deshace lo propio.
       *
       * Deshacer lo que escribió otra mano —un agente, el modelo local— no es
       * deshacer: es corregir a alguien, y eso se hace escribiendo y firmando el
       * cambio con el propio nombre. @invariant TheOnlyHandYouCanUndoIsYourOwn.
       */
      /*
       * Y rehacer es deshacer un deshacer: la misma máquina, otro objetivo.
       *
       * Se distinguen porque si no, pulsar deshacer dos veces rebotaría entre
       * dos estados en vez de caminar hacia atrás.
       */
      const redoing = url.searchParams.get('rehacer') !== null;
      /*
       * Y sobre una página, no sobre el corpus entero.
       *
       * Deshacer es «vuelve esto al momento anterior», y «esto» es la página que
       * se está mirando. Sin acotarlo, dos cosas que ocurren a la vez en sitios
       * distintos —otra ventana, un guion escribiendo mientras alguien teclea—
       * se leen como un solo gesto y deshacer se lleva por delante trabajo ajeno
       * al que se quería deshacer.
       */
      const said = url.searchParams.get('pagina');
      const here = said === null ? undefined : (graph.page(said) ?? graph.pageTitled(said))?.id;
      if (said !== null && here === undefined) {
        send(response, 404, { error: 'no such page' });
        return;
      }
      const scope: { by: string; page?: string } = { by: owner.id };
      if (here !== undefined) scope.page = here;
      const gesture = redoing ? nextToRedo(log, scope) : nextToUndo(log, scope);
      if (gesture.length === 0) {
        send(response, 200, {
          nothing: redoing ? 'no hay nada que rehacer' : 'no hay nada tuyo que deshacer',
        });
        return;
      }

      const undoing = invert(log, gesture, world);
      if ('refusal' in undoing) {
        send(response, 200, { nothing: undoing.refusal, operations: gesture.length });
        return;
      }

      if (request.method === 'GET') {
        send(response, 200, {
          says: undoing.says,
          operations: gesture.length,
          when: gesture.at(-1)?.appliedAt ?? null,
        });
        return;
      }

      const stamp = Date.now();
      let step = 0;
      const done: string[] = [];
      const applied: Operation[] = [];

      const write = (change: Change, why: string): string | null => {
        const outcome = graph.submitOperation({
          originId: `${why}:${gesture.at(-1)?.sequence ?? 0}:${stamp}:${(step += 1)}`,
          participant: owner.id,
          channel: 'typed_text',
          change,
        });
        if (outcome.status !== 'applied') {
          return outcome.status === 'rejected' ? outcome.reason : 'repetido';
        }
        recordOperation(store, graph, outcome.operation);
        applied.push(outcome.operation);
        return null;
      };

      /*
       * Si un paso falla, se devuelve lo que ya se había aplicado.
       *
       * Media reversión deja un estado que nadie eligió y del que nadie se
       * acuerda —es peor que no haber deshecho nada—, y por eso el plan se
       * calcula entero antes de tocar nada. Aun así, aplicar puede fallar por
       * algo que el plan no vio: entonces se deshace el deshacer, con la misma
       * máquina, y se dice que no se pudo.
       */
      const putBack = (): void => {
        const back = invert(graph.operations(), applied, world);
        if ('refusal' in back) return;
        for (const change of back.changes) {
          const outcome = graph.submitOperation({
            originId: `undo-back:${stamp}:${(step += 1)}`,
            participant: owner.id,
            channel: 'typed_text',
            change,
          });
          if (outcome.status !== 'applied') return;
          recordOperation(store, graph, outcome.operation);
        }
      };

      try {
        for (const change of undoing.changes) {
          const failed = write(change, 'undo');
          if (failed !== null) {
            putBack();
            send(response, 422, {
              error: `no se pudo deshacer: ${failed}. Nada cambió.`,
            });
            return;
          }
          done.push(undoing.says[done.length] ?? '');
        }
      } catch (error) {
        putBack();
        send(response, 500, {
          error: 'no se pudo deshacer. Nada cambió.',
          detail: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      send(response, 200, { done, operations: gesture.length, undone: undoing.undoing });
      return;
    }

    if (request.method === 'POST' && path === '/folds') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let body: { participant?: unknown; block?: unknown; folded?: unknown };
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
        } catch {
          send(response, 400, { error: 'the body must be JSON' });
          return;
        }

        const block = typeof body.block === 'string' ? body.block : '';
        if (graph.block(block) === undefined) {
          send(response, 404, { error: 'no such block' });
          return;
        }
        // @invariant OnlyParentsFold: un bloque sin hijos no tiene qué plegar.
        if (graph.childrenOf(block).length === 0) {
          send(response, 422, { error: 'a block with no children has nothing to fold' });
          return;
        }

        const who = typeof body.participant === 'string' ? body.participant : owner.id;
        setFold(store, who, block, body.folded === true);
        send(response, 200, { block, folded: body.folded === true });
      });
      return;
    }

    /*
     * Preguntarle al grafo.
     *
     * POST y no GET aunque sea una lectura: la pregunta va en el cuerpo porque en
     * una dirección se guarda —en el historial, en un registro del servidor, en lo
     * que se comparte al copiar el enlace— y una consulta puede nombrar a una
     * persona, una dirección o un asunto que no tiene por qué quedar escrito
     * fuera del corpus.
     *
     * Una pregunta que no se entiende contesta 200 y dice qué no entendió: la
     * petición estaba bien hecha, y devolver cero resultados sería una respuesta
     * —@invariant WhatCannotBeReadSaysSo—.
     */
    if (request.method === 'POST' && path === '/query') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let body: { source?: unknown; participant?: unknown; sort?: unknown };
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
        } catch {
          send(response, 400, { error: 'the body must be JSON' });
          return;
        }

        const source = typeof body.source === 'string' ? body.source : '';
        const read = readQuery(source);
        if ('error' in read) {
          send(response, 200, { error: read.error, at: read.at, near: read.near });
          return;
        }

        const who = typeof body.participant === 'string' && body.participant !== ''
          ? body.participant
          : owner.id;
        let outcome;
        try {
          outcome = graph.query({ expression: read.expression, participant: who });
        } catch (problem) {
          send(response, 403, { error: problem instanceof Error ? problem.message : 'refused' });
          return;
        }

        // Dónde lo dice, para las preguntas por texto: una sola muestra por
        // página, que es la que hace falta para saber si el acierto es el bueno.
        const says = new Map<string, { block: string; excerpt: string }>();
        for (const id of outcome.matchingBlocks) {
          const block = graph.block(id);
          if (block === undefined || says.has(block.page)) continue;
          says.set(block.page, { block: id, excerpt: excerpt(block.content) });
        }

        const names = propertyNames();
        const valueOf = (page: string, key: string): string | null =>
          graph.propertiesOf(page).find((property) => property.key === key)?.value ?? null;

        const found = outcome.matchingPages
          .map((id) => graph.page(id))
          .filter((page): page is NonNullable<typeof page> => page !== undefined)
          .map((page) => ({
            id: page.id,
            title: page.title,
            type: valueOf(page.id, names.kind),
            /*
             * Los conceptos, ya partidos.
             *
             * Una página es varias cosas a la vez y el corpus lo escribe con
             * comas; partirlo aquí y no en la pantalla es lo que permite que cada
             * palabra sea un enlace en vez de una cadena que no lleva a ninguna
             * parte. La regla de partir vive en el dominio: si el cliente
             * partiera por su cuenta, las palabras que ofrece y las que dibuja
             * podrían dejar de ser las mismas.
             */
            topic: answersIn(valueOf(page.id, names.topic) ?? ''),
            created: page.createdAt,
            updated: graph.updatedAt(page.id),
            says: says.get(page.id) ?? null,
          }));

        /*
         * Ordenar antes de recortar, siempre.
         *
         * Es la diferencia entre ordenar la respuesta y ordenar el trozo de la
         * respuesta que cupo: con dos mil páginas seleccionadas, lo segundo
         * enseñaría las doscientas primeras por título ordenadas por fecha, que
         * no es lo que nadie pidió.
         *
         * Y el orden no se escribe en la pregunta: es cómo se está mirando, no
         * qué se seleccionó. Pulsar una cabecera no debería reescribir el bloque
         * de nadie.
         */
        const sort = body.sort as { by?: unknown; desc?: unknown } | undefined;
        const by = typeof sort?.by === 'string' ? sort.by : 'title';
        const desc = sort?.desc === true;
        const dicho = (value: string | null): string => value ?? '';
        const compare: Record<string, (a: (typeof found)[number], b: (typeof found)[number]) => number> = {
          title: (a, b) => a.title.localeCompare(b.title, 'es'),
          type: (a, b) => dicho(a.type).localeCompare(dicho(b.type), 'es'),
          topic: (a, b) => (a.topic[0] ?? '').localeCompare(b.topic[0] ?? '', 'es'),
          created: (a, b) => a.created - b.created,
          updated: (a, b) => (a.updated ?? 0) - (b.updated ?? 0),
        };
        const order = compare[by] ?? compare['title'];
        // Desempate por título: dos páginas del mismo tipo no pueden bailar entre
        // dos lecturas de la misma pregunta.
        found.sort((a, b) => (order?.(a, b) ?? 0) || a.title.localeCompare(b.title, 'es'));
        if (desc) found.reverse();

        // Se contesta entero cuánto es y se manda un tramo: una pregunta puede
        // seleccionar dos mil páginas, y ninguna pantalla las lee. Lo recortado
        // se declara, como todo lo demás.
        send(response, 200, {
          view: read.view,
          /*
           * La pregunta tal como Vera la entendió.
           *
           * No es un adorno: cuando la respuesta es cero, lo único que quien
           * mira necesita saber es si el corpus no tiene nada o si la pregunta
           * decía otra cosa. Devolver el árbol vuelto a escribir contesta eso sin
           * que haya que adivinarlo —@guarantee AnEmptyAnswerExplainsItself—.
           */
          asked: writeQuery(read.expression, read.view),
          /** Cómo llama este corpus a lo que la tabla enseña en sus columnas. */
          names: { kind: names.kind, topic: names.topic },
          sort: { by, desc },
          count: found.length,
          pages: found.slice(0, MOST_ANSWERS),
          more: Math.max(0, found.length - MOST_ANSWERS),
        });
      });
      return;
    }

    if (request.method !== 'GET') {
      send(response, 405, { error: 'method not allowed' });
      return;
    }

    const participant = url.searchParams.get('participant') ?? owner.id;

    try {
      if (path === '/health') {
        send(response, 200, {
          graph: graph.name,
          /*
           * Cómo llama este corpus a las propiedades que Vera necesita conocer.
           *
           * Viaja aquí porque el cliente las necesita antes de escribir nada
           * —un día nace con su clase puesta— y ésta es la primera petición que
           * hace al arrancar.
           */
          names: propertyNames(),
          embedHosts: embedHosts(),
          pages: graph.pages().length,
          blocks: graph.allBlocks().length,
          lastSequence: graph.log().lastSequence,
        });
        return;
      }

      if (path === '/pages') {
        send(
          response,
          200,
          graph.pages().map((page) => ({
            id: page.id,
            title: page.title,
            visibility: page.visibility,
            blockCount: graph.blocksOf(page.id).length,
            // Cuántas aristas toca. El cliente lo usa para no abrir de entrada
            // una página aislada, que se vería como un grafo vacío.
            linkCount:
              graph.backlinks(page.id).length +
              graph
                .blocksOf(page.id)
                .reduce(
                  (n, block) => n + graph.linksOf(block.stableId).filter((l) => l.target !== null).length,
                  0,
                ),
          })),
        );
        return;
      }

      // El Markdown de una página, tal como git lo recibiría. Se sirve la misma
      // proyección determinista que baja el corpus a disco: exportar y versionar
      // no pueden dar dos textos distintos.
      /*
       * La página en papel, y el PDF que sale de ella.
       *
       * Dos rutas y no una porque son dos cosas distintas: `/paper` es el
       * documento compuesto, que se puede mirar en una pestaña mientras se
       * decide cómo tiene que verse, y `/pdf` es ese mismo documento pasado por
       * un Chrome sin ventana. Componer aquí y no en el navegador de quien lo
       * pide es lo que hace que el PDF sea siempre el mismo: carta, sin
       * encabezados del sistema y sin depender de la impresora que hubiera
       * configurada. Ver paper.ts.
       */
      if (path.startsWith('/pages/') && (path.endsWith('/paper') || path.endsWith('/pdf'))) {
        const asPdf = path.endsWith('/pdf');
        const named = decodeURIComponent(
          path.slice('/pages/'.length, asPdf ? -'/pdf'.length : -'/paper'.length),
        );
        const page = graph.page(named) ?? graph.pageTitled(named);
        if (page === undefined) {
          send(response, 404, { error: 'no such page' });
          return;
        }

        if (!asPdf) {
          const html = paperHtml({
            title: page.title,
            blocks: graph.blocksOf(page.id).map((block) => ({
              stableId: block.stableId,
              parent: block.parent,
              position: block.position,
              content: block.content,
            })),
            assets: assetsOf(page.id),
            embedHosts: embedHosts(),
            indent: url.searchParams.get('sangria') !== null,
          });
          const body = Buffer.from(html, 'utf8');
          response.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'content-length': body.byteLength,
          });
          response.end(body);
          return;
        }

        /*
         * Chrome pide el papel al propio Vera, por el bucle local.
         *
         * Por su dirección y no por un archivo temporal: así las imágenes, las
         * fuentes y los medios se piden por su ruta de siempre y a su propio
         * origen, y mirar el papel en una pestaña y componerlo en un PDF son la
         * misma página y no dos parecidas.
         */
        const port = request.socket.localPort ?? 4173;
        const suffix = url.searchParams.get('sangria') !== null ? '?sangria=1' : '';
        const where = `http://127.0.0.1:${port}/pages/${encodeURIComponent(page.id)}/paper${suffix}`;
        void toPdf(where).then((made) => {
          if ('error' in made) {
            send(response, 503, made);
            return;
          }
          response.writeHead(200, {
            'content-type': 'application/pdf',
            'content-length': made.pdf.byteLength,
            // El nombre del archivo va en las dos formas: la simple para quien
            // sólo entienda ASCII y la codificada para el título de verdad, que
            // lleva tildes y rayas.
            'content-disposition':
              `attachment; filename="${page.title.replace(/[^\w .-]/g, '_')}.pdf"; ` +
              `filename*=UTF-8''${encodeURIComponent(`${page.title}.pdf`)}`,
          });
          response.end(made.pdf);
        });
        return;
      }

      if (path.startsWith('/pages/') && path.endsWith('/markdown')) {
        const named = decodeURIComponent(
          path.slice('/pages/'.length, -'/markdown'.length),
        );
        const page = graph.page(named) ?? graph.pageTitled(named);
        if (page === undefined) {
          send(response, 404, { error: 'no such page' });
          return;
        }
        const { text } = renderPage(graph, page);
        const body = Buffer.from(text, 'utf8');
        response.writeHead(200, {
          'content-type': 'text/markdown; charset=utf-8',
          'content-length': body.byteLength,
        });
        response.end(body);
        return;
      }

      if (path.startsWith('/pages/')) {
        const named = decodeURIComponent(path.slice('/pages/'.length));
        // Por identidad primero, por título después. La URL nombra la página por
        // su título porque es lo legible, pero un enlace viejo escrito con el
        // identificador tiene que seguir funcionando después de un renombrado.
        const page = graph.page(named) ?? graph.pageTitled(named);
        if (page === undefined) {
          send(response, 404, { error: 'no such page' });
          return;
        }
        send(response, 200, {
          id: page.id,
          title: page.title,
          visibility: page.visibility,
          createdAt: page.createdAt,
          originCreatedAt: page.originCreatedAt,
          lastEditedAt: graph.lastEditedAt(page.id),
          properties: graph.propertiesOf(page.id).map((p) => ({ key: p.key, value: p.value })),
          // Lo que el corpus ya contesta a cada una de estas claves. Es el
          // vocabulario observado, no uno declarado: mientras no haya ontología
          // es lo único que hay, y cuando la haya seguirá siendo la evidencia
          // desde la que se propone. Sólo viajan las claves de esta página.
          domains: Object.fromEntries(
            [...new Set(graph.propertiesOf(page.id).map((p) => p.key))].map((key) => [
              key,
              graph.observedValuesOf(key),
            ]),
          ),
          blocks: graph
            .blocksOf(page.id)
            .map((block) => ({
              stableId: block.stableId,
              parent: block.parent,
              position: block.position,
              content: block.content,
            }))
            .sort((a, b) => a.position - b.position),
          // Las referencias viajan ya nombradas: el cliente no puede resolver
          // mil títulos de página con mil peticiones más.
          // Sólo los medios que esta página nombra. El bloque conserva su
          // `../assets/foo.png` —lo que mantiene portable la proyección
          // Markdown— y aquí viaja a qué objeto resuelve.
          assets: assetsOf(page.id),
          /*
           * Las dos columnas: lo que esta página afirma sobre otras y lo que
           * otras afirman sobre ella.
           *
           * Separadas y no juntas porque la diferencia es quién lo dijo, que en
           * un corpus con procedencia es la distinción entera. Cada fila lleva
           * el bloque desde el que se afirma: una relación sin su frase es una
           * flecha sin sujeto, dice que hay algo y no qué, y obliga a irse de la
           * página para saberlo —que es lo que un retroenlace sin extracto ya
           * hace hoy—.
           *
           * Un entrante se lee con el recíproco del término y no con el término:
           * lo que A afirma es que contradice a B, y lo que B tiene que leer es
           * que es contradicha por A. Enseñarlo tal cual invertiría el sujeto de
           * la afirmación sin avisar.
           */
          crossingsOut: graph.crossingsOut(page.id).map((crossing) => ({
            ...crossing,
            title: crossing.toPage === null ? crossing.targetTitle : (graph.page(crossing.toPage)?.title ?? crossing.targetTitle),
            reads: crossing.term,
            says: excerpt(graph.block(crossing.fromBlock)?.content ?? ''),
          })),
          crossingsIn: graph.crossingsIn(page.id).map((crossing) => ({
            ...crossing,
            title: graph.page(crossing.fromPage)?.title ?? crossing.fromPage,
            reads: inverseOf(crossing.term, relationVocabulary()),
            says: excerpt(graph.block(crossing.fromBlock)?.content ?? ''),
          })),
          // La denominación de origen de los bloques hablados de esta página.
          spokenOrigins: spokenOriginsOnPage(store, page.id),
          // @guarantee NothingSpokenIsStrandedFromTheWriting: lo hablado dentro
          // de esta página viaja con ella, para que se vea donde se habló y no
          // haya que ir a buscarlo a una lista aparte.
          recordings: recordingsInPage(store, page.id),
          // @invariant GeneratedContentIsAlwaysDistinguishable: de qué mano
          // salió el texto de cada bloque. Viaja con la página y no en una
          // petición aparte, porque distinguir lo escrito de lo generado tiene
          // que costar lo mismo que leer, o no se hará.
          //
          // Es cosa distinta de spokenOrigins: uno dice de dónde vinieron las
          // palabras y el otro quién las escribió por última vez. Un bloque
          // dictado por Herbert y reescrito por Cotito aparece en los dos, y
          // nombrando participantes distintos.
          authorship: Object.fromEntries(
            graph
              .blocksOf(page.id)
              .map((block) => [block.stableId, graph.authorship(block.stableId)] as const)
              .filter(([, hand]) => hand !== undefined)
              .map(([id, hand]) => [
                id,
                {
                  participant: hand?.participant,
                  kind: graph.participant(hand?.participant ?? '')?.kind ?? null,
                  channel: hand?.channel,
                  writtenAt: hand?.writtenAt,
                },
              ]),
          ),
          // @invariant FoldingIsNotAChange: qué tiene plegado ESTE participante.
          // No sale del registro de operaciones porque nunca entró en él.
          folded: foldedOnPage(store, participant, page.id),
          // @invariant ReferenceResolvesToItsBlock. Las referencias que esta
          // página nombra viajan resueltas: quién es el bloque, en qué página
          // vive y qué dice. Sin esto el cliente tendría que pedir una por una
          // y una referencia sería más cara de mostrar que de escribir.
          blockRefs: (() => {
            const seen = new Set<string>();
            const found: { id: string; page: string; excerpt: string }[] = [];
            for (const block of graph.blocksOf(page.id)) {
              for (const match of block.content.matchAll(/\(\(([^()\s]+)\)\)/g)) {
                const id = match[1] ?? '';
                if (id === '' || seen.has(id)) continue;
                seen.add(id);
                const target = graph.block(id);
                if (target === undefined) continue;
                found.push({ id, page: target.page, excerpt: excerpt(target.content) });
              }
            }
            return found;
          })(),
          // Qué páginas nombradas desde aquí existen ya y cuáles todavía no.
          //
          // Un enlace a una página que aún no está no es un enlace roto: es la
          // intención de escribirla, y el corpus está lleno de ellas a propósito.
          // Pero leerlo igual que uno que lleva a alguna parte hace que el
          // lector descubra la diferencia sólo al pulsarlo.
          pendingLinks: (() => {
            const pending = new Set<string>();
            for (const block of graph.blocksOf(page.id)) {
              for (const link of graph.linksOf(block.stableId)) {
                if (link.target === null) pending.add(link.targetTitle);
              }
            }
            return [...pending];
          })(),
          backlinks: graph.backlinks(page.id).map((link) => {
            const source = graph.page(link.sourcePage);
            const block = link.sourceBlock === null ? undefined : graph.block(link.sourceBlock);
            return {
              page: link.sourcePage,
              block: link.sourceBlock,
              title: source?.title ?? link.sourcePage,
              excerpt: excerpt(block?.content ?? ''),
            };
          }),
          /*
           * Y las que salen: a quién nombra esta página.
           *
           * Estaban en el texto y en ninguna lista. Un enlace saliente se ve
           * leyendo la página entera; el pie contestaba sólo la mitad de la
           * pregunta —quién habla de esto— y no la otra —de qué habla esto—, que
           * es la que dice de qué es vecina una página sin tener que releerla.
           *
           * Se manda una fila por página nombrada y no una por mención: nombrar
           * cinco veces a la misma página es un dato sobre el texto y no sobre el
           * grafo, y una lista que la repitiera cinco veces se leería como cinco
           * vecinas. La frase que viaja es la primera, que es donde se presenta.
           *
           * Un título que nadie ha escrito viaja igual, con `page` nulo. Es lo
           * que el corpus tiene de más honesto: una página nombrada y todavía sin
           * escribir es una deuda a la vista, no un enlace roto.
           */
          references: (() => {
            const seen = new Map<string, { page: string | null; title: string; block: string; excerpt: string }>();
            for (const block of graph.blocksOf(page.id)) {
              for (const link of graph.linksOf(block.stableId)) {
                const target = link.target === null ? undefined : graph.page(link.target);
                const key = titleKey(target?.title ?? link.targetTitle);
                if (key === '' || seen.has(key)) continue;
                seen.set(key, {
                  page: link.target,
                  title: target?.title ?? link.targetTitle,
                  block: block.stableId,
                  excerpt: excerpt(block.content),
                });
              }
            }
            return [...seen.values()];
          })(),
        });
        return;
      }

      // Un objeto se nombra por el hash de su contenido, así que su respuesta
      // nunca cambia: se puede cachear para siempre.
      if (path.startsWith('/media/')) {
        const hash = path.slice('/media/'.length);
        if (objectsRoot === null || !HASH.test(hash)) {
          send(response, 404, { error: 'no such media' });
          return;
        }
        const record = mediaByHash(store, hash);
        const file = objectPath(objectsRoot, hash);
        if (record === null || !existsSync(file)) {
          send(response, 404, { error: 'no such media' });
          return;
        }
        response.writeHead(200, {
          'content-type': record.mediaType,
          'content-length': record.byteSize,
          'cache-control': 'public, max-age=31536000, immutable',
          // @invariant ExecutableContentIsolation. Un SVG servido desde este
          // mismo origen es un documento que puede ejecutar guiones y leer lo
          // que el origen tenga. Estas dos cabeceras se lo impiden: sin fuentes
          // permitidas y en un origen opaco, no alcanza nada del grafo.
          'content-security-policy': "default-src 'none'; sandbox",
          'x-content-type-options': 'nosniff',
        });
        createReadStream(file).pipe(response);
        return;
      }

      if (path === '/search') {
        const outcome = graph.search({ text: url.searchParams.get('q') ?? '', participant });
        send(response, 200, outcome.hits);
        return;
      }

      if (path.startsWith('/graph/')) {
        const centre = decodeURIComponent(path.slice('/graph/'.length));
        const depth = Number(url.searchParams.get('depth') ?? '2');
        const hood = graph.neighbourhood({ centre, depth, participant });
        // La forma que ya consumen renderGraph y renderGraph3D de constel.
        send(response, 200, {
          nodes: hood.nodes.map((node) => ({
            id: node.page,
            name: graph.page(node.page)?.title ?? node.page,
            central: node.distance === 0,
            degree: node.degree,
            blockCount: node.blockCount,
          })),
          links: hood.edges.map((edge) => ({ source: edge.source, target: edge.target })),
        });
        return;
      }

      if (path === '/ops') {
        const since = Number(url.searchParams.get('since') ?? '0');
        send(
          response,
          200,
          graph
            .operations()
            .filter((op) => op.sequence > since)
            .map((op) => ({
              sequence: op.sequence,
              originId: op.originId,
              kind: op.submission.change.kind,
              subjectId: op.subjectId,
              authoredBy: op.submission.submittedBy,
              channel: op.submission.channel,
            })),
        );
        return;
      }

      if (path === '/invariants') {
        send(response, 200, checkInvariants(graph));
        return;
      }

      if (serveStatic(response, path)) return;

      // Reserva para las rutas de la aplicación. `/p/Lectogram` no es un archivo
      // y nunca lo será: es la propia aplicación pidiendo abrirse en esa página.
      // Sin esto, escribir la dirección a mano o recargar devolvía un 404, que
      // es tanto como no tener enrutado.
      if (webRoot !== null && !path.startsWith('/api') && serveStatic(response, '/index.html')) {
        return;
      }

      send(response, 404, { error: 'not found' });
    } catch (error) {
      send(response, 400, { error: error instanceof Error ? error.message : 'bad request' });
    }
  };

  // El grafo se expone por función y no por valor: puede reconstruirse, y quien
  // lo tuviera capturado se quedaría mirando el de antes.
  return {
    handle,
    get graph() {
      return graph;
    },
    store,
    close: () => store.close(),
  };
}

export function listen(options: ServerOptions & { port: number; host?: string }): {
  close(): Promise<void>;
  vera: VeraServer;
} {
  const vera = createVeraServer(options);
  const http = createServer((request, response) => vera.handle(request, response));
  // Loopback por defecto: Vera no autentica y `POST /operations` muta el grafo,
  // así que escuchar en todas las interfaces la deja escribible por cualquiera
  // en la red física. Quien la publique elige el frente (p. ej. tailscale serve,
  // que termina TLS y reenvía desde esta misma máquina).
  http.listen(options.port, options.host ?? '127.0.0.1');
  return {
    vera,
    close: () =>
      new Promise((done) => {
        http.close(() => {
          vera.close();
          done();
        });
      }),
  };
}
