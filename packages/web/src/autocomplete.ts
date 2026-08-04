// La máquina de estados del autocompletado.
//
// Lógica pura: entra el texto y el cursor, sale qué está abierto y qué se está
// buscando. Quién resuelve la búsqueda y cómo se dibuja la lista es cosa del
// outliner.
//
// @invariant SearchRegionFollowsTheCaret: lo que hay abierto es dueño del texto
// entre su disparador y el cursor. Salir de esa región lo cierra.

export type Trigger = 'pagina' | 'etiqueta' | 'bloque' | 'comando';

export interface Open {
  trigger: Trigger;
  /** Dónde empieza la consulta dentro del buffer, después del disparador. */
  queryStart: number;
}

/**
 * Qué disparador acaba de quedar a la izquierda del cursor.
 *
 * Se mira el texto y no la tecla, porque pegar `[[` tiene que abrir lo mismo que
 * escribirlo, y porque el autopar ya metió el cierre cuando llega el segundo
 * corchete.
 */
export function detectTrigger(buffer: string, cursor: number): Open | null {
  const before = buffer.slice(0, cursor);

  // `#[[` es una etiqueta con espacios; se comprueba antes que `[[` a secas.
  if (before.endsWith('#[[')) return { trigger: 'etiqueta', queryStart: cursor };
  if (before.endsWith('[[')) return { trigger: 'pagina', queryStart: cursor };
  if (before.endsWith('((')) return { trigger: 'bloque', queryStart: cursor };

  // Una almohadilla sólo abre etiqueta al principio o tras un espacio: si no,
  // `C#3` y cualquier ancla de URL abrirían una búsqueda.
  if (before.endsWith('#')) {
    const previous = before.at(-2);
    if (previous === undefined || /\s/.test(previous)) {
      return { trigger: 'etiqueta', queryStart: cursor };
    }
  }

  // La barra abre comandos sólo donde podría empezar uno, por la misma razón:
  // una fecha o una ruta llevan barras y no son comandos.
  if (before.endsWith('/')) {
    const previous = before.at(-2);
    if (previous === undefined || /\s/.test(previous)) {
      return { trigger: 'comando', queryStart: cursor };
    }
  }

  return null;
}

/**
 * Lo que se está buscando, o `null` si el cursor salió de la región.
 *
 * La consulta muere al llegar un espacio en las que no lo admiten, y al salir
 * el cursor por delante del disparador.
 */
export function queryOf(open: Open, buffer: string, cursor: number): string | null {
  if (cursor < open.queryStart) return null;

  const query = buffer.slice(open.queryStart, cursor);

  // Un corchete de cierre termina la referencia aunque el cursor siga dentro.
  if (query.includes(']') || query.includes(')')) return null;
  if (query.includes('\n')) return null;

  // Etiquetas y comandos no llevan espacios; páginas y bloques sí.
  if ((open.trigger === 'etiqueta' || open.trigger === 'comando') && query.includes(' ')) {
    return null;
  }

  return query;
}

/** Qué se escribe al elegir, y dónde queda el cursor después. */
export function completionFor(
  open: Open,
  choice: string,
  buffer: string,
  cursor: number,
): { buffer: string; cursor: number } {
  const head = buffer.slice(0, open.queryStart);
  const tail = buffer.slice(cursor);

  if (open.trigger === 'pagina' || open.trigger === 'bloque') {
    // El autopar ya dejó el cierre delante del cursor, así que sólo hay que
    // saltarlo en vez de escribir otro.
    const closing = open.trigger === 'pagina' ? ']]' : '))';
    const skip = tail.startsWith(closing) ? closing.length : 0;
    return {
      buffer: head + choice + closing + tail.slice(skip),
      cursor: head.length + choice.length + closing.length,
    };
  }

  if (open.trigger === 'etiqueta') {
    // Una etiqueta con espacios necesita corchetes; sin ellos no lo parece.
    const written = choice.includes(' ') ? `[[${choice}]]` : choice;
    return { buffer: head + written + tail, cursor: head.length + written.length };
  }

  const command = COMMANDS.find((entry) => entry.name === choice);
  if (command === undefined) return { buffer, cursor };

  const written = typeof command.inserts === 'function' ? command.inserts() : command.inserts;
  // El comando se come su propia barra: `/cita` deja una cita, no `/> `.
  const withoutSlash = head.slice(0, -1);
  return {
    buffer: withoutSlash + written + tail,
    cursor: withoutSlash.length + (command.caret ?? written.length),
  };
}

