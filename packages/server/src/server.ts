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
  advanceRecording,
  correctTranscript,
  createRecording,
  foldedOnPage,
  loadGraph,
  mediaByHash,
  mediaReferences,
  openStore,
  recordOperation,
  recordMedia,
  recordingById,
  recordings,
  saveParticipant,
  setFold,
  setSpokenOrigin,
  spokenOriginsOnPage,
  type Store,
} from '@vera/store';
import { HASH, objectPath, putObject } from '@vera/store/objects';
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

const EXCERPT = 140;

/** Una línea legible del bloque, sin arrastrar transcripciones enteras. */
function excerpt(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length <= EXCERPT ? flat : `${flat.slice(0, EXCERPT).trimEnd()}…`;
}

/** Valida la forma del cuerpo antes de dejarlo entrar al dominio. */
function readOperation(body: SubmitBody): { error: string } | {
  originId: string;
  participant: ParticipantId;
  channel: ContributionChannel;
  evidence?: OriginEvidence;
  change: Change;
} {
  if (typeof body.originId !== 'string' || body.originId === '') {
    return { error: 'originId must be a non-empty string' };
  }
  if (typeof body.participant !== 'string' || body.participant === '') {
    return { error: 'participant must be a non-empty string' };
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
    participant: body.participant,
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

        const outcome = graph.submitOperation(input);
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
    // La cascada de validación desde la voz
    // -----------------------------------------------------------------------
    //
    // Cada ruta mueve la grabación un eslabón, y sólo uno. El orden lo impone
    // `advanceRecording`, así que el contenido no se puede asentar desde una
    // transcripción que nadie validó ni saltándose la transcripción entera.

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
        });

        send(response, 201, recording);
      });
      return;
    }

    if (request.method === 'POST' && /^\/recordings\/[^/]+\/transcribe$/.test(path)) {
      const id = decodeURIComponent(path.split('/')[2] ?? '');
      const held = recordingById(store, id);
      if (held === null) {
        send(response, 404, { error: 'no such recording' });
        return;
      }
      if (held.audioHash === null || objectsRoot === null) {
        send(response, 422, { error: 'la grabación ya no tiene audio que transcribir' });
        return;
      }

      const audio = readFileSync(objectPath(objectsRoot, held.audioHash));
      void transcribeAudio(audio).then((outcome) => {
        if ('error' in outcome) {
          send(response, 502, outcome);
          return;
        }
        // Queda propuesta, nunca validada: eso lo hace una persona.
        const moved = advanceRecording(store, id, 'transcribed', { transcript: outcome.text });
        send(response, 'error' in moved ? 422 : 200, moved);
      });
      return;
    }

    if (request.method === 'POST' && /^\/recordings\/[^/]+\/(transcript|validate|settle)$/.test(path)) {
      const parts = path.split('/');
      const id = decodeURIComponent(parts[2] ?? '');
      const action = parts[3] ?? '';

      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let body: { text?: unknown; page?: unknown } = {};
        if (chunks.length > 0) {
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
          } catch {
            send(response, 400, { error: 'the body must be JSON' });
            return;
          }
        }

        if (action === 'transcript') {
          const outcome = correctTranscript(store, id, String(body.text ?? ''));
          send(response, 'error' in outcome ? 422 : 200, outcome);
          return;
        }

        if (action === 'validate') {
          const outcome = advanceRecording(store, id, 'transcript_validated', {
            validatedBy: owner.id,
          });
          send(response, 'error' in outcome ? 422 : 200, outcome);
          return;
        }

        // Asentar: la transcripción validada se vuelve bloques, y cada uno nace
        // nombrando la grabación. Es el único momento en que puede recibir su
        // denominación de origen.
        const held = recordingById(store, id);
        const page = typeof body.page === 'string' ? body.page : '';
        if (held === null) {
          send(response, 404, { error: 'no such recording' });
          return;
        }
        if (held.stage !== 'transcript_validated') {
          send(response, 422, { error: 'la transcripción todavía no está validada' });
          return;
        }
        if (graph.page(page) === undefined) {
          send(response, 404, { error: 'no such page' });
          return;
        }

        const fragments = held.transcript
          ?.split(/\n{2,}/)
          .map((fragment) => fragment.trim())
          .filter((fragment) => fragment !== '') ?? [];
        if (fragments.length === 0) {
          send(response, 422, { error: 'la transcripción no tiene contenido que asentar' });
          return;
        }

        const created: string[] = [];
        const at = graph.blocksOf(page).filter((block) => block.parent === null).length;

        try {
          for (const [n, fragment] of fragments.entries()) {
            // Canal `authenticated_voice` con su evidencia: es lo que el
            // registro guardará de por vida sobre estos bloques.
            const outcome = graph.submitOperation({
              originId: `voice:${id}:${n}`,
              participant: owner.id,
              channel: 'authenticated_voice',
              evidence: held.evidence,
              change: { kind: 'create_block', page, parent: null, position: at + n, content: fragment },
            });
            if (outcome.status !== 'applied') continue;
            recordOperation(store, graph, outcome.operation);
            setSpokenOrigin(store, outcome.subjectId, id);
            created.push(outcome.subjectId);
          }
        } catch (error) {
          send(response, 500, {
            error: 'no se pudo asentar el contenido',
            detail: error instanceof Error ? error.message : String(error),
          });
          return;
        }

        const moved = advanceRecording(store, id, 'content_settled');
        send(response, 200, { recording: moved, blocks: created });
      });
      return;
    }

    if (request.method === 'GET' && path === '/recordings') {
      send(response, 200, recordings(store));
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
