// Test helpers for the v0 specs.
//
// These helpers are the implementation bridge: they pin the API that
// packages/core must provide. Spec fields are snake_case; the TypeScript
// surface is camelCase, and the mapping is one-to-one.
//
// Nothing here is implemented yet. Every test in this directory is red until
// packages/core/src/index.ts exists.

import fc from 'fast-check';
import {
  VeraGraph,
  type Change,
  type ContributionChannel,
  type OriginEvidence,
  type SubmitOutcome,
} from '@vera/core';

export const OWNER = 'participant:herbert';
export const AGENT = 'participant:cotito';
export const OUTSIDER = 'participant:outsider';

/** A graph with one active human owner and one active agent, and nothing else. */
export function inhabitedGraph(): VeraGraph {
  const graph = VeraGraph.create({ name: 'mind' });
  graph.addParticipant({ id: OWNER, name: 'Herbert', kind: 'human' });
  graph.addParticipant({ id: AGENT, name: 'Cotito', kind: 'agent' });
  graph.admit(OWNER);
  graph.admit(AGENT);
  return graph;
}

let counter = 0;
/** Origin ids are the idempotency key, so tests must be able to reuse one deliberately. */
export function originId(prefix = 'op'): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export interface SubmitOptions {
  participant?: string;
  channel?: ContributionChannel;
  evidence?: OriginEvidence;
  origin?: string;
}

/** The single write path. Every mutation in every test goes through here. */
export function submit(
  graph: VeraGraph,
  change: Change,
  options: SubmitOptions = {},
): SubmitOutcome {
  return graph.submitOperation({
    originId: options.origin ?? originId(),
    participant: options.participant ?? OWNER,
    channel: options.channel ?? 'typed_text',
    evidence: options.evidence,
    change,
  });
}

/** Asserts the outcome applied, and returns the id the change produced. */
export function applied(outcome: SubmitOutcome): string {
  if (outcome.status !== 'applied') {
    throw new Error(
      `expected the operation to apply, got ${outcome.status}` +
        ('reason' in outcome ? `: ${outcome.reason}` : ''),
    );
  }
  return outcome.subjectId;
}

/** Creates a page and returns its id. */
export function makePage(
  graph: VeraGraph,
  title: string,
  visibility: 'private' | 'public' = 'private',
): string {
  return applied(submit(graph, { kind: 'create_page', title, visibility }));
}

/** Creates a block on a page and returns its stable id. */
export function makeBlock(
  graph: VeraGraph,
  page: string,
  content: string,
  options: { parent?: string; position?: number } = {},
): string {
  return applied(
    submit(graph, {
      kind: 'create_block',
      page,
      parent: options.parent ?? null,
      position: options.position ?? 0,
      content,
    }),
  );
}

// ---------------------------------------------------------------------------
// Property-based generation
// ---------------------------------------------------------------------------

/**
 * Abstract intents. Indices are resolved against the graph's current state at
 * apply time, because a generator cannot know which pages and blocks exist.
 */
export type Intent =
  | { t: 'createPage'; title: string }
  | { t: 'renamePage'; pageIdx: number; title: string }
  | { t: 'setVisibility'; pageIdx: number; visibility: 'private' | 'public' }
  | { t: 'createBlock'; pageIdx: number; content: string; nest: boolean }
  | { t: 'editBlock'; blockIdx: number; content: string }
  | { t: 'moveBlock'; blockIdx: number; pageIdx: number; nest: boolean }
  | { t: 'removeBlock'; blockIdx: number }
  | { t: 'setProperty'; pageIdx: number; key: string; value: string }
  | { t: 'removeProperty'; pageIdx: number; key: string };

// Un vocabulario pequeño y cerrado, para que los enlaces resuelvan de verdad.
// Con títulos aleatorios, `[[algo]]` casi nunca nombra una página existente y
// los invariantes de enlace no se ejercitan nunca.
const TITLES = [
  'Amereida',
  'Travesia',
  'Observacion',
  'Ciudad abierta',
  'Poesia',
  'Oficio',
  'Taller',
] as const;
const TAGS = ['accesibilidad', 'diseno', 'ead', 'travesia'] as const;

const title = fc.constantFrom(...TITLES);
const idx = fc.nat({ max: 20 });
const key = fc.constantFrom('status', 'lang', 'type', 'public', 'tags');

/** Contenido que a menudo enlaza y etiqueta, como el corpus real. */
const content: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('apunte', 'nota sobre el', 'fragmento de', 'idea'),
    fc.option(fc.constantFrom(...TITLES), { nil: undefined }),
    fc.option(fc.constantFrom(...TAGS), { nil: undefined }),
  )
  .map(([lead, link, tag]) =>
    [lead, link === undefined ? '' : `[[${link}]]`, tag === undefined ? '' : `#${tag}`]
      .filter((part) => part !== '')
      .join(' '),
  );

