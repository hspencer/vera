// La forma de una página, leída contando.
//
// Traducido desde specs/page-processing.allium. No hay modelo, no hay red y no
// hay azar: entran los bloques de una página y sale su estructura, y la misma
// página da lo mismo cada vez —@invariant ItIsTheSameEveryTime—, que es lo que
// permite probar lo que este archivo afirma.
//
// @invariant ReadingDecidesNothing: aquí no se cambia nada. Lo que sale es una
// descripción de la página, no un plan para arreglarla. Qué hacer con lo que se
// encuentra es una decisión que Herbert dejó explícitamente abierta, y este
// archivo no la toma por omisión.

import type { Block } from '@vera/core';

export type StructuralDefect =
  | 'empty_block'
  | 'monolithic_paragraph'
  | 'implicit_heading'
  | 'flat_list'
  | 'inconsistent_hierarchy'
  | 'mixed_units';

export interface StructuralUnit {
  block: string;
  parent: string | null;
  position: number;
  depth: number;
  chars: number;
  descendants: number;
  /** El nivel de encabezado que el texto declara, si declara alguno. */
  headingLevel: number | null;
}

export interface Section {
  /** El bloque que la encabeza; nulo para el tramo anterior al primer encabezado. */
  heading: string | null;
  title: string;
  depth: number;
  chars: number;
  members: string[];
}

export interface StructuralObservation {
  defect: StructuralDefect;
  block: string;
  evidence: string;
}

export interface PageStructure {
  units: StructuralUnit[];
  sections: Section[];
  observations: StructuralObservation[];
  chars: number;
}

/*
 * Los números que deciden cuándo algo se dice.
 *
 * Están aquí, con nombre y juntos, porque son lo único discutible de este
 * archivo: el resto es contar. Ninguno decide una transformación —decidir qué se
 * transforma es pregunta abierta— y todos sostienen la misma clase de frase:
 * «esto tiene esta pinta», con la cuenta al lado para que quien lea la
 * observación pueda no estar de acuerdo con conocimiento.
 */
const LARGO = 700; // caracteres a partir de los cuales un párrafo es sospechoso
const FRASES = 4; // y cuántas frases hacen falta además, para no marcar una cita larga
const CORTO = 80; // por debajo de esto, un bloque puede estar comportándose como título
const HERMANOS = 8; // cuántos hijos seguidos sin nietos delatan una lista aplanada

