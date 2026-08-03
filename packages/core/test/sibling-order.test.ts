// El orden entre hermanos.
//
// `position` en un cambio es el índice que se pide, y la renumeración del grupo
// es consecuencia de aplicar esa única operación. De esto depende que pulsar
// Enter en medio de una página sea un cambio y no treinta.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { checkInvariants } from '@vera/core';
import { applied, inhabitedGraph, makeBlock, makePage, submit } from './helpers.ts';

/** El contenido de los hermanos, en el orden en que se leen. */
function order(graph: ReturnType<typeof inhabitedGraph>, page: string, parent: string | null = null) {
  return graph
    .blocksOf(page)
    .filter((block) => block.parent === parent)
    .sort((a, b) => a.position - b.position)
    .map((block) => block.content);
}

function positions(graph: ReturnType<typeof inhabitedGraph>, page: string, parent: string | null = null) {
  return graph
    .blocksOf(page)
    .filter((block) => block.parent === parent)
    .map((block) => block.position)
    .sort((a, b) => a - b);
}

describe('insertar entre hermanos', () => {
  it('coloca el bloque en el índice pedido y corre a los demás', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'P');
    makeBlock(graph, page, 'a', { position: 0 });
    makeBlock(graph, page, 'b', { position: 1 });
    makeBlock(graph, page, 'c', { position: 2 });

    makeBlock(graph, page, 'nuevo', { position: 1 });

    assert.deepEqual(order(graph, page), ['a', 'nuevo', 'b', 'c']);
  });

  it('insertar al principio empuja a todos', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'P');
    makeBlock(graph, page, 'a', { position: 0 });
    makeBlock(graph, page, 'b', { position: 1 });

    makeBlock(graph, page, 'primero', { position: 0 });

    assert.deepEqual(order(graph, page), ['primero', 'a', 'b']);
  });

  it('un índice más allá del final deja el bloque al final', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'P');
    makeBlock(graph, page, 'a', { position: 0 });

    makeBlock(graph, page, 'lejos', { position: 99 });

    assert.deepEqual(order(graph, page), ['a', 'lejos']);
  });

  it('las posiciones quedan densas y sin repetir', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'P');
    for (let n = 0; n < 5; n += 1) makeBlock(graph, page, `b${n}`, { position: 0 });

    assert.deepEqual(positions(graph, page), [0, 1, 2, 3, 4]);
  });

  it('insertar es una sola operación, no una por hermano', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'P');
    for (let n = 0; n < 10; n += 1) makeBlock(graph, page, `b${n}`, { position: n });

    const antes = graph.log().lastSequence;
    makeBlock(graph, page, 'en medio', { position: 5 });

    assert.equal(
      graph.log().lastSequence - antes,
      1,
      'renumerar a los hermanos no puede costar operaciones propias',
    );
  });
});

describe('mover entre grupos', () => {
  it('cierra el hueco que deja y se sienta donde se pide', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'P');
    const padre = makeBlock(graph, page, 'padre', { position: 0 });
    const a = makeBlock(graph, page, 'a', { position: 1 });
    makeBlock(graph, page, 'b', { position: 2 });
    makeBlock(graph, page, 'hijo', { parent: padre, position: 0 });

    applied(submit(graph, { kind: 'move_block', block: a, page, parent: padre, position: 0 }));

    assert.deepEqual(order(graph, page), ['padre', 'b'], 'el grupo de origen cierra el hueco');
    assert.deepEqual(order(graph, page, padre), ['a', 'hijo'], 'el destino lo sienta donde se pidió');
    assert.deepEqual(positions(graph, page), [0, 1]);
    assert.deepEqual(positions(graph, page, padre), [0, 1]);
  });

  it('reordenar dentro del mismo grupo no deja huecos', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'P');
    makeBlock(graph, page, 'a', { position: 0 });
    const b = makeBlock(graph, page, 'b', { position: 1 });
    makeBlock(graph, page, 'c', { position: 2 });

    applied(submit(graph, { kind: 'move_block', block: b, page, parent: null, position: 0 }));

    assert.deepEqual(order(graph, page), ['b', 'a', 'c']);
    assert.deepEqual(positions(graph, page), [0, 1, 2]);
  });
});

describe('quitar un hermano', () => {
  it('cierra el hueco', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'P');
    makeBlock(graph, page, 'a', { position: 0 });
    const b = makeBlock(graph, page, 'b', { position: 1 });
    makeBlock(graph, page, 'c', { position: 2 });

    applied(submit(graph, { kind: 'remove_block', block: b }));

    assert.deepEqual(order(graph, page), ['a', 'c']);
    assert.deepEqual(positions(graph, page), [0, 1]);
  });
});

describe('SiblingOrderIsDenseAndUnique', () => {
  it('se sostiene tras cualquier secuencia de inserciones, movimientos y borrados', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({ tipo: fc.constant('crear' as const), at: fc.nat({ max: 8 }) }),
            fc.record({ tipo: fc.constant('mover' as const), cual: fc.nat({ max: 8 }), at: fc.nat({ max: 8 }) }),
            fc.record({ tipo: fc.constant('quitar' as const), cual: fc.nat({ max: 8 }) }),
          ),
          { maxLength: 30 },
        ),
        (acciones) => {
          const graph = inhabitedGraph();
          const page = makePage(graph, 'P');
          const vivos: string[] = [];

          for (const accion of acciones) {
            if (accion.tipo === 'crear') {
              vivos.push(makeBlock(graph, page, `b${vivos.length}`, { position: accion.at }));
            } else if (vivos.length > 0) {
              const id = vivos[accion.cual % vivos.length] as string;
              if (accion.tipo === 'mover') {
                submit(graph, { kind: 'move_block', block: id, page, parent: null, position: accion.at });
              } else {
                submit(graph, { kind: 'remove_block', block: id });
                vivos.splice(vivos.indexOf(id), 1);
              }
            }
            assert.deepEqual(checkInvariants(graph), []);
          }

          const esperado = Array.from({ length: vivos.length }, (_, n) => n);
          assert.deepEqual(positions(graph, page), esperado);
        },
      ),
      { numRuns: 60 },
    );
  });
});
