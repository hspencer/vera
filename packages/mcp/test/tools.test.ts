// Las herramientas de la puerta MCP.
//
// Se prueban contra una Vera de mentira: lo que se fija aquí es qué le pide cada
// herramienta a la API y cómo presenta lo que recibe. Que la API conteste bien
// es cosa de las pruebas del servidor; que un modelo pueda leer esto y citarlo
// es cosa de aquí.
//
// Ver specs/mcp-server.allium.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { connectionFrom } from '../src/client.ts';
import { TOOLS, outline, toolNamed, type Ask, type Write } from '../src/tools.ts';

/** Una Vera de mentira que anota lo que le preguntan. */
function fakeVera(answers: Record<string, unknown>) {
  const asked: { path: string; parameters: unknown }[] = [];
  const ask: Ask = async (path, parameters) => {
    asked.push({ path, parameters: parameters ?? {} });
    const answer = answers[path];
    if (answer === undefined) return { error: 'no such route', status: 404 };
    return answer as never;
  };
  return { ask, asked };
}

const run = (name: string, args: Record<string, unknown>, ask: Ask, write?: Write): Promise<string> => {
  const tool = toolNamed(name);
  assert.ok(tool !== undefined, `no existe la herramienta ${name}`);
  return tool.run(args, ask, write);
};

describe('el catálogo', () => {
  it('ofrece una sola herramienta de escritura y ninguna de borrado', () => {
    assert.deepEqual(TOOLS.filter((tool) => tool.readOnly === false).map((tool) => tool.name), ['vera_escribir']);
    assert.ok(TOOLS.every((tool) => !/borrar|eliminar|descartar/.test(tool.name)));
    assert.deepEqual(
      TOOLS.map((tool) => tool.name).sort(),
      [
        'vera_buscar',
        'vera_escribir',
        'vera_historia_bloque',
        'vera_indice',
        'vera_leer_pagina',
        'vera_ontologia',
        'vera_preparar_escritura',
        'vera_quien_soy',
        'vera_vecindario',
      ],
    );
  });

  it('cada herramienta se explica, porque de eso depende que se use bien', () => {
    for (const tool of TOOLS) {
      assert.ok(tool.description.length > 120, `${tool.name} se explica de menos`);
      assert.equal(tool.inputSchema.type, 'object');
      assert.equal(tool.inputSchema.additionalProperties, false);
    }
  });
});

describe('quién soy', () => {
  it('dice con qué identidad se entró y con qué alcances', async () => {
    const { ask } = fakeVera({
      '/agents/whoami': {
        participant: 'participant:cotito',
        kind: 'agent',
        scopes: ['read', 'write'],
        label: 'Cotito · OpenClaw',
      },
      '/health': { graph: 'mind', pages: 900, blocks: 40000, lastSequence: 123 },
    });
    const said = await run('vera_quien_soy', {}, ask);
    assert.match(said, /participant:cotito/);
    assert.match(said, /read, write/);
    assert.match(said, /900 páginas/);
    // Se le dice al modelo lo que no puede hacer, o lo intenta.
    assert.match(said, /puede escribir/);
  });

  it('sin Vera, lo dice en vez de callarse', async () => {
    const { ask } = fakeVera({});
    const said = await run('vera_quien_soy', {}, ask);
    assert.match(said, /No pude leer eso/);
  });
});

describe('escribir', () => {
  it('envía una operación canónica con una clave de idempotencia', async () => {
    const { ask } = fakeVera({});
    const written: { origin: string; change: Record<string, unknown> }[] = [];
    const write: Write = async (origin, change) => {
      written.push({ origin, change });
      return { status: 'applied', sequence: 77, subjectId: 'block:77' };
    };
    const said = await run('vera_escribir', {
      origen: 'codex:tarea:1',
      cambio: { kind: 'create_block', page: 'page:1', parent: null, position: 0, content: 'Texto' },
    }, ask, write);
    assert.deepEqual(written, [{
      origin: 'codex:tarea:1',
      change: { kind: 'create_block', page: 'page:1', parent: null, position: 0, content: 'Texto' },
    }]);
    assert.match(said, /Cambio aplicado/);
    assert.match(said, /operación 77/);
  });

  it('escribe frontmatter como propiedad canónica', async () => {
    const { ask } = fakeVera({});
    const written: Record<string, unknown>[] = [];
    const write: Write = async (_origin, change) => {
      written.push(change);
      return { status: 'applied', sequence: 78, subjectId: 'page:1' };
    };
    const said = await run('vera_escribir', {
      origen: 'codex:tarea:propiedad',
      cambio: {
        kind: 'set_property',
        page: 'page:1',
        propertyKey: 'concepto',
        propertyValue: 'AUT Legal Case',
      },
    }, ask, write);
    assert.deepEqual(written, [
      { kind: 'set_property', page: 'page:1', propertyKey: 'concepto', propertyValue: 'AUT Legal Case' },
    ]);
    assert.match(said, /Cambio aplicado/);
  });

  it('retira una propiedad obsoleta por la misma puerta auditable', async () => {
    const { ask } = fakeVera({});
    const written: Record<string, unknown>[] = [];
    const write: Write = async (_origin, change) => {
      written.push(change);
      return { status: 'applied', sequence: 79, subjectId: 'page:1' };
    };
    await run('vera_escribir', {
      origen: 'codex:tarea:retirar-propiedad',
      cambio: { kind: 'remove_property', page: 'page:1', propertyKey: 'conceptos' },
    }, ask, write);
    assert.deepEqual(written, [
      { kind: 'remove_property', page: 'page:1', propertyKey: 'conceptos' },
    ]);
  });

  it('rechaza edición y borrado antes de llamar a Vera', async () => {
    const { ask } = fakeVera({});
    let called = false;
    const write: Write = async () => {
      called = true;
      return { status: 'applied', sequence: 1, subjectId: 'block:1' };
    };
    const said = await run('vera_escribir', {
      origen: 'codex:tarea:2',
      cambio: { kind: 'edit_block', block: 'block:1', content: 'Pisado' },
    }, ask, write);
    assert.equal(called, false);
    assert.match(said, /sólo crea páginas y bloques o corrige propiedades/);
  });
});

