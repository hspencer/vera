// Pruebas de la puesta en forma. Ver la Fase B en specs/page-processing.allium.
//
// Lo que se aplica solo tiene que poder probarse solo: éstas son las pruebas de
// lo único que Vera cambia en una página sin preguntar.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Block } from '@vera/core';

import { readStructure } from '../src/structure.ts';
import { describePlan, piecesOf, planTabularity } from '../src/tabularity.ts';

let next = 0;
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
    next += 1;
    const made: Block = {
      stableId: `block:${next}`,
      page: 'page:1',
      parent,
      position: at,
      content: line.slice(indent).replace(/^·\s?/, '').replace(/\\n/g, '\n'),
      createdAt: 0,
    };
    blocks.push(made);
    open[depth] = made.stableId;
    open.length = depth + 1;
  }
  return blocks;
}

const plan = (blocks: Block[]) => planTabularity('page:1', blocks, readStructure(blocks));

/** Una frase larga de las que hacen falta para pasar el umbral de monolítico. */
const frase = (n: number): string =>
  `Esta es la frase número ${n} y dice algo suficientemente largo como para que el párrafo entero pase de los setecientos caracteres que hacen falta.`;

describe('planTabularity', () => {
  it('borra los bloques vacíos', () => {
    const blocks = page(['algo', '', 'otra cosa'].join('\n'));
    blocks[1] = { ...(blocks[1] as Block), content: '   ' };
    const { steps } = plan(blocks);
    assert.equal(steps.length, 1);
    assert.deepEqual(steps[0]?.change, { kind: 'remove_block', block: 'block:2' });
  });

  it('nunca deja una página sin ningún bloque', () => {
    const blocks = page('x');
    blocks[0] = { ...(blocks[0] as Block), content: '' };
    assert.deepEqual(plan(blocks).steps, []);
  });

  it('no borra un bloque vacío del que cuelga algo', () => {
    const blocks = page(['', '  hijo'].join('\n'));
    blocks[0] = { ...(blocks[0] as Block), content: '' };
    assert.deepEqual(plan(blocks).steps, []);
  });

  it('marca como título lo que se comportaba como título', () => {
    const blocks = page(['Antecedentes', '  el proyecto empezó en marzo'].join('\n'));
    const { steps } = plan(blocks);
    assert.deepEqual(steps[0]?.change, {
      kind: 'edit_block',
      block: 'block:1',
      content: '# Antecedentes',
    });
  });

  it('el nivel del título sale de lo hondo que esté', () => {
    const blocks = page(['# Uno', '  Antecedentes', '    detalle'].join('\n'));
    const marked = plan(blocks).steps.find((step) => step.kind === 'heading');
    assert.equal((marked?.change as { content: string }).content, '## Antecedentes');
  });

  it('separa un encabezado de su desarrollo, y el desarrollo pasa a colgar de él', () => {
    const blocks = page([`# Acuerdos\\nAna lleva las cifras.`].join('\n'));
    const { steps } = plan(blocks);
    assert.deepEqual(steps[0]?.change, {
      kind: 'edit_block',
      block: 'block:1',
      content: '# Acuerdos',
    });
    assert.deepEqual(steps[1]?.change, {
      kind: 'create_block',
      page: 'page:1',
      parent: 'block:1',
      position: 0,
      content: 'Ana lleva las cifras.',
    });
  });

  it('corta un bloque con dos encabezados dentro en dos hermanos', () => {
    const blocks = page([`texto suelto\\n# Uno\\n# Dos`].join('\n'));
    const { steps } = plan(blocks);
    const contents = steps.map((step) => (step.change as { content: string }).content);
    assert.deepEqual(contents, ['texto suelto', '# Uno', '# Dos']);
    assert.equal(steps[1]?.change.kind, 'create_block');
    // El segundo hermano va detrás del primero, no delante.
    assert.equal((steps[1]?.change as { position: number }).position, 1);
    assert.equal((steps[2]?.change as { position: number }).position, 2);
  });

  it('parte un párrafo largo y deja los trozos como hermanos, en orden', () => {
    const largo = [frase(1), frase(2), frase(3), frase(4), frase(5)].join(' ');
    const blocks = page(largo);
    const { steps } = plan(blocks);
    assert.equal(steps[0]?.change.kind, 'edit_block');
    assert.ok(steps.length > 1);
    for (const [at, step] of steps.slice(1).entries()) {
      assert.equal(step.change.kind, 'create_block');
      assert.equal((step.change as { position: number }).position, at + 1);
    }
    // Nada se pierde ni se reescribe: los trozos son el texto original.
    const juntos = steps.map((step) => (step.change as { content: string }).content).join(' ');
    assert.equal(juntos.replace(/\s+/g, ' '), largo.replace(/\s+/g, ' '));
  });

  it('endereza un encabezado que cuelga de otro más hondo', () => {
    const blocks = page(['### Detalle', '  # Conclusiones', '    quedó pendiente'].join('\n'));
    const { steps } = plan(blocks);
    assert.deepEqual(steps[0]?.change, {
      kind: 'move_block',
      block: 'block:2',
      page: 'page:1',
      parent: null,
      position: 1,
    });
  });

  it('un bloque se arregla de una manera por vuelta', () => {
    // Un encabezado pegado a un párrafo larguísimo tiene dos defectos; encadenar
    // dos transformaciones haría que la segunda operase sobre lo que ya no se
    // leyó.
    const blocks = page([`# Acuerdos\\n${frase(1)} ${frase(2)} ${frase(3)} ${frase(4)}`].join('\n'));
    const { steps, touched } = plan(blocks);
    assert.deepEqual(touched, ['block:1']);
    assert.equal(steps.filter((step) => step.change.kind === 'edit_block').length, 1);
  });

  it('una página sana no da ningún paso', () => {
    // Sana de veras: cada título ya se lleva lo suyo, y el `##` ya cuelga del `#`.
    const blocks = page(
      ['# Título', '  Un párrafo con su punto.', '  ## Sección', '    Otro.'].join('\n'),
    );
    assert.deepEqual(plan(blocks).steps, []);
  });

  /*
   * Esta prueba tenía antes el árbol de arriba sin sangrar el `##`, y lo llamaba
   * sano. Dejó de serlo cuando se añadió `nest_under_heading`: un `##` hermano de
   * un `#` es exactamente el defecto que ese arreglo existe para corregir, porque
   * plegar el `#` tiene que recoger también la sección que lleva dentro.
   */
  it('un título que era hermano del anterior pasa a colgar de él', () => {
    const blocks = page(['# Título', '  Un párrafo con su punto.', '## Sección', '  Otro.'].join('\n'));
    const moves = plan(blocks).steps.filter((step) => step.kind === 'nest');
    assert.equal(moves.length, 1);
    assert.deepEqual(moves[0]?.change, {
      kind: 'move_block',
      block: 'block:3',
      page: 'page:1',
      parent: 'block:1',
      position: 1,
    });
  });

  it('dice qué tocó, para no proponer nada más sobre eso en la misma vuelta', () => {
    const blocks = page(['Antecedentes', '  algo'].join('\n'));
    assert.deepEqual(plan(blocks).touched, ['block:1']);
  });

  it('el mismo plan sale de la misma página siempre', () => {
    const blocks = page(['Antecedentes', '  algo', '', '### Detalle', '  # Conclusiones'].join('\n'));
    assert.deepEqual(plan(blocks), plan(blocks));
  });
});

