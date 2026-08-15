// Pruebas de la lógica pura del outliner: no tocan el DOM.
//
// La sesión de edición vive ahora en session.ts y se prueba aparte: Escape dejó
// de descartar, así que los casos que lo fijaban ya no describen nada.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNeighbourhoods,
  buildTree,
  externalDestination,
  foldedState,
  invokeMenuAction,
  matchingMovePages,
  nodeMarkdown,
} from '../src/outliner.ts';
import type { BlockView } from '../src/api.ts';

const block = (stableId: string, parent: string | null, position: number, content = stableId): BlockView => ({
  stableId,
  parent,
  position,
  content,
});

describe('enlaces salientes', () => {
  const here = 'https://vera.mediafranca.net/p/Bit%C3%A1cora';

  it('reconoce sólo HTTP de otro origen', () => {
    assert.equal(externalDestination('https://ejemplo.cl/a', here), 'https://ejemplo.cl/a');
    assert.equal(externalDestination('/p/Otra', here), null);
    assert.equal(externalDestination('#seccion', here), null);
    assert.equal(externalDestination('mailto:alguien@ejemplo.cl', here), null);
  });
});

describe('menú encadenado', () => {
  it('detiene el clic antes de abrir el siguiente menú', () => {
    const order: string[] = [];
    invokeMenuAction(
      { stopPropagation: () => order.push('stop') },
      { run: () => order.push('run') },
    );
    assert.deepEqual(order, ['stop', 'run']);
  });
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

describe('nodeMarkdown', () => {
  it('copia el bloque completo con todos sus descendientes', () => {
    const tree = buildTree([
      block('raíz', null, 0, 'Idea'),
      block('hijo', 'raíz', 0, 'Primer punto'),
      block('nieto', 'hijo', 0, 'Detalle'),
      block('otro', 'raíz', 1, 'Segundo punto'),
    ]);
    assert.equal(
      nodeMarkdown(tree[0]!),
      ['Idea', '- Primer punto', '  - Detalle', '- Segundo punto'].join('\n'),
    );
  });

  it('una hoja copia sólo su Markdown', () => {
    const tree = buildTree([block('hoja', null, 0, 'Texto **limpio**')]);
    assert.equal(nodeMarkdown(tree[0]!), 'Texto **limpio**');
  });
});

describe('foldedState', () => {
  it('proyecta inmediatamente plegar y desplegar en la vista local', () => {
    assert.deepEqual(foldedState([], 'padre', true), ['padre']);
    assert.deepEqual(foldedState(['padre'], 'padre', false), []);
  });

  it('no duplica un bloque ya plegado', () => {
    assert.deepEqual(foldedState(['padre'], 'padre', true), ['padre']);
  });
});

describe('buscar la página a la que se mueve un bloque', () => {
  const page = (id: string, title: string) => ({ id, title, visibility: 'private' as const, blockCount: 0, linkCount: 0 });

  it('omite la página de origen y busca sin depender de acentos', () => {
    const pages = [page('a', 'Actual'), page('b', 'Diseño gráfico'), page('c', 'Biología')];
    assert.deepEqual(matchingMovePages('diseno', pages, 'a').map((one) => one.id), ['b']);
  });

  it('pone primero el título exacto y después los que sólo lo contienen', () => {
    const pages = [page('a', 'Actual'), page('b', 'Notas de diseño'), page('c', 'Diseño')];
    assert.deepEqual(matchingMovePages('diseño', pages, 'a').map((one) => one.id), ['c', 'b']);
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