describe('preparar una escritura', () => {
  it('entrega juntas la guía viva y la ontología vigente', async () => {
    const page = {
      id: 'page:guide',
      title: 'Vera — Escritura por agentes',
      visibility: 'private',
      createdAt: 0,
      lastEditedAt: 0,
      properties: [],
      blocks: [{ stableId: 'block:rule', parent: null, position: 0, content: 'Una idea por bloque.' }],
      backlinks: [],
      references: [],
      authorship: {},
    };
    const { ask, asked } = fakeVera({
      '/pages/Vera%20%E2%80%94%20Escritura%20por%20agentes': page,
      '/ontology': { names: { kind: 'tipo', topic: 'concepto' } },
    });
    const said = await run('vera_preparar_escritura', {}, ask);
    assert.deepEqual(asked.map((one) => one.path).sort(), [
      '/ontology',
      '/pages/Vera%20%E2%80%94%20Escritura%20por%20agentes',
    ]);
    assert.match(said, /Una idea por bloque/);
    assert.match(said, /"topic": "concepto"/);
  });
});

describe('buscar', () => {
  it('cada extracto viaja con su página y su bloque, para poder citarlo', async () => {
    const { ask, asked } = fakeVera({
      '/search': [
        { page: 'page:1', block: 'block:9', field: 'content', excerpt: 'la memoria es del dueño', rank: 1 },
      ],
    });
    const said = await run('vera_buscar', { consulta: 'memoria' }, ask);
    assert.deepEqual(asked[0], { path: '/search', parameters: { q: 'memoria' } });
    assert.match(said, /page:1/);
    assert.match(said, /block:9/);
    assert.match(said, /la memoria es del dueño/);
  });

  it('cuando hay más de lo que cabe, dice cuánto no enseñó', async () => {
    // Un tope callado se lee como «esto es todo lo que hay».
    const many = Array.from({ length: 30 }, (_, at) => ({
      page: `page:${at}`,
      block: null,
      field: 'title',
      excerpt: `resultado ${at}`,
      rank: at + 1,
    }));
    const { ask } = fakeVera({ '/search': many });
    const said = await run('vera_buscar', { consulta: 'x', cuantos: 5 }, ask);
    assert.match(said, /25 más sin mostrar/);
  });

  it('nada encontrado no es un fallo', async () => {
    const { ask } = fakeVera({ '/search': [] });
    assert.match(await run('vera_buscar', { consulta: 'zzz' }, ask), /Nada en el corpus/);
  });
});

