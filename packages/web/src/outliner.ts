// Outliner de bloques con edición Markdown nativa.
//
// @invariant SourceRemainsMarkdown: al editar se ve y se guarda el Markdown del
// bloque, no un formato opaco.
//
// @invariant EditingRevealsTheSource: enfocar un bloque reemplaza su
// presentación renderizada por la fuente exacta que la produjo. Lo renderizado
// nunca se guarda, así que ninguna edición pasa de ida y vuelta por el
// renderizador.
//
// Cada edición emite una operación. No hay guardado implícito ni estado local
// que pueda divergir del grafo.

import { api, type BlockView, type Change, type PageView } from './api.ts';
import { renderMarkdown, type RenderOptions } from './markdown.ts';
import { renderMermaid } from './mermaid.ts';
import { is } from './bindings.ts';
import { icon } from './icons.ts';
import { createSession, type SaveIntent } from './session.ts';
import {
  actionOf,
  completionFor,
  detectTrigger,
  isDay,
  matchingCommands,
  queryOf,
  today,
  type Open,
} from './autocomplete.ts';
import {
  renderAudioBlock,
  renderRecorder,
  type AudioBlockHandlers,
} from './audio-block.ts';
import { audioUrl, voice, type Recording } from './voice.ts';
import { type NavigationGesture } from './trace.ts';
import {
  resolveArrow,
  resolveBackspaceAtStart,
  resolveDelimiter,
  resolveEnter,
  resolveTab,
  type KeyOutcome,
  type Neighbourhood,
} from './keys.ts';

export interface OutlinerCallbacks {
  onNavigate(title: string): void;
  /**
   * Abrir otra página, diciendo por qué gesto.
   *
   * El gesto lo nombra quien lo recibió —este módulo, que sabe si se pulsó un
   * backlink o un resultado de búsqueda— y no quien navega, que ya no puede
   * saberlo. @invariant TheGestureIsObservedAndNeverInferred.
   */
  onOpen(page: string, gesture: NavigationGesture): void;
  onChanged(): void;
  /** Seguir una referencia hasta el bloque que nombra. */
  onOpenBlock?(page: string, block: string): void;
  /**
   * Vuelve a traer la página y sigue editando donde diga el foco.
   *
   * Un cambio estructural mueve bloques que ya estaban dibujados, así que la
   * vista se rehace desde el grafo en vez de intentar parchearla: el grafo es
   * quien sabe cómo quedó el árbol.
   */
  onReload(focus: { block: string; at: number } | null): void;
  /** Reenraizar la vista en un bloque; sin bloque, volver a la página entera. */
  onFocusBlock?(block: string | null): void;
  /**
   * Hablar en este punto de la escritura, tras `/audio`.
   *
   * `rest` es lo que quedaba escrito en el bloque. Si hay algo, la grabación
   * necesita un bloque nuevo debajo: uno que ya tiene texto no puede guardarle el
   * lugar sin que la transcripción caiga encima de lo escrito.
   */
  onSpeak?(block: string, rest: string): Promise<void>;
}

/**
 * El bloque donde hay que empezar a grabar en cuanto se dibuje.
 *
 * `/audio` ocurre en un editor que el redibujado se lleva por delante, así que
 * la intención sobrevive aquí hasta que el bloque exista en la página. Se
 * consume al usarla: volver a dibujar no vuelve a grabar.
 */
let speakingIn: string | null = null;

/** Deja dicho que en este bloque se va a hablar. */
export function speakInto(block: string): void {
  speakingIn = block;
}

/**
 * El menú de un bloque. Sólo puede haber uno abierto: el segundo clic en otro
 * bullet cierra el primero, y un clic en cualquier otro sitio los cierra todos.
 */
let openMenu: HTMLElement | null = null;

function closeMenu(): void {
  openMenu?.remove();
  openMenu = null;
}

let dismissalBound = false;

/**
 * Los oyentes que cierran el menú se registran al abrir el primero, no al
 * importar el módulo. Importar no debe hacer nada: con estas dos líneas en el
 * cuerpo del archivo, cargar el outliner fuera de un navegador —como hacen sus
 * propias pruebas— fallaba antes de llegar a ninguna función.
 */
function bindDismissal(): void {
  if (dismissalBound) return;
  dismissalBound = true;

  document.addEventListener('click', (event) => {
    if (openMenu === null) return;
    const target = event.target as HTMLElement;
    if (!openMenu.contains(target) && !target.classList.contains('bullet')) closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
}

interface MenuAction {
  label: string;
  /** Por qué no se puede, cuando no se puede. La acción se muestra igual. */
  blocked?: string;
  run(): void | Promise<void>;
}

function openBlockMenu(anchor: HTMLElement, actions: MenuAction[]): void {
  bindDismissal();
  closeMenu();

  const menu = document.createElement('div');
  menu.className = 'block-menu';
  menu.setAttribute('role', 'menu');

  for (const action of actions) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'block-menu-item';
    item.textContent = action.label;
    item.setAttribute('role', 'menuitem');
    if (action.blocked !== undefined) {
      item.disabled = true;
      item.title = action.blocked;
    }
    item.addEventListener('click', () => {
      closeMenu();
      void action.run();
    });
    menu.append(item);
  }

  /*
   * Un desplegable cabe en la ventana o no sirve.
   *
   * Se dibujaba siempre hacia abajo y hacia la derecha desde su ancla, así que
   * el de un control pegado al borde derecho —el menú de la página, sin ir más
   * lejos— salía de la pantalla y sus opciones quedaban inalcanzables. Hay que
   * medirlo antes de colocarlo, y para medirlo hay que haberlo puesto en el
   * documento: va invisible primero y se sitúa después.
   */
  menu.style.visibility = 'hidden';
  document.body.append(menu);

  const at = anchor.getBoundingClientRect();
  const box = menu.getBoundingClientRect();
  const margin = 8;

  // Se alinea por la izquierda del ancla; si no cabe, por su derecha; y si
  // tampoco, se pega al borde. Nunca se sale.
  let left = at.left;
  if (left + box.width > window.innerWidth - margin) left = at.right - box.width;
  left = Math.max(margin, Math.min(left, window.innerWidth - box.width - margin));

  // Abajo del ancla, salvo que no quepa: entonces encima, que es donde queda el
  // hueco. Un menú que se sale por abajo es igual de inservible.
  let top = at.bottom + 4;
  if (top + box.height > window.innerHeight - margin && at.top - box.height - 4 > margin) {
    top = at.top - box.height - 4;
  }
  top = Math.max(margin, Math.min(top, window.innerHeight - box.height - margin));

  menu.style.left = `${Math.round(left + window.scrollX)}px`;
  menu.style.top = `${Math.round(top + window.scrollY)}px`;
  menu.style.visibility = '';

  openMenu = menu;
  menu.querySelector('button')?.focus();
}

let toastTimer: number | undefined;

/** Un aviso breve. Nunca lleva marcado: el corpus no dicta la interfaz. */
function toast(message: string): void {
  let element = document.querySelector<HTMLElement>('.toast');
  if (element === null) {
    element = document.createElement('div');
    element.className = 'toast';
    element.setAttribute('role', 'status');
    document.body.append(element);
  }
  element.textContent = message;
  element.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (element !== null) element.hidden = true;
  }, 3000);
}

/**
 * Copiar al portapapeles exige contexto seguro. En `localhost` y bajo el HTTPS
 * de Tailscale lo hay; si algún día no, se dice en vez de fallar en silencio y
 * dejar al participante creyendo que copió.
 */
async function copyText(text: string, notify: (message: string) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    notify(`copiado: ${text.length > 40 ? `${text.slice(0, 40)}…` : text}`);
  } catch {
    notify(`no se pudo copiar. El texto es: ${text}`);
  }
}

/**
 * Los binarios del corpus ya viven dentro de Vera, pero una referencia puede
 * seguir sin resolver: el corpus nombra archivos que no están en `assets/`, y
 * una imagen remota depende de un servidor ajeno.
 *
 * Cuando eso pasa se declara lo que es —una fuente que falta, con su ruta a la
 * vista— en vez de dejar el icono roto del navegador, que no dice si el error
 * es del archivo, de la ruta o de Vera.
 */
function markMissingImages(root: HTMLElement): void {
  for (const image of root.querySelectorAll('img')) {
    image.addEventListener(
      'error',
      () => {
        const missing = document.createElement('span');
        missing.className = 'media-missing';
        const label = image.getAttribute('alt');
        missing.textContent =
          label === null || label === '' ? image.getAttribute('src') ?? 'imagen' : label;
        missing.title = `no se pudo cargar: ${image.getAttribute('src') ?? ''}`;
        image.replaceWith(missing);
      },
      { once: true },
    );
  }
}

/**
 * Elimina un bloque del grafo.
 *
 * @invariant DiscardingIsAnOrdinaryChange: sale la misma operación
 * `remove_block` que enviaría cualquier participante, con la misma procedencia
 * y el mismo orden. La interfaz no tiene un camino más corto hasta el grafo.
 */
async function removeBlock(
  block: BlockView,
  row: HTMLElement,
  callbacks: OutlinerCallbacks,
): Promise<void> {
  let result;
  try {
    result = await api.submit({ kind: 'remove_block', block: block.stableId });
  } catch {
    toast('no se pudo eliminar: sin conexión con el servidor');
    return;
  }

  if (result.status === 'rejected') {
    // El dominio manda. Si dice que no, se dice por qué y no se toca la vista.
    toast(`rechazado: ${result.reason}`);
    return;
  }

  /*
   * Se vuelve a dibujar la página, no se recorta la fila.
   *
   * Quitaba el `<div>` del DOM y ya. Con eso basta mientras quede algo, pero si
   * el bloque era el último la página quedaba literalmente muerta: una lista
   * vacía, sin nada donde pulsar, sin forma de volver a escribir. El sitio donde
   * una página vacía ofrece dónde empezar vive dentro del dibujo, y recortando a
   * mano no se pasaba nunca por ahí — recargar la página lo arreglaba, que es
   * tanto como no tener arreglo.
   *
   * Redibujar cuesta una petición y hace que borrar termine en el mismo estado
   * al que se llega abriendo la página. Un atajo que produce un estado que el
   * dibujo no sabe producir es un atajo que va a divergir.
   */
  row.remove();
  callbacks.onReload(null);
  callbacks.onChanged();
}

