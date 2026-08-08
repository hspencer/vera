// Poner en forma una página: lo que se arregla sin decidir por nadie.
//
// Ver la Fase B de «Vera — Procesamiento automático de páginas» y
// specs/page-processing.allium. La lectura estructural describe; esto es lo
// único que además propone hacer, y lo hace con las cuatro transformaciones que
// Herbert eligió el 7 de agosto de 2026: partir párrafos largos, marcar títulos
// implícitos, enderezar jerarquías torcidas y separar unidades pegadas —más los
// bloques vacíos, que ya estaban.
//
// Ninguna añade ni quita sentido: parten donde el texto ya estaba partido,
// marcan lo que ya se comportaba como título y mueven un bloque a donde su
// propia marca dice que iba. El texto no se reescribe nunca: se corta, se
// prefija un `#` y se cambia de sitio. Lo que exigiría interpretar —resumir,
// fusionar, reordenar por sentido— no está aquí y no está por descuido.
//
// Y no hay modelo: el mismo plan sale de la misma página siempre, que es lo que
// permite probar lo que este archivo afirma y lo que hace que aplicarlo solo no
// sea aplicar algo que nadie puede prever.

import type { Block, Change } from '@vera/core';

import type { PageStructure } from './structure.ts';

/** Las clases de arreglo, para contarlas en el registro. */
export type FixKind = 'empty' | 'separate' | 'heading' | 'split' | 'hoist' | 'nest';

export interface PlanStep {
  kind: FixKind;
  change: Change;
}

/*
 * Sin inversa y sin botón de deshacer.
 *
 * Lo decidió Herbert el 7 de agosto de 2026: «no me interesa un historial tan
 * fino, se aplica y ya». No es que no quede rastro —cada paso entra por
 * POST /operations y queda en el log canónico como cualquier edición, con su
 * autoría y su secuencia—: es que no se construye encima una capa de inversas
 * para deshacer el gesto entero. Lo que se arregla se arregla, y lo que quedó
 * mal se corrige escribiendo, que es como se corrige todo lo demás en Vera.
 */

export interface Plan {
  steps: PlanStep[];
  /**
   * Los bloques que el plan toca.
   *
   * Sobre ellos no se propone nada más en la misma vuelta: las sugerencias de
   * enlace se calcularon con el texto de antes, y aplicarlas encima devolvería
   * el bloque a como estaba. Vuelven a proponerse la próxima vez.
   */
  touched: string[];
}

/*
 * Los números que deciden dónde se corta. Están juntos porque son lo único
 * discutible: el resto es leer el texto que ya hay.
 */
const TARGET = 350; // a cuánto se apunta por bloque al partir un párrafo
const MIN = 120; // y por debajo de esto no se cierra un trozo, para no picar
const DEEPEST = 6; // no hay encabezado de nivel siete

const HEADING = /^(#{1,6})\s+\S/;

/*
 * Lo que no se toca aunque tenga la pinta.
 *
 * Un bloque con una valla de código, una tabla o una propiedad dentro es un
 * bloque cuyas líneas significan algo juntas: partirlo por sus saltos de línea
 * deja media tabla en un sitio y media en otro, y una valla abierta que se cierra
 * en el bloque siguiente ya no es código, es texto roto. El defecto puede estar
 * —un bloque así puede ser larguísimo— y aun así arreglarlo no es conservador.
 * Se describe y no se toca.
 */
function delicate(content: string): boolean {
  return (
    content.includes('```') ||
    /^\s*\|.*\|/m.test(content) ||
    /^[^\s:]+::/m.test(content) ||
    content.includes('$$')
  );
}

function headingLevelOf(content: string): number | null {
  const found = HEADING.exec(content.trimStart());
  return found === null ? null : (found[1] ?? '#').length;
}

/** Las frases de un texto, cortadas por sus cierres y con el cierre dentro. */
function sentencesOf(text: string): string[] {
  const parts = text.split(/(?<=[.!?…])\s+/);
  return parts.map((one) => one.trim()).filter((one) => one !== '');
}

/**
 * En qué trozos se parte un párrafo largo.
 *
 * Si el texto ya trae saltos de línea, se parte por ahí: quien escribió ya dijo
 * dónde separaba, y adivinarlo otra vez sólo puede empeorarlo. Si no, se juntan
 * frases hasta llegar a un tamaño de lectura —ni el párrafo entero ni una frase
 * por bloque, que es la fragmentación mecánica que la página prohíbe.
 */
export function piecesOf(content: string): string[] {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length > 1) return lines;

  const sentences = sentencesOf(content);
  if (sentences.length < 2) return [content.trim()];

  const pieces: string[] = [];
  let open = '';
  for (const sentence of sentences) {
    const next = open === '' ? sentence : `${open} ${sentence}`;
    if (open !== '' && next.length > TARGET && open.length >= MIN) {
      pieces.push(open);
      open = sentence;
      continue;
    }
    open = next;
  }
  if (open !== '') pieces.push(open);
  // Un último trozo demasiado corto se queda con el anterior: un bloque que dice
  // «Y ya.» no es una unidad de sentido.
  if (pieces.length > 1) {
    const last = pieces.at(-1) ?? '';
    if (last.length < MIN) {
      pieces.splice(-2, 2, `${pieces.at(-2) ?? ''} ${last}`);
    }
  }
  return pieces;
}

