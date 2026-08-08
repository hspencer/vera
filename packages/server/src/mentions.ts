// Lo que una página nombra y el corpus ya tiene.
//
// Una página recién capturada suele hablar de cosas que en Vera ya son páginas
// —una persona, un proyecto, un taller— y no las enlaza: el texto dice «Ciudad
// Abierta» y el grafo no se entera. Esa página queda escrita y no queda
// encontrable, que no es lo mismo: se llega a ella por búsqueda de texto y no
// por el corpus, y desde el otro lado no se llega en absoluto, porque los
// enlaces entrantes de «Ciudad Abierta» no la mencionan.
//
// Esto busca esas menciones y propone el enlace. No lo escribe: proponer es
// cuanto hace el procesamiento —@invariant ProcessingProposesAndNothingMore— y
// además la decisión no es mecánica, porque un nombre escrito en una frase no
// siempre es una referencia a la página que se llama igual.
//
// Se busca contando, sin modelo: es la mitad del vínculo con el corpus que no
// depende de que haya un binario instalado.

import { isDateTitle, titleKey } from '@vera/core';

export interface KnownPage {
  id: string;
  title: string;
  /** Cuántos enlaces entrantes tiene ya. Un título muy enlazado es un centro. */
  backlinks: number;
}

export interface Mention {
  /** El título de la página existente, tal como ella se llama. */
  title: string;
  page: string;
  block: string;
  /** Lo que el bloque dice ahora, que es sobre lo que se propone el cambio. */
  content: string;
  /** Lo que diría con el enlace puesto. */
  next: string;
  /** El texto tal como está escrito, que puede no coincidir en mayúsculas. */
  written: string;
  backlinks: number;
}

export interface MentionOptions {
  /** Cuántas menciones se proponen como mucho. Una lista larga no se revisa. */
  most?: number;
  /** Por debajo de esto un título no se busca: da demasiados falsos. */
  least?: number;
  /** La página que se está procesando, para no proponerle enlazarse a sí misma. */
  self?: string;
}

/*
 * Los trozos donde un nombre no es una mención: lo que ya es enlace, lo que es
 * dirección y lo que es código. Envolver ahí rompe lo que había.
 */
