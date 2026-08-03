// Servidor local de Vera.
//
// Es deliberadamente pequeño: sin framework, sobre el HTTP que trae Node. La
// única entrada de escritura es POST /operations, que valida contra @vera/core
// y sólo entonces persiste. No hay ningún camino que escriba en la base sin
// pasar por ahí.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

import { VeraGraph, checkInvariants } from '@vera/core';
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
import { readPage, modelPresence, STARTER_TYPES } from './model.ts';
import { readLinks } from './process.ts';
import { transcribeAudio } from './transcribe.ts';
import { renderPage } from '@vera/store/projection';

const CHANGE_KINDS = new Set([
  'create_page',
  'rename_page',
  'set_page_visibility',
  'remove_page',
  'create_block',
  'edit_block',
  'move_block',
  'remove_block',
  'set_property',
  'remove_property',
]);

const CHANNELS = new Set(['typed_text', 'authenticated_voice', 'agent_generation', 'import']);

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
  const owner = options.owner ?? { id: 'participant:herbert', name: 'Herbert' };
  saveParticipant(store, { id: owner.id, name: owner.name, kind: 'human' });

  // El grafo en memoria se reconstruye del log al arrancar y responde las
  // lecturas; el disco conserva la verdad.
  const graph = loadGraph(store, 'mind');
  if (graph.participant(owner.id) === undefined) {
    graph.addParticipant({ id: owner.id, name: owner.name, kind: 'human' });
    graph.admit(owner.id);
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
    response.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
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

      void Promise.all([readLinks(text), readPage(page.title, text, vocabulary)]).then(
        ([reading, understood]) => {
          // @invariant TheModelIsLocalOrThereIsNone y @guarantee
          // ProcessingSaysWhatItDidAndWhatItCouldNot: lo que no se pudo hacer se
          // dice, porque un resultado parcial callado se lee como uno completo.
          const notDone = [...reading.notDone];
          if ('error' in understood) notDone.push(understood.error);

          send(response, 200, {
            page: page.id,
            links: reading.links,
            types: 'error' in understood ? [] : understood.types,
            concepts: 'error' in understood ? [] : understood.concepts,
            notDone,
          });
        },
      );
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
          properties: graph.propertiesOf(page.id).map((p) => ({ key: p.key, value: p.value })),
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