describe('piecesOf', () => {
  it('parte por donde el texto ya venía partido', () => {
    assert.deepEqual(piecesOf('uno\ndos\ntres'), ['uno', 'dos', 'tres']);
  });

  it('junta frases hasta un tamaño de lectura, sin picar frase por frase', () => {
    const pieces = piecesOf([frase(1), frase(2), frase(3), frase(4)].join(' '));
    assert.ok(pieces.length > 1);
    assert.ok(pieces.length < 4);
  });

  it('un texto de una sola frase no se parte', () => {
    assert.deepEqual(piecesOf('Una sola frase.'), ['Una sola frase.']);
  });

  it('no deja un último trozo demasiado corto', () => {
    const pieces = piecesOf([frase(1), frase(2), 'Y ya.'].join(' '));
    assert.ok(!pieces.some((one) => one.length < 20));
  });
});

describe('describePlan', () => {
  it('cuenta arreglos y no operaciones', () => {
    const blocks = page([`# Acuerdos\\nAna lleva las cifras.`].join('\n'));
    assert.deepEqual(describePlan(plan(blocks).steps), ['un bloque con dos unidades separado']);
  });

  it('no dice nada cuando no hizo nada', () => {
    assert.deepEqual(describePlan([]), []);
  });
});

describe('lo delicado no se toca', () => {
  /*
   * Lo que afirman estas pruebas es que el bloque delicado no se rehace: no se
   * parte ni se separa. Antes lo decían exigiendo que el plan entero fuera vacío,
   * y eso afirmaba de paso algo mucho más fuerte —que a la página no le pasa
   * nada—, que dejó de ser cierto al añadirse `nest_under_heading`: mover *otro*
   * bloque bajo el título no toca una letra del delicado.
   */
  const rehacen = (blocks: Block[]) =>
    plan(blocks).steps.filter((step) => step.kind === 'split' || step.kind === 'separate');

  const con = (content: string): Block[] => [
    { stableId: 'block:1', page: 'page:1', parent: null, position: 0, content, createdAt: 0 },
    { stableId: 'block:2', page: 'page:1', parent: null, position: 1, content: 'otra cosa.', createdAt: 0 },
  ];

  it('no parte un bloque con una valla de código', () => {
    const codigo = `# Cómo se corre\n\`\`\`bash\nnpm run dev\nnpm test\n\`\`\``;
    assert.deepEqual(rehacen(con(codigo)), []);
  });

  it('no parte una tabla', () => {
    const tabla = `# Precios\n| uno | dos |\n| --- | --- |\n| 1 | 2 |`;
    assert.deepEqual(rehacen(con(tabla)), []);
  });

  it('no parte un bloque con propiedades dentro', () => {
    assert.deepEqual(rehacen(con('# Ficha\nautor:: alguien')), []);
  });

  it('pero el defecto se sigue viendo', () => {
    const codigo = `# Cómo se corre\n\`\`\`bash\nnpm run dev\n\`\`\``;
    const defects = readStructure(con(codigo)).observations.map((one) => one.defect);
    assert.ok(defects.includes('mixed_units'));
  });
});

