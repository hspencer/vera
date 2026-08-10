// Guardar un tramo del rastro como recorrido.
//
// Componer un recorrido empieza por haberlo andado. Lo que el taller ofrece no
// es un compositor de rutas —una lista donde arrastrar nodos, un panel donde
// teclear conectivas— sino un gesto sobre el rastro que ya está en pantalla:
// promoverlo. Lo que queda después es una página y el editor de siempre.
// @guarantee WalkingIsTheFirstDraft.
//
// La diferencia con un compositor no está en el gesto sino en de dónde sale lo
// que se arrastra: en un compositor uno pone los nodos que cree que necesita, y
// en el rastro ya están porque uno pasó por ahí. Se poda algo que sobra, no se
// convoca algo que falta. Por eso promover no pide saber el argumento de
// antemano: es lo que uno hace mientras se entera de cuál era.
//
// Lo que nace es un argumento con todas sus premisas, el registro de por dónde
// se pasó de una a otra, y ningún razonamiento. Vera transcribe el testimonio y
// no escribe la conectiva nunca: un «y después» de plantilla tendría la forma de
// una conectiva sin afirmar nada, y ocuparía el sitio donde va lo que alguien
// tiene que escribir. @invariant TheFirstDraftSaysWhatHappenedAndNotWhatItMeant.
//
// Ver specs/trail.allium, regla PromoteTheTraceAsAnArgument.

import { TESTIMONY_KEY, TRAIL_KIND } from '@vera/core';
import type { NavigationGesture, TraceStep } from './trace.ts';

/**
 * Cómo se anduvo un paso, dicho como un hecho.
 *
 * Es testimonio y no conectiva, y la línea entre las dos hay que saber decirla
 * porque se parecen mucho: esto es comprobable, sobre el caminante y ya ocurrido;
 * una conectiva es discutible, sobre el corpus y del guía.
 */
export function testimonyFor(step: TraceStep, titleOf: (page: string) => string): string {
  const from = step.from === null ? null : titleOf(step.from);
  const how: Record<NavigationGesture, string> = {
    followed_reference:
      from === null
        ? 'se llegó siguiendo una referencia'
        : `se llegó siguiendo una referencia desde «${from}»`,
    followed_backlink:
      from === null
        ? 'se llegó por un retroenlace'
        : `se llegó preguntando quién habla de «${from}»`,
    pressed_on_the_map: from === null ? 'se llegó desde el mapa' : `se llegó desde el mapa, viniendo de «${from}»`,
    searched: 'se llegó buscando',
    returned: 'se volvió sobre el propio rastro',
    opened_directly: 'se llegó de fuera',
  };
  return how[step.gesture] ?? 'se llegó';
}

/**
 * El nombre con que nace.
 *
 * Un andamio, y se dice que lo es. Lo pone Vera para que la página pueda existir
 * sin obligar a nadie a saber todavía de qué trata; ponerle el suyo es un
 * renombrado como cualquier otro, y no es un trámite: el título de un recorrido
 * es el título de un texto, y escribirlo es decir qué se está afirmando.
 * @invariant TheUpgradeIsHavingAName.
 */
export function provisionalTitle(at: Date, taken: (title: string) => boolean): string {
  const day = at.toISOString().slice(0, 10);
  const first = `Recorrido del ${day}`;
  if (!taken(first)) return first;
  for (let n = 2; n < 100; n += 1) {
    const other = `Recorrido del ${day} (${n})`;
    if (!taken(other)) return other;
  }
  return `${first} · ${at.getTime()}`;
}

/** Un cambio de los que Vera acepta, tal como los escribe quien promueve. */
export type Change =
  | { kind: 'create_page'; title: string; visibility: 'private' }
  | { kind: 'set_property'; page: string; propertyKey: string; propertyValue: string }
  | { kind: 'create_block'; page: string; parent: null; position: number; content: string }
  | { kind: 'set_property'; block: string; propertyKey: string; propertyValue: string };

export interface Seeded {
  /** Los cambios en el orden en que hay que mandarlos. */
  changes: Change[];
  title: string;
}

/**
 * Los cambios que hacen nacer un recorrido a partir de un tramo del rastro.
 *
 * Devuelve la lista y no la manda: quién la manda sabe de páginas nuevas y de
 * errores, y esta función sabe de recorridos. Se prueba entera sin servidor.
 *
 * `page` es el identificador que tendrá la página, que quien manda conoce sólo
 * después de crearla; por eso los bloques se piden aparte, con `blocksFor`.
 */
export function seedTrail(
  trace: readonly TraceStep[],
  said: { title: string; intent?: string | null },
): { page: Change; properties: (page: string) => Change[] } {
  return {
    page: { kind: 'create_page', title: said.title, visibility: 'private' },
    properties: (page) => {
      const changes: Change[] = [
        { kind: 'set_property', page, propertyKey: 'tipo', propertyValue: TRAIL_KIND },
      ];
      if (said.intent != null && said.intent !== '') {
        changes.push({
          kind: 'set_property',
          page,
          propertyKey: 'propósito',
          propertyValue: said.intent,
        });
      }
      return changes;
    },
  };
}

/**
 * Los bloques con que nace: una parada, un hueco, una parada.
 *
 * El hueco es un bloque vacío con el testimonio colgando, y está vacío a
 * propósito: es el sitio donde va la conectiva, y se ve que está vacío porque lo
 * está. No hay contador ni aviso —un recorrido puede querer dos paradas seguidas
 * sin nada entre ellas y eso también es decir algo—; lo que hay es el hueco.
 */
export function blocksFor(
  trace: readonly TraceStep[],
  titleOf: (page: string) => string,
): { content: string; testimony: string | null }[] {
  const said: { content: string; testimony: string | null }[] = [];
  trace.forEach((step, at) => {
    if (at > 0) said.push({ content: '', testimony: testimonyFor(step, titleOf) });
    said.push({ content: `[[${titleOf(step.page)}]]`, testimony: null });
  });
  return said;
}

export { TESTIMONY_KEY };
