// Pruebas de la lectura estructural. Ver specs/page-processing.allium.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Block } from '@vera/core';

import { readingPasses, readStructure } from '../src/structure.ts';

let next = 0;
function block(content: string, parent: string | null, position: number): Block {
  next += 1;
  return {
    stableId: `block:${next}`,
    page: 'page:1',
    parent,
    position,
    content,
    createdAt: 0,
  };
}

/** Una página escrita como se lee: sangría por nivel. */
function page(source: string): Block[] {
  next = 0;
  const blocks: Block[] = [];
  const open: string[] = [];
  const counts = new Map<string | null, number>();
  for (const line of source.split('\n')) {
    if (line.trim() === '' && !line.startsWith('  ')) continue;
    const indent = /^ */.exec(line)?.[0].length ?? 0;
    const depth = Math.floor(indent / 2);
    const parent = depth === 0 ? null : (open[depth - 1] ?? null);
    const at = counts.get(parent) ?? 0;
    counts.set(parent, at + 1);
    const made = block(line.slice(indent).replace(/^·\s?/, ''), parent, at);
    blocks.push(made);
    open[depth] = made.stableId;
    open.length = depth + 1;
  }
  return blocks;
}

const defects = (blocks: Block[]): string[] =>
  readStructure(blocks).observations.map((observation) => observation.defect);

describe('readStructure', () => {
  it('da a cada bloque su profundidad, su sitio y su descendencia', () => {
    // @invariant EveryUnitNamesItsBlock: todo apunta a un bloque por su identidad
    // estable, no por coincidencia de texto.
    const blocks = page(['# Uno', '  hijo', '    nieto', '# Dos'].join('\n'));
    const units = readStructure(blocks).units;
    assert.deepEqual(
      units.map((u) => ({ id: u.block, depth: u.depth, desc: u.descendants })),
      [
        { id: 'block:1', depth: 0, desc: 2 },
        { id: 'block:2', depth: 1, desc: 1 },
        { id: 'block:3', depth: 2, desc: 0 },
        { id: 'block:4', depth: 0, desc: 0 },
      ],
    );
  });

  it('lee en el orden en que se ve, no en el de la lista plana', () => {
    const blocks = page(['# Uno', '  hijo de uno', '# Dos', '  hijo de dos'].join('\n'));
    assert.deepEqual(
      readStructure(blocks).units.map((u) => u.block),
      ['block:1', 'block:2', 'block:3', 'block:4'],
    );
  });

  it('la misma página leída dos veces da lo mismo', () => {
    // @invariant ItIsTheSameEveryTime
    const blocks = page(['# Uno', '  texto', '## Dos', '  más'].join('\n'));
    assert.deepEqual(readStructure(blocks), readStructure(blocks));
  });

  it('no se trunca por larga que sea', () => {
    // @invariant TheWholePageIsRead: el límite de contexto es del modelo, no de
    // contar bloques. Ochenta mil caracteres se leen enteros.
    const blocks = Array.from({ length: 200 }, (_, at) => block('x'.repeat(400), null, at));
    const structure = readStructure(blocks);
    assert.equal(structure.units.length, 200);
    assert.equal(structure.chars, 80_000);
  });

  it('parte la página en secciones por sus encabezados', () => {
    const blocks = page(
      ['entrada suelta', '# Primera', '  texto uno', '## Dentro', '  texto dos', '# Segunda'].join('\n'),
    );
    const sections = readStructure(blocks).sections;
    assert.deepEqual(
      sections.map((s) => ({ t: s.title, d: s.depth, n: s.members.length })),
      [
        { t: '', d: 0, n: 1 },
        { t: 'Primera', d: 0, n: 2 },
        { t: 'Dentro', d: 1, n: 2 },
        { t: 'Segunda', d: 0, n: 1 },
      ],
    );
  });

  it('el tramo anterior al primer encabezado también es una sección', () => {
    // Sin esto, el material de entrada de casi toda página quedaría fuera de
    // todas las secciones y no se podría leer por partes.
    const sections = readStructure(page(['algo suelto', '# Título'].join('\n'))).sections;
    assert.equal(sections[0]?.heading, null);
    assert.equal(sections[0]?.members.length, 1);
  });

  it('ve un bloque vacío', () => {
    assert.deepEqual(defects([block('   ', null, 0)]), ['empty_block']);
  });

  it('ve un párrafo monolítico, y no confunde con él a un bloque largo con hijos', () => {
    const largo = `${'Una frase con su punto. '.repeat(40)}`;
    assert.ok(defects([block(largo, null, 0)]).includes('monolithic_paragraph'));

    const conHijos = [block(largo, null, 0)];
    conHijos.push(block('hijo', conHijos[0]?.stableId ?? null, 0));
    assert.ok(!defects(conHijos).includes('monolithic_paragraph'));
  });

  it('no marca como monolítico un texto largo de una sola frase', () => {
    // Una cita larga es larga y es una unidad. El umbral de caracteres solo no
    // basta, y por eso se cuentan también las frases.
    const cita = 'palabra '.repeat(200);
    assert.ok(!defects([block(cita, null, 0)]).includes('monolithic_paragraph'));
  });

  it('ve un encabezado implícito: corto, sin cierre y con material debajo', () => {
    const blocks = page(['Antecedentes del proyecto', '  el desarrollo va aquí'].join('\n'));
    assert.ok(defects(blocks).includes('implicit_heading'));
  });

  it('no toma por encabezado implícito una frase corta que termina en punto', () => {
    const blocks = page(['Esto es una frase.', '  y su desarrollo'].join('\n'));
    assert.ok(!defects(blocks).includes('implicit_heading'));
  });

  it('ve una jerarquía incoherente', () => {
    // `##` colgando de `###`: la marca dice una cosa y el árbol otra.
    const blocks = page(['### Hondo', '  ## Más importante'].join('\n'));
    assert.ok(defects(blocks).includes('inconsistent_hierarchy'));
  });

  it('ve dos unidades pegadas en un bloque', () => {
    assert.ok(defects([block('# Uno\ntexto\n# Dos', null, 0)]).includes('mixed_units'));
    assert.ok(defects([block('texto suelto\n# Un título', null, 0)]).includes('mixed_units'));
  });

  it('ve una lista aplanada, y no la ve cuando alguno anida', () => {
    const plana = Array.from({ length: 10 }, (_, at) => block(`punto ${at}`, null, at));
    assert.ok(defects(plana).includes('flat_list'));

    const conNieto = [...plana, block('nieto', plana[0]?.stableId ?? null, 0)];
    assert.ok(!defects(conNieto).includes('flat_list'));
  });

  it('una página sana no dice nada de ella', () => {
    const blocks = page(['# Título', '  Un párrafo con su punto.', '## Sección', '  Otro párrafo.'].join('\n'));
    assert.deepEqual(readStructure(blocks).observations, []);
  });

  it('toda observación lleva la cuenta que la sostiene', () => {
    // @invariant ObservationCarriesItsEvidence: una observación sin evidencia es
    // una acusación.
    const blocks = page(['Antecedentes', '  desarrollo', '', '# T'].join('\n'));
    for (const observation of readStructure(blocks).observations) {
      assert.notEqual(observation.evidence, '');
      assert.match(observation.block, /^block:/);
    }
  });

  it('una página vacía se lee sin romperse', () => {
    assert.deepEqual(readStructure([]), { units: [], sections: [], observations: [], chars: 0 });
  });
});