/**
 * La fecha de hoy tal como la escribe el calendario.
 *
 * El reloj es el de esta máquina, no el del servidor: quien escribe está aquí, y
 * si son las once de la noche del lunes para él, es lunes, aunque el servidor
 * viva en otro huso. daily-log.allium deja abierto qué pasa cuando esos dos
 * relojes no son el mismo; mientras la instancia sea de una persona en una
 * máquina, la pregunta no se hace.
 */
export function today(): string {
  return calendarDate(new Date());
}

/** `YYYY-MM-DD` en horario local, que es como se titula un día. */
export function calendarDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface Command {
  name: string;
  hint: string;
  /**
   * Lo que deja escrito.
   *
   * Casi siempre un literal. Es una función cuando lo que escribe depende de
   * cuándo se escribe: `/hoy` no puede ser una constante porque mañana sería
   * mentira.
   */
  inserts: string | (() => string);
  /**
   * Dónde cae el cursor dentro de lo insertado. Omitido, al final — que es lo
   * que quiere un comando que deja algo terminado en vez de algo que rellenar.
   */
  caret?: number;
  /**
   * Lo que el comando hace además de escribir.
   *
   * Casi todos sólo dejan Markdown. `hablar` es el que no: abre una grabación en
   * ese punto de la escritura, y quien atiende el comando es el outliner, porque
   * el hecho ocurre en el grafo y no en el texto.
   */
  acts?: 'hablar' | 'elegir-fecha';
}

/**
 * Los comandos de barra.
 *
 * Todos escriben Markdown y nada más. Vera no modela tipos de bloque ni
 * encabezados como estado —eso vive en el texto—, así que un comando que
 * pusiera un atributo estaría inventando un modelo que la spec no tiene.
 */
export const COMMANDS: Command[] = [
  { name: 'titulo', hint: 'encabezado de primer nivel', inserts: '# ', caret: 2 },
  { name: 'subtitulo', hint: 'encabezado de segundo nivel', inserts: '## ', caret: 3 },
  { name: 'cita', hint: 'cita', inserts: '> ', caret: 2 },
  { name: 'codigo', hint: 'bloque de código', inserts: '```\n\n```', caret: 4 },
  { name: 'mermaid', hint: 'diagrama', inserts: '```mermaid\n\n```', caret: 11 },
  { name: 'tabla', hint: 'tabla de dos columnas', inserts: '| a | b |\n| --- | --- |\n|  |  |', caret: 2 },
  { name: 'linea', hint: 'línea horizontal', inserts: '---', caret: 3 },
  { name: 'lista', hint: 'lista con viñetas', inserts: '- ', caret: 2 },
  { name: 'numerada', hint: 'lista numerada', inserts: '1. ', caret: 3 },
  { name: 'tarea', hint: 'casilla por hacer', inserts: '- [ ] ', caret: 6 },
  { name: 'nota', hint: 'referencia a nota al pie', inserts: '[^1]', caret: 3 },
  { name: 'pagina', hint: 'enlace a otra página', inserts: '[[]]', caret: 2 },
  { name: 'audio', hint: 'hablar aquí mismo', inserts: '', caret: 0, acts: 'hablar' },
  // Fechas. Un día es una página, así que fechar algo es enlazarlo: escribir
  // «hoy» como texto deja una palabra que dentro de un mes será falsa, y
  // escribir el enlace deja algo que sigue llevando al día en que se dijo.
  { name: 'hoy', hint: 'el día de hoy, enlazado a su diario', inserts: () => `[[${today()}]]` },
  {
    name: 'fecha',
    hint: 'elegir un día en el calendario',
    inserts: '',
    caret: 0,
    acts: 'elegir-fecha',
  },
];

/** Lo que un comando hace además de escribir, si hace algo. */
export function actionOf(name: string): Command['acts'] | undefined {
  return COMMANDS.find((command) => command.name === name)?.acts;
}

/** Filtra por lo escrito. Sin consulta se ofrecen todos. */
export function matchingCommands(query: string): Command[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return COMMANDS;
  return COMMANDS.filter(
    (command) =>
      command.name.toLowerCase().includes(needle) || command.hint.toLowerCase().includes(needle),
  );
}
