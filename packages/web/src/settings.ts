// La configuración de Vera.
//
// Dos secciones por ahora: las teclas y la apariencia. Las teclas se leen de
// bindings.ts, que es de donde el editor también las lee, así que esta página
// no puede enseñar un atajo que ya no exista.
//
// @guarantee EditableDesignSystem: los tokens siguen siendo fuente legible y
// editable desde dentro de Vera. Lo que cambia es el control: un color se elige
// con un selector de color y una tipografía de una lista, en vez de escribir el
// valor a ciegas en un campo de texto.

import { BINDINGS, GESTURES, TRIGGERS } from './bindings.ts';
import { COMMANDS } from './autocomplete.ts';
import { icon } from './icons.ts';
import {
  DEFAULT_TOKENS,
  FONT_STACKS,
  kindOf,
  type ColourScheme,
  type DesignToken,
} from './tokens.ts';

export type Section = 'memoria' | 'teclado' | 'apariencia';

export interface SettingsHandlers {
  scheme(): ColourScheme;
  /** Cambiar entre el esquema claro y el oscuro. */
  onScheme(next: ColourScheme): void;
  onTokenChange(token: DesignToken, value: string): void;
  onReset(): void;
  onClose(): void;
  /**
   * Dibuja el estado del corpus y su índice.
   *
   * Lo pone quien tiene los datos —main.ts, que ya los pide al servidor— en vez
   * de que esta página los pida por su cuenta: abrir los ajustes no debería
   * costar una petición más.
   */
  drawMemory?(host: HTMLElement): void;
}

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'memoria', label: 'Memoria' },
  { id: 'teclado', label: 'Teclado' },
  { id: 'apariencia', label: 'Apariencia' },
];

const GROUPS: { id: string; label: string; note?: string }[] = [
  { id: 'navegación', label: 'Navegación', note: 'Valen en cualquier momento.' },
  { id: 'estructura', label: 'Estructura del esquema', note: 'Editando un bloque.' },
  { id: 'edición', label: 'Edición', note: 'Editando un bloque.' },
  { id: 'autocompletado', label: 'Autocompletado', note: 'Con la lista de sugerencias abierta.' },
];

/** Un nombre legible para un token, sin obligar a leer la variable CSS. */
const LABELS: Record<string, string> = {
  '--bg': 'fondo',
  '--bg-raised': 'fondo elevado',
  '--text': 'texto',
  '--text-dim': 'texto atenuado',
  '--rule': 'líneas y bordes',
  '--accent': 'acento',
  '--node-central': 'nodo central del grafo',
  '--node-fill': 'nodos del grafo',
  '--link-stroke': 'aristas del grafo',
  '--warm': 'énfasis cálido',
  '--line-height': 'interlínea',
  '--text-size': 'tamaño del texto',
  '--indent': 'sangría por nivel',
  '--phone-scale': 'tamaño en el teléfono',
  '--content-width': 'ancho de la columna',
  '--font-body': 'texto de lectura',
  '--font-ui': 'interfaz',
  '--font-mono': 'Markdown y código',
};

export function renderSettings(
  host: HTMLElement,
  tokens: DesignToken[],
  active: Section,
  handlers: SettingsHandlers,
): void {
  host.innerHTML = '';
  host.hidden = false;

  const head = document.createElement('header');
  head.className = 'settings-head';

  const title = document.createElement('h2');
  title.textContent = 'Configuración';
  head.append(title);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'settings-close';
  close.setAttribute('aria-label', 'Cerrar');
  close.title = 'Cerrar';
  close.innerHTML = icon('x');
  close.addEventListener('click', () => handlers.onClose());
  head.append(close);
  host.append(head);

  const tabs = document.createElement('nav');
  tabs.className = 'settings-tabs';
  for (const section of SECTIONS) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = section.id === active ? 'settings-tab selected' : 'settings-tab';
    tab.textContent = section.label;
    tab.setAttribute('aria-pressed', String(section.id === active));
    tab.addEventListener('click', () => renderSettings(host, tokens, section.id, handlers));
    tabs.append(tab);
  }
  host.append(tabs);

  const body = document.createElement('div');
  body.className = 'settings-body';
  host.append(body);

  if (active === 'memoria') drawMemory(body, handlers);
  else if (active === 'teclado') drawKeyboard(body);
  else drawAppearance(body, tokens, handlers);
}

