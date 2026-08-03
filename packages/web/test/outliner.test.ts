// Pruebas de la lógica pura del outliner: no tocan el DOM.
//
// La sesión de edición vive ahora en session.ts y se prueba aparte: Escape dejó
// de descartar, así que los casos que lo fijaban ya no describen nada.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildNeighbourhoods, buildTree } from '../src/outliner.ts';
import type { BlockView } from '../src/api.ts';

const block = (stableId: string, parent: string | null, position: number): BlockView => ({
  stableId,
  parent,
  position,
  content: stableId,
});

describe('buildTree', () => {
  it('anida por parent y ordena por position', () => {
    const tree = buildTree([
      block('b', 'a', 1),
      block('a', null, 0),
      block('c', 'a', 0),
    ]);

    assert.equal(tree.length, 1);
    assert.equal(tree[0]?.block.stableId, 'a');
    assert.deepEqual(tree[0]?.children.map((n) => n.block.stableId), ['c', 'b']);
  });

  it('trata como raíz un bloque cuyo padre no vino en la página', () => {
    const tree = buildTree([block('huerfano', 'ausente', 0)]);
    assert.equal(tree.length, 1);
    assert.equal(tree[0]?.block.stableId, 'huerfano');
  });

  it('no pierde ningún bloque', () => {
    const blocks = [
      block('a', null, 0),
      block('b', 'a', 0),
      block('c', 'b', 0),
      block('d', null, 1),
    ];
    const count = (nodes: ReturnType<typeof buildTree>): number =>
      nodes.reduce((n, node) => n + 1 + count(node.children), 0);
    assert.equal(count(buildTree(blocks)), blocks.length);
  });
});

describe('buildNeighbourhoods', () => {
  const nodo = (id: string, children: ReturnType<typeof nodo>[] = []) => ({
    block: { stableId: id, parent: null, position: 0, content: id },
    children,
  });

  it('encadena el orden de lectura, no el de hermanos', () => {
    // a, su hijo a1, y luego b. Lo que está «encima» de b es a1, no a.
    const tree = [nodo('a', [nodo('a1')]), nodo('b')];
    const near = buildNeighbourhoods(tree as never);

    assert.equal(near.get('b')?.previousVisible?.block, 'a1');
    assert.equal(near.get('a1')?.previousVisible?.block, 'a');
    assert.equal(near.get('a')?.previousVisible, null);
    assert.equal(near.get('a')?.nextVisible, 'a1');
  });

  it('el hermano anterior se salta a los hijos del medio', () => {
    const tree = [nodo('a', [nodo('a1')]), nodo('b')];
    const near = buildNeighbourhoods(tree as never);

    assert.equal(near.get('b')?.previousSibling, 'a', 'a1 no es hermano de b');
    assert.equal(near.get('a1')?.previousSibling, null);
  });

  it('sitúa a cada bloque entre sus hermanos', () => {
    const tree = [nodo('a'), nodo('b'), nodo('c')];
    const near = buildNeighbourhoods(tree as never);

    assert.equal(near.get('a')?.index, 0);
    assert.equal(near.get('c')?.index, 2);
  });

  it('recuerda al abuelo y dónde está el padre, para desindentar', () => {
    const tree = [nodo('a'), nodo('b', [nodo('b1', [nodo('b1x')])])];
    const near = buildNeighbourhoods(tree as never);

    assert.equal(near.get('b1x')?.parent, 'b1');
    assert.equal(near.get('b1x')?.grandparent, 'b');
    assert.equal(near.get('b1')?.parentIndex, 1, 'b es el segundo de su nivel');
  });

  it('sabe quién tiene hijos', () => {
    const tree = [nodo('a', [nodo('a1')]), nodo('b')];
    const near = buildNeighbourhoods(tree as never);

    assert.equal(near.get('a')?.hasChildren, true);
    assert.equal(near.get('b')?.hasChildren, false);
    assert.equal(near.get('b')?.previousVisible?.hasChildren, false);
  });
});
