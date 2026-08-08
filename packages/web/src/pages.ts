// Qué significa crear una página en Vera, dicho en un solo sitio.
//
// Nacía en tres: el buscador de la barra, seguir un `[[enlace]]` a algo que no
// existía todavía, y abrir el día de hoy. Cada uno enviaba su `create_page` por
// su cuenta, así que cualquier cosa que hubiera que hacer *además* de crearla
// había que acordarse de hacerla tres veces —y la tercera se olvida—.

import { api, type SubmitResult } from './api.ts';
import { today } from './autocomplete.ts';

/**
 * Cuándo nació una página, dicho como Vera dice las fechas.
 *
 * El valor es el nombre de la bitácora de ese día y no una marca de tiempo: en
 * Vera un día *es* una página, así que fechar algo es poder ir a lo demás que
 * pasó ese día. Una cadena ISO no lleva a ninguna parte; `2026-08-07` es una
 * página con su propia escritura alrededor.
 *
 * Va como texto llano y no entre corchetes dobles porque los valores de
 * propiedad se dibujan tal cual, y un `[[ ]]` se vería literal.
 */
export const BORN_KEY = 'fecha de creación';

/**
 * Crear una página, con lo que Vera pone en toda página que nace.
 *
 * El sello de fecha se envía como una operación aparte y no como parte de
 * `create_page`, que es lo que el dominio permite: son dos hechos —la página
 * existe, y nació tal día— y el registro los guarda por separado, cada uno con
 * su número de secuencia. Si el segundo falla, queda una página sin sello, que
 * es algo que se puede mirar y arreglar; nunca media página.
 *
 * El sello no se pone en la bitácora del propio día: una página llamada
 * `2026-08-07` que dijera «fecha de creación: 2026-08-07» se estaría señalando a
 * sí misma, y una propiedad que repite el título no informa de nada.
 */
export async function createPage(
  title: string,
  visibility: 'private' | 'public' = 'private',
): Promise<SubmitResult> {
  const born = await api.submit({ kind: 'create_page', title, visibility });
  if (born.status === 'rejected') return born;

  const day = today();
  if (title.trim() !== day) {
    await api.submit({
      kind: 'set_property',
      page: born.subjectId,
      propertyKey: BORN_KEY,
      propertyValue: day,
    });
  }
  return born;
}
