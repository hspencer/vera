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

import { DEFAULT_PROPERTY_NAMES, answersIn, looksLikeQuery } from '@vera/core';
import { api, type BlockView, type Change, type CrossingRow, type PageView } from './api.ts';
import { renderMarkdown, type RenderOptions } from './markdown.ts';
import { answerQueryBlock } from './query-block.ts';
import { renderMermaid } from './mermaid.ts';
import { is } from './bindings.ts';
import { icon } from './icons.ts';
import { createPage } from './pages.ts';
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

/*
 * Cómo llama este corpus a lo que Vera necesita nombrar.
 *
 * Lo trae el arranque, leído de la página de ontología, y se guarda aquí para
 * que dibujar una página no tenga que preguntarlo. Mientras no llegue rige lo
 * que Vera trae, que es lo mismo que rige en el servidor.
 */
let names = { ...DEFAULT_PROPERTY_NAMES };

export function nameProperties(said: Partial<typeof names>): void {
  names = { ...names, ...said };
}

const corpusNames = (): typeof names => names;

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
 * Pregunta un título, crea la página y la abre.
 *
 * Nace privada y sin bloques: `createPage` es el acto, y el primer bloque lo
 * escribe quien la abra. Ponerle contenido de plantilla sería inventar texto que
 * nadie escribió, y en un corpus con procedencia eso no es inocuo.
 */
