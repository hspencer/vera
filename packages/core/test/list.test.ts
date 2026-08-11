// Cuándo los hijos de un bloque se leen numerados, y qué cuenta como un número
// escrito a mano.
//
// Lo que se fija aquí es sobre todo lo segundo, porque numerar una lista **borra
// texto de alguien**: la gramática tiene que capturar los 1129 bloques del corpus
// que de verdad empiezan por un ordinal y ninguno de los que empieza por un
// número que no lo es. Capturar de más, aquí, es destruir lo que alguien escribió
// para que un dibujo quede limpio.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LIST_KEY,
  NUMBERED,
  hasTypedOrdinal,
  readChildListStyle,
  withoutTypedOrdinal,
} from '../src/list.ts';

describe('cómo se leen los hijos', () => {
  it('sin decir nada, con viñetas', () => {
    // El caso corriente no declara nada, así que no hay nada que migrar.
    assert.equal(readChildListStyle(undefined), 'bulleted');
    assert.equal(readChildListStyle([]), 'bulleted');
  });

  it('numerados cuando el padre lo dice', () => {
    assert.equal(readChildListStyle([{ key: LIST_KEY, value: NUMBERED }]), 'numbered');
  });

  it('sin importar mayúsculas ni espacios de sobra', () => {
    assert.equal(readChildListStyle([{ key: ' Lista ', value: ' Numerada ' }]), 'numbered');
  });

  it('y una propiedad que se llama igual con otro valor no numera nada', () => {
    /*
     * `lista:: compras` es de quien la escribió y significa lo que él quiera. Lo
     * que numera es el valor, no la clave: apropiarse de la clave entera
     * convertiría en numeración cualquier lista que alguien hubiera nombrado.
     */
    assert.equal(readChildListStyle([{ key: 'lista', value: 'compras' }]), 'bulleted');
  });
});

describe('un número escrito a mano', () => {
  it('es un ordinal con su punto y su espacio', () => {
    assert.ok(hasTypedOrdinal('1. Proloquo2Go (AssistiveWare)'));
    assert.ok(hasTypedOrdinal('10. Saltillo devices'));
    assert.ok(hasTypedOrdinal('7) con paréntesis también'));
  });

  it('no es un año', () => {
    // «1985. Un año difícil» es una fecha. Quitarle el año para que la lista
    // quede bonita sería destruir texto.
    assert.ok(!hasTypedOrdinal('1985. Un año difícil'));
    assert.ok(!hasTypedOrdinal('2026. Lo que viene'));
  });

  it('no es un número suelto', () => {
    assert.ok(!hasTypedOrdinal('1984 fue el año'));
    assert.ok(!hasTypedOrdinal('3 cosas que aprendí'));
  });

  it('no es una cifra decimal', () => {
    assert.ok(!hasTypedOrdinal('1.5 veces más rápido'));
  });

  it('no es una tarea ni un encabezado', () => {
    assert.ok(!hasTypedOrdinal('[ ] 1. hacer la lista'));
    assert.ok(!hasTypedOrdinal('## 1. Primera parte'));
  });

  it('y no está en la segunda línea', () => {
    // Lo que cuelga debajo es el cuerpo del ítem y puede empezar como quiera.
    assert.ok(!hasTypedOrdinal('El primero\n1. y esto es parte de su texto'));
  });
});

describe('quitar el número', () => {
  it('deja el texto y se lleva el ordinal', () => {
    assert.equal(withoutTypedOrdinal('1. Proloquo2Go'), 'Proloquo2Go');
    // El espacio de separación era del número, no del texto, así que se va entero.
    assert.equal(withoutTypedOrdinal('12)  Con dos espacios'), 'Con dos espacios');
  });

  it('conserva entero lo que cuelga debajo', () => {
    assert.equal(
      withoutTypedOrdinal('1. **Vocabulario núcleo**\n   derivado de tableros'),
      '**Vocabulario núcleo**\n   derivado de tableros',
    );
  });

  it('devuelve tal cual lo que no lleva número', () => {
    /*
     * Idéntico y no equivalente: quien llama compara con el original para saber
     * si hay algo que enviar, y una función que recortara de paso generaría una
     * edición por bloque cada vez que se numera una lista.
     */
    const said = '  Un texto con espacio delante  ';
    assert.equal(withoutTypedOrdinal(said), said);
    assert.equal(withoutTypedOrdinal('1984 fue el año'), '1984 fue el año');
  });

  it('un ordinal solo deja un bloque vacío, y eso es lo correcto', () => {
    // Si el bloque no decía más que «1.», lo que decía era su número, y el
    // número ahora lo pone Vera.
    assert.equal(withoutTypedOrdinal('1.'), '');
  });

  it('es idempotente: numerar dos veces no come el texto', () => {
    /*
     * Importa de verdad. Si volver a numerar una lista ya numerada se llevara la
     * primera palabra de cada ítem, el gesto sería una trampa: se ve igual antes
     * y después de pulsarlo, y la segunda vez destruye.
     */
    const once = withoutTypedOrdinal('1. Proloquo2Go');
    assert.equal(withoutTypedOrdinal(once), once);
  });
});