const HEADING = /^(#{1,6})\s+\S/;
const CIERRE = /[.:;!?)»"'\]]$/;

/** El nivel de encabezado que declara el texto de un bloque, si declara alguno. */
function headingLevelOf(content: string): number | null {
  const found = HEADING.exec(content.trimStart());
  return found === null ? null : (found[1] ?? '#').length;
}

/** Cuántas frases hay, contadas por sus cierres. Aproximado y suficiente. */
function sentences(content: string): number {
  return (content.match(/[.!?…](\s|$)/g) ?? []).length;
}

/** La primera línea, recortada, para dar nombre a una sección o a un hallazgo. */
function firstLine(content: string, at = 70): string {
  const line = content.split('\n')[0]?.replace(/^#{1,6}\s+/, '').trim() ?? '';
  return line.length <= at ? line : `${line.slice(0, at).trimEnd()}…`;
}

/**
 * Lee la forma de una página.
 *
 * @invariant EveryUnitNamesItsBlock: todo lo que sale apunta a un bloque por su
 * identidad estable. Nada se localiza volviendo a buscar por coincidencia de
 * texto, que es como una propuesta acaba aplicándose al bloque equivocado.
 *
 * @invariant TheWholePageIsRead: no se recorta. El límite de contexto de un
 * modelo es del modelo; contar bloques no tiene límite que respetar.
 */
export function readStructure(blocks: Block[]): PageStructure {
  const byParent = new Map<string | null, Block[]>();
  for (const block of blocks) {
    const kin = byParent.get(block.parent) ?? [];
    kin.push(block);
    byParent.set(block.parent, kin);
  }
  for (const kin of byParent.values()) kin.sort((a, b) => a.position - b.position);

  // Orden de lectura: el mismo que se ve en pantalla. Recorrer el árbol en
  // profundidad y no la lista plana es lo que hace que «el bloque siguiente»
  // signifique lo que significa al leer.
  const reading: { block: Block; depth: number }[] = [];
  const walk = (parent: string | null, depth: number): void => {
    for (const block of byParent.get(parent) ?? []) {
      reading.push({ block, depth });
      walk(block.stableId, depth + 1);
    }
  };
  walk(null, 0);

  const descendantsOf = (id: string): number => {
    let total = 0;
    for (const child of byParent.get(id) ?? []) total += 1 + descendantsOf(child.stableId);
    return total;
  };

  const units: StructuralUnit[] = reading.map(({ block, depth }) => ({
    block: block.stableId,
    parent: block.parent,
    position: block.position,
    depth,
    chars: block.content.length,
    descendants: descendantsOf(block.stableId),
    headingLevel: headingLevelOf(block.content),
  }));

  const unitOf = new Map(units.map((unit) => [unit.block, unit]));

  /*
   * Secciones: cada encabezado se lleva lo que viene detrás hasta el siguiente
   * encabezado de nivel igual o más importante.
   *
   * Se recorre en orden de lectura y no por el árbol porque una sección es lo que
   * alguien lee seguido, y eso incluye a los hijos del encabezado y también a lo
   * que quedó como hermano suyo más abajo —que es exactamente el desorden que
   * hace falta poder describir.
   */
  const sections: Section[] = [];
  let current: Section | null = null;
  const openLevels: number[] = [];

  for (const { block } of reading) {
    const level = headingLevelOf(block.content);
    if (level !== null) {
      while (openLevels.length > 0 && (openLevels.at(-1) ?? 0) >= level) openLevels.pop();
      current = {
        heading: block.stableId,
        title: firstLine(block.content),
        depth: openLevels.length,
        chars: block.content.length,
        members: [block.stableId],
      };
      openLevels.push(level);
      sections.push(current);
      continue;
    }
    if (current === null) {
      // El tramo anterior al primer encabezado. Existe en casi toda página y no
      // tiene título; no darle sección dejaría material fuera de todas ellas.
      current = { heading: null, title: '', depth: 0, chars: 0, members: [] };
      sections.push(current);
    }
    current.members.push(block.stableId);
    current.chars += block.content.length;
  }

  return {
    units,
    sections,
    observations: observe(reading, byParent, unitOf),
    chars: blocks.reduce((total, block) => total + block.content.length, 0),
  };
}

/**
 * Qué defectos de forma tiene la página.
 *
 * Cada observación lleva la cuenta que la sostiene: una observación sin su
 * evidencia es una acusación, y quien la lea tiene que poder no estar de acuerdo
 * sabiendo por qué se dijo.
 */
function observe(
  reading: { block: Block; depth: number }[],
  byParent: Map<string | null, Block[]>,
  unitOf: Map<string, StructuralUnit>,
): StructuralObservation[] {
  const found: StructuralObservation[] = [];
  const say = (defect: StructuralDefect, block: string, evidence: string): void => {
    found.push({ defect, block, evidence });
  };

  for (let at = 0; at < reading.length; at += 1) {
    const here = reading[at];
    if (here === undefined) continue;
    const { block } = here;
    const unit = unitOf.get(block.stableId);
    if (unit === undefined) continue;
    const content = block.content;
    const trimmed = content.trim();

    if (trimmed === '') {
      say('empty_block', block.stableId, 'no tiene nada escrito');
      continue;
    }

    const level = unit.headingLevel;

    // Un encabezado colgando de otro más profundo: la marca dice una jerarquía y
    // el árbol dice otra, y sólo una de las dos puede ser la que alguien quiso.
    if (level !== null && block.parent !== null) {
      const above = unitOf.get(block.parent);
      if (above?.headingLevel != null && above.headingLevel > level) {
        say(
          'inconsistent_hierarchy',
          block.stableId,
          `es un encabezado de nivel ${level} y cuelga de uno de nivel ${above.headingLevel}`,
        );
      }
    }

    // Dos cosas en un bloque donde el documento tenía dos lugares.
    //
    // Son tres formas del mismo defecto: dos encabezados dentro, un encabezado
    // que no empieza el bloque, y —la más común en una captura— un encabezado
    // que sí lo empieza y se trae su desarrollo pegado detrás.
    const lines = content.split('\n');
    const insideHeadings = lines.filter((line) => HEADING.test(line)).length;
    const trailing = level !== null && lines.slice(1).some((line) => line.trim() !== '');
    if (insideHeadings > 1 || (insideHeadings === 1 && level === null) || trailing) {
      say(
        'mixed_units',
        block.stableId,
        insideHeadings > 1
          ? `lleva ${insideHeadings} encabezados dentro`
          : level === null
            ? 'lleva un encabezado que no empieza el bloque'
            : 'es un encabezado con su desarrollo pegado detrás',
      );
    }

    if (level === null && unit.descendants === 0 && content.length >= LARGO) {
      const howMany = sentences(content);
      if (howMany >= FRASES) {
        say(
          'monolithic_paragraph',
          block.stableId,
          `${content.length} caracteres y unas ${howMany} frases, sin nada colgando`,
        );
      }
    }

    // Se comporta como un título sin estar marcado como tal: corto, sin cierre, y
    // con material debajo que le pertenece.
    if (
      level === null &&
      trimmed.length > 0 &&
      trimmed.length <= CORTO &&
      !CIERRE.test(trimmed) &&
      !trimmed.includes('\n') &&
      unit.descendants > 0
    ) {
      say(
        'implicit_heading',
        block.stableId,
        `${trimmed.length} caracteres, sin puntuación de cierre, con ${unit.descendants} bloques debajo`,
      );
    }
  }

  // Listas aplanadas: muchos hermanos seguidos y ninguna profundidad bajo ellos.
  // Se mira por padre y no bloque a bloque, porque el defecto es del conjunto.
  for (const [parent, kin] of byParent) {
    if (kin.length < HERMANOS) continue;
    const nested = kin.filter((child) => (byParent.get(child.stableId) ?? []).length > 0).length;
    if (nested > 0) continue;
    const anchor = parent ?? kin[0]?.stableId;
    if (anchor === undefined) continue;
    say(
      'flat_list',
      anchor,
      `${kin.length} bloques hermanos y ninguno con hijos${parent === null ? ' en la raíz de la página' : ''}`,
    );
  }

  return found;
}

/*
 * Repartir la página para que se lea entera.
 *
 * Ver `contract SectionedReading` en specs/page-processing.allium. Un modelo
 * local tiene el contexto que tiene, y hasta ahora eso significaba leer los tres
 * mil primeros caracteres de la página y llamar a eso leer la página: para una
 * nota corta es la nota, para una transcripción larga es el saludo del
 * principio. El límite es sobre cuánto cabe de una vez, no sobre cuánto se puede
 * leer, así que se reparte.
 *
 * Se reparte por secciones porque la página ya viene cortada por ahí: un pase
 * lleva secciones enteras mientras quepan —@invariant
 * ThePartsAreCutWhereThePageAlreadyBreaks— y sólo se parte por dentro la sección
 * que por sí sola no cabe.
 */

export interface ReadingPass {
  /** Su sitio en la lectura. Uno es el primero. */
  ordinal: number;
  /** Los encabezados de las secciones que lleva; nulo el tramo sin título. */
  sections: (string | null)[];
  /** Cómo llamar a este pase en el registro que alguien está mirando. */
  title: string;
  text: string;
  chars: number;
}

export interface PassOptions {
  /** Cuánto texto cabe en un pase. Es el límite del modelo, no de la página. */
  chars?: number;
  /** Cuántos pases como mucho. Leer una página no puede durar una tarde. */
  passes?: number;
}

/**
 * Los pases en que se lee una página, y cuánto quedó fuera del tope.
 *
 * @invariant NoPassIsLargerThanTheModelCanHold: ningún pase pasa de `chars`.
 * @invariant EveryPassNamesItsSections: cada pase dice de qué está hecho.
 * @invariant WhatDidNotFitIsCounted: lo que el tope dejó fuera vuelve en `left`,
 * para que quien procese pueda decirlo en vez de callarlo.
 */
export function readingPasses(
  structure: PageStructure,
  contentOf: Map<string, string>,
  options: PassOptions = {},
): { passes: ReadingPass[]; left: number } {
  const room = Math.max(1, options.chars ?? 3000);
  const most = Math.max(1, options.passes ?? 8);

  // Cada sección, dicha en el texto que se le entrega al modelo: su título
  // primero, para que lo que venga debajo tenga de qué estar hablando.
  const written = structure.sections.map((section) => {
    const body = section.members
      .map((id) => (contentOf.get(id) ?? '').replace(/\s+/g, ' ').trim())
      .filter((line) => line !== '')
      .join('\n');
    return { section, text: body };
  });

  const passes: ReadingPass[] = [];
  let left = 0;
  let open: ReadingPass | null = null;

  const close = (): void => {
    if (open !== null && open.chars > 0) passes.push(open);
    open = null;
  };
  const roomLeft = (): number => (open === null ? room : room - open.chars - 1);
  const put = (piece: string, section: Section): void => {
    if (open === null) {
      open = { ordinal: passes.length + 1, sections: [], title: '', text: '', chars: 0 };
    }
    open.text = open.text === '' ? piece : `${open.text}\n${piece}`;
    open.chars = open.text.length;
    if (!open.sections.includes(section.heading)) {
      open.sections.push(section.heading);
      const named = section.title === '' ? 'sin título' : section.title;
      open.title = open.title === '' ? named : `${open.title} · ${named}`;
    }
  };

  for (const { section, text } of written) {
    if (text === '') continue;
    if (passes.length >= most) {
      left += text.length;
      continue;
    }
    if (text.length <= room) {
      if (text.length > roomLeft()) close();
      if (passes.length >= most) {
        left += text.length;
        continue;
      }
      put(text, section);
      continue;
    }
    // Una sección que por sí sola no cabe. Se parte por espacios, que es donde
    // partir no rompe una palabra, y cada trozo sigue siendo de esa sección.
    close();
    for (const piece of cut(text, room)) {
      if (passes.length >= most) {
        left += piece.length;
        continue;
      }
      put(piece, section);
      close();
    }
  }
  close();

  return { passes, left };
}

/** Parte un texto en trozos de a lo más `room` caracteres, por los espacios. */
function cut(text: string, room: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > room) {
    const espacio = rest.lastIndexOf(' ', room);
    // Si el espacio más cercano queda demasiado atrás —una parrafada sin
    // espacios, una URL larguísima— se corta en seco: mejor un corte feo que un
    // pase de dos caracteres y otro de tres mil.
    const corte = espacio > room / 2 ? espacio : room;
    pieces.push(rest.slice(0, corte).trim());
    rest = rest.slice(corte).trim();
  }
  if (rest !== '') pieces.push(rest);
  return pieces;
}

/** Un resumen en una línea, para el registro que se lee mientras procesa. */
export function describeStructure(structure: PageStructure): string {
  const titled = structure.sections.filter((section) => section.heading !== null).length;
  return (
    `${structure.units.length} bloques · ${titled} ${titled === 1 ? 'sección' : 'secciones'} · ` +
    `${structure.chars} caracteres`
  );
}