const PROTECTED = [
  /\[\[[^\]]*\]\]/g, // [[enlace]]
  /\[[^\]]*\]\([^)]*\)/g, // [texto](dirección)
  /`[^`]*`/g, // `código`
  /\bhttps?:\/\/\S+/g, // una dirección desnuda
  /^[^\s:]+::/gm, // la clave de una propiedad
];

/** Dónde no se puede tocar, en pares [desde, hasta). */
function protectedSpans(content: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const pattern of PROTECTED) {
    for (const found of content.matchAll(pattern)) {
      if (found.index === undefined) continue;
      spans.push([found.index, found.index + found[0].length]);
    }
  }
  return spans;
}

/*
 * El texto plegado, con la cuenta de dónde estaba cada letra.
 *
 * Se pliega como `titleKey` —sin acentos y en minúsculas— para que «Ciudad
 * abierta» encuentre a «Ciudad Abierta», y se guarda el índice original de cada
 * carácter porque lo que hace falta después es señalar el trozo del texto tal
 * como está escrito. Plegar y luego buscar por índices del plegado sobre el
 * original es lo que desalinea una tilde.
 */
function fold(content: string): { text: string; at: number[] } {
  let text = '';
  const at: number[] = [];
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index] ?? '';
    const folded = character
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
    for (const one of folded) {
      text += one;
      at.push(index);
    }
  }
  at.push(content.length);
  return { text, at };
}

/*
 * Cuándo un título de una sola palabra sólo vale escrito igual.
 *
 * Un título de dos palabras —«Ciudad Abierta», «Taller de Titulación»— no
 * aparece por casualidad en una frase: nombrarlo es referirse a él. Uno de una
 * sola —«Tareas», «lenguaje», «revisión»— es casi siempre una palabra común, y
 * enlazar cada vez que alguien la escribe llena el grafo de aristas que no
 * significan nada y entierra las que sí.
 *
 * Así que para los de una palabra se exige la coincidencia exacta, con sus
 * mayúsculas y sus tildes, y que el título empiece por mayúscula. «Tareas» en
 * mitad de una frase se parece a un nombre propio; «tareas» es una palabra.
 */
function exactOnly(title: string): boolean {
  return !/\s/.test(title.trim());
}

/** Y cuáles no se buscan siquiera: una palabra común, en minúscula. */
function tooCommon(title: string): boolean {
  const trimmed = title.trim();
  return exactOnly(trimmed) && !/^\p{Lu}/u.test(trimmed);
}

/** Si en esa posición empieza y acaba una palabra, y no parte de otra. */
function whole(text: string, from: number, to: number): boolean {
  const letra = /[\p{L}\p{N}]/u;
  const before = text[from - 1];
  const after = text[to];
  return (
    (before === undefined || !letra.test(before)) && (after === undefined || !letra.test(after))
  );
}

/**
 * Las páginas que esta página nombra sin enlazar.
 *
 * Devuelve una mención por título como mucho —la primera, que es donde se
 * presenta el asunto— y las más enlazadas primero: un título que el corpus ya
 * usa mucho es un centro suyo, y unirse a un centro es lo que vuelve
 * encontrable a la página.
 */
export function mentionsOf(
  blocks: { stableId: string; content: string }[],
  known: KnownPage[],
  options: MentionOptions = {},
): Mention[] {
  const most = options.most ?? 6;
  const least = options.least ?? 5;

  const candidates = known
    .filter((page) => page.id !== options.self)
    .filter((page) => page.title.trim().length >= least)
    // Una fecha no es un concepto: enlazar «2026-08-07» porque el texto dice esa
    // fecha llena el grafo de aristas que no significan nada.
    .filter((page) => !isDateTitle(page.title))
    // Un título que es sólo números o signos tampoco nombra nada.
    .filter((page) => /[\p{L}]{3}/u.test(page.title))
    .filter((page) => !tooCommon(page.title))
    .map((page) => ({ ...page, key: titleKey(page.title), exacto: exactOnly(page.title) }))
    .filter((page) => page.key !== '')
    // Más enlazado primero, y a igualdad el título más largo: es el más
    // específico, y el específico acierta más que el genérico.
    .sort((a, b) => b.backlinks - a.backlinks || b.title.length - a.title.length);

  const found: Mention[] = [];
  const taken = new Set<string>();
  const used = new Set<string>();

  for (const block of blocks) {
    if (block.content.trim() === '') continue;
    // Una mención por bloque como mucho.
    //
    // Cada mención se propone como el texto entero que el bloque tendría, así
    // que dos sobre el mismo bloque son dos versiones del mismo párrafo: aceptar
    // las dos deja la segunda, y el primer enlace desaparece sin que nadie lo
    // haya descartado. Se propone una, y la siguiente vuelta propondrá la otra.
    if (used.has(block.stableId)) continue;
    const { text, at } = fold(block.content);
    const spans = protectedSpans(block.content);
    const covered = (from: number, to: number): boolean =>
      spans.some(([desde, hasta]) => from < hasta && to > desde);

    for (const candidate of candidates) {
      if (used.has(block.stableId)) break;
      if (taken.has(candidate.key)) continue;
      let index = text.indexOf(candidate.key);
      while (index !== -1) {
        const from = at[index] ?? 0;
        const to = at[index + candidate.key.length] ?? block.content.length;
        const written = block.content.slice(from, to);
        // Un título de una sola palabra sólo cuenta escrito igual: con sus
        // mayúsculas y sus tildes. Ver exactOnly.
        const igual = !candidate.exacto || written === candidate.title.trim();
        if (igual && whole(text, index, index + candidate.key.length) && !covered(from, to)) {
          found.push({
            title: candidate.title,
            page: candidate.id,
            block: block.stableId,
            content: block.content,
            // Se envuelve lo escrito y no el título de la página: el grafo
            // resuelve el enlace sin distinguir mayúsculas ni tildes, así que no
            // hace falta corregirle a nadie cómo escribió una palabra.
            next: `${block.content.slice(0, from)}[[${written}]]${block.content.slice(to)}`,
            written,
            backlinks: candidate.backlinks,
          });
          taken.add(candidate.key);
          used.add(block.stableId);
          break;
        }
        index = text.indexOf(candidate.key, index + 1);
      }
      if (found.length >= most) return found;
    }
  }

  return found;
}
