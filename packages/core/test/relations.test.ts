// La relación explicada. Ver «La relación explicada» en specs/trail.allium.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PROPERTY_NAMES,
  STARTER_RELATIONS,
  inverseOf,
  isSymmetric,
  readPropertyNames,
  titleIn,
  senseIn,
} from '@vera/core';
import { OWNER, inhabitedGraph, makeBlock, makePage, submit } from './helpers.ts';

/** Un bloque que explica: cuelga de aquel desde el que se afirma. */
function explain(
  graph: ReturnType<typeof inhabitedGraph>,
  page: string,
  from: string,
  said: string,
  target: string,
  extra: Record<string, string> = {},
): string {
  const connective = makeBlock(graph, page, said, { parent: from });
  submit(graph, { kind: 'set_property', block: connective, propertyKey: 'explica', propertyValue: `[[${target}]]` });
  for (const [key, value] of Object.entries(extra)) {
    submit(graph, { kind: 'set_property', block: connective, propertyKey: key, propertyValue: value });
  }
  return connective;
}

describe('los cruces se ven, no se guardan', () => {
  it('un bloque que lleva «explica» afirma algo sobre esa página', () => {
    const graph = inhabitedGraph();
    const from = makePage(graph, 'PICTOS');
    const to = makePage(graph, 'Guemil');
    const said = makeBlock(graph, from, 'toma la rejilla y la lleva a generación');
    explain(graph, from, said, 'profundiza lo que Guemil dejó planteado', 'Guemil', {
      término: 'profundiza',
    });

    const [crossing] = graph.crossingsOut(from);
    assert.equal(crossing?.fromBlock, said);
    assert.equal(crossing?.toPage, to);
    assert.equal(crossing?.term, 'profundiza');
    assert.equal(crossing?.sense, 'directed');
    assert.match(crossing?.said ?? '', /dejó planteado/);
  });

  it('lo que una página afirma y lo que afirman sobre ella son dos columnas', () => {
    const graph = inhabitedGraph();
    const from = makePage(graph, 'PICTOS');
    const to = makePage(graph, 'Guemil');
    const said = makeBlock(graph, from, 'toma la rejilla');
    explain(graph, from, said, 'profundiza aquello', 'Guemil', { término: 'profundiza' });

    assert.equal(graph.crossingsOut(from).length, 1);
    assert.equal(graph.crossingsIn(from).length, 0);
    assert.equal(graph.crossingsIn(to).length, 1);
    assert.equal(graph.crossingsOut(to).length, 0);
  });

  it('una relación mutua se lee en las dos columnas de las dos páginas', () => {
    const graph = inhabitedGraph();
    const from = makePage(graph, 'Amereida');
    const to = makePage(graph, 'Memex');
    const said = makeBlock(graph, from, 'las dos hablan de lo mismo');
    explain(graph, from, said, 'se oponen en su idea de archivo', 'Memex', {
      término: 'se opone a',
      sentido: 'mutua',
    });

    assert.equal(graph.crossingsOut(from).length, 1);
    assert.equal(graph.crossingsIn(from).length, 1);
    assert.equal(graph.crossingsOut(to).length, 1);
    assert.equal(graph.crossingsIn(to).length, 1);
  });

  it('un título que nadie ha escrito deja el destino sin resolver, y la relación en pie', () => {
    const graph = inhabitedGraph();
    const from = makePage(graph, 'PICTOS');
    const said = makeBlock(graph, from, 'algo');
    explain(graph, from, said, 'lo continúa', 'Página que no existe');

    const [crossing] = graph.crossingsOut(from);
    assert.equal(crossing?.toPage, null);
    assert.equal(crossing?.targetTitle, 'Página que no existe');
  });

  it('una página no se explica respecto de sí misma', () => {
    const graph = inhabitedGraph();
    const page = makePage(graph, 'PICTOS');
    const said = makeBlock(graph, page, 'algo');
    explain(graph, page, said, 'se explica sola', 'PICTOS');

    assert.deepEqual(graph.crossingsOut(page), []);
  });

  it('un bloque dice una sola cosa sobre una página', () => {
    // @invariant OneCrossingPerBlockAndTarget: si hay más que decir, se dice en
    // la conectiva, que es un bloque y crece.
    const graph = inhabitedGraph();
    const from = makePage(graph, 'PICTOS');
    makePage(graph, 'Guemil');
    const said = makeBlock(graph, from, 'algo');
    explain(graph, from, said, 'una cosa', 'Guemil');
    explain(graph, from, said, 'y otra', 'Guemil');

    assert.equal(graph.crossingsOut(from).length, 1);
  });

  it('la explicación sobrevive a corregir la frase que la ocasionó', () => {
    // Es la razón de que cuelgue del bloque y no del enlace derivado: los
    // enlaces se recalculan enteros al tocar el texto.
    const graph = inhabitedGraph();
    const from = makePage(graph, 'PICTOS');
    makePage(graph, 'Guemil');
    const said = makeBlock(graph, from, 'toma la rejilla de [[Guemil]]');
    explain(graph, from, said, 'la profundiza', 'Guemil');

    submit(graph, { kind: 'edit_block', block: said, content: 'toma la rejílla de [[Guemil]]' });

    assert.equal(graph.crossingsOut(from).length, 1);
  });

  it('borrar el bloque borra la relación, porque la relación era el bloque', () => {
    const graph = inhabitedGraph();
    const from = makePage(graph, 'PICTOS');
    makePage(graph, 'Guemil');
    const said = makeBlock(graph, from, 'algo');
    const connective = explain(graph, from, said, 'la profundiza', 'Guemil');

    submit(graph, { kind: 'remove_block', block: connective });

    assert.deepEqual(graph.crossingsOut(from), []);
  });

  it('el término es opcional: explicar no exige clasificar', () => {
    const graph = inhabitedGraph();
    const from = makePage(graph, 'PICTOS');
    makePage(graph, 'Guemil');
    const said = makeBlock(graph, from, 'algo');
    explain(graph, from, said, 'no sé cómo llamar a esto, pero se tocan', 'Guemil');

    assert.equal(graph.crossingsOut(from)[0]?.term, null);
  });
});

