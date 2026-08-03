// La sesión de edición de un bloque.
//
// Es lógica pura: no toca el DOM ni la red. El outliner le cuenta lo que pasa y
// ella dice qué hay que guardar. Así el comportamiento que decide si se pierde
// texto se puede probar sin un navegador.
//
// @invariant TypingIsNeverLost: el texto llega al grafo mientras se escribe y no
// sólo al salir del bloque. Nada de lo escrito depende de acordarse de salir.

/** Qué toca hacer ahora. `nada` cuando el buffer coincide con lo ya guardado. */
export type SaveIntent = { action: 'nada' } | { action: 'guardar'; content: string };

export interface EditSession {
  /** El texto que el participante está viendo. */
  buffer(): string;
  /** Lo último que llegó al grafo. */
  saved(): string;
  dirty(): boolean;

  /** Registra lo escrito. Devuelve si el buffer cambió respecto de lo guardado. */
  type(next: string): void;

  /**
   * Lo que la pausa de escritura debe guardar.
   *
   * Un guardado sin nada que decir no escribe: sin esto, el temporizador pondría
   * una operación en el log cada vez que alguien se detiene a pensar.
   */
  pending(): SaveIntent;

  /** Confirma que ese contenido llegó al grafo. */
  settled(content: string): void;

  /**
   * Salir del bloque, por Escape o por clic fuera.
   *
   * Guarda lo que quede pendiente. No descarta: cuando se pulsa, el guardado al
   * reposar ya dejó el texto en el grafo, y ofrecer descartar sería mentir.
   */
  leave(): SaveIntent;

  /** Un guardado que falló devuelve el texto al participante sin perderlo. */
  failed(): void;
}

/** Comparar sin los espacios de los extremos: un espacio final no es un cambio. */
function same(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

export function createSession(original: string): EditSession {
  let buffer = original;
  let saved = original;

  const intent = (): SaveIntent =>
    same(buffer, saved) ? { action: 'nada' } : { action: 'guardar', content: buffer };

  return {
    buffer: () => buffer,
    saved: () => saved,
    dirty: () => !same(buffer, saved),

    type(next: string): void {
      buffer = next;
    },

    pending: intent,
    leave: intent,

    settled(content: string): void {
      saved = content;
    },

    failed(): void {
      // `saved` no se toca: lo que no llegó al grafo sigue pendiente, y el
      // siguiente intento —otra pausa, o salir del bloque— vuelve a mandarlo.
    },
  };
}
