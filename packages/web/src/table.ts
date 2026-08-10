// La tabla con que se gobierna algo desde su página.
//
// Nació en «Objetos» y «Propiedades» y ahora la usan también Zotero y la puerta
// MCP, que es de donde sale que esté aquí y no allí: tres páginas que se leen
// igual tienen que dibujarse con el mismo código y no con tres códigos
// parecidos, o al tercer arreglo son tres tablas distintas y nadie recuerda por
// qué.
//
// Lo que la tabla es: una fila por cosa gobernada, una columna por lo que se
// decide de ella, y celdas que escriben en el sitio del que salieron. No es una
// copia de nada. Las columnas que Vera observa —cuándo se leyó por última vez,
// cuánto se llevó— van en la misma tabla pero no se editan, porque no son
// decisiones: son lo que pasó.
//
// @invariant AnAgentProposesToASpecialPage, de special-pages.allium: esto es una
// superficie para una persona. Lo que un agente quiera cambiar aquí llega como
// propuesta, y eso lo decide el servidor, no esta tabla.

import { completeInPlace, editInPlace, type Choice } from './fields.ts';
import { icon } from './icons.ts';

export type { Choice };

/** Una tabla en construcción: dónde meter filas y cuántas columnas tiene. */
export interface TableBody {
  body: HTMLTableSectionElement;
  columns: number;
}

/**
 * Una tabla con su nombre y una línea que dice qué reúne.
 *
 * El nombre no es adorno: una tabla partida en dos sin decir por dónde se partió
 * es peor que una tabla larga, porque quien la lee tiene que adivinar el criterio
 * y va a adivinar mal.
 */
export function section(
  host: HTMLElement,
  said: {
    title?: string | null;
    note?: string | null;
    headers: readonly string[];
    /**
     * Qué parte del ancho se lleva cada columna, en porcentaje.
     *
     * Los anchos por número de columnas viven en la hoja de estilos y sirven
     * mientras dos tablas con el mismo número de columnas quieran repartirse
     * igual. En cuanto dejan de quererlo —una de propiedades y una de páginas
     * marcadas tienen las dos cinco columnas y no se parecen en nada— la clase
     * compartida le da a una los anchos de la otra sin que nada avise. Quien sabe
     * qué lleva cada columna es quien la escribe, así que puede decirlo aquí.
     */
    widths?: readonly number[];
    /**
     * Una clase propia, cuando la tabla quiere un trato que no sale del número
     * de columnas.
     *
     * Mismo problema que los anchos y peor: las reglas por número de columnas
     * también reparten estilo —qué celda se lee en la mono y cuál no envuelve— y
     * dos tablas distintas con cinco columnas cada una acaban vistiéndose igual.
     * La de páginas marcadas heredó de la de propiedades un `nowrap` en la
     * segunda celda, y el motivo, que es lo que se lee para decidir, se salía
     * por encima de las columnas siguientes.
     */
    className?: string;
  },
): TableBody {
  if (said.title != null) {
    const heading = document.createElement('h3');
    heading.className = 'governing-title';
    heading.textContent = said.title;
    host.append(heading);
  }
  if (said.note != null) {
    const note = document.createElement('p');
    note.className = 'governing-note';
    note.textContent = said.note;
    host.append(note);
  }

  const table = document.createElement('table');
  table.className = `governing governing-cols-${said.headers.length}${
    said.className === undefined ? '' : ` ${said.className}`
  }`;

  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const [at, label] of said.headers.entries()) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    cell.className = `governing-col-${at}`;
    const width = said.widths?.[at];
    if (width !== undefined) cell.style.width = `${width}%`;
    headRow.append(cell);
  }
  head.append(headRow);
  table.append(head);

  const body = document.createElement('tbody');
  table.append(body);
  host.append(table);
  return { body, columns: said.headers.length };
}

/** Una fila, opcionalmente atada al bloque del que sale lo que dice. */
export function rowIn(table: TableBody, block?: string): HTMLTableRowElement {
  const row = document.createElement('tr');
  if (block !== undefined) row.dataset['block'] = block;
  table.body.append(row);
  return row;
}

/** Una celda en la columna que le toca, que es lo que le da su anchura. */
export function cellIn(row: HTMLTableRowElement, at: number): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.className = `governing-col-${at}`;
  row.append(cell);
  return cell;
}