/**
 * Memoria: qué hay en el corpus y cómo está compuesto.
 *
 * Vivía en un panel lateral permanente, ocupando ancho en cada pantalla para
 * decir algo que se consulta de vez en cuando. Aquí se consulta cuando se
 * quiere, y el ancho vuelve al mapa y al texto.
 */
function drawMemory(host: HTMLElement, handlers: SettingsHandlers): void {
  const intro = document.createElement('p');
  intro.className = 'settings-note';
  intro.textContent =
    'Lo que hay en este grafo, lo que quedó a medias, y las páginas que gobiernan ' +
    'esta instancia. Para encontrar una página cualquiera está el buscador: ' +
    'encuentra por lo que uno recuerda, sin obligar a reconocer un título en una lista.';
  host.append(intro);

  if (handlers.drawMemory === undefined) return;
  handlers.drawMemory(host);
}

/** Un encabezado de sección, con su aclaración de cuándo vale lo que sigue. */
function heading(host: HTMLElement, label: string, note?: string): void {
  const title = document.createElement('h3');
  title.textContent = label;
  host.append(title);
  if (note === undefined) return;
  const said = document.createElement('p');
  said.className = 'settings-note';
  said.textContent = note;
  host.append(said);
}

/** Una tabla de «esto se hace así», que es la única forma que toma esta página. */
function table(host: HTMLElement, rows: { keys: string; what: string; when?: string }[]): void {
  const list = document.createElement('dl');
  list.className = 'keys';
  for (const row of rows) {
    const key = document.createElement('dt');
    const chip = document.createElement('kbd');
    chip.textContent = row.keys;
    key.append(chip);

    const what = document.createElement('dd');
    what.textContent = row.what;
    if (row.when !== undefined) {
      const when = document.createElement('span');
      when.className = 'keys-when';
      when.textContent = row.when;
      what.append(when);
    }
    list.append(key, what);
  }
  host.append(list);
}

/**
 * Qué se puede hacer, y cómo.
 *
 * Se llama «Teclado» por costumbre, pero lo que contesta es «qué puedo hacer»,
 * y la respuesta no depende de si lo que se usa es una tecla, un dedo o una
 * barra escrita. Por eso están juntos los atajos, los gestos del mapa y los
 * comandos: quien viene aquí no sabe todavía en cuál de las tres categorías cae
 * lo que busca.
 *
 * Todo se lee del sitio del que la aplicación lo toma —`BINDINGS`, `GESTURES`,
 * `COMMANDS`—, nunca de una copia. Una lista de ayuda escrita aparte se
 * desincroniza sola, y entonces enseña teclas que ya no hacen eso.
 */
function drawKeyboard(host: HTMLElement): void {
  const intro = document.createElement('p');
  intro.className = 'settings-note';
  intro.textContent =
    'Todo lo que sigue se lee del mismo sitio del que la aplicación lo toma, así que ' +
    'lo que dice aquí es lo que hace.';
  host.append(intro);

  for (const group of GROUPS) {
    const rows = BINDINGS.filter((binding) => binding.group === group.id);
    if (rows.length === 0) continue;
    heading(host, group.label, group.note);
    table(
      host,
      rows.map((binding) => ({ keys: binding.keys, what: binding.what, when: binding.when })),
    );
  }

  /*
   * El mapa, que no se conduce con teclas.
   *
   * Estaba sin documentar en ninguna parte: había que descubrir a tientas que
   * dos dedos lo corren, o que con Shift se desplaza en vez de girar. Un gesto
   * que nadie enseña es un gesto que no existe.
   */
  heading(host, 'Mapa', 'El plano y el de tres dimensiones no se conducen igual.');
  table(
    host,
    GESTURES.map((gesture) => ({
      keys: gesture.does,
      what: gesture.what,
      when: gesture.where === 'las dos' ? 'en las dos vistas' : `sólo en ${gesture.where}`,
    })),
  );

  heading(
    host,
    'Comandos',
    'Se escriben con una barra al principio de un bloque. Basta teclear parte del nombre.',
  );
  table(
    host,
    COMMANDS.map((command) => ({ keys: `/${command.name}`, what: command.hint })),
  );

  heading(host, 'Lo que se escribe para abrir el autocompletado');
  table(host, TRIGGERS);
}

