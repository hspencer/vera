// Pruebas de la lógica pura del outliner: no tocan el DOM.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildTree, editSession, inlineMarkdown } from '../src/outliner.ts';
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

describe('inlineMarkdown', () => {
  it('escapa el HTML antes de cualquier otra cosa', () => {
    const rendered = inlineMarkdown('<script>alert(1)</script>');
    assert.ok(!rendered.includes('<script>'));
    assert.ok(rendered.includes('&lt;script&gt;'));
  });

  it('convierte un enlace wiki en algo navegable', () => {
    const rendered = inlineMarkdown('ver [[Amereida]]');
    assert.ok(rendered.includes('data-page="Amereida"'));
    assert.ok(rendered.includes('>Amereida<'));
  });

  it('marca las etiquetas', () => {
    assert.ok(inlineMarkdown('algo #accesibilidad').includes('class="tag"'));
  });

  it('no confunde una almohadilla pegada a una palabra', () => {
    assert.ok(!inlineMarkdown('color#fff').includes('class="tag"'));
  });

  it('respeta negrita, cursiva y código', () => {
    assert.ok(inlineMarkdown('**fuerte**').includes('<strong>fuerte</strong>'));
    assert.ok(inlineMarkdown('*suave*').includes('<em>suave</em>'));
    assert.ok(inlineMarkdown('`codigo`').includes('<code>codigo</code>'));
  });

  it('no toma la negrita por cursiva', () => {
    assert.ok(!inlineMarkdown('**fuerte**').includes('<em>'));
  });

  it('conserva los saltos de línea del bloque', () => {
    assert.ok(inlineMarkdown('una\notra').includes('<br>'));
  });

  it('deja pasar un enlace externo', () => {
    const rendered = inlineMarkdown('[sitio](https://herbertspencer.net)');
    assert.ok(rendered.includes('href="https://herbertspencer.net"'));
  });
});

describe('editSession', () => {
  it('guarda al salir si el texto cambió', () => {
    const session = editSession('original');
    assert.deepEqual(session.leave('editado'), { action: 'submit', content: 'editado' });
  });

  it('no emite operación si el texto no cambió', () => {
    const session = editSession('original');
    assert.deepEqual(session.leave('original'), { action: 'restore' });
  });

  it('descarta con Escape sin guardar', () => {
    const session = editSession('original');
    assert.deepEqual(session.cancel(), { action: 'restore' });
  });

  // La regresión: descartar retira del DOM el campo enfocado y el navegador
  // emite un `blur` tardío. Ese `blur` llegaba a guardar lo descartado.
  it('el blur posterior a un descarte no guarda nada', () => {
    const session = editSession('original');
    session.cancel();
    assert.deepEqual(session.leave('lo que se descartó'), { action: 'ignore' });
  });

  it('un blur repetido no guarda dos veces', () => {
    const session = editSession('original');
    assert.deepEqual(session.leave('editado'), { action: 'submit', content: 'editado' });
    assert.deepEqual(session.leave('editado'), { action: 'ignore' });
  });

  it('tras un fallo al guardar, la edición vuelve a poder resolverse', () => {
    const session = editSession('original');
    session.leave('editado');
    session.reopen();
    assert.deepEqual(session.leave('editado'), { action: 'submit', content: 'editado' });
  });
});