/**
 * El plan de una página: qué se arregla y en qué orden.
 *
 * Los pasos se aplican en el orden en que salen. Las posiciones se calculan
 * sobre el estado que la página tendrá en ese momento —no sobre el original—,
 * así que aplicarlos salteados o al revés no da la misma página.
 */
export function planTabularity(page: string, blocks: Block[], structure: PageStructure): Plan {
  const unitOf = new Map(structure.units.map((unit) => [unit.block, unit]));
  const defects = new Map<string, Set<string>>();
  for (const observation of structure.observations) {
    const held = defects.get(observation.block) ?? new Set<string>();
    held.add(observation.defect);
    defects.set(observation.block, held);
  }

  // El estado vivo de la página según se aplica el plan: quién cuelga de quién,
  // en qué orden, y qué dice cada bloque.
  const kin = new Map<string | null, string[]>();
  const parentOf = new Map<string, string | null>();
  const contentOf = new Map<string, string>();
  for (const unit of structure.units) {
    const held = kin.get(unit.parent) ?? [];
    held.push(unit.block);
    kin.set(unit.parent, held);
    parentOf.set(unit.block, unit.parent);
  }
  for (const block of blocks) contentOf.set(block.stableId, block.content);

  const steps: PlanStep[] = [];
  const touched = new Set<string>();
  let alive = blocks.length;
  let invented = 0;

  const indexIn = (parent: string | null, block: string): number =>
    (kin.get(parent) ?? []).indexOf(block);
  const putAt = (parent: string | null, block: string, at: number): void => {
    const held = kin.get(parent) ?? [];
    held.splice(at, 0, block);
    kin.set(parent, held);
    parentOf.set(block, parent);
  };
  const takeOut = (parent: string | null, block: string): void => {
    const held = kin.get(parent) ?? [];
    const at = held.indexOf(block);
    if (at !== -1) held.splice(at, 1);
  };

  /** Un bloque nuevo detrás de `after`. Devuelve cómo llamarlo mientras no exista. */
  const bornAfter = (parent: string | null, after: string, content: string): string => {
    invented += 1;
    const name = `new:${invented}`;
    const at = indexIn(parent, after) + 1;
    steps.push({
      kind: 'split',
      change: { kind: 'create_block', page, parent, position: at, content },
    });
    putAt(parent, name, at);
    return name;
  };

  for (const unit of structure.units) {
    const id = unit.block;
    const content = contentOf.get(id) ?? '';
    const has = defects.get(id) ?? new Set<string>();
    const parent = parentOf.get(id) ?? null;

    /*
     * Un arreglo por bloque y por vuelta.
     *
     * Un bloque puede tener dos defectos a la vez —un encabezado pegado a un
     * párrafo larguísimo—, y encadenar dos transformaciones sobre el mismo texto
     * significa que la segunda opera sobre lo que la primera dejó, que ya no es
     * lo que se leyó. Se hace el más urgente y el resto se ve la próxima vez,
     * cuando vuelva a leerse la página tal como quedó.
     */

    // Un bloque delicado se describe y no se toca: ver delicate().
    if (delicate(content)) continue;

    // 1. Los huecos. Nunca el último bloque que le queda a la página: sin él no
    //    quedaría dónde escribir.
    if (has.has('empty_block') && unit.descendants === 0 && alive > 1) {
      steps.push({
        kind: 'empty',
        change: { kind: 'remove_block', block: id },
      });
      takeOut(parent, id);
      touched.add(id);
      alive -= 1;
      continue;
    }

    // 2. Dos cosas en un bloque donde el documento tenía dos lugares.
    if (has.has('mixed_units')) {
      const lines = content.split('\n');
      const first = lines[0] ?? '';
      const rest = lines.slice(1).join('\n').trim();
      if (headingLevelOf(first) !== null && rest !== '') {
        // El encabezado se queda solo y su desarrollo pasa a colgar de él, que
        // es donde estaba en el documento antes de que la captura los pegara.
        steps.push({
          kind: 'separate',
          change: { kind: 'edit_block', block: id, content: first.trim() },
        });
        contentOf.set(id, first.trim());
        invented += 1;
        steps.push({
          kind: 'separate',
          change: { kind: 'create_block', page, parent: id, position: 0, content: rest },
        });
        putAt(id, `new:${invented}`, 0);
        touched.add(id);
        continue;
      }
      // Varios encabezados dentro, o uno que no empieza el bloque: se corta por
      // donde empieza cada encabezado y cada trozo queda de hermano.
      const cuts: string[] = [];
      let open: string[] = [];
      for (const line of lines) {
        if (HEADING.test(line) && open.length > 0) {
          cuts.push(open.join('\n').trim());
          open = [];
        }
        open.push(line);
      }
      if (open.length > 0) cuts.push(open.join('\n').trim());
      const kept = cuts.filter((one) => one !== '');
      if (kept.length > 1) {
        const [head, ...others] = kept;
        steps.push({
          kind: 'separate',
          change: { kind: 'edit_block', block: id, content: head ?? '' },
        });
        contentOf.set(id, head ?? '');
        let after = id;
        for (const piece of others) {
          invented += 1;
          const name = `new:${invented}`;
          const at = indexIn(parent, after) + 1;
          steps.push({
            kind: 'separate',
            change: { kind: 'create_block', page, parent, position: at, content: piece },
          });
          putAt(parent, name, at);
          after = name;
        }
        touched.add(id);
        continue;
      }
    }

    // 3. Se comportaba como título; ahora lo dice.
    if (has.has('implicit_heading')) {
      const level = Math.min(DEEPEST, unit.depth + 1);
      const marked = `${'#'.repeat(level)} ${content.trim()}`;
      steps.push({
        kind: 'heading',
        change: { kind: 'edit_block', block: id, content: marked },
      });
      contentOf.set(id, marked);
      touched.add(id);
      continue;
    }

    // 4. Un párrafo largo, partido por donde ya estaba partido.
    if (has.has('monolithic_paragraph')) {
      const pieces = piecesOf(content);
      if (pieces.length > 1) {
        const [head, ...others] = pieces;
        steps.push({
          kind: 'split',
          change: { kind: 'edit_block', block: id, content: head ?? '' },
        });
        contentOf.set(id, head ?? '');
        let after = id;
        for (const piece of others) after = bornAfter(parent, after, piece);
        touched.add(id);
        continue;
      }
    }

    // 5. La marca dice una jerarquía y el árbol dice otra. Se cree la marca: es
    //    lo que se ve al leer, y mover un bloque no cambia una letra.
    if (has.has('inconsistent_hierarchy')) {
      const level = unit.headingLevel;
      if (level === null) continue;
      // El antepasado más cercano cuyo encabezado sea más importante; si no hay
      // ninguno, este bloque es de primer nivel y va a la raíz.
      let anchor = id;
      let above = parentOf.get(id) ?? null;
      let target: string | null = null;
      while (above !== null) {
        const level_above = unitOf.get(above)?.headingLevel ?? null;
        if (level_above !== null && level_above < level) {
          target = above;
          break;
        }
        anchor = above;
        above = parentOf.get(above) ?? null;
      }
      // Ya cuelga de donde debería, o no hay de dónde subirlo más.
      if (target === parent) continue;
      const at = indexIn(target, anchor) + 1;
      steps.push({
        kind: 'hoist',
        change: { kind: 'move_block', block: id, page, parent: target, position: at },
      });
      takeOut(parent, id);
      putAt(target, id, at);
      touched.add(id);
      continue;
    }
  }

  /*
   * Y el ultimo paso: que cada encabezado se lleve lo que encabeza.
   *
   * @invariant AHeadingTakesWhatFollowsItUntilItsPeer. En Markdown la jerarquia
   * la lleva la marca `#` y no la sangria, asi que al volverse bloques la marca
   * sobrevive y la jerarquia no: queda una lista de renglones del mismo peso
   * donde el documento tenia secciones. Y un titulo asi no se puede plegar,
   * porque plegar recoge lo que cuelga y de un titulo plano no cuelga nada.
   *
   * Es el gemelo de `hoist`: aquel sube un encabezado que quedo demasiado hondo,
   * este baja lo que se quedo demasiado plano. Van en este orden porque `hoist`
   * decide de quien es hermano cada encabezado, y esto reparte a los hermanos.
   *
   * Se recorre de atras hacia adelante para que un encabezado se lleve a sus
   * seguidores antes de que otro mas importante se lo lleve a el: yendo al
   * derecho, `#` se llevaria a `##` y a todo lo demas de golpe, y `##` se
   * quedaria sin nada que encabezar.
   */
  const nest = (parent: string | null): void => {
    const kids = [...(kin.get(parent) ?? [])];
    for (let at = kids.length - 1; at >= 0; at -= 1) {
      const id = kids[at];
      if (id === undefined) continue;
      const level = headingLevelOf(contentOf.get(id) ?? '');
      if (level === null) continue;

      // Lo que viene detras, hasta el siguiente encabezado de rango igual o mas
      // importante. Se relee la lista viva: los pasos anteriores ya la movieron.
      const brothers = kin.get(parent) ?? [];
      const from = brothers.indexOf(id);
      if (from < 0) continue;
      const takes: string[] = [];
      for (let i = from + 1; i < brothers.length; i += 1) {
        const next = brothers[i];
        if (next === undefined) continue;
        const its = headingLevelOf(contentOf.get(next) ?? '');
        if (its !== null && its <= level) break;
        // @invariant OneFixPerBlockPerRound: lo que este plan ya rehizo se deja
        // para la vuelta siguiente, cuando la pagina vuelva a leerse como quedo.
        if (touched.has(next)) break;
        takes.push(next);
      }
      if (takes.length === 0) continue;

      for (const moved of takes) {
        const to = (kin.get(id) ?? []).length;
        steps.push({
          kind: 'nest',
          change: { kind: 'move_block', block: moved, page, parent: id, position: to },
        });
        takeOut(parent, moved);
        putAt(id, moved, to);
        touched.add(moved);
      }
    }
  };

  // Por cada nivel del arbol, empezando por la raiz. Los hijos recien mudados se
  // reparten tambien: un `##` que acaba de entrar bajo un `#` se lleva a su vez
  // lo suyo.
  const levels: (string | null)[] = [null];
  for (let i = 0; i < levels.length && i < 10_000; i += 1) {
    const parent = levels[i] as string | null;
    nest(parent);
    for (const child of kin.get(parent) ?? []) levels.push(child);
  }

  return { steps, touched: [...touched] };
}

