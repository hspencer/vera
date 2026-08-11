// Cuándo los hijos de un bloque se leen numerados.
//
// Ver specs/block-editing.allium, contract OutlineManipulation.
//
// El hecho es del padre y es uno solo: `lista:: numerada`. No se repite en cada
// hijo, y por eso un hijo que nazca después queda numerado sin que nadie se lo
// diga — que es lo que hace que una lista sea una lista y no un montón de bloques
// que casualmente coinciden. @invariant MarkingIsOneFactOnTheParent.
//
// **El número no se guarda en ninguna parte.** Es la posición del hijo entre sus
// hermanos, calculada al dibujar. Insertar, mover o borrar renumera el resto sin
// tocar a nadie: eso es toda la diferencia con escribir «1. » en el texto, que es
// como está el corpus hoy —182 listas a mano, una de ellas de 75 hermanos, donde
// meter un ítem en el medio son 75 ediciones.
// @invariant TheNumberBelongsToTheTreeAndNotToTheText.
//
// Parece contradecir a `task.ts`, que dice que la marca de una tarea vive en el
// texto y no en una propiedad. No la contradice: la marca de una tarea es un
// hecho de ese ítem y sobrevive a moverlo de sitio. El número de una lista es una
// consecuencia de dónde está, y escribirlo en el texto es exactamente lo que lo
// vuelve mentira en cuanto algo se mueve.

/** Con qué se dice que los hijos de un bloque van numerados. */
export const LIST_KEY = 'lista';

/** Y con qué valor. Cualquier otro es una propiedad corriente de quien la puso. */
export const NUMBERED = 'numerada';

export type ChildListStyle = 'bulleted' | 'numbered';

/**
 * Cómo se leen los hijos de este bloque, según lo que cuelgue de él.
 *
 * Sin marca, viñetas. @invariant BulletsAreWhatABlockIsWithoutBeingTold: el caso
 * corriente no declara nada, así que no hay nada que migrar y una página escrita
 * antes de que esto existiera sigue significando lo mismo.
 */
export function readChildListStyle(
  properties: readonly { key: string; value: string }[] | undefined,
): ChildListStyle {
  const found = (properties ?? []).find(
    (one) => one.key.trim().toLowerCase() === LIST_KEY,
  );
  return found?.value.trim().toLowerCase() === NUMBERED ? 'numbered' : 'bulleted';
}

/*
 * Un número de lista escrito a mano, y nada más que eso.
 *
 * Anclado al principio de la primera línea; de uno a tres dígitos; un punto o un
 * paréntesis; y espacio o final. Cada condición está por algo:
 *
 * - **Tres dígitos como mucho.** «1985. Un año difícil» es una fecha y no un
 *   ítem, y quitarle el año sería destruir texto para arreglar un dibujo. Una
 *   lista de mil ítems no existe; un año de cuatro cifras, todo el rato.
 * - **Punto o paréntesis obligatorio.** «1984 fue el año» no lleva número de
 *   lista delante, lleva un número.
 * - **Espacio después.** «1.5 veces más» es una cifra decimal.
 *
 * Una gramática que captura de más convierte texto ajeno en numeración, y aquí
 * capturar de más significa borrar lo que alguien escribió.
 */
const TYPED_ORDINAL = /^(\d{1,3})[.)](\s+|$)/;

/** ¿Este bloque empieza por un número escrito a mano? */
export function hasTypedOrdinal(content: string): boolean {
  const [first = ''] = content.split('\n');
  return TYPED_ORDINAL.test(first);
}

/**
 * El bloque sin su número de cabeza.
 *
 * Sólo la primera línea, porque sólo ahí puede haber un ordinal de lista: lo que
 * cuelga debajo es el cuerpo del ítem y puede empezar como quiera.
 *
 * Lo que no lleva número vuelve tal cual, sin copiar ni normalizar nada. Eso
 * importa: quien llama compara el resultado con el original para decidir si hay
 * algo que enviar, y una función que devolviera un texto distinto por haberlo
 * recortado generaría una edición por bloque en cada lista que se numere.
 */
export function withoutTypedOrdinal(content: string): string {
  const [first = '', ...rest] = content.split('\n');
  const found = TYPED_ORDINAL.exec(first);
  if (found === null) return content;
  return [first.slice(found[0].length), ...rest].join('\n');
}