/** El reparto de una página en los pases con que un modelo la lee entera. */
describe('readingPasses', () => {
  const contents = (blocks: Block[]): Map<string, string> =>
    new Map(blocks.map((one) => [one.stableId, one.content]));

  const split = (blocks: Block[], chars: number, most = 8) =>
    readingPasses(readStructure(blocks), contents(blocks), { chars, passes: most });

  it('una página que cabe entera se lee de una vez', () => {
    const blocks = page(['# Uno', '  algo corto', '# Dos', '  otro poco'].join('\n'));
    const { passes, left } = split(blocks, 3000);
    assert.equal(passes.length, 1);
    assert.equal(left, 0);
    assert.match(passes[0]?.text ?? '', /algo corto/);
    assert.match(passes[0]?.text ?? '', /otro poco/);
  });

  it('corta por las secciones y no por la cuenta de caracteres', () => {
    // @invariant ThePartsAreCutWhereThePageAlreadyBreaks.
    const blocks = page(
      ['# Uno', `  ${'a'.repeat(300)}`, '# Dos', `  ${'b'.repeat(300)}`].join('\n'),
    );
    const { passes } = split(blocks, 400);
    assert.equal(passes.length, 2);
    assert.ok(!(passes[0]?.text ?? '').includes('b'));
    assert.ok(!(passes[1]?.text ?? '').includes('a'));
  });

  it('ningún pase pasa del tamaño que el modelo aguanta', () => {
    // @invariant NoPassIsLargerThanTheModelCanHold.
    const largo = Array.from({ length: 12 }, (_, at) => `# S${at}\n  ${'x'.repeat(500)}`).join('\n');
    const blocks = page(largo);
    for (const pass of split(blocks, 900, 99).passes) assert.ok(pass.chars <= 900);
  });

  it('cada pase dice de qué secciones está hecho', () => {
    // @invariant EveryPassNamesItsSections.
    const blocks = page(['# Uno', '  algo', '# Dos', '  más'].join('\n'));
    const pass = split(blocks, 3000).passes[0];
    assert.deepEqual(pass?.sections.length, 2);
    assert.match(pass?.title ?? '', /Uno/);
    assert.match(pass?.title ?? '', /Dos/);
  });

  it('una sección que por sí sola no cabe se parte, y sigue siendo esa sección', () => {
    const blocks = page(['# Larga', `  ${'palabra '.repeat(200)}`].join('\n'));
    const { passes, left } = split(blocks, 400, 99);
    assert.ok(passes.length > 2);
    assert.equal(left, 0);
    for (const pass of passes) {
      assert.ok(pass.chars <= 400);
      assert.deepEqual(pass.sections, [passes[0]?.sections[0] ?? null]);
      // Se parte por los espacios: ningún trozo empieza o acaba a media palabra.
      assert.ok(!pass.text.startsWith('labra'));
    }
  });

  it('lo que el tope de pases deja fuera se cuenta', () => {
    // @invariant WhatDidNotFitIsCounted: un recorte callado convierte una lectura
    // parcial en una afirmación sobre el todo.
    const blocks = page(
      Array.from({ length: 10 }, (_, at) => `# S${at}\n  ${'x'.repeat(300)}`).join('\n'),
    );
    const { passes, left } = split(blocks, 350, 3);
    assert.equal(passes.length, 3);
    assert.ok(left > 0);
  });

  it('una página vacía no da ningún pase', () => {
    assert.deepEqual(split([], 3000), { passes: [], left: 0 });
  });

  it('el tramo anterior al primer encabezado también se lee', () => {
    const blocks = page(['antes de todo', '# Uno', '  algo'].join('\n'));
    const { passes } = split(blocks, 3000);
    assert.match(passes[0]?.text ?? '', /antes de todo/);
    assert.match(passes[0]?.title ?? '', /sin título/);
  });
});