/**
 * Pliega o despliega un bloque.
 *
 * @invariant FoldingIsNotAChange: no pasa por `submit`. No genera operación, no
 * aparece en ninguna revisión, y el registro no se entera. Es lo que esta
 * persona está mirando, no lo que dice el grafo.
 */
async function toggleFold(
  block: string,
  folded: boolean,
  callbacks: OutlinerCallbacks,
): Promise<void> {
  try {
    await api.fold(block, folded);
  } catch {
    toast('no se pudo plegar: sin conexión con el servidor');
    return;
  }
  callbacks.onReload(null);
}

/**
 * Sube o baja un bloque intercambiándolo con su hermano.
 *
 * @invariant SubtreesTravelWithTheirRoot: `move_block` arrastra el subárbol, así
 * que basta con pedir el índice del hermano. Un bloque que adelantara a sus
 * propios hijos los dejaría describiendo algo que ya no está encima.
 */
async function moveBlock(
  block: BlockView,
  page: string,
  near: Neighbourhood,
  up: boolean,
  callbacks: OutlinerCallbacks,
): Promise<void> {
  const target = up ? near.index - 1 : near.index + 1;
  if (target < 0) {
    toast('el bloque ya es el primero de su nivel');
    return;
  }

  let result;
  try {
    result = await api.submit({
      kind: 'move_block',
      block: block.stableId,
      page,
      parent: near.parent,
      position: target,
    });
  } catch {
    toast('no se pudo mover: sin conexión con el servidor');
    return;
  }

  if (result.status === 'rejected') {
    toast(`rechazado: ${result.reason}`);
    return;
  }
  callbacks.onReload({ block: block.stableId, at: 0 });
}

/**
 * Edita un texto donde está, sin abrir nada aparte.
 *
 * Sirve para el título y para las propiedades: son campos de una línea, y un
 * editor de bloque completo sería desproporcionado. `commit` devuelve si el
 * cambio se aplicó; si no, el texto vuelve a lo que era y no se pierde nada.
 */
/** Cuántas respuestas se ofrecen sin que el menú deje de leerse de un vistazo. */
const OFFERED_AT_MOST = 12;

/** Qué parte del uso tienen que concentrar para que la pregunta sea cerrada. */
const CLOSED_QUESTION_SHARE = 0.6;

/**
 * Si una propiedad se contesta eligiendo o escribiendo.
 *
 * Provisional, y a la vista de que lo es: lo correcto es que la ontología
 * declare el dominio de cada propiedad, y eso todavía no existe en el almacén.
 * Mientras tanto se infiere de lo que el corpus ya dice, que es la misma
 * evidencia desde la que rule ProposePropertyDomainFromUsage lo propondrá.
 *
 * Lo que decide no es cuántos valores hay sino si unos pocos concentran el uso.
 * Contar valores distintos parece lo natural y se equivoca justo donde importa:
 * `type` toma treinta y ocho valores en este corpus y aun así es una pregunta
 * cerrada, porque doce de ellos cubren el 94% y el resto es cola —erratas,
 * sinónimos, cosas dichas una vez—. `tags`, con quinientos sesenta y cinco, no
 * concentra nada: sus doce más usados cubren el 7%, y eso no es un vocabulario
 * sino texto.
 *
 * La cola, además, no es ruido que ocultar: es exactamente lo que la ronda del
 * bibliotecario tiene que traer. «`bibliography` aparece una vez y `bibliografia`
 * treinta» es una decisión que alguien puede tomar.
 */
function isChoosable(offered: { value: string; uses: number }[]): boolean {
  if (offered.length < 2) return false;
  const total = offered.reduce((sum, option) => sum + option.uses, 0);
  if (total === 0) return false;
  const head = offered.slice(0, OFFERED_AT_MOST).reduce((sum, option) => sum + option.uses, 0);
  return head / total >= CLOSED_QUESTION_SHARE;
}

/**
 * Elegir un día en el calendario.
 *
 * Usa el selector del propio navegador y no uno dibujado aquí. Un calendario es
 * de las pocas cosas que todo sistema ya resuelve bien y en el idioma y con la
 * semana que quien mira espera —lunes o domingo primero, según dónde viva—, y
 * reimplementarlo sería reimplementar eso también, peor.
 *
 * Se descarta al perder el foco y no deja rastro: mientras no se elija un día,
 * no ha pasado nada.
 */
function pickDate(anchor: HTMLElement, onPick: (date: string) => void): void {
  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'date-picker';
  input.value = today();

  const rect = anchor.getBoundingClientRect();
  input.style.left = `${Math.round(rect.left + window.scrollX)}px`;
  input.style.top = `${Math.round(rect.bottom + window.scrollY)}px`;

  const dismiss = (): void => input.remove();
  input.addEventListener('change', () => {
    const chosen = input.value;
    dismiss();
    if (chosen !== '') onPick(chosen);
  });
  input.addEventListener('blur', dismiss);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      dismiss();
      anchor.focus();
    }
  });

  document.body.append(input);
  input.focus();
  // Abrir el calendario sin obligar a pulsar el iconito. No todos los
  // navegadores lo permiten, y donde no, el campo sigue sirviendo.
  try {
    (input as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
  } catch {
    // El navegador exige un gesto suyo para abrirlo. El campo ya está enfocado.
  }
}

function editInPlace(
  host: HTMLElement,
  original: string,
  label: string,
  commit: (next: string) => Promise<boolean>,
): void {
  if (host.querySelector('input') !== null) return;

  const field = document.createElement('input');
  field.type = 'text';
  field.className = 'inline-edit';
  field.value = original;
  field.setAttribute('aria-label', label);

  const held = host.innerHTML;
  host.innerHTML = '';
  host.append(field);
  field.focus();
  field.select();

  let settled = false;
  const finish = (accept: boolean): void => {
    if (settled) return;
    settled = true;
    const next = field.value;
    if (!accept || next === original) {
      host.innerHTML = held;
      return;
    }
    void commit(next).then((applied) => {
      // Aplicar recarga la página entera, así que sólo hay que restituir esto
      // cuando el cambio no llegó a ocurrir.
      if (!applied) host.innerHTML = held;
    });
  };

  field.addEventListener('blur', () => finish(true));
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    }
    // Aquí Escape sí descarta: nada se ha guardado todavía, porque un campo de
    // una línea no tiene guardado al reposar.
    if (event.key === 'Escape') {
      event.preventDefault();
      settled = true;
      host.innerHTML = held;
    }
  });
}

/** Envía un cambio sin recargar. Devuelve si se aplicó. */
async function submitQuietly(change: Change): Promise<boolean> {
  let result;
  try {
    result = await api.submit(change);
  } catch {
    toast('sin conexión con el servidor');
    return false;
  }
  if (result.status === 'rejected') {
    toast(`rechazado: ${result.reason}`);
    return false;
  }
  return true;
}

/** Envía un cambio y rehace la página desde el grafo. */
async function submitAndReload(change: Change, callbacks: OutlinerCallbacks): Promise<boolean> {
  const applied = await submitQuietly(change);
  if (applied) callbacks.onReload(null);
  return applied;
}

/**
 * Crea una página y la abre.
 *
 * Nace privada y sin bloques: `create_page` es la operación, y el primer bloque
 * lo escribe quien la abra. Ponerle contenido de plantilla sería inventar texto
 * que nadie escribió, y en un corpus con procedencia eso no es inocuo.
 */
async function createPage(callbacks: OutlinerCallbacks): Promise<void> {
  const title = window.prompt('Título de la página nueva');
  if (title === null || title.trim() === '') return;

  let result;
  try {
    result = await api.submit({ kind: 'create_page', title: title.trim(), visibility: 'private' });
  } catch {
    toast('no se pudo crear: sin conexión con el servidor');
    return;
  }

  if (result.status === 'rejected') {
    // El dominio exige título único dentro del grafo, y lo dice él.
    toast(`rechazado: ${result.reason}`);
    return;
  }
  // Una página recién creada desde el buscador de la barra: se llegó a por
  // ella, no siguiendo nada de lo que se estaba leyendo.
  callbacks.onOpen(result.subjectId, 'searched');
}

/** El Markdown de la página, pedido al servidor para que sea el mismo que git recibiría. */
async function pageMarkdown(page: string): Promise<string | null> {
  try {
    const response = await fetch(`/pages/${encodeURIComponent(page)}/markdown`);
    if (!response.ok) throw new Error(String(response.status));
    return await response.text();
  } catch {
    toast('no se pudo traer el Markdown de la página');
    return null;
  }
}

/** Lo que procesar devolvió. Proposiciones, ninguna decisión. */
interface PageReading {
  links: {
    url: string;
    title: string | null;
    kind: string | null;
    unreachable: string | null;
    /** El bloque que lleva esta dirección, para poder arreglarla donde está. */
    block: string | null;
    /** Y lo que ese bloque dice ahora, que es sobre lo que se propone el cambio. */
    content: string | null;
  }[];
  types: string[];
  concepts: string[];
  notDone: string[];
}

/**
 * Un cambio propuesto, con su decisión.
 *
 * Nace aprobado. La decisión que Vera protege es la de *aplicar* —que es un acto
 * aparte, explícito y con su propio botón— y no la de cada renglón: obligar a
 * marcar veinte casillas para aceptar veinte títulos de enlace que ya se están
 * leyendo convierte en trabajo lo que era una revisión. Lo que hace falta es
 * poder decir que no a los que sobren, y eso es «ignorar».
 */
