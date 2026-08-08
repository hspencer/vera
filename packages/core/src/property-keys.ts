/**
 * El nombre estable con que el dominio guarda una propiedad y el nombre con
 * que Herbert la lee y la escribe no son dos propiedades distintas.
 *
 * Las claves internas en inglés sobreviven por compatibilidad con la
 * importación y la API. La superficie humana es castellana. Mantener esta
 * traducción en core evita que la cabecera y las consultas inventen dialectos
 * diferentes.
 */
const LABEL_BY_KEY: Readonly<Record<string, string>> = {
  type: 'tipo',
  status: 'estado',
  lang: 'idioma',
  public: 'público',
  date: 'fecha',
  start: 'inicio',
  due: 'vencimiento',
  aliases: 'alias',
};

const KEY_BY_LABEL = new Map(
  Object.entries(LABEL_BY_KEY).flatMap(([key, label]) => [
    [key, key],
    [label, key],
  ]),
);

/** Resuelve tanto la forma humana como la heredada a la identidad estable. */
export function canonicalPropertyKey(said: string): string {
  return KEY_BY_LABEL.get(said.toLocaleLowerCase('es')) ?? said;
}

/** La forma que las superficies humanas de Vera deben enseñar y escribir. */
export function propertyLabel(key: string): string {
  return LABEL_BY_KEY[key] ?? key;
}
