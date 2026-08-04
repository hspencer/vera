// Pruebas del lector de Logseq, con las formas que trae el corpus real.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  journalTitle,
  parseLogseqPage,
  referencedAssets,
  referencedMacros,
  titleFromFilename,
} from '../src/logseq.ts';

describe('cabecera de página', () => {
  it('lee las propiedades anteriores a la primera viñeta', () => {
    const page = parseLogseqPage(
      ['status:: draft', 'public:: false', 'lang:: es', '', '- primer bloque'].join('\n'),
    );

    assert.equal(page.properties.get('status'), 'draft');
    assert.equal(page.properties.get('public'), 'false');
    assert.equal(page.properties.get('lang'), 'es');
    assert.equal(page.blocks.length, 1);
  });

  it('conserva el preámbulo que no era propiedad', () => {
    const page = parseLogseqPage(['## Bitácora de Cotito', '', '- Hoy instalo LogSeq'].join('\n'));

    assert.deepEqual(page.preamble, ['## Bitácora de Cotito']);
    assert.equal(page.blocks.length, 1);
  });

  it('no confunde una propiedad posterior a la primera viñeta con una de página', () => {
    const page = parseLogseqPage(['- un bloque', '  id:: abc-123'].join('\n'));

    assert.equal(page.properties.size, 0);
    assert.equal(page.blocks[0]?.properties.get('id'), 'abc-123');
  });
});

describe('árbol de bloques', () => {
  it('mide la profundidad por tabuladores', () => {
    const page = parseLogseqPage(['- raíz', '\t- hija', '\t\t- nieta'].join('\n'));

    assert.deepEqual(
      page.blocks.map((b) => [b.depth, b.content]),
      [
        [0, 'raíz'],
        [1, 'hija'],
        [2, 'nieta'],
      ],
    );
  });

  it('acepta dos espacios como un nivel, porque parte del corpus se escribió a mano', () => {
    const page = parseLogseqPage(['- raíz', '  - hija'].join('\n'));

    assert.deepEqual(
      page.blocks.map((b) => b.depth),
      [0, 1],
    );
  });

  it('une las líneas de continuación al contenido del bloque', () => {
    const page = parseLogseqPage(
      ['- Una línea y su continuación.', '  id:: 672286bc-9b4c-4301-9e9b-4df027dc85a3', '  sigue aquí'].join(
        '\n',
      ),
    );

    assert.equal(page.blocks.length, 1);
    assert.equal(page.blocks[0]?.content, 'Una línea y su continuación.\nsigue aquí');
    assert.equal(page.blocks[0]?.properties.get('id'), '672286bc-9b4c-4301-9e9b-4df027dc85a3');
  });

  it('separa collapsed:: del contenido', () => {
    const page = parseLogseqPage(['- Aseo corporal', '  collapsed:: true', '\t- Ducharse'].join('\n'));

    assert.equal(page.blocks[0]?.content, 'Aseo corporal');
    assert.equal(page.blocks[0]?.properties.get('collapsed'), 'true');
  });
});

describe('títulos', () => {
  it('decodifica el escape en porcentaje del nombre de archivo', () => {
    assert.equal(titleFromFilename('AAC - Survey%3A results.md'), 'AAC - Survey: results');
  });

  it('traduce ___ a la barra de espacio de nombres', () => {
    assert.equal(titleFromFilename('Escuela___Taller.md'), 'Escuela/Taller');
  });

  it('conserva el nombre literal cuando el porcentaje no era un escape', () => {
    assert.equal(titleFromFilename('100% seguro.md'), '100% seguro');
  });

  it('reconoce un journal por su nombre', () => {
    assert.equal(journalTitle('2024_02_26.md'), '2024-02-26');
    assert.equal(journalTitle('Amereida.md'), null);
  });
});

describe('referencias', () => {
  it('encuentra un asset', () => {
    assert.deepEqual(referencedAssets('![x](../assets/foto.png)'), ['../assets/foto.png']);
  });

  it('no corta en un paréntesis interno del nombre', () => {
    assert.deepEqual(
      referencedAssets('![x](../assets/Captura_a_la(s)_12.png)'),
      ['../assets/Captura_a_la(s)_12.png'],
    );
  });

  it('enumera las macros que el corpus trae', () => {
    assert.deepEqual(
      referencedMacros('{{query (property status "draft")}} y {{embed [[x]]}}'),
      ['query', 'embed'],
    );
  });
});