interface Suggestion {
  /** Qué se lee en el renglón. */
  what: string;
  /** El detalle, en gris: de dónde sale o en qué se convierte. */
  detail: string;
  change: Change;
  approved: boolean;
}

/** Las claves con que se guarda lo que el bibliotecario propone. */
const TYPE_KEY = 'type';
const CONCEPT_KEY = 'concepto';

/**
 * Procesa la página, cuenta lo que va haciendo, y propone cambios.
 *
 * @invariant ProcessingProposesAndNothingMore: nada se escribe aquí. Lo que
 * aparece son proposiciones, y hasta que alguien pulsa «aplicar» la página está
 * exactamente como estaba. Cerrar el panel la deja igual.
 */
async function processPage(
  page: { id: string; title: string; properties?: { key: string; value: string }[] },
  notify: (message: string) => void,
  callbacks?: OutlinerCallbacks,
): Promise<void> {
  const panel = document.querySelector<HTMLElement>('#tokens');
  if (panel === null) return;
  panel.hidden = false;
  panel.innerHTML = '';

  const head = document.createElement('header');
  head.className = 'settings-head';
  const title = document.createElement('h2');
  title.textContent = `Procesando «${page.title}»`;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'settings-close';
  close.setAttribute('aria-label', 'Cerrar');
  close.title = 'Cerrar';
  close.innerHTML = icon('x');
  const shut = (): void => {
    panel.hidden = true;
    panel.innerHTML = '';
  };
  close.addEventListener('click', shut);
  head.append(title, close);
  panel.append(head);

  const body = document.createElement('div');
  body.className = 'settings-body';
  panel.append(body);

  /*
   * La bitácora de lo que está pasando.
   *
   * Se escribe según ocurre y se queda cuando termina. Lo que cuenta no es que
   * algo avanza —para eso basta una animación, y una animación miente cuando el
   * proceso se cuelga— sino qué está haciendo: qué dirección consulta ahora,
   * cuál no contestó, si el modelo local está. Cuando algo sale mal, esta lista
   * es la única explicación que va a haber.
   */
  const log = document.createElement('ol');
  log.className = 'process-log';
  body.append(log);

  const step = (text: string, kind: 'doing' | 'ok' | 'bad' = 'doing'): HTMLElement => {
    const line = document.createElement('li');
    line.className = `process-step ${kind}`;
    line.textContent = text;
    log.append(line);
    line.scrollIntoView({ block: 'nearest' });
    return line;
  };

  let reading: PageReading | null = null;

  try {
    const answer = await fetch(`/pages/${encodeURIComponent(page.id)}/process`, { method: 'POST' });
    if (!answer.ok || answer.body === null) {
      step('no se pudo procesar la página', 'bad');
      return;
    }

    // NDJSON: una línea por hecho. Se lee según llega, que es lo que permite
    // contarlo mientras pasa en vez de al final.
    const decoder = new TextDecoder();
    const stream = answer.body.getReader();
    let rest = '';

    for (;;) {
      const { value, done } = await stream.read();
      if (done) break;
      rest += decoder.decode(value, { stream: true });
      const lines = rest.split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim() === '') continue;
        const event = JSON.parse(line) as Record<string, unknown>;
        switch (event['step']) {
          case 'reading':
            step(`leídos ${String(event['blocks'])} bloques · ${String(event['chars'])} caracteres`, 'ok');
            break;
          case 'model':
            if (event['state'] === 'asking') step('preguntando al modelo local qué es y de qué trata…');
            else if (event['state'] === 'failed') step(String(event['why']), 'bad');
            else step('el modelo contestó', 'ok');
            break;
          case 'link': {
            const url = String(event['url']);
            const where = `${String(event['done'])}/${String(event['total'])}`;
            if (event['unreachable'] !== null) step(`${where} · no contestó · ${url}`, 'bad');
            else step(`${where} · ${String(event['title'] ?? event['kind'] ?? 'sin título')} · ${url}`, 'ok');
            break;
          }
          case 'done':
            reading = event as unknown as PageReading;
            step('terminado', 'ok');
            break;
          default:
            break;
        }
      }
    }
  } catch {
    step('se perdió la conexión con el servidor a mitad', 'bad');
    return;
  }

  if (reading === null) {
    step('el servidor no llegó a decir qué encontró', 'bad');
    return;
  }

  for (const line of reading.notDone) step(line, 'bad');

  /*
   * De la lectura a las proposiciones.
   *
   * No se propone lo que la página ya dice: repetir una propiedad que ya está
   * no es un cambio, y ofrecerlo obligaría a descartarlo una vez por proceso.
   */
  const already = new Set((page.properties ?? []).map((p) => `${p.key}=${p.value}`));
  const suggestions: Suggestion[] = [];

  for (const value of reading.types) {
    if (already.has(`${TYPE_KEY}=${value}`)) continue;
    suggestions.push({
      what: `qué es: ${value}`,
      detail: `${TYPE_KEY}:: ${value}`,
      change: { kind: 'set_property', page: page.id, propertyKey: TYPE_KEY, propertyValue: value },
      approved: true,
    });
  }

  for (const value of reading.concepts) {
    if (already.has(`${CONCEPT_KEY}=${value}`)) continue;
    suggestions.push({
      what: `de qué trata: ${value}`,
      detail: `${CONCEPT_KEY}:: ${value}`,
      change: { kind: 'set_property', page: page.id, propertyKey: CONCEPT_KEY, propertyValue: value },
      approved: true,
    });
  }

  // Una dirección desnuda pasa a llevar su título. La dirección no se toca:
  // @guarantee ALinkResolvedKeepsItsAddress — se envuelve, no se sustituye.
  for (const link of reading.links) {
    if (link.title === null || link.block === null || link.content === null) continue;
    // Ya tiene título: envolver otra vez lo rompería.
    if (link.content.includes(`](${link.url})`)) continue;
    const next = link.content.split(link.url).join(`[${link.title}](${link.url})`);
    if (next === link.content) continue;
    suggestions.push({
      what: `titular el enlace: ${link.title}`,
      detail: link.url,
      change: { kind: 'edit_block', block: link.block, content: next },
      approved: true,
    });
  }

  if (suggestions.length === 0) {
    const none = document.createElement('p');
    none.className = 'settings-note';
    none.textContent = 'Nada que proponer: lo que se leyó ya está en la página.';
    body.append(none);
    return;
  }

  const heading = document.createElement('h3');
  heading.className = 'settings-group';
  heading.textContent = `Sugerencias (${suggestions.length})`;
  body.append(heading);

  const list = document.createElement('div');
  list.className = 'suggestions';
  body.append(list);

  for (const suggestion of suggestions) {
    const row = document.createElement('div');
    row.className = 'suggestion';

    const text = document.createElement('div');
    text.className = 'suggestion-text';
    const what = document.createElement('span');
    what.className = 'suggestion-what';
    what.textContent = suggestion.what;
    const detail = document.createElement('span');
    detail.className = 'suggestion-detail';
    detail.textContent = suggestion.detail;
    text.append(what, detail);

    const decide = document.createElement('button');
    decide.type = 'button';
    decide.className = 'suggestion-decide';

    const draw = (): void => {
      row.classList.toggle('ignored', !suggestion.approved);
      decide.textContent = suggestion.approved ? 'ignorar' : 'aprobar';
      decide.setAttribute('aria-pressed', String(!suggestion.approved));
      decide.title = suggestion.approved
        ? 'Dejar esta fuera de lo que se aplique'
        : 'Volver a incluirla';
    };
    decide.addEventListener('click', () => {
      suggestion.approved = !suggestion.approved;
      draw();
      count();
    });
    draw();

    row.append(text, decide);
    list.append(row);
  }

  /*
   * Aplicar y cancelar, a la izquierda y como texto.
   *
   * No son botones porque no compiten: aplicar es la consecuencia de lo que
   * acaba de decidirse renglón a renglón, y dibujarlo como un botón grande lo
   * convertiría en la acción principal de un panel cuya acción principal es
   * leer. A la izquierda porque es donde termina la lectura de cada renglón.
   */
  const foot = document.createElement('div');
  foot.className = 'suggestions-foot';

  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'suggestion-apply';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'suggestion-cancel';
  cancel.textContent = 'cancelar';
  cancel.addEventListener('click', shut);

  const count = (): void => {
    const n = suggestions.filter((s) => s.approved).length;
    apply.textContent = n === 0 ? 'aplicar' : `aplicar ${n}`;
    apply.disabled = n === 0;
  };
  count();

  apply.addEventListener('click', () => {
    void (async () => {
      apply.disabled = true;
      cancel.disabled = true;
      const chosen = suggestions.filter((s) => s.approved);
      step(`aplicando ${chosen.length} cambios…`);

      /*
       * Las propiedades se juntan por clave antes de escribirse.
       *
       * `set_property` guarda un valor por clave, así que mandar tres conceptos
       * como tres cambios escribía tres veces la misma clave y sólo sobrevivía
       * el último: aprobar tres y quedarse con uno, sin que nada lo dijera. Un
       * aplicar que descarta en silencio lo que alguien acaba de decidir es peor
       * que no aplicar.
       *
       * Y los valores son componibles —una página puede ser varias cosas y
       * tratar de varias— así que lo correcto no era elegir uno sino escribirlos
       * juntos, separados por comas, que es como el corpus ya lo escribe.
       *
       * Se conserva lo que la página ya decía. Procesar propone; no reemplaza lo
       * que había, que lo escribió alguien y no está en discusión.
       */
      const held = new Map<string, string[]>();
      for (const property of page.properties ?? []) {
        held.set(
          property.key,
          property.value.split(',').map((value) => value.trim()).filter((value) => value !== ''),
        );
      }

      const byKey = new Map<string, string[]>();
      const others: Suggestion[] = [];
      for (const suggestion of chosen) {
        if (suggestion.change.kind !== 'set_property') {
          others.push(suggestion);
          continue;
        }
        const key = suggestion.change.propertyKey;
        const values = byKey.get(key) ?? [...(held.get(key) ?? [])];
        if (!values.includes(suggestion.change.propertyValue)) {
          values.push(suggestion.change.propertyValue);
        }
        byKey.set(key, values);
      }

      let written = 0;
      let asked = 0;

      for (const [key, values] of byKey) {
        asked += 1;
        const result = await api.submit({
          kind: 'set_property',
          page: page.id,
          propertyKey: key,
          propertyValue: values.join(', '),
        });
        if (result.status === 'rejected') {
          step(`rechazado: ${result.reason} · ${key}`, 'bad');
          continue;
        }
        written += 1;
        step(`${key}:: ${values.join(', ')}`, 'ok');
      }

      for (const suggestion of others) {
        asked += 1;
        const result = await api.submit(suggestion.change);
        if (result.status === 'rejected') {
          step(`rechazado: ${result.reason} · ${suggestion.what}`, 'bad');
          continue;
        }
        written += 1;
        step(suggestion.what, 'ok');
      }

      // Aplicado deja de ser sugerencia: la lista se retira entera. Lo que se
      // aplicó está ahora en la página, que es donde se lee.
      list.remove();
      heading.remove();
      foot.remove();
      // Se cuentan escrituras, no sugerencias: varias propuestas de la misma
      // clave se escriben en un solo cambio, y decir «3 de 5» sería mentir sobre
      // lo que se hizo.
      step(`aplicados ${written} de ${asked} cambios`, written === asked ? 'ok' : 'bad');
      notify(`aplicados ${written} cambios en «${page.title}»`);
      callbacks?.onReload(null);
    })();
  });

  foot.append(apply, cancel);
  body.append(foot);
}

