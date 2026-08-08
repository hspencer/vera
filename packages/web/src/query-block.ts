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

import { api, type QueryAnswer, type QueryHit, type QuerySort } from './api.ts';

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
  host.append(answer);

  /*
   * Ordenar vuelve a preguntar, y no reordena lo que llegó.
   *
   * Una pregunta puede seleccionar dos mil páginas y de ellas viajan doscientas:
   * ordenar aquí ordenaría las doscientas primeras por título, que no es ordenar
   * la respuesta sino el trozo que cupo. El orden va al servidor, que ordena
   * antes de recortar.
   */
  const ask = (sort?: QuerySort): void => {
    answer.innerHTML = '';
    const waiting = document.createElement('p');
    waiting.className = 'query-waiting';
    waiting.textContent = 'preguntando…';
    answer.append(waiting);

    void api.query(source, sort).then((said) => {
      answer.innerHTML = '';
      answer.append(...drawAnswer(said, handlers, ask));
    });
  };

  ask();
  return answer;
}

/** Lo que se lee debajo de la pregunta, según cómo haya salido. */
export function drawAnswer(
  said: QueryAnswer,
  handlers: QueryBlockHandlers,
  again: (sort?: QuerySort) => void = () => {},
): HTMLElement[] {
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

  return [
    head,
    said.view === 'table'
      ? drawTable(said.pages, handlers, said.names, said.sort, again)
      : drawList(said.pages, handlers),
  ];
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
 * La tabla.
 *
 * Cinco columnas: el título, lo que la página dice ser, de qué trata, cuándo
 * nació y cuándo se la tocó por última vez. Las dos primeras y la tercera se
 * llaman como el corpus las llame —vienen con la respuesta—, porque preguntar
 * por `tipo` y ver una columna que diga otra cosa obliga a saberse dos palabras
 * para una.
 *
 * Y las cabeceras ordenan. Pulsar una vuelve a preguntar con ese orden: ordenar
 * en la pantalla ordenaría el trozo que cupo, y el trozo que cupo se eligió por
 * título.
 */
function drawTable(
  pages: QueryHit[],
  handlers: QueryBlockHandlers,
  names: { kind: string; topic: string },
  sort: QuerySort,
  again: (sort?: QuerySort) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'query-table-wrap';

  const table = document.createElement('table');
  table.className = 'query-table';

  const columns: { key: QuerySort['by']; name: string }[] = [
    { key: 'title', name: 'título' },
    { key: 'type', name: names.kind },
    { key: 'topic', name: names.topic },
    { key: 'created', name: 'creación' },
    { key: 'updated', name: 'actualización' },
  ];

  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const column of columns) {
    const cell = document.createElement('th');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'query-sort';
    button.textContent = column.name;
    const mine = sort.by === column.key;
    if (mine) {
      button.classList.add('sorted');
      // La flecha dice hacia dónde está ordenado ahora, no hacia dónde iría al
      // pulsar: es el estado y no la promesa.
      button.append(document.createTextNode(sort.desc ? ' ↓' : ' ↑'));
    }
    button.title = mine && !sort.desc ? `ordenar por ${column.name}, al revés` : `ordenar por ${column.name}`;
    // Pulsar la misma cabecera da la vuelta; pulsar otra empieza por arriba.
    /*
     * El clic se queda aquí.
     *
     * Sin esto sube hasta el bloque, que lo entiende como «ponme a editar»,
     * rehace su cuerpo y se lleva la tabla por delante: pulsar una cabecera
     * cerraba la respuesta en vez de ordenarla. Le pasa a todo lo que se pulse
     * dentro de una respuesta, y por eso lo hacen también los títulos.
     */
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      again({ by: column.key, desc: mine ? !sort.desc : false });
    });
    cell.append(button);
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

    /*
     * Los conceptos, uno por uno y cada uno enlazado.
     *
     * Una página es varias cosas a la vez y el corpus lo escribe con comas. La
     * cadena entera no lleva a ninguna parte —no existe una página llamada
     * «contactos, PUCV, EAD»—, así que cada respuesta es su propio enlace.
     */
    const topic = document.createElement('td');
    topic.className = 'query-cell-topic';
    for (const [at, one] of (hit.topic ?? []).entries()) {
      if (at > 0) topic.append(document.createTextNode(', '));
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'query-title';
      link.textContent = one;
      link.title = `ir a ${one}`;
      link.addEventListener('click', (event) => {
        event.stopPropagation();
        handlers.onNavigate(one);
      });
      topic.append(link);
    }

    const born = document.createElement('td');
    born.className = 'query-cell-when';
    born.textContent = saidDate(hit.created);

    const when = document.createElement('td');
    when.className = 'query-cell-when';
    when.textContent = saidDate(hit.updated);

    row.append(title, type, topic, born, when);
    body.append(row);
  }

  table.append(head, body);
  wrap.append(table);
  return wrap;
}