async function askForNewPage(callbacks: OutlinerCallbacks): Promise<void> {
  const title = window.prompt('Título de la página nueva');
  if (title === null || title.trim() === '') return;

  let result;
  try {
    result = await createPage(title.trim());
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


/**
 * Vaciar una pagina y despues quitarla.
 *
 * El dominio solo borra una pagina vacia, y solo borra un bloque que no tenga
 * hijos —`rule ApplyRemovePage` y la validacion de `remove_block`—. Asi que esto
 * no es una operacion sino una secuencia: las hojas primero, subiendo, y al
 * final la pagina. Cada paso queda en el registro con su propio numero de
 * secuencia.
 *
 * Que sea una secuencia y no un acto unico es deliberado en la spec: «emptying
 * it is a sequence of remove_block operations, each separately ordered and
 * separately auditable». Borrar una pagina no puede tragarse lo que hubiera
 * dentro sin dejar constancia de que habia.
 *
 * Si un paso falla se para ahi. Queda una pagina a medio vaciar, que es
 * visiblemente reparable; nunca una pagina borrada con bloques huerfanos.
 */
async function deletePage(
  page: PageView,
  callbacks: OutlinerCallbacks,
): Promise<void> {
  const cuantos = page.blocks.filter((b) => b.content.trim() !== '').length;
  const dentro =
    cuantos === 0 ? '' : cuantos === 1 ? ' y el bloque que tiene escrito' : ` y sus ${cuantos} bloques escritos`;
  const aviso = `Se va a eliminar «${page.title}»${dentro}. No se puede deshacer.`;
  if (!window.confirm(aviso)) return;

  // Las hojas primero: un bloque con hijos no se puede quitar, asi que se ordena
  // por profundidad y se va de abajo hacia arriba.
  const parents = new Map(page.blocks.map((b) => [b.stableId, b.parent]));
  const depthOf = (id: string): number => {
    let depth = 0;
    let at = parents.get(id) ?? null;
    // El tope es por si un dia el arbol llegara con un ciclo: mejor un orden
    // aproximado que un bucle infinito en el navegador de alguien.
    while (at !== null && depth < 1000) {
      depth += 1;
      at = parents.get(at) ?? null;
    }
    return depth;
  };
  const deepestFirst = [...page.blocks].sort((a, b) => depthOf(b.stableId) - depthOf(a.stableId));

  for (const block of deepestFirst) {
    if (!(await submitQuietly({ kind: 'remove_block', block: block.stableId }))) return;
  }
  if (!(await submitQuietly({ kind: 'remove_page', page: page.id }))) return;

  toast(`eliminada: ${page.title}`);
  // La pagina que se estaba leyendo ya no existe, asi que hay que ir a alguna
  // parte. El dia de hoy es el sitio al que Vera vuelve siempre que no hay un
  // sitio mejor: existe siempre y es donde se estaba escribiendo.
  callbacks.onNavigate(today());
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
  /** Cómo llama este corpus a lo que se propone. */
  names?: { kind: string; topic: string };
  /** Cada concepto, y si el corpus ya lo tiene como página. */
  concepts: { value: string; page: string | null; backlinks: number }[];
  /** Páginas que esta página nombra y no enlaza. */
  mentions: {
    title: string;
    page: string;
    block: string;
    content: string;
    next: string;
    written: string;
    backlinks: number;
  }[];
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
  /*
   * Lo que hay que escribir para que el renglón ocurra.
   *
   * Casi siempre es una operación, pero no siempre: «borrar los doce bloques
   * vacíos» son doce, y partirlo en doce renglones convertiría en trabajo lo
   * que es una sola decisión. Lo que se decide es el renglón; cuántas
   * operaciones hagan falta es del código.
   */
  changes: Change[];
  approved: boolean;
}

/*
 * Las claves con que se guarda lo que el bibliotecario propone no están aquí:
 * las dice el corpus y viajan con el resultado del procesamiento.
 *
 * Escribirlas en el cliente convertía en decisión de Vera algo que es de quien
 * escribe: quien lleve su corpus en otra lengua no tiene por qué recibir
 * sugerencias que le escriban `type` en sus páginas.
 */
const DEFAULT_NAMES = { kind: 'tipo', topic: 'concepto' };
/**
 * Procesa la página, cuenta lo que va haciendo, y propone cambios.
 *
 * @invariant ProcessingProposesAndNothingMore: nada se escribe aquí. Lo que
 * aparece son proposiciones, y hasta que alguien pulsa «aplicar» la página está
 * exactamente como estaba. Cerrar el panel la deja igual.
 */
/*
 * Los defectos de forma, dichos en palabras.
 *
 * El dominio los nombra en inglés y con guiones bajos porque son un enum; aquí
 * se dicen como se leen. Y se dicen como observaciones —«párrafos largos sin
 * partir»— y no como órdenes —«partir los párrafos»—, que es la diferencia entre
 * describir una página y decidir por quien la escribió.
 */
const DEFECTS: Record<string, string> = {
  empty_block: 'bloques vacíos',
  monolithic_paragraph: 'párrafos largos sin partir',
  implicit_heading: 'bloques que se comportan como título sin serlo',
  flat_list: 'listas sin ninguna profundidad',
  inconsistent_hierarchy: 'encabezados colgando de otro más hondo',
  mixed_units: 'bloques con más de una unidad dentro',
};

/** Cuántos de cada clase, en el orden en que aparecieron. */
function countBy(seen: { defect: string }[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const one of seen) counts.set(one.defect, (counts.get(one.defect) ?? 0) + 1);
  return [...counts];
}

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

  const step = (text: string, kind: 'doing' | 'ok' | 'bad' | 'note' = 'doing'): HTMLElement => {
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
          /*
           * La forma de la página, leída contando y sin modelo.
           *
           * @guarantee WhatWasFoundIsNotYetAProposal: esto se enseña como lo que
           * es —una descripción— y no como algo que aplicar. No lleva botón, no
           * viene preseleccionado y no promete un arreglo, porque qué hacer con
           * un párrafo monolítico es una decisión que Herbert dejó abierta a
           * propósito y enseñarla como sugerencia la tomaría por él.
           */
          case 'structure': {
            step(`forma: ${String(event['summary'])}`, 'ok');
            const seen = (event['observations'] ?? []) as { defect: string; evidence: string }[];
            for (const [defect, count] of countBy(seen)) {
              step(`${count} × ${DEFECTS[defect] ?? defect}`, 'note');
            }
            break;
          }
          /*
           * La puesta en forma, que ocurre sin preguntar.
           *
           * Es lo único que procesar cambia por su cuenta: partir párrafos
           * largos, marcar títulos implícitos, enderezar jerarquías torcidas,
           * separar unidades pegadas y borrar los huecos. Ninguna añade ni quita
           * sentido —el texto no se reescribe: se corta, se prefija un `#` y se
           * cambia de sitio—, y por eso no hay nada que decidir.
           *
           * Se aplica aquí, operación por operación y contra POST /operations,
           * porque ésa es la única entrada de escritura de Vera: cada paso queda
           * en el log con su autoría y su secuencia, como cualquier edición
           * hecha a mano. Sin botón de deshacer y sin capa de inversas: lo que
           * quedó mal se corrige escribiendo, como todo lo demás.
           *
           * En orden y parándose al primer rechazo: las posiciones de cada paso
           * cuentan con que el anterior entró.
           */
          case 'plan': {
            const changes = (event['changes'] ?? []) as Change[];
            const did = (event['did'] ?? []) as string[];
            if (changes.length === 0) {
              step('la forma ya estaba bien; no se tocó nada', 'note');
              break;
            }
            let escritas = 0;
            for (const change of changes) {
              const result = await api.submit(change);
              if (result.status === 'rejected') {
                step(`la puesta en forma se detuvo: ${result.reason}`, 'bad');
                break;
              }
              escritas += 1;
            }
            if (escritas === changes.length) {
              for (const line of did) step(line, 'ok');
            } else {
              step(`puesta en forma a medias: ${escritas} de ${changes.length} operaciones`, 'bad');
            }
            if (escritas > 0) callbacks?.onReload(null);
            break;
          }
          /*
           * La lectura de sentido, que va por partes.
           *
           * @invariant ReadingInPartsIsSaidInParts: una página larga se lee en
           * varias veces porque el modelo no la aguanta entera, y eso tarda. Que
           * se vea por cuál parte va y de qué sección es la diferencia entre
           * tardar y parecer colgado.
           */
          case 'model': {
            const of = Number(event['of'] ?? 1);
            const which = Number(event['pass'] ?? 1);
            const section = String(event['section'] ?? '');
            const part =
              of > 1 ? ` · parte ${which} de ${of}${section === '' ? '' : ` · «${section}»`}` : '';
            if (event['state'] === 'asking') {
              step(`preguntando al modelo local qué es y de qué trata…${part}`);
            } else if (event['state'] === 'failed') step(String(event['why']), 'bad');
            else step('el modelo contestó', 'ok');
            break;
          }
          case 'mentions': {
            const found = Number(event['found'] ?? 0);
            const titles = (event['titles'] ?? []) as string[];
            step(
              found === 0
                ? 'no nombra ninguna página del corpus sin enlazar'
                : `nombra sin enlazar: ${titles.join(' · ')}`,
              found === 0 ? 'note' : 'ok',
            );
            break;
          }
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
  const names = reading.names ?? DEFAULT_NAMES;
  const already = new Set((page.properties ?? []).map((p) => `${p.key}=${p.value}`));
  const suggestions: Suggestion[] = [];

  for (const value of reading.types) {
    if (already.has(`${names.kind}=${value}`)) continue;
    suggestions.push({
      what: `qué es: ${value}`,
      detail: `${names.kind}:: ${value}`,
      changes: [
        { kind: 'set_property', page: page.id, propertyKey: names.kind, propertyValue: value },
      ],
      approved: true,
    });
  }

  /*
   * De qué trata, dicho de forma que una a la página con el corpus.
   *
   * Un concepto que ya es una página del grafo no es lo mismo que uno nuevo: el
   * primero mete esta página en un vecindario que ya existe —y por eso el
   * renglón dice cuántas páginas lo enlazan ya—, el segundo abre un nombre que
   * hasta ahora no estaba. Aceptar los dos es legítimo; confundirlos es lo que
   * hace que un corpus tenga «diseño», «Diseño» y «diseños» y ninguno de los
   * tres reúna lo que el otro tiene.
   */
  for (const concept of reading.concepts) {
    if (already.has(`${names.topic}=${concept.value}`)) continue;
    suggestions.push({
      what: `de qué trata: ${concept.value}`,
      detail:
        concept.page === null
          ? `${names.topic}:: ${concept.value} · nuevo en el corpus`
          : `${names.topic}:: ${concept.value} · ya es página${
              concept.backlinks > 0 ? `, con ${concept.backlinks} enlaces` : ''
            }`,
      changes: [
        {
          kind: 'set_property',
          page: page.id,
          propertyKey: names.topic,
          propertyValue: concept.value,
        },
      ],
      approved: true,
    });
  }

  /*
   * Lo que la página nombra y el corpus ya tiene, propuesto como enlace.
   *
   * Es lo que la vuelve encontrable desde el otro lado: una página que dice
   * «Ciudad Abierta» sin enlazarla no aparece entre los enlaces entrantes de
   * Ciudad Abierta, y quien recorra el corpus desde allí no llegará nunca. La
   * dirección del texto no se toca: se envuelve la palabra tal como está escrita
   * —el grafo resuelve el enlace sin distinguir mayúsculas ni tildes—, que es la
   * misma promesa que con los enlaces externos.
   */
  // Un bloque con un cambio propuesto ya no admite otro: los dos se proponen
  // como el texto entero que el bloque tendría, y aceptar los dos deja el
  // segundo. La mención que se cae vuelve a proponerse la próxima vez.
  const tocados = new Set(
    suggestions
      .flatMap((one) => one.changes)
      .map((one) => (one.kind === 'edit_block' ? one.block : null))
      .filter((one): one is string => one !== null),
  );

  for (const mention of reading.mentions ?? []) {
    if (tocados.has(mention.block)) continue;
    tocados.add(mention.block);
    suggestions.push({
      what: `enlazar con «${mention.title}»`,
      detail:
        mention.backlinks > 0
          ? `dice «${mention.written}» · ${mention.backlinks} páginas ya la enlazan`
          : `dice «${mention.written}»`,
      changes: [{ kind: 'edit_block', block: mention.block, content: mention.next }],
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
      changes: [{ kind: 'edit_block', block: link.block, content: next }],
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

  /** Las que siguen a la vista, sin decidir. */
  const abiertas = new Set<Suggestion>();

  /*
   * Lo que la página ya dice, para no pisarlo y para poder sumar.
   *
   * `set_property` guarda un valor por clave, así que escribir un tipo nuevo sin
   * mirar lo que había borraría los anteriores. Se lleva aquí el estado y se
   * actualiza a cada escritura: así aplicar de una en una acumula igual que
   * aplicar todas de golpe, que es lo que alguien espera al pulsar dos vistos
   * seguidos.
   */
  const held = new Map<string, string[]>();
  for (const property of page.properties ?? []) {
    held.set(
      property.key,
      property.value.split(',').map((v) => v.trim()).filter((v) => v !== ''),
    );
  }

  /** Escribe un grupo de sugerencias. Devuelve si todo lo pedido se escribió. */
  const escribir = async (chosen: Suggestion[]): Promise<boolean> => {
    const byKey = new Map<string, string[]>();
    const others: { suggestion: Suggestion; change: Change }[] = [];
    for (const suggestion of chosen) {
      for (const change of suggestion.changes) {
        if (change.kind !== 'set_property') {
          others.push({ suggestion, change });
          continue;
        }
        const key = change.propertyKey;
        const values = byKey.get(key) ?? [...(held.get(key) ?? [])];
        if (!values.includes(change.propertyValue)) values.push(change.propertyValue);
        byKey.set(key, values);
      }
    }

    let entero = true;

    for (const [key, values] of byKey) {
      const result = await api.submit({
        kind: 'set_property',
        page: page.id,
        propertyKey: key,
        propertyValue: values.join(', '),
      });
      if (result.status === 'rejected') {
        step(`rechazado: ${result.reason} · ${key}`, 'bad');
        entero = false;
        continue;
      }
      held.set(key, values);
      step(`${key}:: ${values.join(', ')}`, 'ok');
    }

    const dicho = new Set<Suggestion>();
    for (const { suggestion, change } of others) {
      const result = await api.submit(change);
      if (result.status === 'rejected') {
        step(`rechazado: ${result.reason} · ${suggestion.what}`, 'bad');
        entero = false;
        continue;
      }
      // Un renglón se cuenta una vez aunque hayan hecho falta doce operaciones.
      if (!dicho.has(suggestion)) {
        dicho.add(suggestion);
        step(suggestion.what, 'ok');
      }
    }

    return entero;
  };

  /*
   * Las escrituras van en fila de a una.
   *
   * Una propiedad guarda un valor por clave, así que aceptar un tipo es leer lo
   * que la página ya tiene, añadir el nuevo y escribir la lista entera. Dos de
   * esas a la vez leen las dos lo mismo, y la que llega segunda escribe una
   * lista donde la primera no está: se acepta una sugerencia, se ve aplicada, y
   * al recargar no está. Aceptar tres seguidas —que es lo natural cuando las
   * sugerencias son tres— dejaba sólo la última.
   *
   * No hace falta un modo distinto ni juntarlo todo para el final: hace falta
   * que la segunda escritura empiece cuando la primera ya terminó, que es lo que
   * hace esta fila. Cada acepta se aplica en el acto, y ninguna pisa a otra.
   */
  let cola: Promise<unknown> = Promise.resolve();
  const write = (chosen: Suggestion[]): Promise<boolean> => {
    const turno = cola.then(() => escribir(chosen));
    // La fila no puede romperse por un fallo: si una escritura revienta, la
    // siguiente tiene que poder correr igual.
    cola = turno.catch(() => undefined);
    return turno;
  };

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

    /*
     * Dos botones y no un interruptor.
     *
     * Aceptar y descartar son dos gestos distintos, no dos estados de uno: con
     * un interruptor hay que leer qué dice ahora para saber qué va a hacer, y
     * eso es una pregunta de más por cada renglón. Con la cruz y el visto se
     * pulsa lo que se quiere hacer.
     *
     * Los dos hacen desaparecer la fila, y por la misma razón: una vez decidido
     * ya no es una sugerencia. Lo aplicado está en la página, que es donde se
     * lee; lo descartado no está en ninguna parte, que es lo que se pidió.
     */
    const decide = document.createElement('div');
    decide.className = 'suggestion-decide';

    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'suggestion-no';
    drop.innerHTML = icon('x');
    drop.setAttribute('aria-label', `Descartar: ${suggestion.what}`);
    drop.title = 'Descartar';
    drop.addEventListener('click', () => {
      suggestion.approved = false;
      row.remove();
      abiertas.delete(suggestion);
      count();
    });

    const take = document.createElement('button');
    take.type = 'button';
    take.className = 'suggestion-yes';
    take.innerHTML = icon('check');
    take.setAttribute('aria-label', `Aplicar: ${suggestion.what}`);
    take.title = 'Aplicar';
    take.addEventListener('click', () => {
      void (async () => {
        take.disabled = true;
        drop.disabled = true;
        // Sale de las abiertas al pulsar y no al escribirse: mientras espera su
        // turno en la fila ya está decidida, y «aplicar los que quedan» no puede
        // volver a incluirla.
        abiertas.delete(suggestion);
        escribiendo += 1;
        count();
        const ok = await write([suggestion]);
        escribiendo -= 1;
        if (!ok) {
          take.disabled = false;
          drop.disabled = false;
          abiertas.add(suggestion);
          count();
          return;
        }
        row.remove();
        count();
        callbacks?.onReload(null);
      })();
    });

    decide.append(drop, take);
    row.append(text, decide);
    list.append(row);
    abiertas.add(suggestion);
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

  foot.append(apply, cancel);

  /** Cuántas escrituras hay en curso o esperando su turno en la fila. */
  let escribiendo = 0;

  const count = (): void => {
    const n = abiertas.size;
    apply.textContent = n === 1 ? 'aplicar' : `aplicar los ${n}`;
    apply.disabled = n === 0;
    // Sin nada que decidir, el panel deja de ser un panel de sugerencias. Pero
    // sólo cuando además no queda ninguna escribiéndose: si la última falla hay
    // que poder verla volver, y no se ve volver a una lista que ya se retiró.
    if (n === 0 && escribiendo === 0) {
      heading.remove();
      list.remove();
      foot.remove();
    }
  };

  apply.addEventListener('click', () => {
    void (async () => {
      apply.disabled = true;
      cancel.disabled = true;
      const chosen = [...abiertas];
      step(`aplicando ${chosen.length} sugerencias…`);

      const entero = await write(chosen);
      for (const suggestion of chosen) abiertas.delete(suggestion);

      // Aplicado deja de ser sugerencia: la lista se retira entera, y lo que se
      // escribió está ya en la página, que es donde se lee.
      list.remove();
      heading.remove();
      foot.remove();
      step(entero ? 'aplicadas todas' : 'algunas no se pudieron aplicar', entero ? 'ok' : 'bad');
      notify(`procesada «${page.title}»`);
      callbacks?.onReload(null);
    })();
  });

  body.append(foot);
  count();
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

/**
 * Los bloques escogidos ahora mismo, y desde donde se empezo a escoger.
 *
 * @invariant NothingIsSelectedWhileWriting. Un cursor y una seleccion son dos
 * respuestas distintas a «sobre que actua la siguiente tecla», y solo una puede
 * ser cierta: empezar a escribir vacia la seleccion, y escoger deja la escritura.
 *
 * Vive fuera del dibujo porque el dibujo se rehace entero en cada cambio, y una
 * seleccion que se perdiera en cada repintado no serviria para nada. Se limpia
 * al cambiar de pagina, que es cuando deja de querer decir algo.
 */
const picked = new Set<string>();
let pickedOn: string | null = null;
/**
 * El extremo que se mueve, que no es el mismo que el ancla.
 *
 * Sin recordarlo, estirar y recoger no son operaciones inversas: si el borde se
 * dedujera del tramo —el mayor indice al bajar, el menor al subir— entonces
 * Shift+arriba sobre un tramo que crecio hacia abajo se iria al otro lado del
 * ancla en vez de recogerlo. Un extremo es una posicion, no una consecuencia.
 */
let pickedTo: string | null = null;
let pickedPage: string | null = null;
/** Retira el oyente de teclado del dibujo anterior. */
let dropPickedKeys: (() => void) | null = null;

/** Deshace la seleccion. Lo llama todo lo que empieza a escribir. */
export function clearPicked(): void {
  picked.clear();
  pickedOn = null;
  pickedTo = null;
  for (const row of document.querySelectorAll('.block.picked')) row.classList.remove('picked');
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
  dropPickedKeys?.();
  dropPickedKeys = null;
  // Una seleccion nombra bloques de una pagina; en otra no quiere decir nada.
  if (pickedPage !== page.id) {
    picked.clear();
    pickedOn = null;
    pickedPage = page.id;
  }
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
  /*
   * Los tres renglones que no salen de una propiedad escrita.
   *
   * Se llaman como el corpus los llame —lo declara la ontología, igual que las
   * demás— porque lo que la cabecera enseña como propiedad tiene que poder
   * preguntarse como propiedad: `? público=sí`, `? creación=2026-08-07`. Lo que
   * no hacen es guardarse: la visibilidad tiene su operación y su columna, y las
   * dos fechas las sabe el registro. Dos sitios diciendo lo mismo acaban
   * diciendo cosas distintas.
   */
  const derived = corpusNames();
  visibilityKey.textContent = derived.visible;

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

  /*
   * Fechas de solo lectura.
   *
   * No son propiedades que alguien mantenga a mano. La creación proviene del
   * corpus original cuando hay evidencia y, si no, muestra el techo cierto de
   * entrada a Vera. La actualización sale de la última revisión real: escribir,
   * mover o cambiar propiedades la mueve sola; recuperar procedencia no.
   */
  const journalDay = (at: number): string => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(at));
    const value = (part: string): string => parts.find((p) => p.type === part)?.value ?? '';
    return `${value('year')}-${value('month')}-${value('day')}`;
  };
  const temporal = (label: string, at: number | null, title: string): void => {
    if (at === null) return;
    const key = document.createElement('dt');
    key.className = 'property-key';
    key.textContent = label;
    const value = document.createElement('dd');
    value.className = 'property-value governed';
    const dayLink = document.createElement('button');
    dayLink.type = 'button';
    dayLink.className = 'property-word';
    dayLink.textContent = journalDay(at);
    dayLink.title = `${title} Ir a la bitácora de ese día.`;
    dayLink.addEventListener('click', () => callbacks.onNavigate(dayLink.textContent ?? ''));
    value.append(dayLink);
    properties.append(key, value);
  };
  temporal(
    derived.created,
    page.originCreatedAt ?? page.createdAt,
    page.originCreatedAt === null
      ? 'No se recuperó una fecha anterior: ésta es la fecha cierta de entrada a Vera.'
      : 'Recuperada del corpus de origen.',
  );
  temporal(
    derived.updated,
    page.lastEditedAt,
    'Derivada automáticamente de la última revisión de la página.',
  );

  // La `public::` heredada de Logseq no se dibuja: la fila de arriba dice lo
  // mismo y además manda. Sigue en el corpus hasta que se adopte, y adoptarla
  // es un acto aparte y deliberado — ver rule AdoptImportedVisibilityProperty.
  const written = page.properties.filter((property) => property.key !== 'public');

  for (const property of written) {
    const key = document.createElement('dt');
    key.className = 'property-key';
    // La clave, tal como está escrita en la página. Sin máscara: enseñar «tipo»
    // sobre una clave que se llama `type` obliga a saberse las dos para poder
    // preguntar por ella, y la que vale es la que el corpus dice.
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

    /*
     * Dos preguntas distintas que estaban siendo una sola.
     *
     * La primera es si esto es una pregunta cerrada: si el corpus contesta esta
     * clave con unas pocas palabras, se contesta eligiendo de un menú. La
     * segunda es si el valor lleva varias respuestas dentro: si las lleva, cada
     * una es una palabra y cada palabra lleva a su página.
     *
     * Estaban anidadas —sólo se partía por comas dentro de la rama de
     * vocabulario— y por eso `concepto` se dibujaba como una cadena. Medido
     * sobre el corpus: mil cincuenta y una palabras distintas, y las doce más
     * usadas cubren el 19 % del uso. `concepto` es vocabulario abierto, como las
     * etiquetas: no es una pregunta cerrada y nunca lo será, y aun así sus
     * valores son varios y cada uno nombra algo que existe.
     *
     * Que una no sea la otra es lo que hace que `AAC`, `PictoNet` y `doctorado`
     * puedan seguirse por separado sin que nadie tenga que declarar un
     * vocabulario primero.
     */
    const answers = answersIn(property.value);
    const several = answers.length > 1;

    if (isChoosable(offered) || several) {
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
      /*
       * Un valor por palabra, no una cadena con comas dentro.
       *
       * Una propiedad de vocabulario puede llevar varios valores —una página es
       * varias cosas a la vez— y se guardan separados por comas, que es como el
       * corpus ya lo escribe. Dibujarlos como un solo botón los volvía una sola
       * palabra: se resaltaban juntos al pasar por encima, y pulsarlos llevaba a
       * una página llamada «entrada diaria, página especial», que no existe ni va
       * a existir.
       *
       * Aquí la coma es separador y no texto, porque los valores salen de un
       * vocabulario: ninguno lleva una coma dentro. Donde no hay vocabulario el
       * valor se deja entero, que ahí una coma sí puede ser parte de la frase.
       */
      const words = document.createElement('span');
      words.className = 'property-words';
      for (const one of answers) {
        const follow = document.createElement('button');
        follow.type = 'button';
        follow.className = 'property-word';
        follow.textContent = one;
        follow.title = `ir a ${one}`;
        follow.addEventListener('click', (event) => {
          event.stopPropagation();
          callbacks.onNavigate(one);
        });
        words.append(follow);
      }
      // Con vocabulario y sin valor queda el chevrón, pero el hueco donde irá la
      // palabra tiene que decir que está vacío: si no, la fila parece rota.
      if (words.children.length === 0) {
        const empty = document.createElement('button');
        empty.type = 'button';
        empty.className = 'property-word property-empty';
        empty.textContent = 'sin valor';
        empty.title = `escribir el valor de ${property.key}`;
        empty.addEventListener('click', (event) => {
          event.stopPropagation();
          editInPlace(value, '', `valor de ${property.key}`, answer);
        });
        words.append(empty);
      }
      const follow = words;

      /*
       * El chevrón sólo donde hay de dónde elegir.
       *
       * Un vocabulario abierto —`concepto`, con mil palabras— no cabe en un menú
       * de doce, y ofrecer las doce más usadas seria decir que la respuesta esta
       * entre ellas cuando cubren el diecinueve por ciento del uso. Ahí se
       * escribe, y para eso ya están las palabras: se pulsan y se editan.
       */
      value.append(follow);

      if (isChoosable(offered)) {
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
        value.append(choose);
      } else {
        /*
         * Sin de dónde elegir, no hay chevrón.
         *
         * Un vocabulario abierto —`concepto`, con mil palabras— no cabe en un
         * menú de doce, y ofrecer las doce más usadas diría que la respuesta
         * está entre ellas cuando cubren el diecinueve por ciento del uso. Aquí
         * se escribe, pulsando el hueco de la fila: las palabras no, que cada
         * una lleva a su página.
         */
        value.title = `editar ${property.key}`;
        value.addEventListener('click', (event) => {
          if ((event.target as HTMLElement).closest('.property-word') !== null) return;
          editInPlace(value, property.value, `valor de ${property.key}`, answer);
        });
      }
    } else {
      /*
       * Un valor vacío se dibuja con una palabra, o no se puede pulsar.
       *
       * Una propiedad nace sin valor —el nombre se escribe primero y el valor
       * después— y hasta aquí eso dejaba un `dd` sin texto: sin texto no hay caja,
       * sin caja no hay dónde hacer clic, y la propiedad recién creada se quedaba
       * sin ninguna forma de recibir su valor. Y como su clave es nueva tampoco
       * tiene vocabulario observado, así que el chevrón que salva el otro caso
       * tampoco aparecía. Callejón sin salida, en el gesto más común.
       *
       * El texto suplente es del hueco y no del valor: se enseña, se puede pulsar,
       * y lo que se abre para escribir sigue empezando vacío.
       */
      const empty = property.value.trim() === '';
      value.textContent = empty ? 'sin valor' : property.value;
      if (empty) value.classList.add('property-empty');
      value.tabIndex = 0;
      value.title = empty ? 'escribir el valor' : 'editar el valor';
      value.addEventListener('click', () => {
        editInPlace(value, property.value, `valor de ${property.key}`, answer);
      });
    }

    /*
     * El tipo de un día no se ofrece para quitar.
     *
     * rule ADayKeepsItsKind lo rechaza en el dominio, así que dibujar la cruz
     * sería ofrecer algo que el servidor va a negar. El valor sigue siendo
     * editable: lo que no se puede es dejar al día sin decir que es un día.
     */
    if (!(day && property.key === 'type')) {
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
    }

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
   * Un día no lleva front matter: lleva su fecha. Pero sí lleva propiedades.
   *
   * Antes se le retiraba `+ propiedad` para no repetir aparato encima de cada
   * jornada. El coste apareció en cuanto alguien quitó el tipo de un día: la
   * página quedaba sin ninguna forma de devolvérselo, porque el único sitio
   * desde el que se pone una propiedad era el botón que no se dibujaba. Una
   * puerta que sólo abre hacia fuera.
   *
   * Ver @guarantee TheKindIsRestorableWhereItIsRemovable: ninguna superficie
   * puede ofrecer quitar sin ofrecer poner. Lo que sigue fuera del día es la
   * marca de visibilidad, que no es una acción sino un estado.
   */
  header.append(properties, add);

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
      {
        label: 'Eliminar la página',
        run: () => void deletePage(page, callbacks),
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

      /*
       * Un bloque que pregunta se contesta al leerse.
       *
       * No hay nada que pulsar ni nada que guardar: se pregunta al dibujar la
       * página, contra el grafo como esté entonces. Guardar la respuesta sería
       * guardar una lista que envejece sin decirlo.
       */
      if (looksLikeQuery(node.block.content)) {
        answerQueryBlock(body, node.block.content, { onNavigate: callbacks.onNavigate });
      }
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
        /*
         * Explicar por qué esta página y aquélla se tocan.
         *
         * Desde aquí y no desde otro sitio: el momento en que alguien sabe por
         * qué dos páginas se tocan es el momento en que las está mirando
         * juntas. Lo que sale es un bloque hijo —la conectiva— que se escribe
         * como cualquier otro; lo que Vera pone es a dónde apunta y con qué
         * término, que es lo que hace que la relación se pueda leer desde el
         * otro extremo.
         */
        {
          label: 'Explicar relación…',
          run: () => explainFrom(body, node.block, page.id, toast, callbacks),
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

      /*
       * Con Shift se escoge el tramo en vez de abrir el bloque.
       *
       * @invariant ASelectionIsWhatIsOnScreenBetweenTwoBlocks: el tramo corre
       * sobre lo dibujado. Y no se abre el editor, porque escoger y escribir son
       * respuestas distintas a la misma pregunta.
       */
      if (event.shiftKey) {
        event.preventDefault();
        const from = pickedOn ?? node.block.stableId;
        pickedOn = from;
        pickRange(from, node.block.stableId);
        window.getSelection()?.removeAllRanges();
        return;
      }
      // Empezar a escribir deshace lo escogido. @invariant NothingIsSelectedWhileWriting.
      if (picked.size > 0) clearPicked();
      pickedOn = node.block.stableId;
      pickedTo = node.block.stableId;
      openEditor(node, body);
    });

    row.append(bullet, body);
    list.append(row);
    editors.set(node.block.stableId, { node, body });
    // El orden de lectura, que es este y no el del arbol guardado.
    visible.push(node.block.stableId);
    rows.set(node.block.stableId, row);
    if (picked.has(node.block.stableId)) row.classList.add('picked');
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

  // ---------------------------------------------------------------------
  // Escoger varios bloques.
  // ---------------------------------------------------------------------

  /*
   * El orden en que se lee, que no es el orden en que se guarda.
   *
   * @invariant ASelectionIsWhatIsOnScreenBetweenTwoBlocks. `drawBlock` va
   * anadiendo aqui, asi que esta lista es literalmente lo dibujado y en su
   * orden. Un subarbol plegado no se dibuja y por tanto no esta: nadie lo
   * escogio, porque nadie lo estaba viendo.
   */
  const visible: string[] = [];
  const rows = new Map<string, HTMLElement>();

  const paintPicked = (): void => {
    for (const [id, row] of rows) row.classList.toggle('picked', picked.has(id));
  };

  /** Todo lo que cuelga de un bloque, este dibujado o plegado. */
  const withDescendants = (id: string): string[] => {
    const node = findNode(tree, id);
    if (node === null) return [id];
    const out: string[] = [];
    const walk = (at: Node): void => {
      out.push(at.block.stableId);
      for (const child of at.children) walk(child);
    };
    walk(node);
    return out;
  };

  const pickRange = (from: string, to: string): void => {
    const a = visible.indexOf(from);
    const b = visible.indexOf(to);
    if (a < 0 || b < 0) return;
    picked.clear();
    for (const id of visible.slice(Math.min(a, b), Math.max(a, b) + 1)) picked.add(id);
    pickedTo = to;
    paintPicked();
  };

  /**
   * Mueve un bloque el extremo suelto del tramo, en el orden en que se lee.
   *
   * Mueve el extremo, no el borde de lo escogido: asi recoger deshace estirar,
   * y el tramo puede cruzar el ancla y crecer al otro lado, que es lo que hace
   * cualquier seleccion con Shift desde que existen las listas.
   */
  const stretch = (by: 1 | -1): void => {
    if (pickedOn === null) return;
    const at = visible.indexOf(pickedTo ?? pickedOn);
    if (at < 0) return;
    const next = visible[at + by];
    if (next === undefined) return;
    pickRange(pickedOn, next);
  };

  /** El padre de un bloque, segun la pagina y no segun el arbol dibujado. */
  const parentOf = (id: string): string | null =>
    page.blocks.find((b) => b.stableId === id)?.parent ?? null;

  /** Los hijos de alguien, en su orden. */
  const childrenOf = (parent: string | null): BlockView[] =>
    page.blocks.filter((b) => b.parent === parent).sort((a, b) => a.position - b.position);

  /**
   * Los escogidos que no cuelgan de otro escogido.
   *
   * Mover un padre se lleva a sus hijos por definicion, asi que mover ademas al
   * hijo seria moverlo dos veces y dejarlo donde no se pidio. En orden de
   * lectura, que es el que importa para decidir quien entra donde.
   */
  const pickedRoots = (): string[] => {
    const under = (id: string): boolean => {
      let at = parentOf(id);
      let hops = 0;
      while (at !== null && hops < 1000) {
        if (picked.has(at)) return true;
        at = parentOf(at);
        hops += 1;
      }
      return false;
    };
    return visible.filter((id) => picked.has(id) && !under(id));
  };

  /**
   * Indentar o desindentar lo escogido, con la misma semantica que un bloque suelto.
   *
   * Indentar: cada uno pasa a ser hijo del hermano de encima, al final de sus
   * hijos. Desindentar: cada uno pasa a colgar de su abuelo, justo detras de su
   * antiguo padre. Es literalmente lo que `resolveTab` decide para uno solo; lo
   * unico que anade un tramo es el orden en que se envian los movimientos.
   *
   * Indentando se va de arriba abajo: el hermano de encima de un tramo de
   * hermanos es el mismo para todos —el primero que no se esta moviendo— y al
   * anadirse al final por turnos conservan su orden. Desindentando se va de abajo
   * arriba: cada uno se mete justo detras del padre, asi que procesar al reves es
   * lo que los deja en el orden en que estaban.
   */
  const shiftPicked = async (deeper: boolean): Promise<void> => {
    const roots = pickedRoots();
    if (roots.length === 0) return;

    const moves: Change[] = [];
    for (const id of deeper ? roots : [...roots].reverse()) {
      const parent = parentOf(id);
      if (deeper) {
        const brothers = childrenOf(parent);
        const at = brothers.findIndex((b) => b.stableId === id);
        // El hermano de encima que no se este moviendo tambien.
        let into: string | null = null;
        for (let i = at - 1; i >= 0; i -= 1) {
          const candidate = brothers[i]?.stableId;
          if (candidate !== undefined && !picked.has(candidate)) {
            into = candidate;
            break;
          }
        }
        if (into === null) continue;
        moves.push({
          kind: 'move_block',
          block: id,
          page: page.id,
          parent: into,
          position: Number.MAX_SAFE_INTEGER,
        });
        continue;
      }
      if (parent === null) continue;
      const grand = parentOf(parent);
      const uncles = childrenOf(grand);
      const at = uncles.findIndex((b) => b.stableId === parent);
      moves.push({ kind: 'move_block', block: id, page: page.id, parent: grand, position: at + 1 });
    }

    if (moves.length === 0) {
      toast(deeper ? 'no hay un hermano encima al que entrar' : 'ya están en el primer nivel');
      return;
    }
    for (const move of moves) {
      if (!(await submitQuietly(move))) break;
    }
    // Lo escogido sigue escogido: se puede volver a pulsar Tab sin reapuntar.
    callbacks.onReload(null);
  };

  /*
   * Quitar lo escogido.
   *
   * @invariant ASelectionIsRemovedLeavesFirst. El grafo no quita un bloque que
   * todavia tenga hijos, asi que se va de abajo hacia arriba y con una operacion
   * por bloque: la secuencia queda auditable paso a paso, igual que vaciar una
   * pagina.
   *
   * @invariant SelectingAParentSelectsWhatHangsFromIt: un bloque escogido con su
   * subarbol plegado se lleva el subarbol, y el aviso lo dice antes.
   *
   * @invariant DiscardingASelectionIsDeliberate.
   */
  const dropPicked = async (): Promise<void> => {
    if (picked.size === 0) return;
    const all = new Set<string>();
    for (const id of picked) for (const each of withDescendants(id)) all.add(each);

    const written = [...all].filter((id) => {
      const node = findNode(tree, id);
      return node !== null && node.block.content.trim() !== '';
    }).length;

    if (written > 0) {
      const cuenta =
        all.size === picked.size
          ? `${all.size} bloques`
          : `${picked.size} bloques y lo que cuelga de ellos, ${all.size} en total`;
      if (!window.confirm(`Se van a eliminar ${cuenta}. No se puede deshacer.`)) return;
    }

    // Las hojas primero: profundidad descendente sobre el arbol de la pagina.
    const depthOf = (id: string): number => {
      let depth = 0;
      let at = page.blocks.find((b) => b.stableId === id)?.parent ?? null;
      while (at !== null && depth < 1000) {
        depth += 1;
        at = page.blocks.find((b) => b.stableId === at)?.parent ?? null;
      }
      return depth;
    };
    const order = [...all].sort((x, y) => depthOf(y) - depthOf(x));

    clearPicked();
    for (const id of order) {
      if (!(await submitQuietly({ kind: 'remove_block', block: id }))) break;
    }
    callbacks.onReload(null);
  };

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

  /*
   * Las teclas que actuan sobre lo escogido.
   *
   * Cuelgan del documento y no de un elemento porque una seleccion no tiene
   * foco: no hay nada donde escribir mientras esta puesta, y ese es justo su
   * significado. Se retira el oyente al volver a dibujar, o se acumularia uno
   * por repintado.
   */
  const onPickedKeys = (event: KeyboardEvent): void => {
    // Escribiendo manda el cursor: la seleccion ya se deshizo al abrir el editor.
    const at = document.activeElement;
    if (at instanceof HTMLTextAreaElement || at instanceof HTMLInputElement) return;
    if (at instanceof HTMLElement && at.isContentEditable) return;

    if (event.key === 'Escape' && picked.size > 0) {
      event.preventDefault();
      clearPicked();
      return;
    }
    if (event.shiftKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      if (pickedOn === null) return;
      event.preventDefault();
      // La primera vez escoge el bloque de partida; a partir de ahi, estira.
      if (picked.size === 0) {
        picked.add(pickedOn);
        pickedTo = pickedOn;
        paintPicked();
      }
      stretch(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && picked.size > 0) {
      event.preventDefault();
      void dropPicked();
      return;
    }
    if (event.key === 'Tab' && picked.size > 0) {
      // Sin esto, Tab se lleva el foco a otro control y la seleccion se queda
      // puesta sobre algo que ya no responde a las teclas.
      event.preventDefault();
      void shiftPicked(!event.shiftKey);
    }
  };
  document.addEventListener('keydown', onPickedKeys);
  dropPickedKeys = (): void => document.removeEventListener('keydown', onPickedKeys);

  // Los diagramas se dibujan después del texto: la biblioteca se carga sola y
  // la página no espera por ella para poder leerse.
  void renderMermaid(list);

  /*
   * Las dos columnas: lo que esta página afirma y lo que afirman sobre ella.
   *
   * Van antes de las referencias y no después, y son cosa distinta de ellas. Un
   * retroenlace dice que alguien nombró esta página; una relación dice qué dijo
   * al nombrarla. Se ven las relaciones explicadas existan o no menciones entre
   * las dos páginas, y no se ven las menciones que nadie explicó: son dos
   * preguntas distintas y ésta es la segunda.
   */
  for (const [rows, name, outgoing] of [
    [page.crossingsOut ?? [], 'Afirma sobre otras', true],
    [page.crossingsIn ?? [], 'Afirman sobre ésta', false],
  ] as [CrossingRow[], string, boolean][]) {
    if (rows.length === 0) continue;

    const folded = foldingSection(`rel:${name}`, `${name} (${rows.length})`, 2);
    folded.section.classList.add('relations');
    const section = folded.body;

    const list = document.createElement('ul');
    for (const row of rows) {
      const item = document.createElement('li');
      item.className = 'relation';

      // El término, cuando lo hay. Sin él la fila dice lo mismo con una palabra
      // menos: explicar no exige clasificar.
      if (row.reads !== null) {
        const term = document.createElement('span');
        term.className = 'relation-term';
        term.textContent = row.reads;
        item.append(term);
      }

      const other = document.createElement('button');
      other.type = 'button';
      other.className = 'relation-page';
      other.textContent = row.title;
      // Un destino que nadie ha escrito se ve como lo que es: la relación está
      // en pie y la página todavía no.
      if (outgoing && row.toPage === null) other.classList.add('unresolved');
      other.addEventListener('click', () =>
        callbacks.onOpen(outgoing ? (row.toPage ?? row.targetTitle) : row.fromPage, 'followed_reference'),
      );
      item.append(other);

      // Lo dicho, que es la relación misma, y debajo la frase desde la que se
      // afirma: una relación sin su frase es una flecha sin sujeto.
      const said = document.createElement('p');
      said.className = 'relation-said';
      said.textContent = row.said;
      item.append(said);

      const from = document.createElement('p');
      from.className = 'relation-from';
      from.textContent = row.says;
      item.append(from);

      list.append(item);
    }
    section.append(list);
    container.append(folded.section);
  }

  /*
   * Referencias: una sola sección, en los dos sentidos.
   *
   * El pie contestaba media pregunta —quién habla de esta página— y la otra
   * mitad, de qué habla ella, estaba sólo dentro del texto: para saber de qué es
   * vecina una página había que releerla entera.
   *
   * Las dos columnas van a la par porque son la misma pregunta mirada desde los
   * dos lados. Las que van en los dos sentidos van debajo y juntas, porque no
   * son dos hechos sino uno: dos páginas que se nombran mutuamente están
   * relacionadas de una manera que ninguna de las dos columnas dice por
   * separado, y repetirlas arriba las contaría dos veces.
   *
   * Y cada renglón lleva su pluma. El momento en que alguien sabe por qué dos
   * páginas se tocan es el momento en que las está mirando juntas, y aquí están
   * juntas: explicar desde otro sitio sería pedirle que se acuerde después.
   */
  {
    const out = new Map((page.references ?? []).map((one) => [one.title.toLowerCase(), one]));
    const back = new Map<string, (typeof page.backlinks)[number]>();
    for (const one of page.backlinks) {
      if (!back.has(one.title.toLowerCase())) back.set(one.title.toLowerCase(), one);
    }

    interface Row {
      title: string;
      page: string | null;
      excerpt: string;
      /** El bloque de esta página donde ocurre la mención, si ocurre aquí. */
      from: string | null;
      /** Y lo que la otra dice de ésta, cuando se nombran las dos. */
      says?: string;
    }

    const both: Row[] = [];
    for (const [key, one] of out) {
      const other = back.get(key);
      if (other === undefined) continue;
      both.push({
        title: one.title,
        page: one.page,
        excerpt: one.excerpt,
        from: one.block,
        says: other.excerpt,
      });
    }
    const mutual = new Set(both.map((one) => one.title.toLowerCase()));
    const names: Row[] = [...out.values()]
      .filter((one) => !mutual.has(one.title.toLowerCase()))
      .map((one) => ({ title: one.title, page: one.page, excerpt: one.excerpt, from: one.block }));
    const named: Row[] = [...back.values()]
      .filter((one) => !mutual.has(one.title.toLowerCase()))
      .map((one) => ({ title: one.title, page: one.page, excerpt: one.excerpt, from: null }));

    if (both.length + names.length + named.length > 0) {
      const whole = foldingSection(
        'referencias',
        `Referencias (${both.length + names.length + named.length})`,
        2,
      );
      whole.section.classList.add('references');
      const section = whole.body;

      const list = (rows: Row[], gesture: 'followed_reference' | 'followed_backlink'): HTMLElement => {
        const ul = document.createElement('ul');
        for (const row of rows) {
          const item = document.createElement('li');
          item.className = 'reference';

          /*
           * La pluma, arriba a la izquierda. Explicar por qué estas dos páginas
           * se tocan es escribir, y lo que escribe cuelga del bloque donde la
           * mención ocurre —o, si la mención está en la otra página, de un bloque
           * nuevo al final de ésta, porque la afirmación es de aquí.
           */
          const quill = document.createElement('button');
          quill.type = 'button';
          quill.className = 'reference-explain';
          quill.innerHTML = icon('feather');
          quill.title = `explicar por qué ${row.title} tiene que ver con esta página`;
          quill.setAttribute('aria-label', `explicar la relación con ${row.title}`);
          quill.addEventListener('click', (event) => {
            event.stopPropagation();
            explainTowards(item, row.title, row.from, page, toast, callbacks);
          });

          const link = document.createElement('button');
          link.type = 'button';
          link.className = 'backlink';

          const where = document.createElement('span');
          where.className = 'backlink-page';
          where.textContent = row.title;
          // Una página nombrada y todavía sin escribir es una deuda a la vista,
          // no un enlace roto: se dibuja como lo que es.
          if (row.page === null) where.classList.add('unwritten');

          const said = document.createElement('span');
          said.className = 'backlink-excerpt';
          said.textContent = row.excerpt;

          link.append(where, said);
          if (row.says !== undefined) {
            const answers = document.createElement('span');
            answers.className = 'backlink-excerpt reciprocal';
            answers.textContent = row.says;
            link.append(answers);
          }
          link.addEventListener('click', () => callbacks.onOpen(row.page ?? row.title, gesture));

          item.append(quill, link);
          ul.append(item);
        }
        return ul;
      };

      const columns = document.createElement('div');
      columns.className = 'reference-columns';
      for (const [name, rows, gesture] of [
        ['Nombra a', names, 'followed_reference'],
        ['La nombran', named, 'followed_backlink'],
      ] as [string, Row[], 'followed_reference' | 'followed_backlink'][]) {
        if (rows.length === 0) continue;
        const column = foldingSection(`ref:${name}`, `${name} (${rows.length})`, 3);
        column.section.classList.add('reference-column');
        column.body.append(list(rows, gesture));
        columns.append(column.section);
      }
      if (columns.children.length > 0) section.append(columns);

      if (both.length > 0) {
        const mutuals = foldingSection(
          'ref:ambos',
          `En los dos sentidos (${both.length})`,
          3,
        );
        mutuals.section.classList.add('reference-mutual');
        mutuals.body.append(list(both, 'followed_reference'));
        section.append(mutuals.section);
      }

      container.append(whole.section);
    }
  }
}

/*
 * Lo plegado al pie, recordado mientras dure la sesión.
 *
 * Cada guardado redibuja la página entera, así que sin esto una sección plegada
 * se abriría sola en cuanto alguien escribiera una letra. No baja al corpus: qué
 * tiene uno plegado es del taller, como lo es dónde está el divisor.
 */
const shutBelow = new Set<string>();

/**
 * Una sección del pie que se pliega.
 *
 * `details` y `summary` del navegador y no un botón propio: traen el teclado, el
 * lector de pantalla y el triángulo sin que haya que escribirlos, y lo que se
 * pliega sigue estando en el documento —se encuentra buscando en la página.
 */
function foldingSection(name: string, label: string, level: 2 | 3): {
  section: HTMLElement;
  body: HTMLElement;
} {
  const section = document.createElement('details');
  section.className = 'folding';
  section.open = !shutBelow.has(name);
  section.addEventListener('toggle', () => {
    if (section.open) shutBelow.delete(name);
    else shutBelow.add(name);
  });

  const head = document.createElement('summary');
  const title = document.createElement(level === 2 ? 'h2' : 'h3');
  title.textContent = label;
  head.append(title);

  const body = document.createElement('div');
  body.className = 'folding-body';

  section.append(head, body);
  return { section, body };
}

/**
 * Explica una relación cuyo destino ya se sabe.
 *
 * Desde una referencia, la página del otro extremo no hay que preguntarla: está
 * ahí, es la que se está mirando. Lo que falta es lo único que Vera no puede
 * poner, así que la caja pide eso —la frase— y, delante de dos puntos, el
 * término si se quiere: `profundiza: su rejilla se vuelve generativa`.
 */
async function explainTowards(
  host: HTMLElement,
  title: string,
  from: string | null,
  page: PageView,
  notify: (message: string) => void,
  callbacks: OutlinerCallbacks,
): Promise<void> {
  const asking = document.createElement('div');
  asking.className = 'relation-ask';
  host.append(asking);

  editInPlace(asking, '', `por qué ${title} tiene que ver con esta página`, async (said) => {
    const clean = said.trim();
    if (clean === '') {
      asking.remove();
      return true;
    }

    const split = termAndProse(clean);

    /*
     * Dónde cuelga lo que se escribe.
     *
     * Si la mención ocurre en esta página, del bloque que la dice: ahí es donde
     * la afirmación tiene sujeto. Si ocurre en la otra —alguien nos nombró—, lo
     * que se está escribiendo es texto nuevo de esta página, y va al final como
     * cualquier cosa que se escribe.
     */
    const roots = page.blocks.filter((block) => block.parent === null).length;
    const born = await api.submit(
      from === null
        ? { kind: 'create_block', page: page.id, parent: null, position: roots, content: split.prose }
        : { kind: 'create_block', page: page.id, parent: from, position: 0, content: split.prose },
    );
    if (born.status === 'rejected') {
      notify(`no se pudo explicar: ${born.reason}`);
      asking.remove();
      return true;
    }

    const puesta = await api.submit({
      kind: 'set_property',
      block: born.subjectId,
      propertyKey: 'explica',
      propertyValue: `[[${title}]]`,
    });
    if (puesta.status === 'rejected') {
      notify(`no se pudo explicar: ${puesta.reason}`);
      asking.remove();
      return true;
    }

    if (split.term !== null) {
      await api.submit({
        kind: 'set_property',
        block: born.subjectId,
        propertyKey: 'término',
        propertyValue: split.term,
      });
    }

    notify(`explicada la relación con ${title}`);
    callbacks.onReload(null);
    return true;
  });
}

/**
 * Parte «profundiza: la frase» en su término y su frase.
 *
 * Los dos puntos y no un espacio: el término puede llevarlos —«precede a»— y la
 * frase empieza por donde sea. Sin dos puntos, todo es frase: la prosa es
 * obligatoria y clasificar no.
 */
export function termAndProse(said: string): { term: string | null; prose: string } {
  const at = said.indexOf(':');
  if (at === -1) return { term: null, prose: said.trim() };
  const term = said.slice(0, at).trim();
  const prose = said.slice(at + 1).trim();
  // Unos dos puntos con media frase delante no son un término: son puntuación.
  if (term === '' || term.length > 24 || prose === '') return { term: null, prose: said.trim() };
  return { term, prose };
}

/**
 * Pregunta a qué página apunta esta relación, y con qué término.
 *
 * Se escribe en una línea —`profundiza [[Guemil]]`— porque son dos cosas y
 * pedirlas en dos pasos convertiría en trámite lo que es un apunte. El término
 * es lo que va delante y puede no ir: la prosa es obligatoria y clasificar no.
 */
export function explanationIn(said: string): { title: string; term: string | null } | null {
  const linked = /\[\[([^\]]+)\]\]/.exec(said);
  const title = (linked?.[1] ?? '').trim();
  if (title === '') {
    // Sin corchetes, lo escrito es el título entero y no hay término: adivinar
    // dónde acaba uno y empieza el otro sería inventarse una separación.
    const bare = said.trim();
    return bare === '' ? null : { title: bare, term: null };
  }
  const before = said.slice(0, linked?.index ?? 0).trim();
  return { title, term: before === '' ? null : before };
}

/**
 * Crea la conectiva: un bloque que cuelga de aquel desde el que se afirma.
 *
 * Tres operaciones ordinarias y ninguna propia —@guarantee
 * ComposingIsWritingAndNothingElse—: el bloque, a dónde apunta y, si se dijo,
 * con qué término. Después se abre para escribir, porque lo que falta es
 * justamente lo único que Vera no puede poner.
 */
async function explainFrom(
  host: HTMLElement,
  from: BlockView,
  page: string,
  notify: (message: string) => void,
  callbacks: OutlinerCallbacks,
): Promise<void> {
  // Se pregunta donde se está leyendo, en un renglón bajo el bloque, y no en un
  // diálogo del navegador: lo que se está haciendo es escribir sobre lo que se
  // tiene delante, y un cuadro modal tapa justamente eso.
  const asking = document.createElement('div');
  asking.className = 'relation-ask';
  host.append(asking);

  editInPlace(asking, '', 'término y página, p. ej. profundiza [[Guemil]]', async (said) => {
    const asked = explanationIn(said);
    if (asked === null) {
      notify('hace falta una página a la que apuntar');
      asking.remove();
      return true;
    }

    const born = await api.submit({
      kind: 'create_block',
      page,
      parent: from.stableId,
      position: 0,
      content: '',
    });
    if (born.status === 'rejected') {
      notify(`no se pudo explicar: ${born.reason}`);
      asking.remove();
      return true;
    }

    const connective = born.subjectId;
    const puesta = await api.submit({
      kind: 'set_property',
      block: connective,
      propertyKey: 'explica',
      propertyValue: `[[${asked.title}]]`,
    });
    if (puesta.status === 'rejected') {
      notify(`no se pudo explicar: ${puesta.reason}`);
      asking.remove();
      return true;
    }

    if (asked.term !== null) {
      await api.submit({
        kind: 'set_property',
        block: connective,
        propertyKey: 'término',
        propertyValue: asked.term,
      });
    }

    notify(`explicada la relación con ${asked.title}`);
    // El cursor donde va lo que falta: la frase. Es lo único que Vera no puede
    // poner, y es la relación entera.
    callbacks.onReload({ block: connective, at: 0 });
    return true;
  });
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
  body.classList.add('editing');

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
    body.classList.remove('editing');
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

    // Editada la pregunta, se vuelve a preguntar. Es lo mismo que hace el
    // dibujado inicial: la respuesta no vive en ninguna parte, así que no hay
    // nada que invalidar —sólo hay que volver a pedirla.
    if (looksLikeQuery(content)) {
      answerQueryBlock(body, content, { onNavigate: callbacks.onNavigate });
    }

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

    /*
     * Importar tampoco escribe aquí: trae una página y lleva a ella.
     *
     * El selector de archivos tiene que abrirse dentro del gesto que lo pidió, o
     * el navegador lo bloquea por venir de nadie. Por eso se abre ya y se espera
     * después, y no al revés.
     *
     * @guarantee TheImportedPageOpensAtOnce: al terminar se va a la página nueva.
     * Importar y luego tener que ir a buscar dónde quedó lo importado son dos
     * actos donde debería haber uno.
     */
    if (acts === 'importar') {
      const chooser = document.createElement('input');
      chooser.type = 'file';
      chooser.accept = '.md,.markdown,.txt,.docx,text/markdown,text/plain';
      chooser.style.display = 'none';
      document.body.append(chooser);
      chooser.addEventListener('change', () => {
        const file = chooser.files?.[0];
        chooser.remove();
        if (file === undefined) return;
        toast(`trayendo ${file.name}…`);
        void api.importDocument(file).then((brought) => {
          if ('error' in brought) {
            toast(brought.error);
            return;
          }
          // @guarantee WhatWasLostIsSaidOnArrival: si algo no se supo traer se
          // dice al llegar y en palabras, no semanas después al echarlo de menos.
          const missing = brought.losses.length === 0 ? '' : ` · ${brought.losses.join('; ')}`;
          toast(`${brought.title}: ${brought.blocks} bloques${missing}`);
          callbacks.onNavigate(brought.title);
        });
      });
      chooser.click();
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
      // El autopar se come su propia tecla, así que aquí no llega ningún evento
      // `input` y nadie mira el disparador. Y el único instante en que `[[`
      // queda a la izquierda del cursor es exactamente éste: si pasa sin que se
      // consulte, ya no vuelve, porque a la siguiente letra el texto de delante
      // deja de terminar en el disparador. Por eso `[[` no completaba nada.
      refreshList();
    }
  });
}