async function copyPageMarkdown(page: string): Promise<void> {
  const text = await pageMarkdown(page);
  if (text === null) return;
  try {
    await navigator.clipboard.writeText(text);
    toast(`copiado: ${text.length} caracteres`);
  } catch {
    toast('no se pudo copiar; el portapapeles exige contexto seguro');
  }
}

async function downloadPage(page: { id: string; title: string }): Promise<void> {
  const text = await pageMarkdown(page.id);
  if (text === null) return;

  // El nombre del archivo lleva el título, no el identificador: lo exportado se
  // abre fuera de Vera y ahí `page:31015` no le dice nada a nadie. Los caracteres
  // que un sistema de archivos no admite se sustituyen, como hace Logseq.
  const name = `${page.title.replace(/[/\\?%*:|"<>]/g, '_').trim() || page.id}.md`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  toast(`exportado ${name}`);
}

export interface Node {
  block: BlockView;
  children: Node[];
}

/** Busca un nodo por su identidad en cualquier profundidad del árbol. */
function findNode(nodes: Node[], id: string): Node | null {
  for (const node of nodes) {
    if (node.block.stableId === id) return node;
    const found = findNode(node.children, id);
    if (found !== null) return found;
  }
  return null;
}

export function buildTree(blocks: BlockView[]): Node[] {
  const nodes = new Map<string, Node>();
  for (const block of blocks) nodes.set(block.stableId, { block, children: [] });

  const roots: Node[] = [];
  for (const block of blocks) {
    const node = nodes.get(block.stableId);
    if (node === undefined) continue;
    const parent = block.parent === null ? undefined : nodes.get(block.parent);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }

  const sort = (list: Node[]): void => {
    list.sort((a, b) => a.block.position - b.block.position);
    for (const node of list) sort(node.children);
  };
  sort(roots);
  return roots;
}

/**
 * Traduce las rutas del corpus a los objetos que Vera guarda.
 *
 * La página trae ya resueltas las suyas, así que no hay una petición por
 * imagen ni el cliente tiene que saber cómo se direcciona el almacén.
 */
export function assetResolver(page: PageView): RenderOptions['resolveAsset'] {
  if (page.assets.length === 0) return undefined;
  const byPath = new Map(page.assets.map((asset) => [asset.path, asset]));
  return (path) => {
    const found = byPath.get(path);
    if (found !== undefined) return { url: found.url, mediaType: found.mediaType };
    // El corpus escribe algunas rutas con caracteres codificados y otras no.
    try {
      const decoded = byPath.get(decodeURIComponent(path));
      return decoded === undefined ? null : { url: decoded.url, mediaType: decoded.mediaType };
    } catch {
      return null;
    }
  };
}

/** @invariant ReferenceResolvesToItsBlock: la página trae ya resuelto a quién nombra. */
export function blockResolver(page: PageView): RenderOptions['resolveBlock'] {
  if (page.blockRefs.length === 0) return undefined;
  const byId = new Map(page.blockRefs.map((ref) => [ref.id, ref]));
  return (stableId) => {
    const found = byId.get(stableId);
    return found === undefined ? null : { page: found.page, excerpt: found.excerpt };
  };
}

