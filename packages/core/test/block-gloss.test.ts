import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { inhabitedGraph, makeBlock, makePage, submit } from './helpers.ts';

describe('glosa canónica del bloque', () => {
  it('crea una sola glosa y las revisiones posteriores editan la misma', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Texto');
    const block = makeBlock(graph, page, 'Pasaje');

    assert.equal(submit(graph, { kind: 'set_block_gloss', block, content: 'Primera lectura' }).status, 'applied');
    const created = graph.gloss(block)?.createdAt;
    assert.equal(submit(graph, { kind: 'set_block_gloss', block, content: 'Lectura afinada' }).status, 'applied');

    assert.equal(graph.glosses().length, 1);
    assert.equal(graph.gloss(block)?.content, 'Lectura afinada');
    assert.equal(graph.gloss(block)?.createdAt, created);
  });

  it('se busca como marginalia y conserva el bloque que acompaña', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Texto');
    const block = makeBlock(graph, page, 'Pasaje sin esa palabra');
    submit(graph, { kind: 'set_block_gloss', block, content: 'hospitalidad radical' });

    const hit = graph.search({ text: 'hospitalidad', participant: 'participant:herbert' }).hits[0];
    assert.equal(hit?.field, 'gloss_content');
    assert.equal(hit?.block, block);
  });

  it('desaparece con el bloque y vuelve al reproducir el registro', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'Texto');
    const block = makeBlock(graph, page, 'Pasaje');
    submit(graph, { kind: 'set_block_gloss', block, content: 'Marginalia' });

    assert.equal(graph.replayFromLog().gloss(block)?.content, 'Marginalia');
    submit(graph, { kind: 'remove_block', block });
    assert.equal(graph.gloss(block), undefined);
  });
});