export const intent: fc.Arbitrary<Intent> = fc.oneof(
  { arbitrary: fc.record({ t: fc.constant('createPage' as const), title }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('renamePage' as const), pageIdx: idx, title }), weight: 1 },
  {
    arbitrary: fc.record({
      t: fc.constant('setVisibility' as const),
      pageIdx: idx,
      visibility: fc.constantFrom('private' as const, 'public' as const),
    }),
    weight: 1,
  },
  {
    arbitrary: fc.record({
      t: fc.constant('createBlock' as const),
      pageIdx: idx,
      content,
      nest: fc.boolean(),
    }),
    weight: 5,
  },
  {
    arbitrary: fc.record({ t: fc.constant('editBlock' as const), blockIdx: idx, content }),
    weight: 3,
  },
  {
    arbitrary: fc.record({
      t: fc.constant('moveBlock' as const),
      blockIdx: idx,
      pageIdx: idx,
      nest: fc.boolean(),
    }),
    weight: 2,
  },
  { arbitrary: fc.record({ t: fc.constant('removeBlock' as const), blockIdx: idx }), weight: 2 },
  {
    arbitrary: fc.record({
      t: fc.constant('setProperty' as const),
      pageIdx: idx,
      key,
      value: fc.constantFrom('draft', 'done', 'es', 'en', 'note'),
    }),
    weight: 2,
  },
  {
    arbitrary: fc.record({ t: fc.constant('removeProperty' as const), pageIdx: idx, key }),
    weight: 1,
  },
);

/**
 * Toda secuencia empieza creando páginas. Sin eso la mayoría de los intents
 * apuntan a un grafo vacío, se rechazan, y la propiedad pasa sin haber
 * construido nada que verificar.
 */
export const intents: fc.Arbitrary<Intent[]> = fc
  .tuple(
    fc.uniqueArray(fc.constantFrom(...TITLES), { minLength: 2, maxLength: 5 }),
    fc.array(intent, { minLength: 1, maxLength: 40 }),
  )
  .map(([seed, rest]) => [
    ...seed.map((t): Intent => ({ t: 'createPage', title: t })),
    ...rest,
  ]);

/** Resolves an intent against current state and submits it. Unresolvable intents are skipped. */
export function applyIntent(graph: VeraGraph, i: Intent): void {
  const pages = graph.pages().map((p) => p.id);
  const blocks = graph.allBlocks().map((b) => b.stableId);
  const page = (n: number): string | undefined => pages[n % Math.max(pages.length, 1)];
  const block = (n: number): string | undefined => blocks[n % Math.max(blocks.length, 1)];

  switch (i.t) {
    case 'createPage':
      submit(graph, { kind: 'create_page', title: i.title, visibility: 'private' });
      return;
    case 'renamePage': {
      const p = page(i.pageIdx);
      if (p) submit(graph, { kind: 'rename_page', page: p, title: i.title });
      return;
    }
    case 'setVisibility': {
      const p = page(i.pageIdx);
      if (p) submit(graph, { kind: 'set_page_visibility', page: p, visibility: i.visibility });
      return;
    }
    case 'createBlock': {
      const p = page(i.pageIdx);
      if (!p) return;
      // Anidar de verdad, o el invariante BlockParentBelongsToSamePage nunca
      // llega a tener un padre que verificar.
      const siblings = graph.blocksOf(p);
      const parent = i.nest && siblings.length > 0 ? (siblings[0]?.stableId ?? null) : null;
      submit(graph, {
        kind: 'create_block',
        page: p,
        parent,
        position: siblings.length,
        content: i.content,
      });
      return;
    }
    case 'editBlock': {
      const b = block(i.blockIdx);
      if (b) submit(graph, { kind: 'edit_block', block: b, content: i.content });
      return;
    }
    case 'moveBlock': {
      const b = block(i.blockIdx);
      const p = page(i.pageIdx);
      if (!b || !p) return;
      const candidates = graph
        .blocksOf(p)
        .filter((c) => c.stableId !== b && !graph.descendantsOf(b).some((d) => d.stableId === c.stableId));
      const parent = i.nest && candidates.length > 0 ? (candidates[0]?.stableId ?? null) : null;
      submit(graph, {
        kind: 'move_block',
        block: b,
        page: p,
        parent,
        position: graph.blocksOf(p).length,
      });
      return;
    }
    case 'removeBlock': {
      // Preferir hojas: sólo ellas son removibles, y apuntar siempre a un padre
      // convierte esta rama en un rechazo garantizado.
      const leaves = graph.allBlocks().filter((b) => graph.childrenOf(b.stableId).length === 0);
      const leaf = leaves[i.blockIdx % Math.max(leaves.length, 1)];
      if (leaf) submit(graph, { kind: 'remove_block', block: leaf.stableId });
      return;
    }
    case 'setProperty': {
      const p = page(i.pageIdx);
      if (p) {
        submit(graph, {
          kind: 'set_property',
          page: p,
          propertyKey: i.key,
          propertyValue: i.value,
        });
      }
      return;
    }
    case 'removeProperty': {
      const p = page(i.pageIdx);
      if (p) submit(graph, { kind: 'remove_property', page: p, propertyKey: i.key });
      return;
    }
  }
}

/** Runs a whole intent sequence against a fresh inhabited graph. */
export function runIntents(list: readonly Intent[]): VeraGraph {
  const graph = inhabitedGraph();
  for (const i of list) applyIntent(graph, i);
  return graph;
}
