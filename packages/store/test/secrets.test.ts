// El secreto de un servicio vive fuera del log, y estas pruebas fijan por qué.
//
// La frase que las ordena: aquí olvidar tiene que significar olvidar. Todo lo
// demás de una conexión —qué servicio, qué biblioteca, qué se trae— es corpus y
// se comporta como corpus; el secreto es lo único que no puede quedar escrito
// para siempre en un registro que sólo sabe añadir.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { forgetSecret, saveSecret, secretsOf, useSecret } from '../src/secrets.ts';
import { openStore } from '../src/store.ts';

const abierto = () => {
  const store = openStore({ path: ':memory:', graphName: 'mind' });
  store.db
    .prepare(
      `INSERT INTO pages (id, graph_id, title, title_key, visibility, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run('page:1', store.graphId, 'Zotero', 'zotero', 'private', 1);
  return store;
};

describe('los secretos de un servicio', () => {
  it('se guardan y se recuperan para usarlos', () => {
    const store = abierto();
    saveSecret(store, 'page:1', 'clave', 'P9xK2mQ7vB4nR1tY8wL3', 1000);
    assert.equal(useSecret(store, 'page:1', 'clave', 2000), 'P9xK2mQ7vB4nR1tY8wL3');
  });

  it('lo que se puede contar de uno no incluye su valor', () => {
    const store = abierto();
    saveSecret(store, 'page:1', 'clave', 'P9xK2mQ7vB4nR1tY8wL3', 1000);
    const [said] = secretsOf(store, 'page:1');
    assert.equal(said?.tail, '8wL3');
    assert.equal(said?.savedAt, 1000);
    assert.ok(!JSON.stringify(said).includes('P9xK2mQ7'));
  });

  it('de un secreto corto no se enseña ni la cola', () => {
    // Cuatro caracteres de un secreto de seis son medio secreto.
    const store = abierto();
    saveSecret(store, 'page:1', 'clave', 'abc123', 1000);
    assert.equal(secretsOf(store, 'page:1')[0]?.tail, '');
  });

  it('usarlo deja dicho cuándo se usó', () => {
    // No es estadística: es lo que deja ver que una conexión que uno cree viva
    // lleva tres meses sin hablar con nadie.
    const store = abierto();
    saveSecret(store, 'page:1', 'clave', 'P9xK2mQ7vB4nR1tY8wL3', 1000);
    assert.equal(secretsOf(store, 'page:1')[0]?.lastUsedAt, null);
    useSecret(store, 'page:1', 'clave', 5000);
    assert.equal(secretsOf(store, 'page:1')[0]?.lastUsedAt, 5000);
  });

  it('cambiarlo lo reemplaza y no lo acumula', () => {
    const store = abierto();
    saveSecret(store, 'page:1', 'clave', 'la-vieja-de-antes', 1000);
    useSecret(store, 'page:1', 'clave', 2000);
    saveSecret(store, 'page:1', 'clave', 'la-nueva-de-ahora', 3000);
    assert.equal(secretsOf(store, 'page:1').length, 1);
    assert.equal(useSecret(store, 'page:1', 'clave', 4000), 'la-nueva-de-ahora');
    // Y la fecha de uso se va con la clave vieja: la nueva no se ha usado.
    assert.equal(secretsOf(store, 'page:1')[0]?.savedAt, 3000);
  });

  it('olvidarlo lo borra de verdad', () => {
    const store = abierto();
    saveSecret(store, 'page:1', 'clave', 'P9xK2mQ7vB4nR1tY8wL3', 1000);
    assert.equal(forgetSecret(store, 'page:1', 'clave'), true);
    assert.equal(useSecret(store, 'page:1', 'clave', 2000), null);
    assert.deepEqual(secretsOf(store, 'page:1'), []);
    const rows = store.db.prepare('SELECT count(*) AS n FROM service_secrets').get() as {
      n: number;
    };
    assert.equal(rows.n, 0);
  });

  it('olvidar lo que no estaba lo dice en vez de fingir que sí', () => {
    const store = abierto();
    assert.equal(forgetSecret(store, 'page:1', 'clave'), false);
  });

  it('un servicio puede tener más de una credencial, nombradas', () => {
    const store = abierto();
    saveSecret(store, 'page:1', 'clave', 'la-clave-de-lectura', 1000);
    saveSecret(store, 'page:1', 'token', 'el-token-de-otra-cosa', 1000);
    assert.deepEqual(secretsOf(store, 'page:1').map((one) => one.name), ['clave', 'token']);
    assert.equal(useSecret(store, 'page:1', 'token', 2000), 'el-token-de-otra-cosa');
  });

  it('borrar la página que lo gobierna olvida su secreto', () => {
    // Una credencial sin página que la explique es una llave sin puerta.
    const store = abierto();
    saveSecret(store, 'page:1', 'clave', 'P9xK2mQ7vB4nR1tY8wL3', 1000);
    store.db.exec('PRAGMA foreign_keys = ON');
    store.db.prepare('DELETE FROM pages WHERE id = ?').run('page:1');
    assert.deepEqual(secretsOf(store, 'page:1'), []);
  });

  it('no deja rastro en el registro de operaciones', () => {
    /*
     * El punto entero de esta tabla. El log es append-only —es lo que hace
     * auditable a Vera— y por eso mismo es mal sitio para una clave: escrita una
     * vez, no se puede desescribir ni rotándola ni borrando el bloque.
     */
    const store = abierto();
    saveSecret(store, 'page:1', 'clave', 'P9xK2mQ7vB4nR1tY8wL3', 1000);
    const operations = store.db.prepare('SELECT count(*) AS n FROM operations').get() as {
      n: number;
    };
    const revisions = store.db.prepare('SELECT count(*) AS n FROM revisions').get() as {
      n: number;
    };
    assert.equal(operations.n, 0);
    assert.equal(revisions.n, 0);
  });
});