export function renderOutliner(
  container: HTMLElement,
  page: PageView,
  callbacks: OutlinerCallbacks,
  focus: { block: string; at: number } | null = null,
  focusRoot: string | null = null,
): void {
  container.innerHTML = '';
  /** Dónde quedó dibujado cada bloque, para poder devolverle el cursor. */
  const editors = new Map<string, { node: Node; body: HTMLElement }>();
  const folded = new Set(page.folded);
  // @invariant SpokenContentNamesItsRecording: un bloque hablado lo dice.
  const spoken = new Map((page.spokenOrigins ?? []).map((o) => [o.block, o.recording]));
  // Lo hablado que tiene lugar en esta página, por el bloque que se lo guarda.
  const held = new Map(
    (page.recordings ?? [])
      .filter((r): r is Recording & { placedInBlock: string } => r.placedInBlock !== null)
      .map((r) => [r.placedInBlock, r]),
  );
  // @invariant GeneratedContentIsAlwaysDistinguishable.
  //
  // Sólo se marca lo generado, no todo. El corpus es casi entero de Herbert, y
  // atribuir cada bloque a su autor lo convertiría en un muro de firmas donde
  // lo excepcional dejaría de verse. Lo que hay que poder distinguir de un
  // vistazo es lo que no escribió él.
  const hands = page.authorship ?? {};
  const audioHandlers: AudioBlockHandlers = {
    onSettled: () => callbacks.onReload(null),
    notify: toast,
    // Un eslabón que avanza sin mover el árbol no necesita rehacer la página.
    onChanged: () => undefined,
  };
  const options: RenderOptions = {};
  const asset = assetResolver(page);
  if (asset !== undefined) options.resolveAsset = asset;
  const block = blockResolver(page);
  if (block !== undefined) options.resolveBlock = block;
  const pending = new Set(page.pendingLinks ?? []);
  if (pending.size > 0) options.pageExists = (title) => !pending.has(title);

  const header = document.createElement('header');
  header.className = 'page-header';

  const day = isDay(page.title);

  /*
   * El título es contenido y se edita como contenido — salvo el de un día.
   *
   * @invariant ADayIsNamedByItsDate: el título de un día no es una etiqueta
   * puesta sobre él, es su identidad. Renombrarlo movería un testimonio a una
   * fecha en la que no ocurrió, y lo escrito el martes pasaría a decir que pasó
   * el jueves. Aquí se podía: el campo se abría igual que en cualquier otra
   * página, y el dominio habría aceptado el `rename_page` sin saber que estaba
   * mintiendo sobre cuándo pasaron las cosas.
   */
  const title = document.createElement('h1');
  title.className = day ? 'page-title day' : 'page-title';
  title.textContent = page.title;
  if (!day) {
    title.tabIndex = 0;
    title.title = 'renombrar la página';
    title.addEventListener('click', () => {
      editInPlace(title, page.title, 'el título de la página', async (next) => {
        if (next.trim() === '' || next === page.title) return true;
        return submitAndReload(
          { kind: 'rename_page', page: page.id, title: next.trim() },
          callbacks,
        );
      });
    });
  }
  header.append(title);

  // El front matter no es decoración: son propiedades del grafo, y se editan.
  const properties = document.createElement('dl');
  properties.className = 'properties';

  /*
   * Público o privado, entre las demás propiedades y no en un botón aparte.
   *
   * Era una marca al pie que decía «privada» mientras el front matter, dos
   * centímetros más arriba, decía `public:: false`. Dos sitios diciendo lo mismo
   * con palabras distintas, y ninguna forma de saber cuál mandaba — la respuesta
   * era ésta, y no se veía.
   *
   * Ahora es una fila más, y la única que además gobierna: lo que se lee aquí es
   * el estado de verdad, el que decide si la página se proyecta al sitio
   * personal. La propiedad de texto que traía el corpus importado no se dibuja
   * al lado, porque duplicarla es el problema que esto resuelve.
   *
   * Se ve distinta de las demás a propósito. Una propiedad de texto se edita
   * escribiendo; ésta se contesta con un interruptor porque su dominio no está
   * por decidir: es sí o no, y siempre lo fue. Ver el contrato PageFrontMatter
   * en workspace-interface.allium.
   */
  const publica = page.visibility === 'public';

  const visibilityKey = document.createElement('dt');
  visibilityKey.className = 'property-key';
  visibilityKey.textContent = 'public';

  const visibilityValue = document.createElement('dd');
  visibilityValue.className = 'property-value governed';

  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = `visibility ${page.visibility}`;
  badge.textContent = publica ? 'pública' : 'privada';
  badge.setAttribute('role', 'switch');
  badge.setAttribute('aria-checked', String(publica));
  badge.title = publica
    ? 'Pública: se proyecta al sitio personal. Pulsa para hacerla privada.'
    : 'Privada: no sale de aquí. Pulsa para publicarla.';
  badge.addEventListener('click', () => {
    void submitAndReload(
      {
        kind: 'set_page_visibility',
        page: page.id,
        visibility: publica ? 'private' : 'public',
      },
      callbacks,
    );
  });
  visibilityValue.append(badge);
  // En un día tampoco va el interruptor: publicar una jornada entera no es un
  // gesto que se ofrezca de paso, y repetido sobre cada fecha de la lectura
  // continua sería la fila más ruidosa de todas.
  if (!day) properties.append(visibilityKey, visibilityValue);

  // La `public::` heredada de Logseq no se dibuja: la fila de arriba dice lo
  // mismo y además manda. Sigue en el corpus hasta que se adopte, y adoptarla
  // es un acto aparte y deliberado — ver rule AdoptImportedVisibilityProperty.
  const written = page.properties.filter((property) => property.key !== 'public');

  for (const property of written) {
    const key = document.createElement('dt');
    key.className = 'property-key';
    key.textContent = property.key;
    key.tabIndex = 0;
    key.title = 'renombrar la propiedad';
    key.addEventListener('click', () => {
      editInPlace(key, property.key, 'nombre de la propiedad', async (next) => {
        const name = next.trim();
        if (name === '' || name === property.key) return true;
        // Renombrar es quitar la vieja y poner la nueva: el dominio identifica
        // una propiedad por su clave, así que no hay un cambio que la renombre.
        const removed = await submitQuietly({
          kind: 'remove_property',
          page: page.id,
          propertyKey: property.key,
        });
        if (!removed) return false;
        return submitAndReload(
          { kind: 'set_property', page: page.id, propertyKey: name, propertyValue: property.value },
          callbacks,
        );
      });
    });

    const value = document.createElement('dd');
    value.className = 'property-value';

    const answer = async (next: string): Promise<boolean> => {
      if (next === property.value) return true;
      return submitAndReload(
        { kind: 'set_property', page: page.id, propertyKey: property.key, propertyValue: next },
        callbacks,
      );
    };

    const offered = page.domains?.[property.key] ?? [];

    if (isChoosable(offered)) {
      /*
       * Un valor de vocabulario se contesta eligiendo y se sigue pulsando, y son
       * dos cosas distintas con dos sitios distintos.
       *
       * La palabra lleva a su página —qué es una bitácora, y todas las que hay—,
       * y el chevrón de al lado abre lo que se puede contestar. Compartir
       * destino los enfrentaría: quien sólo quiere saber qué significa
       * «bitácora» tendría que asignarla para averiguarlo. Ver @invariant
       * BothHalvesOfAPropertyAreFollowable.
       */
      const follow = document.createElement('button');
      follow.type = 'button';
      follow.className = 'property-word';
      follow.textContent = property.value;
      follow.title = `ir a ${property.value}`;
      follow.addEventListener('click', (event) => {
        event.stopPropagation();
        callbacks.onNavigate(property.value);
      });

      const choose = document.createElement('button');
      choose.type = 'button';
      choose.className = 'property-choose';
      choose.innerHTML = icon('chevron-down');
      choose.setAttribute('aria-label', `elegir ${property.key}`);
      choose.title = `elegir ${property.key}`;
      choose.addEventListener('click', (event) => {
        event.stopPropagation();
        openBlockMenu(choose, [
          // Los más dichos, y sólo esos. La cola larga de una propiedad son sus
          // erratas; ofrecerlas al mismo nivel que los términos las volvería a
          // sembrar, que es cómo se llegó a tener treinta y ocho tipos.
          ...offered.slice(0, OFFERED_AT_MOST).map((option) => ({
            label: option.value === property.value ? `${option.value} ·` : option.value,
            run: () => void answer(option.value),
          })),
          // Un vocabulario que no crece donde se usa deja de crecer, y con él
          // deja de etiquetarse. Ver @guarantee AVocabularyGrowsAtThePointOfUse.
          { label: 'escribir otro…', run: () => editInPlace(value, property.value, `valor de ${property.key}`, answer) },
        ]);
      });

      value.append(follow, choose);
    } else {
      value.textContent = property.value;
      value.tabIndex = 0;
      value.title = 'editar el valor';
      value.addEventListener('click', () => {
        editInPlace(value, property.value, `valor de ${property.key}`, answer);
      });
    }

    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'property-drop';
    drop.innerHTML = icon('x');
    drop.setAttribute('aria-label', `quitar ${property.key}`);
    drop.title = `quitar ${property.key}`;
    drop.addEventListener('click', (event) => {
      event.stopPropagation();
      void submitAndReload(
        { kind: 'remove_property', page: page.id, propertyKey: property.key },
        callbacks,
      );
    });
    value.append(drop);

    properties.append(key, value);
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'property-add';
  add.textContent = '+ propiedad';
  add.addEventListener('click', () => {
    const key = document.createElement('dt');
    key.className = 'property-key';
    const value = document.createElement('dd');
    value.className = 'property-value';
    value.textContent = '';
    properties.append(key, value);
    editInPlace(key, '', 'nombre de la propiedad nueva', async (next) => {
      const name = next.trim();
      if (name === '') {
        key.remove();
        value.remove();
        return true;
      }
      // Nace con valor vacío; el valor se escribe en el siguiente clic. El
      // dominio acepta una propiedad sin valor, así que no hace falta inventarlo.
      return submitAndReload(
        { kind: 'set_property', page: page.id, propertyKey: name, propertyValue: '' },
        callbacks,
      );
    });
  });

  /*
   * Un día no lleva front matter: lleva su fecha.
   *
   * En una página el front matter dice de qué trata y cómo se publica, y eso hay
   * que poder contestarlo. Un día no trata de nada: es cuándo. Su fecha ya lo
   * dice entero, y `public` y `+ propiedad` repetidos encima de cada jornada son
   * ruido que separa lo escrito el martes de lo escrito el miércoles —
   * justamente lo que la lectura continua junta.
   *
   * Lo que el día traiga escrito sí se dibuja: esconderlo sería esconder algo
   * que alguien puso, y una propiedad de un día es contenido como cualquier
   * otro. Lo que se retira es el aparato para poner más, no lo puesto.
   */
  if (!day) {
    header.append(properties, add);
  } else if (written.length > 0) {
    header.append(properties);
  }

  /*
   * Lo que se puede hacer con la página entera, en un menú.
   *
   * Sacar algo del documento —copiarlo, descargarlo, y mañana un PDF— es una
   * familia que va a crecer, y cada miembro puesto a la vista le quita sitio a
   * lo que la página dice. Lo que queda fuera del menú es `+ propiedad`, que no
   * saca nada sino que escribe, y la marca de visibilidad, que no es una acción
   * sino un estado y por eso se lee de un vistazo.
   */
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'page-more';
  more.setAttribute('aria-label', 'Más de esta página');
  more.setAttribute('aria-haspopup', 'menu');
  more.title = 'Más de esta página';
  more.innerHTML = icon('more-vertical');
  more.addEventListener('click', (event) => {
    event.stopPropagation();
    openBlockMenu(more, [
      {
        // Deliberado y sobre esta página, nunca de oficio: resolver un enlace es
        // preguntarle al servidor que lo tiene, y eso le dice que aquí alguien
        // está leyendo sobre esto.
        label: 'Procesar la página',
        run: () => void processPage(page, toast, callbacks),
      },
      {
        label: 'Copiar el Markdown de la página',
        run: () => void copyPageMarkdown(page.id),
      },
      {
        label: 'Descargar como .md',
        run: () => void downloadPage(page),
      },
    ]);
  });
  header.append(more);

  container.append(header);

  const list = document.createElement('div');
  list.className = 'blocks';
  container.append(list);

  const drawBlock = (node: Node, depth: number): void => {
    const row = document.createElement('div');
    row.className = 'block';
    row.style.paddingLeft = `${depth * 1.25}rem`;
    row.dataset['id'] = node.block.stableId;

    // @invariant OnlyParentsFold: el control sólo aparece donde hay algo que
    // plegar. Ofrecerlo en una hoja prometería algo que no puede pasar.
    const parent = node.children.length > 0;
    const shut = folded.has(node.block.stableId);

    if (parent) {
      const fold = document.createElement('button');
      fold.type = 'button';
      fold.className = shut ? 'fold shut' : 'fold';
      fold.innerHTML = icon(shut ? 'chevron-right' : 'chevron-down');
      fold.title = shut ? 'desplegar' : 'plegar';
      fold.setAttribute('aria-label', shut ? 'desplegar' : 'plegar');
      fold.setAttribute('aria-expanded', String(!shut));
      fold.addEventListener('click', (event) => {
        event.stopPropagation();
        void toggleFold(node.block.stableId, !shut, callbacks);
      });
      row.append(fold);
    } else {
      // Un hueco del mismo ancho, para que las viñetas queden en columna.
      const gap = document.createElement('span');
      gap.className = 'fold empty';
      row.append(gap);
    }

    const bullet = document.createElement('button');
    bullet.type = 'button';
    const origin = spoken.get(node.block.stableId);
    const hand = hands[node.block.stableId];
    const generated = hand?.kind === 'agent';
    if (generated) row.classList.add('generated');

    bullet.className = [
      'bullet',
      shut ? 'folded' : '',
      origin === undefined ? '' : 'spoken',
      generated ? 'generated' : '',
    ].filter((part) => part !== '').join(' ');

    // Un bloque puede llevar las dos marcas y no se contradicen: dictado por
    // Herbert y reescrito después por un agente. Una dice de dónde vinieron las
    // palabras y la otra de quién son ahora.
    const said: string[] = [node.block.stableId];
    if (origin !== undefined) said.push(`dicho en voz: ${origin}`);
    if (generated) said.push(`escrito por ${hand.participant}`);
    bullet.title = said.join(' · ');
    bullet.textContent = '•';
    bullet.setAttribute('aria-haspopup', 'menu');
    bullet.setAttribute('aria-label', 'acciones del bloque');

    const body = document.createElement('div');
    body.className = 'body';

    /*
     * Un bloque con grabación enseña las dos cosas: el audio arriba y su texto
     * debajo, editable como cualquier otro.
     *
     * Antes el audio *reemplazaba* al bloque hasta que la cascada terminaba, y
     * terminarla se llevaba el audio por delante. Ahora conviven: el audio se
     * queda mientras no se borre, y el texto se escribe, se corrige y se parte
     * sin pedirle permiso a nada.
     */
    const attached = held.get(node.block.stableId);
    const speaking = speakingIn === node.block.stableId;
    if (speaking) speakingIn = null;

    if (speaking) {
      renderRecorder(body, node.block.stableId, audioHandlers);
    } else {
      if (attached !== undefined) {
        renderAudioBlock(body, attached, audioHandlers, node.block.content);
      }
      const text = document.createElement('div');
      text.className = 'body-text';
      text.innerHTML = renderMarkdown(node.block.content, options);
      markMissingImages(text);
      body.append(text);
    }

    bullet.addEventListener('click', (event) => {
      event.stopPropagation();
      // Un bloque con hijos no es hoja, y remove_block sólo acepta hojas. Se
      // muestra igual, con el motivo: ocultarla dejaría al participante sin
      // saber por qué no puede borrar esto y sí lo de al lado.
      const leaf = node.children.length === 0;
      openBlockMenu(bullet, [
        {
          label: 'Copiar referencia',
          run: () => copyText(`((${node.block.stableId}))`, toast),
        },
        {
          label: 'Copiar identificador',
          run: () => copyText(node.block.stableId, toast),
        },
        {
          label: 'Copiar el Markdown del bloque',
          run: () => copyText(node.block.content, toast),
        },
        {
          label: 'Subir',
          ...(neighbourhoods.get(node.block.stableId)?.index === 0
            ? { blocked: 'el bloque ya es el primero de su nivel' }
            : {}),
          run: () => {
            const near = neighbourhoods.get(node.block.stableId);
            if (near !== undefined) void moveBlock(node.block, page.id, near, true, callbacks);
          },
        },
        {
          label: 'Bajar',
          run: () => {
            const near = neighbourhoods.get(node.block.stableId);
            if (near !== undefined) void moveBlock(node.block, page.id, near, false, callbacks);
          },
        },
        {
          label: 'Enfocar en este bloque',
          ...(parent ? {} : { blocked: 'un bloque sin hijos no tiene en qué enfocar' }),
          run: () => callbacks.onFocusBlock?.(node.block.stableId),
        },
        {
          label: 'Eliminar bloque',
          ...(leaf ? {} : { blocked: 'un bloque con hijos no se puede eliminar todavía' }),
          run: () => removeBlock(node.block, row, callbacks),
        },
      ]);
    });

    // Al enfocar, el bloque muestra su Markdown; al salir, su render.
    body.tabIndex = 0;
    body.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.classList.contains('wiki')) {
        event.preventDefault();
        callbacks.onNavigate(target.dataset['page'] ?? '');
        return;
      }
      if (target.classList.contains('block-ref')) {
        event.preventDefault();
        const id = target.dataset['block'] ?? '';
        const ref = page.blockRefs.find((candidate) => candidate.id === id);
        if (ref === undefined) {
          toast('esa referencia no nombra ningún bloque de este grafo');
          return;
        }
        // No sirve `a?.() ?? b()`: la primera devuelve void, así que el `??`
        // dispararía también la segunda y se navegaría dos veces.
        if (callbacks.onOpenBlock === undefined) callbacks.onOpen(ref.page, 'followed_reference');
        else callbacks.onOpenBlock(ref.page, ref.id);
        return;
      }
      if (target.tagName === 'A') return;
      // Pulsar el reproductor o sus botones no abre el editor; pulsar el texto
      // sí, que es lo que se espera de un texto.
      if (target.closest('.audio-block') !== null) return;
      openEditor(node, body);
    });

    row.append(bullet, body);
    list.append(row);
    editors.set(node.block.stableId, { node, body });
    // Un subárbol plegado no se dibuja. Como la vecindad se calcula sobre el
    // árbol visible, las teclas que recorren bloques lo saltan sin saber nada
    // del plegado: no hay dos ideas de qué está a la vista.
    if (!folded.has(node.block.stableId)) {
      for (const child of node.children) drawBlock(child, depth + 1);
    }
  };

  /**
   * @invariant FocusBoundsTheStructure: enfocar reenraiza el árbol, y todo lo
   * demás se calcula sobre el árbol. Ninguna tecla necesita saber que hay un
   * foco: fuera de él, simplemente, no hay bloques.
   */
  const whole = buildTree(page.blocks);
  const rooted = focusRoot === null ? null : findNode(whole, focusRoot);
  const tree = rooted === null ? whole : rooted.children;
  const neighbourhoods = buildNeighbourhoods(tree);

  if (rooted !== null) {
    const bar = document.createElement('div');
    bar.className = 'focused';
    const label = document.createElement('span');
    label.textContent = renderMarkdown(rooted.block.content, options).replace(/<[^>]*>/g, '').trim();
    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'focused-out';
    out.textContent = 'salir del enfoque';
    out.addEventListener('click', () => callbacks.onFocusBlock?.(null));
    bar.append(label, out);
    container.append(bar);
  }

  function openEditor(node: Node, body: HTMLElement, caret?: number): void {
    const near = neighbourhoods.get(node.block.stableId);
    if (near === undefined) return;
    startEditing(
      node.block,
      body,
      callbacks,
      options,
      {
        page: page.id,
        near,
        children: node.children.map((child) => child.block.stableId),
      },
      caret,
    );
  }

  for (const root of tree) drawBlock(root, 0);

  // Una página sin bloques no tenía dónde pulsar, así que crearla dejaba a
  // quien la creó mirando una página en la que no podía escribir.
  /*
   * Una página sin bloques ofrece dónde escribir, no un botón que lo prometa.
   *
   * Aquí había un botón que decía «escribir el primer bloque». Cumplía de
   * palabra y fallaba de hecho: obligaba a leer una etiqueta, apuntarle y
   * pulsarla para llegar al sitio donde se escribe, cuando el sitio donde se
   * escribe podía estar ahí desde el principio. Escribir es lo único que se
   * puede hacer en una página vacía; pedir un gesto para desbloquearlo es poner
   * una puerta delante de la única habitación.
   *
   * Así que se dibuja el bloque: su viñeta y su renglón, con el cursor dentro.
   * Es lo mismo que se ve al borrar el último bloque de una página, y es lo que
   * uno espera de un editor de bloques desde hace quince años.
   *
   * El bloque nace al recibir el foco, no al dibujarse. Crearlo por el mero
   * hecho de mirar dejaría una operación firmada en el registro cada vez que
   * alguien abre una página vacía, y el registro de Vera dice quién hizo qué:
   * no puede llenarse de cosas que nadie hizo. Poner el cursor ahí sí es haber
   * decidido escribir.
   */
  if (tree.length === 0) {
    const row = document.createElement('div');
    row.className = 'block';

    const mark = document.createElement('span');
    mark.className = 'bullet phantom';
    mark.textContent = '•';
    mark.setAttribute('aria-hidden', 'true');

    const body = document.createElement('div');
    body.className = 'body';

    const editor = document.createElement('textarea');
    editor.className = 'editor';
    editor.rows = 1;
    editor.setAttribute('aria-label', 'Escribir el primer bloque');
    editor.placeholder = 'escribe aquí';

    let born = false;
    editor.addEventListener('focus', () => {
      // Una sola vez: el foco vuelve a este campo mientras la página se rehace.
      if (born) return;
      born = true;
      void api
        .submit({ kind: 'create_block', page: page.id, parent: null, position: 0, content: '' })
        .then((result) => {
          if (result.status === 'rejected') {
            born = false;
            toast(`rechazado: ${result.reason}`);
            return;
          }
          callbacks.onReload({ block: result.subjectId, at: 0 });
        })
        .catch(() => {
          born = false;
          toast('no se pudo crear el bloque: sin conexión con el servidor');
        });
    });

    body.append(editor);
    row.append(mark, body);
    list.append(row);
  }

  // Un cambio estructural rehace la página y pide seguir editando donde el
  // modelo dice que quedó el cursor.
  if (focus !== null) {
    const seat = editors.get(focus.block);
    if (seat !== undefined) {
      seat.body.closest('.block')?.scrollIntoView({ block: 'nearest' });
      openEditor(seat.node, seat.body, focus.at);
    }
  }

  // Los diagramas se dibujan después del texto: la biblioteca se carga sola y
  // la página no espera por ella para poder leerse.
  void renderMermaid(list);

  if (page.backlinks.length > 0) {
    const section = document.createElement('section');
    section.className = 'backlinks';

    const heading = document.createElement('h2');
    heading.textContent = `Referencias (${page.backlinks.length})`;
    section.append(heading);

    // Una referencia que no se puede seguir no es una referencia. Cada backlink
    // abre la página que lo produjo y muestra el bloque donde ocurre.
    const list = document.createElement('ul');
    for (const backlink of page.backlinks) {
      const item = document.createElement('li');
      const link = document.createElement('button');
      link.className = 'backlink';

      const where = document.createElement('span');
      where.className = 'backlink-page';
      where.textContent = backlink.title;

      const excerpt = document.createElement('span');
      excerpt.className = 'backlink-excerpt';
      excerpt.textContent = backlink.excerpt;

      link.append(where, excerpt);
      // Un backlink: la pregunta era quién había hablado de esto.
      link.addEventListener('click', () => callbacks.onOpen(backlink.page, 'followed_backlink'));
      item.append(link);
      list.append(item);
    }
    section.append(list);

    container.append(section);
  }
}

