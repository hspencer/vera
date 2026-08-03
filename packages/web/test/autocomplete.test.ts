// La máquina de estados del autocompletado. Entra texto y cursor, sale qué está
// abierto y qué se busca.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  completionFor,
  detectTrigger,
  matchingCommands,
  queryOf,
  type Open,
} from '../src/autocomplete.ts';

describe('detectTrigger', () => {
  it('dos corchetes abren la búsqueda de páginas', () => {
    assert.deepEqual(detectTrigger('ver [[', 6), { trigger: 'pagina', queryStart: 6 });
  });

  it('dos paréntesis abren la de bloques', () => {
    assert.deepEqual(detectTrigger('ver ((', 6), { trigger: 'bloque', queryStart: 6 });
  });

  it('una almohadilla abre la de etiquetas', () => {
    assert.deepEqual(detectTrigger('sobre #', 7), { trigger: 'etiqueta', queryStart: 7 });
  });

  it('#[[ es una etiqueta, no una página', () => {
    // Es como se escribe una etiqueta que lleva espacios.
    assert.deepEqual(detectTrigger('#[[', 3), { trigger: 'etiqueta', queryStart: 3 });
  });

  it('una almohadilla pegada a una palabra no abre nada', () => {
    // Si no, `C#3` y cualquier ancla de URL abrirían una búsqueda.
    assert.equal(detectTrigger('C#', 2), null);
    assert.equal(detectTrigger('https://x.cl/a#', 15), null);
  });

  it('la barra abre comandos sólo donde podría empezar uno', () => {
    assert.deepEqual(detectTrigger('/', 1), { trigger: 'comando', queryStart: 1 });
    assert.deepEqual(detectTrigger('texto /', 7), { trigger: 'comando', queryStart: 7 });
    assert.equal(detectTrigger('ruta/', 5), null, 'una ruta lleva barras y no es un comando');
  });

  it('el texto corriente no abre nada', () => {
    assert.equal(detectTrigger('una frase normal', 16), null);
  });
});

describe('queryOf', () => {
  const pagina: Open = { trigger: 'pagina', queryStart: 2 };

  it('es lo que hay entre el disparador y el cursor', () => {
    assert.equal(queryOf(pagina, '[[Trav', 6), 'Trav');
  });

  it('se cierra si el cursor sale por delante del disparador', () => {
    assert.equal(queryOf(pagina, '[[Trav', 1), null);
  });

  it('una página admite espacios', () => {
    assert.equal(queryOf(pagina, '[[Viaje a España', 16), 'Viaje a España');
  });

  it('una etiqueta no', () => {
    const etiqueta: Open = { trigger: 'etiqueta', queryStart: 1 };
    assert.equal(queryOf(etiqueta, '#uno dos', 8), null);
    assert.equal(queryOf(etiqueta, '#uno', 4), 'uno');
  });

  it('un comando tampoco', () => {
    const comando: Open = { trigger: 'comando', queryStart: 1 };
    assert.equal(queryOf(comando, '/cita algo', 10), null);
  });

  it('el corchete de cierre la termina', () => {
    assert.equal(queryOf(pagina, '[[Trav]]', 8), null);
  });

  it('un salto de línea la termina', () => {
    assert.equal(queryOf(pagina, '[[Trav\nmás', 10), null);
  });
});

describe('completionFor', () => {
  it('una página se escribe entre corchetes y salta el cierre que ya estaba', () => {
    // El autopar dejó `]]` delante del cursor; escribir otro daría `]]]]`.
    const open: Open = { trigger: 'pagina', queryStart: 2 };
    assert.deepEqual(completionFor(open, 'Travesías', '[[Trav]]', 6), {
      buffer: '[[Travesías]]',
      cursor: 13,
    });
  });

  it('un bloque hace lo mismo con paréntesis', () => {
    const open: Open = { trigger: 'bloque', queryStart: 2 };
    assert.deepEqual(completionFor(open, 'block:7', '((blo))', 5), {
      buffer: '((block:7))',
      cursor: 11,
    });
  });

  it('una etiqueta sin espacios va suelta', () => {
    const open: Open = { trigger: 'etiqueta', queryStart: 1 };
    assert.deepEqual(completionFor(open, 'diseño', '#dis', 4), {
      buffer: '#diseño',
      cursor: 7,
    });
  });

  it('una etiqueta con espacios necesita corchetes', () => {
    const open: Open = { trigger: 'etiqueta', queryStart: 1 };
    const result = completionFor(open, 'diseño de interacción', '#dis', 4);
    assert.equal(result.buffer, '#[[diseño de interacción]]');
  });

  it('un comando se come su propia barra', () => {
    // `/cita` tiene que dejar una cita, no `/> `.
    const open: Open = { trigger: 'comando', queryStart: 1 };
    assert.deepEqual(completionFor(open, 'cita', '/cit', 4), { buffer: '> ', cursor: 2 });
  });

  it('un comando deja el cursor donde se escribe', () => {
    const open: Open = { trigger: 'comando', queryStart: 1 };
    const result = completionFor(open, 'codigo', '/cod', 4);
    assert.equal(result.buffer, '```\n\n```');
    assert.equal(result.cursor, 4, 'dentro del cercado, no al final');
  });

  it('conserva lo que había alrededor', () => {
    // `[[` ocupa los índices 6 y 7, así que la consulta empieza en el 8.
    const open: Open = { trigger: 'pagina', queryStart: 8 };
    const result = completionFor(open, 'Otra', 'antes [[Ot]] después', 10);
    assert.equal(result.buffer, 'antes [[Otra]] después');
  });
});

describe('matchingCommands', () => {
  it('sin consulta ofrece todos', () => {
    assert.ok(matchingCommands('').length > 8);
  });

  it('filtra por nombre', () => {
    assert.deepEqual(matchingCommands('cita').map((c) => c.name), ['cita']);
  });

  it('filtra también por lo que hace', () => {
    assert.ok(matchingCommands('diagrama').some((c) => c.name === 'mermaid'));
  });

  it('una consulta que no encaja no ofrece nada', () => {
    assert.deepEqual(matchingCommands('zzzz'), []);
  });
});