/*
 * Anidar bajo el título.
 *
 * En Markdown la jerarquía la lleva la marca `#` y no la sangría, así que al
 * volverse bloques la marca sobrevive y la jerarquía no. Sin esto un título no
 * se puede plegar: plegar recoge lo que cuelga, y de un título plano no cuelga
 * nada. Ver @invariant AHeadingTakesWhatFollowsItUntilItsPeer.
 */
describe('anidar bajo el título', () => {
  /** El árbol que queda tras aplicar el plan, dibujado con sangría. */
  const after = (source: string): string[] => {
    const blocks = page(source);
    const parent = new Map(blocks.map((b) => [b.stableId, b.parent]));
    const order = new Map(blocks.map((b) => [b.stableId, b.position]));
    const text = new Map(blocks.map((b) => [b.stableId, b.content]));
    for (const step of plan(blocks).steps) {
      const change = step.change;
      if (change.kind !== 'move_block') continue;
      parent.set(change.block, change.parent);
      order.set(change.block, change.position);
    }
    const kids = (of: string | null): string[] =>
      [...parent.entries()]
        .filter(([, at]) => at === of)
        .map(([id]) => id)
        .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    const out: string[] = [];
    const walk = (of: string | null, depth: number): void => {
      for (const id of kids(of)) {
        out.push('  '.repeat(depth) + (text.get(id) ?? ''));
        walk(id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  };

  it('un título se lleva lo que viene detrás', () => {
    assert.deepEqual(after('# Uno\nprimero\nsegundo'), ['# Uno', '  primero', '  segundo']);
  });

  it('y lo deja al llegar a otro título de su mismo rango', () => {
    assert.deepEqual(after('# Uno\nprimero\n# Dos\nsegundo'), [
      '# Uno',
      '  primero',
      '# Dos',
      '  segundo',
    ]);
  });

  it('un título menos importante entra, y se lleva lo suyo', () => {
    assert.deepEqual(after('# Uno\n## Uno.uno\nhondo\n# Dos'), [
      '# Uno',
      '  ## Uno.uno',
      '    hondo',
      '# Dos',
    ]);
  });

  it('no se lleva lo que ya está más allá de su par', () => {
    assert.deepEqual(after('## Menor\nsuyo\n# Mayor\najeno'), [
      '## Menor',
      '  suyo',
      '# Mayor',
      '  ajeno',
    ]);
  });

  it('lo que ya colgaba del título se queda donde estaba, y lo nuevo va detrás', () => {
    assert.deepEqual(after('# Uno\n  ya dentro\nnuevo'), ['# Uno', '  ya dentro', '  nuevo']);
  });

  it('aplicarlo dos veces da la misma página que aplicarlo una', () => {
    const una = after('# Uno\nprimero\n## Dos\nsegundo');
    assert.deepEqual(una, ['# Uno', '  primero', '  ## Dos', '    segundo']);
    // El árbol ya anidado no propone ningún movimiento más.
    const ya = page('# Uno\n  primero\n  ## Dos\n    segundo');
    assert.deepEqual(
      plan(ya).steps.filter((step) => step.kind === 'nest'),
      [],
    );
  });

  it('una página sin títulos no se toca', () => {
    assert.deepEqual(
      plan(page('uno\ndos\ntres')).steps.filter((step) => step.kind === 'nest'),
      [],
    );
  });
});