/**
 * La vecindad de cada bloque de la página, calculada una vez por render.
 *
 * Las teclas estructurales necesitan saber quién está encima, quién es hermano
 * y quién es abuelo. Recorrer el árbol en cada pulsación sería recalcular lo
 * mismo una y otra vez.
 */
export function buildNeighbourhoods(roots: Node[]): Map<string, Neighbourhood> {
  interface Seat {
    node: Node;
    parent: string | null;
    index: number;
  }

  const flat: Seat[] = [];
  const walk = (nodes: Node[], parent: string | null): void => {
    for (const [index, node] of nodes.entries()) {
      flat.push({ node, parent, index });
      walk(node.children, node.block.stableId);
    }
  };
  walk(roots, null);

  const seats = new Map(flat.map((seat) => [seat.node.block.stableId, seat]));
  const near = new Map<string, Neighbourhood>();

  for (const [at, seat] of flat.entries()) {
    const id = seat.node.block.stableId;
    const before = flat[at - 1];
    const after = flat[at + 1];

    // El hermano anterior es el que comparte padre y va justo antes en el orden
    // de lectura; buscarlo hacia atrás lo encuentra saltándose a los hijos.
    let previousSibling: string | null = null;
    for (let back = at - 1; back >= 0; back -= 1) {
      const candidate = flat[back];
      if (candidate === undefined) break;
      if (candidate.parent === seat.parent) {
        previousSibling = candidate.node.block.stableId;
        break;
      }
    }

    const parentSeat = seat.parent === null ? undefined : seats.get(seat.parent);

    near.set(id, {
      block: id,
      parent: seat.parent,
      index: seat.index,
      hasChildren: seat.node.children.length > 0,
      previousSibling,
      previousVisible:
        before === undefined
          ? null
          : {
              block: before.node.block.stableId,
              content: before.node.block.content,
              hasChildren: before.node.children.length > 0,
            },
      nextVisible: after === undefined ? null : after.node.block.stableId,
      grandparent: parentSeat?.parent ?? null,
      parentIndex: parentSeat?.index ?? 0,
    });
  }

  return near;
}

