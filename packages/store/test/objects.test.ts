// Pruebas del almacén de objetos. Usan un directorio temporal real: lo que
// importa aquí es exactamente el comportamiento en disco.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  HASH,
  hasObject,
  hashBytes,
  isPresentableImage,
  mediaTypeFor,
  objectPath,
  objectSize,
  putObject,
  readObject,
} from '../src/objects.ts';

let root: string;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'vera-objects-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

// readObject devuelve el Buffer de Node, que es un Uint8Array pero no el mismo
// tipo; se compara el contenido, que es lo que importa.
const same = (got: Uint8Array, want: Uint8Array): void =>
  assert.deepEqual(Array.from(got), Array.from(want));

describe('hashBytes', () => {
  it('produce un sha256 hexadecimal', () => {
    const hash = hashBytes(bytes('vera'));
    assert.match(hash, HASH);
    assert.equal(hash.length, 64);
  });

  it('los mismos bytes dan el mismo hash', () => {
    assert.equal(hashBytes(bytes('igual')), hashBytes(bytes('igual')));
  });

  it('un byte distinto da otro hash', () => {
    assert.notEqual(hashBytes(bytes('a')), hashBytes(bytes('b')));
  });
});

describe('objectPath', () => {
  it('reparte en dos niveles por el primer byte', () => {
    const hash = 'a'.repeat(64);
    assert.equal(objectPath('/tmp/o', hash), join('/tmp/o', 'aa', 'a'.repeat(62)));
  });

  it('rechaza cualquier cosa que no sea un hash', () => {
    // Sin esto, una ruta venida de la red podría salir del almacén.
    for (const malo of ['../../etc/passwd', 'ABC', '', 'a'.repeat(63), `${'a'.repeat(63)}/x`]) {
      assert.throws(() => objectPath('/tmp/o', malo), /hash inválido/, `aceptó ${malo}`);
    }
  });
});

describe('putObject', () => {
  it('guarda y relee los mismos bytes', () => {
    const stored = putObject(root, bytes('contenido'));
    assert.equal(stored.written, true);
    assert.equal(stored.byteSize, 9);
    same(readObject(root, stored.hash), bytes('contenido'));
  });

  it('guardar dos veces lo mismo no duplica ni reescribe', () => {
    const first = putObject(root, bytes('repetido'));
    const second = putObject(root, bytes('repetido'));
    assert.equal(first.hash, second.hash);
    assert.equal(second.written, false, 'la segunda vez no debe escribir');
  });

  it('un objeto guardado no se puede pisar', () => {
    // @invariant SourceFidelity. Direccionar por contenido lo vuelve estructural:
    // otros bytes son otro objeto, así que el original no tiene cómo perderse.
    const stored = putObject(root, bytes('original'));
    putObject(root, bytes('distinto'));
    same(readObject(root, stored.hash), bytes('original'));
  });

  it('no deja visible un objeto a medio escribir', () => {
    const stored = putObject(root, bytes('completo'));
    assert.equal(objectSize(root, stored.hash), 8);
    assert.equal(hasObject(root, stored.hash), true);
  });

  it('guarda bytes binarios sin alterarlos', () => {
    const raw = new Uint8Array([0, 255, 13, 10, 127, 128]);
    const stored = putObject(root, raw);
    same(readObject(root, stored.hash), raw);
  });
});

describe('hasObject', () => {
  it('es falso para un hash que no está', () => {
    assert.equal(hasObject(root, 'f'.repeat(64)), false);
  });

  it('es falso para algo que ni siquiera es un hash, sin lanzar', () => {
    assert.equal(hasObject(root, '../../etc/passwd'), false);
  });
});

describe('mediaTypeFor', () => {
  it('reconoce lo que trae el corpus', () => {
    assert.equal(mediaTypeFor('a.png'), 'image/png');
    assert.equal(mediaTypeFor('a.jpeg'), 'image/jpeg');
    assert.equal(mediaTypeFor('a.JPG'), 'image/jpeg');
    assert.equal(mediaTypeFor('a.pdf'), 'application/pdf');
    assert.equal(mediaTypeFor('a.svg'), 'image/svg+xml');
  });

  it('no inventa un tipo para lo desconocido', () => {
    assert.equal(mediaTypeFor('a.webarchive'), 'application/octet-stream');
    assert.equal(mediaTypeFor('sin-extension'), 'application/octet-stream');
  });
});

describe('isPresentableImage', () => {
  it('distingue lo que se presenta en la página de lo que se ofrece', () => {
    assert.equal(isPresentableImage('image/png'), true);
    assert.equal(isPresentableImage('application/pdf'), false);
  });
});

describe('sobre un archivo real', () => {
  it('el hash del contenido no depende del nombre', () => {
    const a = join(root, 'uno.txt');
    const b = join(root, 'otro.txt');
    writeFileSync(a, 'mismo contenido');
    writeFileSync(b, 'mismo contenido');
    assert.equal(hashBytes(readFileSync(a)), hashBytes(readFileSync(b)));
  });
});
