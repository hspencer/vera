// Cómo llama este corpus a las propiedades que Vera necesita conocer.
//
// Hay un puñado de propiedades sobre las que el código tiene que decir algo: cuál
// dice qué clase de cosa es una página, cuál de qué trata, cuáles llevan una
// relación explicada. Hasta ahora esas palabras estaban escritas dentro del
// código —`type`, `concepto`, `explica`— y eso las convertía en decisiones de
// Vera sobre el idioma de quien escribe.
//
// No lo son. Una propiedad es del corpus: la escribió alguien, en su lengua, y
// puede llamarse `tipo`, `type` o `momo`. Lo que el código necesita no es la
// palabra sino el **papel**, y qué palabra cumple cada papel lo dice la página de
// ontología —@invariant DefaultsLiveInTheCode: lo de aquí rige mientras esa
// página no diga otra cosa, y deja de regir en cuanto lo diga.
//
// El papel se nombra en inglés porque es del programa. La palabra es del corpus
// y puede estar en cualquier idioma. La página de ontología es la bisagra:
//
//     - Nombres de propiedades
//       - kind · tipo
//       - topic · concepto
//       - explains · explica
//       - term · término
//       - sense · sentido
//       - day · bitácora
//
// Una sola palabra no puede declararse así y se queda dentro del código:
// `special-kind`, la que dice cuál es la página de ontología. No cabe declararla
// en la página que sirve para encontrarla.

/** Los papeles que el código conoce. */
export type PropertyRole = 'kind' | 'topic' | 'explains' | 'term' | 'sense' | 'day';

export type PropertyNames = Readonly<Record<PropertyRole, string>>;

/**
 * Lo que Vera trae, que es un mínimo y no una verdad.
 *
 * En castellano porque es la lengua en que se escribe este corpus, y por la
 * misma razón por la que `concepto` y `término` ya lo estaban: lo que Vera
 * escribe en una página lo va a leer una persona.
 */
export const DEFAULT_PROPERTY_NAMES: PropertyNames = {
  kind: 'tipo',
  topic: 'concepto',
  explains: 'explica',
  term: 'término',
  sense: 'sentido',
  // Éste no es una clave sino un valor: la clase con que nace un día.
  day: 'bitácora',
};

/** La única palabra que no se puede declarar: con ella se encuentra la ontología. */
export const SPECIAL_KIND = 'special-kind';

const ROLES: PropertyRole[] = ['kind', 'topic', 'explains', 'term', 'sense', 'day'];

/**
 * Lee lo que una página declara, y deja lo demás como estaba.
 *
 * Entra una lista de renglones `papel · palabra` —tal como se escriben en la
 * ontología— y sale el juego completo: los papeles declarados con su palabra y
 * los demás con la que Vera trae. Un renglón que nombre un papel que no existe
 * se ignora en silencio: la página es de quien la escribe y puede tener dentro
 * cosas que Vera todavía no sepa leer.
 */
export function readPropertyNames(said: readonly string[]): PropertyNames {
  const names: Record<PropertyRole, string> = { ...DEFAULT_PROPERTY_NAMES };
  for (const line of said) {
    const [role, word] = line.split(/\s+[·/|]\s+/).map((one) => one.trim());
    if (role === undefined || word === undefined || word === '') continue;
    const held = ROLES.find((one) => one === role.toLowerCase());
    if (held !== undefined) names[held] = word;
  }
  return names;
}