/** Lo que hace falta para llevar a cabo una decisión de tecla. */
interface Structural {
  page: string;
  block: BlockView;
  near: Neighbourhood;
  children: string[];
  callbacks: OutlinerCallbacks;
}

/**
 * Lleva a cabo la decisión enviando operaciones.
 *
 * @invariant EveryKeystrokeChangeIsAnOperation: partir, fusionar e indentar
 * envían operaciones ordinarias, con la misma procedencia y el mismo orden que
 * cualquier otro cambio. La fluidez no compra ningún atajo hacia el grafo.
 */
async function perform(outcome: KeyOutcome, context: Structural): Promise<void> {
  const { page, block, near, children, callbacks } = context;

  try {
    switch (outcome.kind) {
      case 'ninguno':
        return;

      case 'rechazo':
        // @invariant RefusalsAreVisible: el silencio sería indistinguible de una
        // tecla que no registró.
        toast(outcome.reason);
        return;

      case 'partir': {
        // El bloque conserva su identidad y su cabeza; la cola nace aparte.
        await api.submit({ kind: 'edit_block', block: block.stableId, content: outcome.head });
        const created = await api.submit({
          kind: 'create_block',
          page,
          parent: outcome.parent,
          position: outcome.position,
          content: outcome.tail,
        });
        callbacks.onReload(
          created.status === 'rejected' ? null : { block: created.subjectId, at: 0 },
        );
        return;
      }

      case 'insertar-encima':
        await api.submit({
          kind: 'create_block',
          page,
          parent: outcome.parent,
          position: outcome.position,
          content: '',
        });
        callbacks.onReload({ block: block.stableId, at: 0 });
        return;

      case 'indentar':
      case 'desindentar': {
        const moved = await api.submit({
          kind: 'move_block',
          block: block.stableId,
          page,
          parent: outcome.parent,
          position: outcome.position,
        });
        if (moved.status === 'rejected') toast(`rechazado: ${moved.reason}`);
        callbacks.onReload({ block: block.stableId, at: 0 });
        return;
      }

      case 'quitar-encima': {
        const removed = await api.submit({ kind: 'remove_block', block: outcome.target });
        if (removed.status === 'rejected') toast(`rechazado: ${removed.reason}`);
        callbacks.onReload({ block: block.stableId, at: 0 });
        return;
      }

      case 'fusionar': {
        // Los hijos se mudan antes de quitar el bloque: sólo una hoja se puede
        // quitar, y así ninguno queda huérfano por un padre que desapareció.
        for (const child of children) {
          await api.submit({
            kind: 'move_block',
            block: child,
            page,
            parent: outcome.into,
            position: Number.MAX_SAFE_INTEGER,
          });
        }
        await api.submit({ kind: 'edit_block', block: outcome.into, content: outcome.content });
        const removed = await api.submit({ kind: 'remove_block', block: block.stableId });
        if (removed.status === 'rejected') {
          toast(`rechazado: ${removed.reason}`);
          callbacks.onReload(null);
          return;
        }
        callbacks.onReload({ block: outcome.into, at: outcome.caret });
        return;
      }

      case 'mover-foco':
        callbacks.onReload({
          block: outcome.block,
          at: outcome.at === 'inicio' ? 0 : Number.MAX_SAFE_INTEGER,
        });
        return;
    }
  } catch {
    toast('no se pudo aplicar el cambio: sin conexión con el servidor');
  }
  void near;
}


/** Una entrada ofrecida por el autocompletado. */
interface Candidate {
  /** Lo que se escribe al elegirla. */
  value: string;
  label: string;
  hint?: string;
}

/**
 * Busca candidatos para lo que hay abierto.
 *
 * Las páginas y los bloques se piden al servidor, que es quien sabe qué hay en
 * el grafo; los comandos son una lista fija que vive en el cliente porque no
 * dependen del contenido.
 */
async function candidatesFor(open: Open, query: string): Promise<Candidate[]> {
  if (open.trigger === 'comando') {
    return matchingCommands(query).map((command) => ({
      value: command.name,
      label: command.name,
      hint: command.hint,
    }));
  }

  if (query.trim() === '') return [];

  const hits = await api.search(query);
  const seen = new Set<string>();
  const out: Candidate[] = [];

  for (const hit of hits) {
    if (open.trigger === 'bloque') {
      if (hit.block === null || seen.has(hit.block)) continue;
      seen.add(hit.block);
      out.push({ value: hit.block, label: hit.excerpt, hint: 'bloque' });
    } else {
      // Páginas y etiquetas se completan con un título, que es lo que va entre
      // corchetes; el hallazgo puede venir de un bloque de esa página.
      if (hit.field !== 'page_title' || seen.has(hit.excerpt)) continue;
      seen.add(hit.excerpt);
      out.push({ value: hit.excerpt, label: hit.excerpt });
    }
    if (out.length >= 8) break;
  }

  return out;
}

/** Cuánto silencio hace falta para que lo escrito baje al grafo. */
const EDITING_PAUSE = 900;

