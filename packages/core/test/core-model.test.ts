// Propagated from specs/core.allium — the structural and surface obligations.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { CHANGE_KINDS, CONTRIBUTION_CHANNELS, VISIBILITIES, checkInvariants } from '@vera/core';
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

describe('enumerations', () => {
  it('declares exactly the change vocabulary the spec settled on', () => {
    assert.deepEqual([...CHANGE_KINDS].sort(), [
      'create_block',
      'create_page',
      'edit_block',
      'move_block',
      'recover_page_origin',
      'remove_block',
      'remove_page',
      'remove_property',
      'rename_page',
      'set_page_visibility',
      'set_property',
    ]);
  });

  it('has no link_pages kind, because links are derived from content', () => {
    assert.ok(!CHANGE_KINDS.includes('link_pages' as never));
  });

  it('declares the six contribution channels', () => {
    assert.deepEqual([...CONTRIBUTION_CHANNELS].sort(), [
      'agent_generation',
      'authenticated_voice',
      'drawn',
      'import',
      'typed_text',
      'walked',
    ]);
  });

  // Caminar es producir: el testimonio de un cruce lo escribe quien anduvo, y sin
  // este canal lo firmaría Vera. Ver trail/TheTestimonyIsWrittenByWhoeverWalked.
  it('admits what someone produced by walking', () => {
    assert.ok(CONTRIBUTION_CHANNELS.includes('walked'));
  });

  /*
   * Dibujar es producir con la mano, y eso deja denominación de origen humana.
   * Es de la misma clase que la voz autenticada: una grabación prueba que
   * alguien habló, un trazo con su presión prueba que alguien lo hizo con la
   * mano. Ver hand-drawing/AHandLeavesItsName.
   */
  it('admits what someone drew with their hand', () => {
    assert.ok(CONTRIBUTION_CHANNELS.includes('drawn'));
  });

  it('declares two visibilities', () => {
    assert.deepEqual([...VISIBILITIES].sort(), ['private', 'public']);
  });
});

describe('entity fields', () => {
  it('gives a page a title, a visibility and a graph', () => {
    const graph = inhabitedGraph();
    const id = makePage(graph, 'Ficha', 'public');
    const page = graph.page(id);

    assert.equal(page?.title, 'Ficha');
    assert.equal(page?.visibility, 'public');
    assert.equal(page?.graph, graph.id);
  });

  it('gives a block a stable id, a page, a position and an optional parent', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Arbol');
    const root = makeBlock(graph, page, 'raiz', { position: 0 });
    const child = makeBlock(graph, page, 'hijo', { parent: root, position: 0 });

    assert.equal(graph.block(root)?.parent, null, 'a root block has no parent');
    assert.equal(graph.block(child)?.parent, root);
    assert.equal(graph.block(child)?.position, 0);
  });

  it('defaults a page to private', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Nueva');

    assert.equal(graph.page(page)?.visibility, 'private');
  });

  it('leaves evidence absent on a typed submission', () => {
    const graph = inhabitedGraph();
    makePage(graph, 'Escrita');

    assert.equal(graph.revisions().at(-1)?.evidence, undefined);
  });
});

describe('invariant BlockParentBelongsToSamePage', () => {
  it('holds after any sequence of changes', () => {
    fc.assert(
      fc.property(intents, (list) => {
        const graph = runIntents(list);
        for (const block of graph.allBlocks()) {
          if (block.parent === null) continue;
          assert.equal(graph.block(block.parent)?.page, block.page);
        }
      }),
    );
  });

  it('carries a subtree with its root when the root moves to another page', () => {
    const graph = inhabitedGraph();
    const here = makePage(graph, 'Aqui');
    const there = makePage(graph, 'Alla');
    const root = makeBlock(graph, here, 'raiz');
    const child = makeBlock(graph, here, 'hijo', { parent: root });

    submit(graph, { kind: 'move_block', block: root, page: there, parent: null, position: 0 });

    assert.equal(graph.block(child)?.page, there);
    assert.equal(graph.block(child)?.parent, root, 'the subtree keeps its shape');
  });
});

describe('invariant PrivatePagesAreNeverPublished', () => {
  it('refuses to publish a private page', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Privada');

    assert.throws(
      () => graph.publish({ page, path: '/privada/', participant: OWNER }),
      /private|visibility/i,
    );
  });

  it('publishes a public page for its human owner', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Publica', 'public');

    const publication = graph.publish({ page, path: '/publica/', participant: OWNER });

    assert.equal(publication.page, page);
    assert.equal(publication.path, '/publica/');
  });

  it('refuses to let an agent publish', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Publica', 'public');

    assert.throws(
      () => graph.publish({ page, path: '/publica/', participant: AGENT }),
      /human|owner/i,
    );
  });

  it('holds after any sequence of changes', () => {
    fc.assert(
      fc.property(intents, (list) => {
        const graph = runIntents(list);
        for (const publication of graph.publications()) {
          assert.equal(graph.page(publication.page)?.visibility, 'public');
        }
      }),
    );
  });
});

describe('surface GraphParticipation', () => {
  it('exposes the graph name and its pages to an active participant', () => {
    const graph = inhabitedGraph();
    makePage(graph, 'Visible');

    const view = graph.participationSurface(AGENT);

    assert.equal(view.name, 'mind');
    assert.equal(view.pages.length, 1);
  });

  it('is absent for a participant with no membership', () => {
    const graph = inhabitedGraph();

    assert.throws(() => graph.participationSurface(OUTSIDER));
  });

  it('is absent for a suspended participant', () => {
    const graph = inhabitedGraph();
    graph.suspend(AGENT);

    assert.throws(() => graph.participationSurface(AGENT));
  });
});

describe('the invariant checker itself', () => {
  it('reports nothing on a graph built only through the write path', () => {
    fc.assert(
      fc.property(intents, (list) => {
        assert.deepEqual(checkInvariants(runIntents(list)), []);
      }),
    );
  });

  it('names the invariant it caught when state is corrupted directly', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Corrupta');
    const a = makeBlock(graph, page, 'uno');
    const b = makeBlock(graph, page, 'dos');

    // Deliberately bypassing submitOperation: this is the situation the checker exists for.
    graph.unsafeSetBlockStableId(b, a);

    const violations = checkInvariants(graph);
    assert.ok(violations.some((v) => v.invariant === 'BlockStableIdentityIsUnique'));
  });
});
