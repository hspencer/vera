// Propagated from specs/search-index.allium and specs/query-language.allium.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { and, contentTerm, linksTo, not, or, propertyTerm, tagTerm, titleTerm } from '@vera/core';
import {
  AGENT,
  OUTSIDER,
  OWNER,
  inhabitedGraph,
  intents,
  makeBlock,
  makePage,
  runIntents,
  submit,
} from './helpers.ts';

// ---------------------------------------------------------------------------
// search-index.allium
// ---------------------------------------------------------------------------

describe('search', () => {
  it('finds a page by its title', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Taller de Amereida');

    const outcome = graph.search({ text: 'Amereida', participant: OWNER });

    assert.ok(outcome.hits.some((h) => h.page === page && h.field === 'page_title'));
  });

  it('finds a block by its content and names the block', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Observacion');
    const block = makeBlock(graph, page, 'la travesia comienza en el desierto');

    const outcome = graph.search({ text: 'desierto', participant: OWNER });

    const hit = outcome.hits.find((h) => h.field === 'block_content');
    assert.equal(hit?.block, block, '@invariant BlockContentHitsNameTheirBlock');
    assert.equal(hit?.page, page);
  });

  it('finds a page by a property value', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Ficha');
    submit(graph, { kind: 'set_property', page, propertyKey: 'type', propertyValue: 'note' });

    const outcome = graph.search({ text: 'note', participant: OWNER });

    assert.ok(outcome.hits.some((h) => h.page === page && h.field === 'property_value'));
  });

  it('covers titles, content and properties in one search', () => {
    const graph = inhabitedGraph();
    const byTitle = makePage(graph, 'travesia');
    const holder = makePage(graph, 'Otra');
    makeBlock(graph, holder, 'una travesia distinta');
    const byProp = makePage(graph, 'Tercera');
    submit(graph, {
      kind: 'set_property',
      page: byProp,
      propertyKey: 'tags',
      propertyValue: 'travesia',
    });

    const outcome = graph.search({ text: 'travesia', participant: OWNER });
    const fields = new Set(outcome.hits.map((h) => h.field));

    assert.deepEqual(
      [...fields].sort(),
      ['block_content', 'page_title', 'property_value'],
      '@guarantee OneSearchReachesEverySearchableField',
    );
    assert.ok(outcome.hits.some((h) => h.page === byTitle));
  });

  it('finds nothing for an empty text', () => {
    const graph = inhabitedGraph();
    makePage(graph, 'Cualquiera');

    const outcome = graph.search({ text: '', participant: OWNER });

    assert.equal(outcome.hits.length, 0, '@invariant EmptyTextFindsNothing');
  });

  it('reflects a change as soon as it is applied', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Fresca');
    const block = makeBlock(graph, page, 'antes');

    assert.equal(graph.search({ text: 'despues', participant: OWNER }).hits.length, 0);
    submit(graph, { kind: 'edit_block', block, content: 'despues' });

    assert.ok(
      graph.search({ text: 'despues', participant: OWNER }).hits.length > 0,
      '@invariant IndexFollowsAppliedChange',
    );
    assert.equal(graph.search({ text: 'antes', participant: OWNER }).hits.length, 0);
  });

  it('drops hits for content that has been removed', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Efimera');
    const block = makeBlock(graph, page, 'contenido borrable');

    submit(graph, { kind: 'remove_block', block });

    assert.equal(graph.search({ text: 'borrable', participant: OWNER }).hits.length, 0);
  });

  it('refuses a participant with no active membership', () => {
    const graph = inhabitedGraph();
    makePage(graph, 'Privada');

    assert.throws(() => graph.search({ text: 'Privada', participant: OUTSIDER }));
  });

  it('carries an excerpt on every hit', () => {
    fc.assert(
      fc.property(intents, fc.string({ minLength: 1, maxLength: 6 }), (list, text) => {
        const graph = runIntents(list);
        for (const hit of graph.search({ text, participant: OWNER }).hits) {
          assert.notEqual(hit.excerpt, '', '@invariant HitCarriesItsEvidence');
        }
      }),
    );
  });

  it('ranks hits uniquely and positively, and repeats the order exactly', () => {
    fc.assert(
      fc.property(intents, fc.string({ minLength: 1, maxLength: 6 }), (list, text) => {
        const graph = runIntents(list);
        const first = graph.search({ text, participant: OWNER });
        const second = graph.search({ text, participant: OWNER });

        const ranks = first.hits.map((h) => h.rank);
        assert.equal(new Set(ranks).size, ranks.length, '@invariant RankIsUniqueWithinOutcome');
        for (const rank of ranks) assert.ok(rank >= 1, '@invariant RankIsPositive');

        assert.deepEqual(
          second.hits.map((h) => [h.page, h.block, h.rank]),
          first.hits.map((h) => [h.page, h.block, h.rank]),
          '@invariant StableOrdering',
        );
      }),
    );
  });

  it('returns hits only from the graph it searched', () => {
    fc.assert(
      fc.property(intents, fc.string({ minLength: 1, maxLength: 6 }), (list, text) => {
        const graph = runIntents(list);
        const pages = new Set(graph.pages().map((p) => p.id));
        for (const hit of graph.search({ text, participant: OWNER }).hits) {
          assert.ok(pages.has(hit.page), '@invariant CurrentGraphOnly');
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// query-language.allium
// ---------------------------------------------------------------------------

describe('query terms', () => {
  it('selects by title', () => {
    const graph = inhabitedGraph();
    const wanted = makePage(graph, 'Amereida');
    makePage(graph, 'Otra cosa');

    const result = graph.query({ expression: titleTerm('Amereida'), participant: OWNER });

    assert.deepEqual(result.matchingPages, [wanted]);
  });

  it('selects by property key and value', () => {
    const graph = inhabitedGraph();
    const draft = makePage(graph, 'Borrador');
    const done = makePage(graph, 'Lista');
    submit(graph, { kind: 'set_property', page: draft, propertyKey: 'status', propertyValue: 'draft' });
    submit(graph, { kind: 'set_property', page: done, propertyKey: 'status', propertyValue: 'done' });

    const result = graph.query({
      expression: propertyTerm('status', 'draft'),
      participant: OWNER,
    });

    assert.deepEqual(result.matchingPages, [draft]);
  });

  it('selects by the mere presence of a property when no value is given', () => {
    const graph = inhabitedGraph();
    const tagged = makePage(graph, 'Con lang');
    makePage(graph, 'Sin lang');
    submit(graph, { kind: 'set_property', page: tagged, propertyKey: 'lang', propertyValue: 'es' });

    const result = graph.query({ expression: propertyTerm('lang'), participant: OWNER });

    assert.deepEqual(result.matchingPages, [tagged]);
  });

  it('selects by tag', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Etiquetada');
    makeBlock(graph, page, 'algo #accesibilidad importante');

    const result = graph.query({ expression: tagTerm('accesibilidad'), participant: OWNER });

    assert.deepEqual(result.matchingPages, [page]);
  });

  it('selects the pages that link to a page', () => {
    const graph = inhabitedGraph();
    makePage(graph, 'Centro');
    const source = makePage(graph, 'Origen');
    makePage(graph, 'Ajena');
    makeBlock(graph, source, 'ver [[Centro]]');

    const result = graph.query({ expression: linksTo('Centro'), participant: OWNER });

    assert.deepEqual(result.matchingPages, [source]);
  });

  it('selects by the title that was written, even without distinguishing case', () => {
    const graph = inhabitedGraph();
    makePage(graph, 'Ciudad Abierta');
    const source = makePage(graph, 'Origen');
    makeBlock(graph, source, 'ver [[ciudad abierta]]');

    const result = graph.query({ expression: linksTo('Ciudad Abierta'), participant: OWNER });

    assert.deepEqual(result.matchingPages, [source]);
  });

  it('a title no page carries selects nothing, which is the answer and not an error', () => {
    const graph = inhabitedGraph();
    const source = makePage(graph, 'Origen');
    makeBlock(graph, source, 'ver [[Nadie la ha escrito]]');

    // El enlace existe aunque su destino no: preguntar por el título encuentra la
    // página que lo nombra, y preguntar por otro no encuentra nada.
    assert.deepEqual(
      graph.query({ expression: linksTo('Nadie la ha escrito'), participant: OWNER }).matchingPages,
      [source],
    );
    assert.deepEqual(
      graph.query({ expression: linksTo('Otra cualquiera'), participant: OWNER }).matchingPages,
      [],
    );
  });

  it('composes terms with and', () => {
    const graph = inhabitedGraph();
    const both = makePage(graph, 'Ambas');
    const one = makePage(graph, 'Solo una');
    for (const page of [both, one]) {
      submit(graph, { kind: 'set_property', page, propertyKey: 'lang', propertyValue: 'es' });
    }
    submit(graph, { kind: 'set_property', page: both, propertyKey: 'status', propertyValue: 'draft' });

    const result = graph.query({
      expression: and(propertyTerm('lang', 'es'), propertyTerm('status', 'draft')),
      participant: OWNER,
    });

    assert.deepEqual(result.matchingPages, [both]);
  });

  it('composes terms with or', () => {
    const graph = inhabitedGraph();
    const a = makePage(graph, 'Alfa');
    const b = makePage(graph, 'Beta');
    makePage(graph, 'Gamma');

    const result = graph.query({
      expression: or(titleTerm('Alfa'), titleTerm('Beta')),
      participant: OWNER,
    });

    assert.deepEqual([...result.matchingPages].sort(), [a, b].sort());
  });

  it('scopes negation to the current graph rather than an empty universe', () => {
    const graph = inhabitedGraph();
    const draft = makePage(graph, 'Borrador');
    const other = makePage(graph, 'Otra');
    submit(graph, { kind: 'set_property', page: draft, propertyKey: 'status', propertyValue: 'draft' });

    const result = graph.query({
      expression: not(propertyTerm('status', 'draft')),
      participant: OWNER,
    });

    assert.deepEqual(
      result.matchingPages,
      [other],
      '@invariant NegationIsGraphScoped',
    );
  });

  it('rejects a combining term with fewer than two operands', () => {
    assert.throws(() => and(titleTerm('sola')), /two/i);
    assert.throws(() => or(titleTerm('sola')), /two/i);
  });

  it('evaluates the same expression to the same result', () => {
    fc.assert(
      fc.property(intents, (list) => {
        const graph = runIntents(list);
        const expression = propertyTerm('status', 'draft');
        const first = graph.query({ expression, participant: OWNER });
        const second = graph.query({ expression, participant: AGENT });

        assert.deepEqual(
          [...second.matchingPages].sort(),
          [...first.matchingPages].sort(),
          '@invariant DeterministicEvaluation',
        );
      }),
    );
  });

  it('selects only from the graph it names', () => {
    fc.assert(
      fc.property(intents, (list) => {
        const graph = runIntents(list);
        const pages = new Set(graph.pages().map((p) => p.id));
        const result = graph.query({ expression: propertyTerm('status'), participant: OWNER });
        for (const page of result.matchingPages) assert.ok(pages.has(page));
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// @invariant NoSilentTranslation — the 32 Logseq queries in the corpus
// ---------------------------------------------------------------------------

describe('unported Logseq queries', () => {
  it('preserves the macro text verbatim without evaluating it', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Con query');
    const source = '{{query (and [[proyecto]] (property status "draft"))}}';
    const block = makeBlock(graph, page, source);

    const unported = graph.unportedQueries().find((u) => u.block === block);

    assert.equal(unported?.sourceText, source);
    assert.equal(unported?.portedTo, null, 'Vera must not guess what it meant');
  });

  it('records who ported a legacy query and when', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Con query');
    const block = makeBlock(graph, page, '{{query (property status "draft")}}');
    const unported = graph.unportedQueries().find((u) => u.block === block);
    assert.ok(unported);

    graph.portLegacyQuery({
      unported: unported.id,
      expression: propertyTerm('status', 'draft'),
      participant: OWNER,
    });

    const after = graph.unportedQueries().find((u) => u.block === block);
    assert.notEqual(after?.portedTo, null);
    assert.equal(after?.portedBy, OWNER, '@invariant PortingIsAttributed');
    assert.equal(after?.sourceText, '{{query (property status "draft")}}');
  });

  it('refuses to port a query that has already been ported', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Con query');
    const block = makeBlock(graph, page, '{{query (property lang "es")}}');
    const unported = graph.unportedQueries().find((u) => u.block === block);
    assert.ok(unported);

    const port = () =>
      graph.portLegacyQuery({
        unported: unported.id,
        expression: propertyTerm('lang', 'es'),
        participant: OWNER,
      });

    port();
    assert.throws(port);
  });

  it('holds at most one unported record per block', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Con query');
    const block = makeBlock(graph, page, '{{query (property lang "es")}}');
    submit(graph, { kind: 'edit_block', block, content: '{{query (property lang "en")}}' });

    const held = graph.unportedQueries().filter((u) => u.block === block);
    assert.equal(held.length, 1, '@invariant OneUnportedRecordPerBlock');
  });
});