function startEditing(
  block: BlockView,
  body: HTMLElement,
  callbacks: OutlinerCallbacks,
  options: RenderOptions,
  context: { page: string; near: Neighbourhood; children: string[] },
  caret = Number.MAX_SAFE_INTEGER,
): void {
  if (body.querySelector('textarea') !== null) return;
  const session = createSession(block.content);

  const editor = document.createElement('textarea');
  editor.className = 'editor';
  editor.value = block.content;
  editor.rows = 1;

  /*
   * El audio sobrevive a la edición de su texto.
   *
   * `body` tiene dos cosas cuando el bloque fue hablado: la grabación arriba y
   * su texto debajo. Editar vaciaba el `body` entero para poner el campo, así
   * que tocar el texto se llevaba el audio por delante, y al volver a la vista
   * normal ya no estaba. La grabación seguía en el grafo —pegada a su bloque,
   * intacta— pero no había forma de oírla sin recargar la página.
   *
   * Eso incumple @guarantee TheRecordingIsAlwaysReachable: mientras el audio
   * existe se oye desde donde se leen sus palabras, sin abrir nada. Una
   * grabación que hay que ir a buscar es una que se deja de contrastar, y
   * contrastar el texto con lo que se dijo es justo lo que uno hace mientras lo
   * corrige.
   *
   * Se aparta antes de vaciar y se devuelve: lo que se edita es el texto, y el
   * audio no es texto de nadie.
   */
  const spoken = body.querySelector('.audio-block');
  body.innerHTML = '';
  if (spoken !== null) body.append(spoken);
  body.append(editor);

  /**
   * El alto sigue al contenido.
   *
   * Contar los saltos de línea no alcanza: una línea larga se reparte en varias
   * al ajustarse al ancho de la columna, y el bloque más común del corpus es
   * justamente eso, un párrafo sin un solo salto. `scrollHeight` mide el texto
   * ya ajustado, así que vale para los dos casos.
   *
   * El `auto` previo es necesario: sin él, `scrollHeight` nunca baja de la
   * altura que ya tiene el campo, y borrar líneas dejaría un hueco.
   *
   * Al borde hay que sumarlo aparte. Con `box-sizing: border-box` la altura que
   * se fija lo incluye, pero `scrollHeight` no, así que asignar `scrollHeight`
   * a secas deja el contenido dos píxeles corto y el campo se desplaza.
   */
  const autosize = (): void => {
    editor.style.height = 'auto';
    const border = editor.offsetHeight - editor.clientHeight;
    editor.style.height = `${editor.scrollHeight + border}px`;
  };

  autosize();

  const at = Math.min(caret, editor.value.length);
  editor.focus();
  editor.setSelectionRange(at, at);

  /** Volver a la vista de lectura, conservando la grabación por el mismo motivo. */
  const render = (content: string): void => {
    const heldAudio = body.querySelector('.audio-block');
    body.innerHTML = '';
    if (heldAudio !== null) body.append(heldAudio);

    // El mismo envoltorio que usa el dibujo inicial. Antes esto escribía el
    // markdown directamente en `body`, así que un bloque recién editado tenía
    // una estructura distinta de la de su vecino y el audio no habría tenido
    // dónde volver.
    const text = document.createElement('div');
    text.className = 'body-text';
    text.innerHTML = renderMarkdown(content, options);
    body.append(text);

    markMissingImages(body);
    void renderMermaid(body);
  };

  let timer: number | undefined;
  // Una salida estructural no vuelve a dibujar aquí: la página se recarga entera
  // y sería dibujar algo que está a punto de desaparecer.
  let leaving = false;

  const flush = async (intent: SaveIntent): Promise<boolean> => {
    if (intent.action === 'nada') return true;

    let result;
    try {
      result = await api.submit({
        kind: 'edit_block',
        block: block.stableId,
        content: intent.content,
      });
    } catch {
      // Sin red no se pierde lo escrito: sigue pendiente y el siguiente intento
      // —otra pausa, o salir del bloque— vuelve a mandarlo.
      session.failed();
      editor.classList.add('failed');
      editor.title = 'no se pudo guardar: sin conexión con el servidor';
      return false;
    }

    if (result.status === 'rejected') {
      toast(`rechazado: ${result.reason}`);
      return false;
    }

    session.settled(intent.content);
    block.content = intent.content;
    editor.classList.remove('failed');
    editor.removeAttribute('title');
    callbacks.onChanged();
    return true;
  };

  /** @invariant TypingIsNeverLost: el texto baja al grafo mientras se escribe. */
  const scheduleSave = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void flush(session.pending()), EDITING_PAUSE);
  };

  const leave = (): void => {
    if (leaving) return;
    leaving = true;
    window.clearTimeout(timer);
    void flush(session.leave()).then(() => render(session.saved()));
  };

  /** Una tecla estructural guarda lo pendiente antes de cambiar el árbol. */
  const structural = (outcome: KeyOutcome): void => {
    if (outcome.kind === 'ninguno') return;
    leaving = true;
    window.clearTimeout(timer);
    void flush(session.pending()).then(() => {
      if (outcome.kind === 'rechazo') {
        // Un rechazo no cambia nada, así que se vuelve a la edición.
        leaving = false;
        toast(outcome.reason);
        return;
      }
      void perform(outcome, {
        page: context.page,
        block,
        near: context.near,
        children: context.children,
        callbacks,
      });
    });
  };

  // --- Autocompletado -------------------------------------------------------
  //
  // @invariant AutocompleteOwnsItsKeys: mientras hay uno abierto, las teclas que
  // lo recorren le pertenecen. Es lo que permite que Tab indente un bloque y
  // elija una entrada sin ambigüedad.

  let open: Open | null = null;
  let candidates: Candidate[] = [];
  let highlighted = 0;
  let list: HTMLElement | null = null;
  let queryTurn = 0;

  const closeList = (): void => {
    list?.remove();
    list = null;
    open = null;
    candidates = [];
    highlighted = 0;
  };

  const drawList = (): void => {
    if (candidates.length === 0) {
      list?.remove();
      list = null;
      return;
    }
    if (list === null) {
      list = document.createElement('div');
      list.className = 'complete';
      list.setAttribute('role', 'listbox');
      document.body.append(list);
    }
    list.innerHTML = '';
    for (const [at, candidate] of candidates.entries()) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = at === highlighted ? 'complete-item selected' : 'complete-item';
      item.setAttribute('role', 'option');
      const label = document.createElement('span');
      label.textContent = candidate.label;
      item.append(label);
      if (candidate.hint !== undefined) {
        const hint = document.createElement('span');
        hint.className = 'complete-hint';
        hint.textContent = candidate.hint;
        item.append(hint);
      }
      // `mousedown` y no `click`: el clic llegaría después del blur, que ya
      // habría cerrado la lista y salido del bloque.
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        accept(at);
      });
      list.append(item);
    }

    // Cabe en la ventana o no sirve, igual que el menú de un bloque: el editor
    // puede estar pegado al borde derecho o al pie, y la lista se salía.
    const at = editor.getBoundingClientRect();
    const box = list.getBoundingClientRect();
    const margin = 8;

    const left = Math.max(margin, Math.min(at.left, window.innerWidth - box.width - margin));
    let top = at.bottom + 2;
    if (top + box.height > window.innerHeight - margin && at.top - box.height - 2 > margin) {
      top = at.top - box.height - 2;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - box.height - margin));

    list.style.left = `${Math.round(left + window.scrollX)}px`;
    list.style.top = `${Math.round(top + window.scrollY)}px`;
  };

  const accept = (at: number): void => {
    const chosen = candidates[at];
    if (open === null || chosen === undefined) return;
    const acts = open.trigger === 'comando' ? actionOf(chosen.value) : undefined;
    const applied = completionFor(open, chosen.value, editor.value, editor.selectionStart);
    editor.value = applied.buffer;
    editor.setSelectionRange(applied.cursor, applied.cursor);
    session.type(editor.value);
    closeList();
    autosize();

    // Hablar no es escribir: el comando desaparece del texto y lo que ocurre
    // ocurre en el grafo. Lo que quedara escrito se guarda antes, porque la
    // grabación necesita un bloque vacío que le guarde el lugar.
    if (acts === 'hablar') {
      void callbacks.onSpeak?.(block.stableId, editor.value.trim());
      return;
    }

    // Fechar algo es enlazarlo al día. El comando ya se borró a sí mismo, así
    // que lo elegido cae donde estaba escribiéndose. El sitio se guarda ahora y
    // no se vuelve a leer después: entre abrir el calendario y elegir un día
    // pasa tiempo, y el cursor puede haberse ido a otra parte.
    if (acts === 'elegir-fecha') {
      const at = applied.cursor;
      pickDate(editor, (date) => {
        const written = `[[${date}]]`;
        editor.value = editor.value.slice(0, at) + written + editor.value.slice(at);
        const after = at + written.length;
        editor.setSelectionRange(after, after);
        session.type(editor.value);
        autosize();
        scheduleSave();
        editor.focus();
      });
      return;
    }

    scheduleSave();
    editor.focus();
  };

  const refreshList = (): void => {
    const cursor = editor.selectionStart;
    if (open === null) open = detectTrigger(editor.value, cursor);
    if (open === null) {
      closeList();
      return;
    }

    const query = queryOf(open, editor.value, cursor);
    if (query === null) {
      closeList();
      return;
    }

    // Cada búsqueda lleva turno: una respuesta lenta no pisa a una más reciente.
    queryTurn += 1;
    const turn = queryTurn;
    void candidatesFor(open, query).then((found) => {
      if (turn !== queryTurn || open === null) return;
      candidates = found;
      highlighted = 0;
      drawList();
    });
  };

  editor.addEventListener('input', () => {
    session.type(editor.value);
    autosize();
    scheduleSave();
    refreshList();
  });

  editor.addEventListener('blur', () => {
    closeList();
    leave();
  });

  editor.addEventListener('keydown', (event) => {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;

    // Con una lista abierta, estas teclas son suyas. Sin esto, Enter partiría el
    // bloque en mitad de una búsqueda y Tab lo indentaría.
    if (list !== null && candidates.length > 0) {
      if (is('complete-move', event)) {
        event.preventDefault();
        const paso = event.key === 'ArrowDown' ? 1 : -1;
        highlighted = (highlighted + paso + candidates.length) % candidates.length;
        drawList();
        return;
      }
      if (is('complete-accept', event)) {
        event.preventDefault();
        accept(highlighted);
        return;
      }
      if (is('complete-close', event)) {
        // La primera pulsación cierra la lista; la segunda ya sale del bloque.
        event.preventDefault();
        closeList();
        return;
      }
    }

    // Escape sale guardando. No descarta: para cuando se pulsa, la pausa ya dejó
    // el texto en el grafo, y ofrecer descartar sería mentir.
    if (is('leave', event)) {
      event.preventDefault();
      editor.blur();
      return;
    }

    if (is('split', event)) {
      event.preventDefault();
      session.type(editor.value);
      structural(resolveEnter(editor.value, start, end, context.near));
      return;
    }

    // Shift-Enter escribe un salto de línea dentro del bloque, que es la única
    // forma de tener un párrafo de varias líneas en un solo bloque.
    if (is('leave-cmd', event)) {
      event.preventDefault();
      editor.blur();
      return;
    }

    if (is('indent', event) || is('outdent', event)) {
      event.preventDefault();
      session.type(editor.value);
      structural(resolveTab(is('indent', event), context.near));
      return;
    }

    if (is('merge', event) && start === 0 && end === 0) {
      event.preventDefault();
      session.type(editor.value);
      structural(resolveBackspaceAtStart(editor.value, context.near));
      return;
    }

    if (is('up', event) || is('down', event)) {
      const outcome = resolveArrow(is('up', event), editor.value, start, context.near);
      if (outcome.kind === 'ninguno') return;
      event.preventDefault();
      session.type(editor.value);
      structural(outcome);
      return;
    }

    // Autopar. Se hace a mano porque hay que decidir entre envolver, emparejar y
    // saltar el cierre, y ninguna de las tres es lo que el navegador haría.
    const typed = resolveDelimiter(event.key, editor.value, start, end);
    if (typed !== null) {
      event.preventDefault();
      editor.value = typed.buffer;
      editor.setSelectionRange(typed.cursor, typed.cursor);
      session.type(editor.value);
      autosize();
      scheduleSave();
    }
  });
}
