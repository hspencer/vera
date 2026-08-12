// El rastro: por dónde se ha pasado, y cómo.
//
// workspace-interface.allium lo gobierna. Vive aquí y no en main.ts porque a
// partir del paso 2 se poda y se reordena, y esas son operaciones sobre una
// lista que conviene poder probar sin un DOM delante.
//
// Lo que este módulo defiende, dicho una vez: un paso no es una página, es una
// llegada a una página. La diferencia decide todo lo demás. Una lista de páginas
// dice por dónde se pasó; una lista de llegadas dice cómo se pasó de cada una a
// la siguiente, y eso es lo único que hay de un cruce mientras nadie escriba
// sobre él. Ver trail.allium.

/**
 * Qué hizo alguien para llegar a la página en la que está.
 *
 * No son maneras de moverse: son maneras de leer.
 * @invariant TheGestureIsObservedAndNeverInferred: lo pone la superficie que
 * recibió el gesto, porque es la única que lo sabe. No hay valor por defecto y no
 * se deduce después mirando el grafo — eso contestaría qué había en el corpus, y
 * la pregunta es qué hizo alguien.
 */
export type NavigationGesture =
  /** Se pulsó el nombre de otra página dentro del texto que se leía. */
  | 'followed_reference'
  /** Se entró por un backlink: la pregunta era quién había hablado de esto. */
  | 'followed_backlink'
  /** Se vio una forma en el mapa y se fue ahí. */
  | 'pressed_on_the_map'
  /** Se fue a por algo que ya se sabía que se quería. */
  | 'searched'
  /** Se regresó sobre el propio rastro. */
  | 'returned'
  /** Se llegó de fuera: una dirección, el día de hoy, una página del menú. */
  | 'opened_directly';

/** Un paso del rastro. `from` es nulo cuando se llegó sin venir de ninguna parte. */
export interface TraceStep {
  readonly page: string;
  readonly from: string | null;
  readonly gesture: NavigationGesture;
  readonly at: number;
}

const TRACE_KEY = 'vera.navigationTrace';
const GESTURES = new Set<NavigationGesture>([
  'followed_reference',
  'followed_backlink',
  'pressed_on_the_map',
  'searched',
  'returned',
  'opened_directly',
]);

/** Recupera el taller local sin permitir que datos viejos o rotos impidan abrir Vera. */
export function loadTrace(): TraceStep[] {
  try {
    const held: unknown = JSON.parse(localStorage.getItem(TRACE_KEY) ?? '[]');
    if (!Array.isArray(held)) return [];
    return held.filter((step): step is TraceStep => {
      if (typeof step !== 'object' || step === null) return false;
      const candidate = step as Partial<TraceStep>;
      return (
        typeof candidate.page === 'string' &&
        (candidate.from === null || typeof candidate.from === 'string') &&
        typeof candidate.gesture === 'string' &&
        GESTURES.has(candidate.gesture as NavigationGesture) &&
        typeof candidate.at === 'number' &&
        Number.isFinite(candidate.at)
      );
    });
  } catch {
    return [];
  }
}

/** El rastro es local-first: cada gesto queda durable antes de volver a la red. */
export function saveTrace(trace: readonly TraceStep[]): void {
  localStorage.setItem(TRACE_KEY, JSON.stringify(trace));
}

/**
 * Añade una llegada.
 *
 * No deduplica, y es una decisión y no un descuido. El objeto es un *walk*:
 * repite páginas y las repite a propósito. Llegar a una página, recorrer un
 * argumento y volver a ella por otro camino es exactamente lo que un bucle es
 * en el plano del sentido, y colapsar las dos llegadas en una lo borraría justo
 * donde importa.
 *
 * Tampoco tiene tope. `HISTORY = 50` truncaba por el principio en silencio, lo
 * que en un rastro promovible significa que media sesión no llega al argumento
 * sin que nada lo diga. Un paso ocupa unas decenas de bytes; una jornada larga
 * son kilobytes. Si algún día estorba, lo que estorba es que el rastro no
 * persista, y eso es una pregunta abierta de trail.allium, no un tope.
 */
export function walked(trace: readonly TraceStep[], step: TraceStep): TraceStep[] {
  /*
   * Lo que sí se descarta: llegar donde ya se estaba.
   *
   * @invariant RedrawingAPageIsNotWalkingToIt, dicho donde no se puede olvidar.
   * Lo estaba sólo por convención —quien redibuja no pasa gesto— y bastó un
   * camino que sí lo pasara para romperlo: pulsar un enlace a un ancla cambiaba
   * el fragmento de la dirección, el enrutador lo leía como una llegada, y el
   * rastro se llenaba de la misma página tantas veces como clics hubo.
   *
   * No contradice lo de arriba y es la otra mitad de lo mismo. Un bucle son dos
   * llegadas con algo en medio; esto es no haberse movido. La pregunta no es si
   * la página cambió, sino si alguien anduvo.
   */
  if (step.from === step.page) return [...trace];
  // Y sin `from` —una dirección pegada, el botón de atrás— lo dice el rastro:
  // si el último paso ya estaba ahí, nadie se movió.
  if (step.from === null && trace[trace.length - 1]?.page === step.page) return [...trace];
  return [...trace, step];
}

/**
 * Quita un paso.
 *
 * @invariant DroppingAStepLeavesNoRecord: no queda constancia de que estuvo. El
 * rastro no tiene historia porque no es una página.
 */
export function dropped(trace: readonly TraceStep[], index: number): TraceStep[] {
  if (index < 0 || index >= trace.length) return [...trace];
  return trace.filter((_, i) => i !== index);
}

/**
 * Mueve un paso a otra posición.
 *
 * @invariant ReorderingDoesNotRewriteWhatHappened: el paso conserva su gesto y su
 * `from`, que son hechos sobre lo que ocurrió y no cambian porque cambie de
 * sitio. Lo que cambia es de quién es vecino, y por eso `from` puede acabar
 * nombrando una página que ya no es la anterior. No se repara: es la distancia
 * entre por dónde se anduvo y por dónde se quiere llevar a alguien.
 */
export function movedTo(trace: readonly TraceStep[], index: number, position: number): TraceStep[] {
  if (index < 0 || index >= trace.length) return [...trace];
  const target = Math.max(0, Math.min(position, trace.length - 1));
  if (target === index) return [...trace];
  const next = [...trace];
  const [step] = next.splice(index, 1);
  if (step === undefined) return [...trace];
  next.splice(target, 0, step);
  return next;
}

/** Las páginas por las que se pasó, en orden. Lo que el mapa necesita del rastro. */
export function pagesOf(trace: readonly TraceStep[]): string[] {
  return trace.map((step) => step.page);
}