describe('leer una página', () => {
  const page = {
    id: 'page:7',
    title: 'Vera',
    visibility: 'private',
    createdAt: 0,
    lastEditedAt: 1_700_000_000_000,
    properties: [{ key: 'tipo', value: 'proyecto' }],
    blocks: [
      { stableId: 'b1', parent: null, position: 1, content: 'Primero' },
      { stableId: 'b2', parent: 'b1', position: 1, content: 'Dentro del primero' },
      { stableId: 'b3', parent: null, position: 2, content: 'Segundo' },
    ],
    backlinks: [{ page: 'page:8', block: null, title: 'Otra', excerpt: 'habla de Vera' }],
    references: [{ page: null, title: 'Sin escribir', block: 'b1', excerpt: '' }],
    authorship: { b3: { participant: 'participant:cotito', kind: 'agent', channel: 'agent_generation' } },
  };

  it('conserva la sangría, que es lo que dice de quién es hijo qué', async () => {
    const { ask } = fakeVera({ '/pages/Vera': page });
    const said = await run('vera_leer_pagina', { pagina: 'Vera' }, ask);
    assert.match(said, /- Primero\n {2}- Dentro del primero\n- Segundo/);
  });

  it('dice qué bloques escribió una máquina', async () => {
    // @invariant GeneratedContentIsAlwaysDistinguishable: distinguir lo escrito
    // de lo generado tiene que costar lo mismo que leer.
    const { ask } = fakeVera({ '/pages/Vera': page });
    const said = await run('vera_leer_pagina', { pagina: 'Vera' }, ask);
    assert.match(said, /Escrito por agentes/);
    assert.match(said, /b3 · participant:cotito/);
  });

  it('una página que no existe se contesta con qué hacer en su lugar', async () => {
    const { ask } = fakeVera({});
    const said = await run('vera_leer_pagina', { pagina: 'Nada' }, ask);
    assert.match(said, /vera_buscar/);
  });

  it('un enlace a una página aún sin escribir se dice como lo que es', async () => {
    const { ask } = fakeVera({ '/pages/Vera': page });
    const said = await run('vera_leer_pagina', { pagina: 'Vera' }, ask);
    assert.match(said, /Sin escribir \(aún sin escribir\)/);
  });
});

describe('la historia de un bloque', () => {
  it('trae también lo que ya no está en la página', async () => {
    const { ask } = fakeVera({
      '/blocks/block%3A3/history': {
        block: 'block:3',
        alive: false,
        now: null,
        states: [
          { sequence: 1, at: 0, by: 'Herbert', channel: 'typed_text', what: 'nació', content: 'lo primero' },
          { sequence: 2, at: 1000, by: 'Herbert', channel: 'typed_text', what: 'se borró', content: null },
        ],
      },
    });
    const said = await run('vera_historia_bloque', { bloque: 'block:3' }, ask);
    assert.match(said, /está borrado/);
    assert.match(said, /lo primero/);
  });
});

describe('el vecindario', () => {
  it('viene ordenado por cercanía, que es el orden en que se lee un mapa', async () => {
    const { ask, asked } = fakeVera({
      '/graph/Vera': {
        nodes: [
          { id: 'page:3', title: 'Lejos', distance: 2, degree: 1 },
          { id: 'page:2', title: 'Cerca', distance: 1, degree: 9 },
        ],
      },
    });
    const said = await run('vera_vecindario', { pagina: 'Vera', profundidad: 3 }, ask);
    assert.deepEqual(asked[0]?.parameters, { depth: 3 });
    assert.ok(said.indexOf('Cerca') < said.indexOf('Lejos'));
  });

  it('la profundidad se acota: pedir 40 saltos es pedir el corpus entero', async () => {
    const { ask, asked } = fakeVera({ '/graph/Vera': { nodes: [] } });
    await run('vera_vecindario', { pagina: 'Vera', profundidad: 40 }, ask);
    assert.deepEqual(asked[0]?.parameters, { depth: 4 });
  });
});

describe('la sangría', () => {
  it('un bloque de varias líneas se sangra entero', () => {
    const said = outline([
      { stableId: 'a', parent: null, position: 1, content: 'uno\ndos' },
      { stableId: 'b', parent: 'a', position: 1, content: 'dentro' },
    ]);
    assert.equal(said, '- uno\n- dos\n  - dentro');
  });

  it('el orden lo da la posición y no el orden en que llegaron', () => {
    const said = outline([
      { stableId: 'b', parent: null, position: 2, content: 'segundo' },
      { stableId: 'a', parent: null, position: 1, content: 'primero' },
    ]);
    assert.equal(said, '- primero\n- segundo');
  });
});

describe('de dónde sale la credencial', () => {
  it('de un archivo antes que del entorno', () => {
    // Una variable de entorno se hereda a todo lo que el proceso lance; un
    // archivo con permisos, no.
    const connection = connectionFrom(
      { VERA_TOKEN_FILE: '/donde/sea', VERA_TOKEN: 'del-entorno' },
      () => '  del-archivo\n',
    );
    assert.equal(connection.token, 'del-archivo');
  });

  it('si el archivo no está, se usa el entorno', () => {
    const connection = connectionFrom({ VERA_TOKEN_FILE: '/no/existe', VERA_TOKEN: 'del-entorno' }, () => {
      throw new Error('nope');
    });
    assert.equal(connection.token, 'del-entorno');
  });

  it('sin credencial se entra igual, que es lo que pasa en casa', () => {
    const connection = connectionFrom({}, () => '');
    assert.equal(connection.token, null);
    assert.equal(connection.url, 'http://127.0.0.1:4173');
  });
});