function drawAppearance(
  host: HTMLElement,
  tokens: DesignToken[],
  handlers: SettingsHandlers,
): void {
  const scheme = handlers.scheme();

  /*
   * Claro u oscuro, aquí y no en la barra.
   *
   * Era un botón permanente entre los de arriba, y en un teléfono la barra es el
   * recurso más escaso que hay: cada icono que se queda ahí es uno que compite
   * con hablar, buscar y volver al día. El tema se cambia dos veces al día como
   * mucho —al anochecer y poco más— y lo que se usa dos veces al día no vive
   * donde lo que se usa veinte.
   *
   * Y aquí está en su sitio: debajo se editan los colores de ese mismo esquema,
   * así que elegir cuál se está mirando es la primera decisión de esta página.
   */
  const chooser = document.createElement('div');
  chooser.className = 'scheme-choice';

  const label = document.createElement('span');
  label.className = 'settings-label';
  label.textContent = 'Esquema';
  chooser.append(label);

  // Con icono y no con palabra: «claro» y «oscuro» miden distinto, y dos
  // botones de anchos distintos para elegir entre dos cosas equivalentes leen
  // como si una pesara más. El sol y la luna miden lo mismo y se reconocen sin
  // leerse. El nombre sigue estando donde hace falta, en la etiqueta accesible.
  const options: { value: ColourScheme; shape: 'sun' | 'moon'; text: string }[] = [
    { value: 'light', shape: 'sun', text: 'claro' },
    { value: 'dark', shape: 'moon', text: 'oscuro' },
  ];
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'scheme-option';
    button.innerHTML = icon(option.shape);
    button.setAttribute('aria-label', `Esquema ${option.text}`);
    button.title = `Esquema ${option.text}`;
    const here = scheme === option.value;
    button.setAttribute('aria-pressed', String(here));
    if (here) button.classList.add('here');
    button.addEventListener('click', () => handlers.onScheme(option.value));
    chooser.append(button);
  }
  host.append(chooser);

  const intro = document.createElement('p');
  intro.className = 'settings-note';
  intro.textContent =
    `Se está editando el esquema ${scheme === 'dark' ? 'oscuro' : 'claro'}. ` +
    'Cada token guarda su valor para los dos, así que cambiar de esquema no pisa el otro.';
  host.append(intro);

  const list = document.createElement('div');
  list.className = 'tokens';

  for (const token of tokens) {
    const row = document.createElement('label');
    row.className = 'token';

    const name = document.createElement('span');
    name.className = 'token-name';
    name.textContent = LABELS[token.name] ?? token.name;
    const variable = document.createElement('code');
    variable.className = 'token-var';
    variable.textContent = token.name;
    name.append(variable);

    const current = scheme === 'dark' ? token.dark : token.light;
    const kind = kindOf(token);
    let control: HTMLElement;

    if (kind === 'color') {
      /*
       * Un color se elige mirándolo. Junto al selector va su valor, porque el
       * token sigue siendo texto y hay quien prefiere escribirlo.
       *
       * Y el texto es el que manda sobre la transparencia, porque el selector no
       * sabe de ella: `<input type="color">` es de tres canales por
       * especificación, y al darle `#8fa2a363` devuelve `#8fa2a3` sin decir
       * nada. Medido. Como al tocarlo se escribía su valor de vuelta al token,
       * bastaba rozar el selector para que un color translúcido se volviera
       * opaco y nadie se enterara.
       *
       * Ahora el selector lleva sólo los tres canales y la transparencia viaja
       * aparte: se conserva al elegir un tono nuevo, y se escribe en el campo de
       * texto, que sí admite los ocho dígitos. Ni el modelo ni CSS tenían nada
       * en contra —`rgba(143, 162, 163, 0.39)` es lo que el navegador lee de
       * `#8fa2a363`—; era el control el que no llegaba.
       */
      const wrap = document.createElement('span');
      wrap.className = 'token-color';

      /** Los tres canales por un lado y la transparencia por otro. */
      const opaqueOf = (value: string): string => value.trim().slice(0, 7);
      const alphaOf = (value: string): string => {
        const held = value.trim();
        return /^#[0-9a-f]{8}$/i.test(held) ? held.slice(7) : '';
      };

      let alpha = alphaOf(current);

      const picker = document.createElement('input');
      picker.type = 'color';
      picker.value = opaqueOf(current);
      const text = document.createElement('input');
      text.type = 'text';
      text.className = 'token-hex';
      text.value = current;
      text.title = 'seis dígitos, u ocho para dar transparencia: #8fa2a363';

      /*
       * La transparencia, con su propio control.
       *
       * El selector del navegador no la ofrece, y dejarla sólo en el campo de
       * texto significa que para bajar un color al 40 % hay que saberse que eso
       * se escribe `66` en hexadecimal. Un tono se elige mirándolo y una
       * transparencia también.
       *
       * El deslizador es además la muestra: su carril va del transparente al
       * color entero sobre un damero, así que enseña exactamente lo que el token
       * va a valer. Por eso no hace falta un cuadrito aparte —había uno y era un
       * segundo selector de color a la vista, que es justo lo que no es—.
       */
      const opacity = document.createElement('input');
      opacity.type = 'range';
      opacity.className = 'token-alpha';
      opacity.min = '0';
      opacity.max = '100';
      opacity.setAttribute('aria-label', `opacidad de ${LABELS[token.name] ?? token.name}`);

      const pctOf = (hex: string): number =>
        hex === '' ? 100 : Math.round((parseInt(hex, 16) / 255) * 100);
      const hexOf = (pct: number): string =>
        pct >= 100 ? '' : Math.round((pct / 100) * 255).toString(16).padStart(2, '0');

      /** Deja los tres controles diciendo lo mismo, y pinta el carril. */
      const settle = (value: string): void => {
        const rgb = opaqueOf(value);
        alpha = alphaOf(value);
        picker.value = rgb;
        text.value = value;
        opacity.value = String(pctOf(alpha));
        wrap.style.setProperty('--token-rgb', rgb);
        opacity.title = `${pctOf(alpha)} % de opacidad`;
      };
      settle(current);

      const emit = (value: string): void => {
        settle(value);
        handlers.onTokenChange(token, value);
      };

      // La transparencia sobrevive a elegir un tono nuevo: es otra decisión.
      picker.addEventListener('input', () => emit(picker.value + alpha));
      opacity.addEventListener('input', () => emit(picker.value + hexOf(Number(opacity.value))));
      text.addEventListener('change', () => emit(text.value.trim()));

      wrap.append(picker, opacity, text);
      control = wrap;
    } else if (kind === 'font') {
      const select = document.createElement('select');
      for (const stack of FONT_STACKS) {
        const option = document.createElement('option');
        option.value = stack.value;
        option.textContent = stack.label;
        option.selected = stack.value === current;
        select.append(option);
      }
      // Una pila que no está en la lista no se pierde: se ofrece como está.
      if (!FONT_STACKS.some((stack) => stack.value === current)) {
        const option = document.createElement('option');
        option.value = current;
        option.textContent = 'la que hay ahora';
        option.selected = true;
        select.prepend(option);
      }
      select.addEventListener('change', () => handlers.onTokenChange(token, select.value));
      // Se ve escrita en su propia letra, que es la única forma de elegirla.
      select.style.fontFamily = current;
      control = select;
    } else {
      const field = document.createElement('input');
      field.type = 'text';
      field.value = current;
      field.addEventListener('change', () => handlers.onTokenChange(token, field.value));
      control = field;
    }

    row.append(name, control);
    list.append(row);
  }

  host.append(list);

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'settings-reset';
  reset.textContent = `Restituir los ${DEFAULT_TOKENS.length} tokens de origen`;
  reset.addEventListener('click', () => handlers.onReset());
  host.append(reset);
}
