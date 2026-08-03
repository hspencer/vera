// Pruebas de la persistencia. Se ejercitan sobre SQLite real, en memoria.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { VeraGraph, checkInvariants } from '@vera/core';
import type { Change } from '@vera/core';
import {
  loadGraph,
  neighbourhoodFromStore,
  openStore,
  recordOperation,
  saveParticipant,
  searchStore,
} from '../src/store.ts';

const OWNER = 'participant:herbert';

function freshStore() {
  const store = openStore({ path: ':memory:', graphName: 'mind' });
  saveParticipant(store, { id: OWNER, name: 'Herbert', kind: 'human' });
  const graph = VeraGraph.create({ name: 'mind', id: store.graphId });
  graph.addParticipant({ id: OWNER, name: 'Herbert', kind: 'human' });
  graph.admit(OWNER);
  let n = 0;
  const write = (change: Change): string => {
    n += 1;
    const outcome = graph.submitOperation({
      originId: `o${n}`,
      participant: OWNER,
      channel: 'typed_text',
      change,
    });
    if (outcome.status !== 'applied') throw new Error(`rechazada: ${JSON.stringify(outcome)}`);
    recordOperation(store, graph, outcome.operation);
    return outcome.subjectId;
  };
  return { store, graph, write };
}

const count = (store: ReturnType<typeof openStore>, table: string): number =>
  (store.db.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n;

describe('persistencia', () => {
  it('aplica el esquema completo', () => {
    const store = openStore({ path: ':memory:' });
    const tables = store.db
      .prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'")
      .get() as { n: number };
    assert.ok(tables.n > 15);
    store.close();
  });

  it('guarda la operación y su revisión', () => {
    const { store, write } = freshStore();
    write({ kind: 'create_page', title: 'Amereida', visibility: 'private' });
    assert.equal(count(store, 'operations'), 1);
    assert.equal(count(store, 'revisions'), 1);
    store.close();
  });

  it('rechaza en la base un origin_id repetido', () => {
    const { store } = freshStore();
    const insert = () =>
      store.db.prepare(
        `INSERT INTO operations (id, graph_id, origin_id, sequence, participant_id, change_kind,
           change_payload, subject_id, channel, submitted_at, applied_at)
         VALUES (?, ?, 'mismo', ?, ?, 'edit_block', '{}', 'b', 'typed_text', 0, 0)`,
      );
    insert().run('op:1', store.graphId, 1, OWNER);
    assert.throws(() => insert().run('op:2', store.graphId, 2, OWNER), /UNIQUE/);
    store.close();
  });

  it('rechaza voz autenticada sin evidencia', () => {
    const { store } = freshStore();
    assert.throws(
      () =>
        store.db
          .prepare(
            `INSERT INTO operations (id, graph_id, origin_id, sequence, participant_id, change_kind,
               change_payload, subject_id, channel, submitted_at, applied_at)
             VALUES ('op:x', ?, 'x', 1, ?, 'edit_block', '{}', 'b', 'authenticated_voice', 0, 0)`,
          )
          .run(store.graphId, OWNER),
      /CHECK/,
    );
    store.close();
  });

  it('materializa páginas, bloques, enlaces y etiquetas', () => {
    const { store, write } = freshStore();
    const page = write({ kind: 'create_page', title: 'Amereida', visibility: 'private' });
    write({ kind: 'create_page', title: 'Travesia', visibility: 'private' });
    write({
      kind: 'create_block',
      page,
      parent: null,
      position: 0,
      content: 'ver [[Travesia]] #ead',
    });

    assert.equal(count(store, 'pages'), 2);
    assert.equal(count(store, 'blocks'), 1);
    assert.equal(count(store, 'page_links'), 1);
    assert.equal(count(store, 'block_tags'), 1);

    const link = store.db.prepare('SELECT target_id FROM page_links').get() as {
      target_id: string | null;
    };
    assert.notEqual(link.target_id, null);
    store.close();
  });

  it('reproduce el grafo desde el log y no desde las tablas de estado', () => {
    const { store, graph, write } = freshStore();
    const page = write({ kind: 'create_page', title: 'Amereida', visibility: 'private' });
    const block = write({ kind: 'create_block', page, parent: null, position: 0, content: 'uno' });
    write({ kind: 'edit_block', block, content: 'dos' });

    const loaded = loadGraph(store);
    assert.equal(loaded.pages().length, graph.pages().length);
    assert.equal(loaded.block(block)?.content, 'dos');
    assert.equal(loaded.block(block)?.stableId, block, 'la identidad sobrevive al viaje por disco');
    assert.deepEqual(checkInvariants(loaded), []);
    store.close();
  });

  it('conserva la procedencia al reproducir', () => {
    const { store, write } = freshStore();
    write({ kind: 'create_page', title: 'Amereida', visibility: 'private' });
    const loaded = loadGraph(store);
    assert.equal(loaded.revisions().at(-1)?.authoredBy, OWNER);
    assert.equal(loaded.revisions().at(-1)?.channel, 'typed_text');
    store.close();
  });

  it('encuentra por FTS5 plegando los diacríticos', () => {
    const { store, write } = freshStore();
    const page = write({ kind: 'create_page', title: 'Travesía', visibility: 'private' });
    write({
      kind: 'create_block',
      page,
      parent: null,
      position: 0,
      content: 'el desierto de Atacama',
    });

    assert.equal(searchStore(store, 'travesia').length, 1, 'travesia encuentra Travesía');
    assert.equal(searchStore(store, 'desierto').length, 1);
    assert.equal(searchStore(store, 'inexistente').length, 0);
    assert.equal(searchStore(store, '').length, 0);
    store.close();
  });

  it('deja de encontrar lo que se borró', () => {
    const { store, write } = freshStore();
    const page = write({ kind: 'create_page', title: 'P', visibility: 'private' });
    const block = write({
      kind: 'create_block',
      page,
      parent: null,
      position: 0,
      content: 'borrable',
    });
    assert.equal(searchStore(store, 'borrable').length, 1);
    write({ kind: 'remove_block', block });
    assert.equal(searchStore(store, 'borrable').length, 0);
    store.close();
  });

  // Este caso tumbaba el servidor. La clave foránea de property_assignments no
  // declara ON DELETE, así que mientras quedara una propiedad el borrado del
  // bloque fallaba; y en el corpus real casi ningún bloque de bibliografía está
  // sin propiedades. El test anterior no lo veía porque su bloque no tenía.
  it('borra un bloque que lleva propiedades', () => {
    const { store, write } = freshStore();
    const page = write({ kind: 'create_page', title: 'P', visibility: 'private' });
    const block = write({
      kind: 'create_block',
      page,
      parent: null,
      position: 0,
      content: 'con propiedades',
    });
    write({ kind: 'set_property', block, propertyKey: 'tipo', propertyValue: 'nota' });
    write({ kind: 'set_property', block, propertyKey: 'año', propertyValue: '2001' });

    const cuenta = (): number =>
      (
        store.db
          .prepare('SELECT count(*) c FROM property_assignments WHERE block_id = ?')
          .get(block) as { c: number }
      ).c;
    assert.equal(cuenta(), 2);

    write({ kind: 'remove_block', block });

    assert.equal(cuenta(), 0, 'las propiedades del bloque se van con él');
    assert.equal(searchStore(store, 'propiedades').length, 0);
    store.close();
  });

  // Insertar entre hermanos renumera al grupo, y esa renumeración es parte de
  // aplicar la operación. Si sólo bajara a disco el bloque sujeto, el grafo en
  // memoria y la base contarían dos órdenes distintos hasta el siguiente
  // arranque, que es la clase de divergencia que este proyecto no admite.
  it('persiste el orden de los hermanos, no sólo el bloque insertado', () => {
    const { store, write } = freshStore();
    const page = write({ kind: 'create_page', title: 'P', visibility: 'private' });
    const a = write({ kind: 'create_block', page, parent: null, position: 0, content: 'a' });
    const b = write({ kind: 'create_block', page, parent: null, position: 1, content: 'b' });
    const medio = write({ kind: 'create_block', page, parent: null, position: 1, content: 'medio' });

    const enDisco = (): string[] =>
      (
        store.db
          .prepare('SELECT content FROM blocks WHERE page_id = ? ORDER BY position')
          .all(page) as { content: string }[]
      ).map((row) => row.content);

    assert.deepEqual(enDisco(), ['a', 'medio', 'b']);

    write({ kind: 'move_block', block: a, page, parent: null, position: 2 });
    assert.deepEqual(enDisco(), ['medio', 'b', 'a']);

    write({ kind: 'remove_block', block: b });
    assert.deepEqual(enDisco(), ['medio', 'a']);

    const posiciones = (
      store.db
        .prepare('SELECT position FROM blocks WHERE page_id = ? ORDER BY position')
        .all(page) as { position: number }[]
    ).map((row) => row.position);
    assert.deepEqual(posiciones, [0, 1], 'sin huecos ni repetidos en disco');

    // Y lo definitivo: reproducir el log desde cero da el mismo orden.
    const reproducido = loadGraph(store, 'mind');
    assert.deepEqual(
      reproducido
        .blocksOf(page)
        .sort((x, y) => x.position - y.position)
        .map((block) => block.content),
      ['medio', 'a'],
    );
    assert.deepEqual(checkInvariants(reproducido), []);
    store.close();
  });

  it('borra una página que lleva propiedades', () => {
    const { store, write } = freshStore();
    const page = write({ kind: 'create_page', title: 'P', visibility: 'private' });
    write({ kind: 'set_property', page, propertyKey: 'estado', propertyValue: 'borrador' });

    write({ kind: 'remove_page', page });

    const quedan = (
      store.db
        .prepare('SELECT count(*) c FROM property_assignments WHERE page_id = ?')
        .get(page) as { c: number }
    ).c;
    assert.equal(quedan, 0, 'las propiedades de la página se van con ella');
    store.close();
  });

  it('recorre la vecindad con una consulta recursiva', () => {
    const { store, write } = freshStore();
    const a = write({ kind: 'create_page', title: 'A', visibility: 'private' });
    const b = write({ kind: 'create_page', title: 'B', visibility: 'private' });
    write({ kind: 'create_page', title: 'C', visibility: 'private' });
    write({ kind: 'create_block', page: a, parent: null, position: 0, content: 'ver [[B]]' });
    write({ kind: 'create_block', page: b, parent: null, position: 0, content: 'ver [[C]]' });

    const near = neighbourhoodFromStore(store, a, 1);
    assert.deepEqual(
      near.map((n) => n.distance),
      [0, 1],
    );
    const far = neighbourhoodFromStore(store, a, 2);
    assert.equal(far.length, 3, 'a dos saltos alcanza C');
    store.close();
  });

  it('deshace la operación entera si algo falla a mitad', () => {
    const { store, graph } = freshStore();
    const before = count(store, 'operations');
    const outcome = graph.submitOperation({
      originId: 'x',
      participant: OWNER,
      channel: 'typed_text',
      change: { kind: 'create_page', title: 'X', visibility: 'private' },
    });
    assert.equal(outcome.status, 'applied');
    if (outcome.status !== 'applied') return;
    // Voz autenticada sin evidencia viola el CHECK del esquema a mitad de la
    // transacción: lo ya escrito debe deshacerse.
    const corrupted = {
      ...outcome.operation,
      submission: { ...outcome.operation.submission, channel: 'authenticated_voice' as const },
    };
    assert.throws(() => recordOperation(store, graph, corrupted));
    assert.equal(count(store, 'operations'), before, 'no queda media operación escrita');
    store.close();
  });
});