/**
 * Una celda que enseña lo que Vera observó, y no se toca.
 *
 * Se distingue a la vista de las que se editan —atenuada y sin el cursor de
 * escribir— porque una celda que parece editable y no lo es se pulsa una vez, no
 * pasa nada, y a partir de ahí no se confía en ninguna.
 */
export function observedCell(cell: HTMLElement, shows: string, title?: string): void {
  cell.classList.add('governing-observed');
  cell.classList.toggle('governing-empty', shows === '');
  cell.textContent = shows === '' ? '—' : shows;
  if (title !== undefined) cell.title = title;
}

export interface EditableCell {
  /** Lo que la celda enseña. */
  shows: string;
  /**
   * Lo que se corrige, cuando no es lo mismo.
   *
   * La celda del tipo lee «enlace · varios: a, b» y lo que se está cambiando ahí
   * es `campo`, que dice sólo «enlace». Sin la distinción, abrir la celda y
   * aceptar escribiría la frase entera dentro de `campo` y la declaración
   * dejaría de entenderse.
   */
  edits?: string;
  label: string;
  /** Qué se lee cuando no hay nada dicho. Se dibuja atenuado. */
  placeholder: string;
}

/**
 * Una celda que se corrige pulsándola.
 *
 * `choices` la convierte en un campo que ofrece mientras se escribe; sin ellas es
 * un campo de texto a secas. En los dos casos vale lo que se teclee aunque no
 * esté en la lista: los vocabularios son cerrados para el código y no para quien
 * escribe, y lo que el código no reconozca se lee como no dicho.
 */
export function editableCell(
  cell: HTMLElement,
  said: EditableCell,
  commit: (next: string) => Promise<boolean>,
  choices?: readonly Choice[],
): void {
  const held = said.edits ?? said.shows;

  const draw = (): void => {
    cell.innerHTML = '';
    cell.classList.toggle('governing-empty', said.shows === '');
    cell.textContent = said.shows === '' ? said.placeholder : said.shows;
  };
  draw();

  cell.tabIndex = 0;
  cell.title = held === '' ? `escribir ${said.label}` : `corregir ${said.label}`;
  cell.addEventListener('click', () => {
    if (cell.querySelector('input') !== null) return;
    if (choices === undefined) {
      editInPlace(cell, held, said.label, commit);
      return;
    }
    completeInPlace(cell, said.label, commit, { initial: held, choices, onCancel: draw });
  });
}

/**
 * Una celda de varias respuestas, cada una su ficha.
 *
 * Y no una cadena con comas dentro, por lo mismo que en el frontmatter de una
 * página: son varias respuestas y cada una es una cosa. Quitar una es pulsar su
 * cruz; añadir otra es escribirla con lo que ya existe ofrecido debajo.
 */
export function chipsCell(
  cell: HTMLElement,
  held: readonly string[],
  said: { offered: readonly Choice[]; label: string; add: string },
  commit: (next: readonly string[]) => Promise<boolean>,
): void {
  const draw = (): void => {
    cell.innerHTML = '';
    cell.classList.toggle('governing-empty', held.length === 0);

    for (const one of held) {
      const chip = document.createElement('span');
      chip.className = 'governing-chip';
      const name = document.createElement('span');
      name.textContent = one;
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'governing-chip-drop';
      drop.innerHTML = icon('x');
      drop.setAttribute('aria-label', `quitar ${one}`);
      drop.title = `quitar ${one}`;
      drop.addEventListener('click', (event) => {
        event.stopPropagation();
        void commit(held.filter((other) => other !== one));
      });
      chip.append(name, drop);
      cell.append(chip);
    }

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'governing-chip-add';
    add.textContent = held.length === 0 ? said.add : '+';
    add.setAttribute('aria-label', said.add);
    add.addEventListener('click', (event) => {
      event.stopPropagation();
      const slot = document.createElement('span');
      slot.className = 'governing-chip-slot';
      add.before(slot);
      completeInPlace(slot, said.label, async (next) => commit([...held, next]), {
        // Lo que ya está no se vuelve a ofrecer: añadirlo dos veces no declara
        // nada nuevo y deja la lista con un duplicado.
        choices: said.offered.filter((one) => !held.includes(one.value)),
        onCancel: () => slot.remove(),
      });
    });
    cell.append(add);
  };
  draw();
}