/** Lo que el plan hizo, contado por clases, para el registro que alguien lee. */
export function describePlan(steps: PlanStep[]): string[] {
  const counts = new Map<FixKind, number>();
  for (const step of steps) {
    // Un arreglo se cuenta por el bloque que se arregló, no por las operaciones
    // que hicieron falta: partir un párrafo en cuatro es un arreglo.
    if (step.change.kind === 'create_block') continue;
    counts.set(step.kind, (counts.get(step.kind) ?? 0) + 1);
  }
  const say: Record<FixKind, (many: number) => string> = {
    empty: (many) => (many === 1 ? 'un bloque vacío borrado' : `${many} bloques vacíos borrados`),
    separate: (many) =>
      many === 1 ? 'un bloque con dos unidades separado' : `${many} bloques con dos unidades separados`,
    heading: (many) => (many === 1 ? 'un título marcado' : `${many} títulos marcados`),
    split: (many) => (many === 1 ? 'un párrafo largo partido' : `${many} párrafos largos partidos`),
    hoist: (many) =>
      many === 1 ? 'un encabezado puesto en su nivel' : `${many} encabezados puestos en su nivel`,
    nest: (many) =>
      many === 1 ? 'un bloque metido bajo su título' : `${many} bloques metidos bajo su título`,
  };
  return [...counts].map(([kind, many]) => say[kind](many));
}
