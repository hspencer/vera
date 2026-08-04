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

import { BINDINGS, TRIGGERS } from './bindings.ts';
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

const GROUPS: { id: string; label: string }[] = [
  { id: 'estructura', label: 'Estructura del esquema' },
  { id: 'edición', label: 'Edición' },
  { id: 'autocompletado', label: 'Autocompletado' },
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

function drawKeyboard(host: HTMLElement): void {
  const intro = document.createElement('p');
  intro.className = 'settings-note';
  intro.textContent =
    'Los atajos valen mientras se edita un bloque. Se leen del mismo sitio del que ' +
    'el editor los toma, así que lo que dice aquí es lo que hace la tecla.';
  host.append(intro);

  for (const group of GROUPS) {
    const rows = BINDINGS.filter((binding) => binding.group === group.id);
    if (rows.length === 0) continue;

    const heading = document.createElement('h3');
    heading.textContent = group.label;
    host.append(heading);

    const table = document.createElement('dl');
    table.className = 'keys';
    for (const binding of rows) {
      const key = document.createElement('dt');
      const chip = document.createElement('kbd');
      chip.textContent = binding.keys;
      key.append(chip);

      const what = document.createElement('dd');
      what.textContent = binding.what;
      const when = document.createElement('span');
      when.className = 'keys-when';
      when.textContent = binding.when;
      what.append(when);

      table.append(key, what);
    }
    host.append(table);
  }

  const heading = document.createElement('h3');
  heading.textContent = 'Lo que se escribe para abrir el autocompletado';
  host.append(heading);

  const table = document.createElement('dl');
  table.className = 'keys';
  for (const trigger of TRIGGERS) {
    const key = document.createElement('dt');
    const chip = document.createElement('kbd');
    chip.textContent = trigger.keys;
    key.append(chip);
    const what = document.createElement('dd');
    what.textContent = trigger.what;
    table.append(key, what);
  }
  host.append(table);
}

function drawAppearance(
  host: HTMLElement,
  tokens: DesignToken[],
  handlers: SettingsHandlers,
): void {
  const scheme = handlers.scheme();

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
      // Un color se elige mirándolo. Junto al selector va su valor, porque el
      // token sigue siendo texto y hay quien prefiere escribirlo.
      const wrap = document.createElement('span');
      wrap.className = 'token-color';
      const picker = document.createElement('input');
      picker.type = 'color';
      picker.value = current;
      const text = document.createElement('input');
      text.type = 'text';
      text.className = 'token-hex';
      text.value = current;

      picker.addEventListener('input', () => {
        text.value = picker.value;
        handlers.onTokenChange(token, picker.value);
      });
      text.addEventListener('change', () => {
        picker.value = text.value;
        handlers.onTokenChange(token, text.value);
      });
      wrap.append(picker, text);
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