describe('el vocabulario de relaciones', () => {
  it('cada término se lee al revés desde el otro extremo', () => {
    assert.equal(inverseOf('contradice'), 'es contradicha por');
    assert.equal(inverseOf('profundiza'), 'es profundizada por');
  });

  it('los simétricos son su propio inverso', () => {
    assert.equal(inverseOf('se opone a'), 'se opone a');
    assert.ok(isSymmetric({ name: 'dialoga con', inverse: 'dialoga con' }));
  });

  it('un término que el vocabulario no tiene se lee igual en los dos lados', () => {
    // No se inventa un recíproco: inventarlo pondría en boca de una página una
    // afirmación que nadie escribió.
    assert.equal(inverseOf('hace cosquillas a'), 'hace cosquillas a');
  });

  it('sin término no hay recíproco que leer', () => {
    assert.equal(inverseOf(null), null);
  });

  it('todo término del vocabulario que trae Vera tiene su inverso', () => {
    for (const term of STARTER_RELATIONS) {
      assert.notEqual(term.inverse, '');
      assert.equal(inverseOf(term.name), term.inverse);
    }
  });

  it('lee el título con corchetes o sin ellos', () => {
    assert.equal(titleIn('[[Guemil]]'), 'Guemil');
    assert.equal(titleIn('Guemil'), 'Guemil');
    assert.equal(titleIn('  [[Ciudad Abierta]]  '), 'Ciudad Abierta');
  });

  it('el sentido es dirigido salvo que se diga lo contrario', () => {
    assert.equal(senseIn(null), 'directed');
    assert.equal(senseIn('mutua'), 'mutual');
    assert.equal(senseIn('MUTUAL'), 'mutual');
    assert.equal(senseIn('cualquier cosa'), 'directed');
  });
});

/*
 * Las palabras las dice el corpus, no el código.
 *
 * Ver property-names.ts. Escribir `explica` o `tipo` dentro del programa
 * convertía en decisión de Vera algo que es de quien escribe: quien lleve su
 * corpus en maorí tiene que poder preguntar en maorí.
 */
describe('los nombres de las propiedades', () => {
  it('sin declarar nada, rige lo que Vera trae', () => {
    assert.deepEqual(readPropertyNames([]), DEFAULT_PROPERTY_NAMES);
  });

  it('la página de ontología pisa la palabra de un papel', () => {
    const names = readPropertyNames(['kind · momo', 'topic · kaupapa']);
    assert.equal(names.kind, 'momo');
    assert.equal(names.topic, 'kaupapa');
    // Y lo que no se declaró se queda como estaba.
    assert.equal(names.explains, DEFAULT_PROPERTY_NAMES.explains);
  });

  it('admite los tres separadores que ya usa la ontología', () => {
    assert.equal(readPropertyNames(['kind / genre']).kind, 'genre');
    assert.equal(readPropertyNames(['kind | soort']).kind, 'soort');
  });

  it('un papel que Vera no conoce se ignora sin protestar', () => {
    // La página es de quien la escribe y puede llevar dentro cosas que Vera
    // todavía no sepa leer.
    assert.deepEqual(readPropertyNames(['ferocidad · mucha']), DEFAULT_PROPERTY_NAMES);
  });

  it('un renglón a medias no borra la palabra que había', () => {
    assert.equal(readPropertyNames(['kind ·']).kind, DEFAULT_PROPERTY_NAMES.kind);
    assert.equal(readPropertyNames(['kind']).kind, DEFAULT_PROPERTY_NAMES.kind);
  });

  it('un corpus en otra lengua explica sus relaciones con sus palabras', () => {
    const graph = inhabitedGraph();
    graph.namesProperties({ ...DEFAULT_PROPERTY_NAMES, explains: 'whakamārama', term: 'kupu' });

    const from = makePage(graph, 'PICTOS');
    makePage(graph, 'Guemil');
    const said = makeBlock(graph, from, 'algo');
    const connective = makeBlock(graph, from, 'la profundiza', { parent: said });
    submit(graph, {
      kind: 'set_property',
      block: connective,
      propertyKey: 'whakamārama',
      propertyValue: '[[Guemil]]',
    });
    submit(graph, {
      kind: 'set_property',
      block: connective,
      propertyKey: 'kupu',
      propertyValue: 'profundiza',
    });

    const [crossing] = graph.crossingsOut(from);
    assert.equal(crossing?.targetTitle, 'Guemil');
    assert.equal(crossing?.term, 'profundiza');
  });

  it('y con las palabras de Vera ya no le dicen nada', () => {
    const graph = inhabitedGraph();
    graph.namesProperties({ ...DEFAULT_PROPERTY_NAMES, explains: 'whakamārama' });

    const from = makePage(graph, 'PICTOS');
    makePage(graph, 'Guemil');
    const said = makeBlock(graph, from, 'algo');
    const connective = makeBlock(graph, from, 'la profundiza', { parent: said });
    submit(graph, {
      kind: 'set_property',
      block: connective,
      propertyKey: 'explica',
      propertyValue: '[[Guemil]]',
    });

    assert.deepEqual(graph.crossingsOut(from), []);
  });
});
