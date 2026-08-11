// Lo que se crea se bautiza en el cliente, siempre.
//
// La prueba existe por un defecto que sólo apareció al abrir el navegador: sin
// bautizar, la réplica le ponía al bloque nuevo el nombre de su propio contador
// —`block:1`— y el servidor le ponía el suyo —`block:8`—. A partir de ahí las dos
// hablaban de cosas distintas: se escribía en el bloque recién creado, la
// pantalla lo enseñaba, y el servidor rechazaba la edición con «no such block».
// La palabra se perdía y la pantalla seguía enseñándola.
//
// Ver specs/offline-reconciliation.allium y docs/plan-local-first.md.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { named } from '../src/api.ts';

describe('bautizar lo que se crea', () => {
  it('un bloque nuevo sale con nombre', () => {
    const said = named({ kind: 'create_block', page: 'page:1', parent: null, position: 0, content: 'x' });
    assert.match(said.kind === 'create_block' ? (said.stableId ?? '') : '', /^block:/);
  });

  it('una página nueva también', () => {
    const said = named({ kind: 'create_page', title: 'Nueva', visibility: 'private' });
    assert.match(said.kind === 'create_page' ? (said.stableId ?? '') : '', /^page:/);
  });

  it('dos creaciones no comparten nombre', () => {
    const one = named({ kind: 'create_block', page: 'page:1', parent: null, position: 0, content: 'a' });
    const two = named({ kind: 'create_block', page: 'page:1', parent: null, position: 1, content: 'b' });
    assert.notEqual(
      one.kind === 'create_block' ? one.stableId : '',
      two.kind === 'create_block' ? two.stableId : '',
    );
  });

  it('el nombre no es un número, para no chocar con los del servidor', () => {
    // El servidor cuenta —`block:1`, `block:2`— y adelanta su contador con
    // cualquier identificador numérico que le llegue. Un sufijo que no es número
    // no puede chocar con los suyos ni moverle el contador. Ver `#observeId`.
    const said = named({ kind: 'create_block', page: 'page:1', parent: null, position: 0, content: 'x' });
    const id = said.kind === 'create_block' ? (said.stableId ?? '') : '';
    assert.ok(!Number.isFinite(Number(id.slice(id.indexOf(':') + 1))));
  });

  it('lo que ya venía bautizado se respeta', () => {
    // La importación trae los identificadores que el corpus tenía en Logseq, y
    // reescribirlos rompería las referencias que existían fuera de Vera.
    const said = named({
      kind: 'create_block',
      page: 'page:1',
      parent: null,
      position: 0,
      content: 'x',
      stableId: 'block:de-logseq',
    });
    assert.equal(said.kind === 'create_block' ? said.stableId : '', 'block:de-logseq');
  });

  it('lo que no crea nada no se toca', () => {
    const change = { kind: 'edit_block' as const, block: 'block:a', content: 'x' };
    assert.equal(named(change), change);
  });
});
