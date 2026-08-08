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
  checkInvariants,
  readQuery,
  writeQuery,
  CHANGE_KINDS as CORE_CHANGE_KINDS,
  CONTRIBUTION_CHANNELS,
} from '@vera/core';
import type { Change, ContributionChannel, OriginEvidence, ParticipantId } from '@vera/core';
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
import { readPage, mergeReadings, modelPresence, MOST_PASSES, READABLE_CHARS, STARTER_TYPES } from './model.ts';
import { mentionsOf } from './mentions.ts';
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

  // El grafo en memoria se reconstruye del log al arrancar y responde las
  // lecturas; el disco conserva la verdad.
  const graph = loadGraph(store, 'mind');

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
                .find((block) => /^Tipos iniciales/i.test(block.content));
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
    if (request.method === 'GET' && path === '/special-pages') {
      const found = graph
        .pages()
        .map((page) => ({
          page,
          kind: graph
            .propertiesOf(page.id)
            .find((property) => property.key === 'special-kind')?.value,
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
        let body: { source?: unknown; participant?: unknown };
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

        const found = outcome.matchingPages
          .map((id) => graph.page(id))
          .filter((page): page is NonNullable<typeof page> => page !== undefined)
          .map((page) => ({
            id: page.id,
            title: page.title,
            type:
              graph.propertiesOf(page.id).find((property) => property.key === 'type')?.value ?? null,
            updated: graph.updatedAt(page.id),
            says: says.get(page.id) ?? null,
          }))
          .sort((a, b) => a.title.localeCompare(b.title, 'es'));

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
          assets: (() => {
            const text = graph
              .blocksOf(page.id)
              .map((block) => block.content)
              .join('\n');
            return media
              .filter((entry) => text.includes(entry.path))
              .map((entry) => ({
                path: entry.path,
                url: `/media/${entry.hash}`,
                mediaType: entry.mediaType,
              }));
          })(),
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

  return { handle, graph, store, close: () => store.close() };
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
