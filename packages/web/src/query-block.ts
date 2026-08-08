// Un bloque que pregunta, y lo que se lee debajo.
//
// Ver query-language.allium. Un bloque cuyo texto empieza por `?` es una
// pregunta; la respuesta se dibuja debajo y no se guarda en ninguna parte.
//
// @guarantee AStandingQueryIsAnsweredOnRead: se contesta cada vez que se lee la
// página, contra el grafo como esté entonces. Guardar la respuesta sería guardar
// una lista que envejece sin decirlo, y una lista que dice ser todos los
// proyectos y se dejó el de la semana pasada es peor que ninguna lista: se le
// cree.

import { api, type QueryAnswer, type QueryHit } from './api.ts';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Una fecha como se dice en voz alta.
 *
 * Lo de hoy y lo de ayer se nombran, no se fechan: quien mira una lista de lo
 * último que escribió no está leyendo un calendario. Lo de este año se dice sin
 * año, porque el año es el que se sobreentiende.
 */
export function saidDate(when: number | null, now = Date.now()): string {
  if (when === null) return '';
  const día = new Date(when);
  const hoy = new Date(now);
  const mismoDía = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (mismoDía(día, hoy)) return 'hoy';
  const ayer = new Date(now);
  ayer.setDate(ayer.getDate() - 1);
  if (mismoDía(día, ayer)) return 'ayer';

  const mes = MESES[día.getMonth()] ?? '';
  return día.getFullYear() === hoy.getFullYear()
    ? `${día.getDate()} ${mes}`
    : `${día.getDate()} ${mes} ${día.getFullYear()}`;
}

export interface QueryBlockHandlers {
  /** Ir a una página por su título, como cualquier otro enlace. */
  onNavigate(title: string): void;
}

/**
 * Dibuja la respuesta de un bloque que pregunta, debajo de él.
 *
 * Devuelve el elemento donde vive la respuesta para que quien lo llamó pueda
 * quitarlo al volver a dibujar. Mientras la respuesta viaja se dice que se está
 * preguntando: una pregunta sobre dos mil páginas tarda, y un hueco en blanco no
 * se distingue de un cero.
 */
export function answerQueryBlock(
  host: HTMLElement,
  source: string,
  handlers: QueryBlockHandlers,
): HTMLElement {
  const answer = document.createElement('div');
  answer.className = 'query-answer';
  answer.setAttribute('aria-live', 'polite');

  const waiting = document.createElement('p');
  waiting.className = 'query-waiting';
  waiting.textContent = 'preguntando…';
  answer.append(waiting);
  host.append(answer);

  void api.query(source).then((said) => {
    answer.innerHTML = '';
    answer.append(...drawAnswer(said, handlers));
  });

  return answer;
}

/** Lo que se lee debajo de la pregunta, según cómo haya salido. */
export function drawAnswer(said: QueryAnswer, handlers: QueryBlockHandlers): HTMLElement[] {
  if ('error' in said) return [drawUnreadable(said)];

  const head = document.createElement('p');
  head.className = 'query-count';
  head.textContent =
    said.count === 0
      ? 'ninguna página'
      : said.count === 1
        ? 'una página'
        : `${said.count} páginas`;
  if (said.more > 0) {
    const rest = document.createElement('span');
    rest.className = 'query-more';
    // Lo recortado se dice. Callarlo convertiría «hay 592» en «hay 200 y son
    // éstas», que es lo mismo que mentir con la forma correcta.
    rest.textContent = ` · se ven ${said.pages.length}, faltan ${said.more}`;
    head.append(rest);
  }

  /*
   * Cuando no cumple ninguna, lo que hace falta saber es si el corpus no tiene
   * nada o si la pregunta decía otra cosa. Se enseña la pregunta tal como Vera
   * la entendió —@guarantee AnEmptyAnswerExplainsItself— y con eso la diferencia
   * se ve sin adivinarla.
   */
  if (said.count === 0) {
    const why = document.createElement('p');
    why.className = 'query-empty';
    why.textContent = `ninguna cumple «${said.asked}»`;
    return [why];
  }

  return [head, said.view === 'table' ? drawTable(said.pages, handlers) : drawList(said.pages, handlers)];
}

function drawUnreadable(said: { error: string; at: number; near: string }): HTMLElement {
  const problem = document.createElement('p');
  problem.className = 'query-problem';
  problem.textContent = said.error;
  if (said.near !== '') {
    const where = document.createElement('code');
    where.className = 'query-near';
    where.textContent = said.near;
    problem.append(' ', where);
  }
  return problem;
}

/** El título de una página, que se pulsa y lleva a ella. */
function titleButton(hit: QueryHit, handlers: QueryBlockHandlers): HTMLButtonElement {
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'query-title';
  link.textContent = hit.title;
  link.title = `ir a ${hit.title}`;
  link.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.onNavigate(hit.title);
  });
  return link;
}

function drawList(pages: QueryHit[], handlers: QueryBlockHandlers): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'query-list';
  for (const hit of pages) {
    const row = document.createElement('li');
    row.append(titleButton(hit, handlers));
    // El pasaje donde lo dice, cuando la pregunta era por texto. Es lo que
    // distingue el acierto bueno del que sólo comparte una palabra.
    if (hit.says !== null) {
      const says = document.createElement('span');
      says.className = 'query-says';
      says.textContent = hit.says.excerpt;
      row.append(says);
    }
    list.append(row);
  }
  return list;
}

/*
 * La tabla, con las tres columnas de siempre.
 *
 * Elegir columnas es lo que convierte una tabla en un índice de trabajo y es
 * también lo que trae columnas vacías, anchos imposibles en el teléfono y una
 * preferencia que hay que guardar en alguna parte. Primero que la tabla exista.
 */
function drawTable(pages: QueryHit[], handlers: QueryBlockHandlers): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'query-table-wrap';

  const table = document.createElement('table');
  table.className = 'query-table';

  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  /*
   * «escrita» y no «actualización».
   *
   * Es la misma columna —cuándo se tocó la página por última vez— dicha en corto.
   * Con el mapa abierto al lado, el hueco de un bloque son trescientos píxeles, y
   * un encabezado de trece letras se come el ancho de la columna que encabeza.
   */
  for (const name of ['título', 'tipo', 'escrita']) {
    const cell = document.createElement('th');
    cell.textContent = name;
    headRow.append(cell);
  }
  head.append(headRow);

  const body = document.createElement('tbody');
  for (const hit of pages) {
    const row = document.createElement('tr');

    const title = document.createElement('td');
    title.append(titleButton(hit, handlers));

    const type = document.createElement('td');
    type.className = 'query-cell-type';
    // Una página sin tipo no dice «ninguno»: deja el hueco. Escribir una palabra
    // donde no hay dato hace que la columna parezca contestada.
    type.textContent = hit.type ?? '';

    const when = document.createElement('td');
    when.className = 'query-cell-when';
    when.textContent = saidDate(hit.updated);

    row.append(title, type, when);
    body.append(row);
  }

  table.append(head, body);
  wrap.append(table);
  return wrap;
}
