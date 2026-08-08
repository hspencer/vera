// Cuantas respuestas lleva dentro el valor de una propiedad.
//
// Vive en el dominio y no en el cliente ni en el servidor porque los dos tienen
// que estar de acuerdo: el servidor cuenta el vocabulario observado partiendo
// por aqui, y el cliente dibuja las palabras partiendo por aqui. Dos copias de
// esta regla que se separasen darian una pagina que ofrece palabras distintas
// de las que dibuja.

/**
 * Las respuestas que lleva dentro un valor de propiedad.
 *
 * Una pagina es varias cosas a la vez, y el corpus lo escribe con comas:
 * `concepto:: contactos, PUCV, EAD, arquitectura`. Contando el valor entero, el
 * vocabulario observado de `concepto` salian quinientas sesenta y siete
 * combinaciones distintas en vez de las pocas decenas de palabras que de verdad
 * usa. Con esa cola ninguna pregunta parece cerrada, asi que la propiedad se
 * dibujaba como texto libre y sus palabras dejaban de ser enlaces: una sola
 * cadena que llevaba a una pagina llamada «contactos, PUCV, EAD, arquitectura»,
 * que no existe ni va a existir.
 *
 * La coma separa respuestas solo cuando cada trozo parece una palabra de
 * vocabulario: corto y sin puntuacion de cierre. En una frase la coma es parte
 * de la frase —`resumen:: llego tarde, pero llego`— y partirla inventaria dos
 * respuestas donde habia una. Es la misma prueba con que la lectura estructural
 * reconoce un titulo sin marcar, y por el mismo motivo: lo que se puede decidir
 * contando se decide contando.
 */
const ANSWER_AT_MOST = 40;
const CLOSING = /[.;:!?]$/;

export function answersIn(value: string): string[] {
  const whole = value.trim();
  if (whole === '') return [];
  const parts = whole
    .split(',')
    .map((one) => one.trim())
    .filter((one) => one !== '');
  if (parts.length < 2) return [whole];
  const wordy = parts.every((one) => one.length <= ANSWER_AT_MOST && !CLOSING.test(one));
  return wordy ? parts : [whole];
}

