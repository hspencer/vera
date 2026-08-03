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
  matchingCommands,
  queryOf,
  type Open,
} from './autocomplete.ts';
import {
  renderAudioBlock,
  renderRecorder,
  type AudioBlockHandlers,
} from './audio-block.ts';
import { audioUrl, voice, type Recording } from './voice.ts';
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
  onOpen(page: string): void;
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

  row.remove();
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
  callbacks.onOpen(result.subjectId);
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
  }[];
  types: string[];
  tags: string[];
  notDone: string[];
}

/**
 * Procesa la página y enseña lo que se leyó.
 *
 * Nada de esto se aplica: lo que se ve es una lectura, y quien decide qué hacer
 * con ella es quien la pidió. @invariant ProcessingProposesAndNothingMore.
 */
async function processPage(
  page: { id: string; title: string },
  notify: (message: string) => void,
): Promise<void> {
  notify('leyendo la página y sus enlaces…');
  let reading: PageReading;
  try {
    const answer = await fetch(`/pages/${encodeURIComponent(page.id)}/process`, { method: 'POST' });
    if (!answer.ok) {
      notify('no se pudo procesar la página');
      return;
    }
    reading = (await answer.json()) as PageReading;
  } catch {
    notify('no se pudo procesar: sin conexión con el servidor');
    return;
  }

  const panel = document.querySelector<HTMLElement>('#tokens');
  if (panel === null) return;
  panel.hidden = false;
  panel.innerHTML = '';

  const head = document.createElement('header');
  head.className = 'settings-head';
  const title = document.createElement('h2');
  title.textContent = `Lectura de «${page.title}»`;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'settings-close';
  close.textContent = 'cerrar';
  close.addEventListener('click', () => {
    panel.hidden = true;
    panel.innerHTML = '';
  });
  head.append(title, close);
  panel.append(head);

  const body = document.createElement('div');
  body.className = 'settings-body';
  panel.append(body);

  const note = document.createElement('p');
  note.className = 'settings-note';
  note.textContent =
    'Esto es una lectura, no un cambio. Nada de lo que aparece aquí se ha escrito ' +
    'en la página: procesarla y luego cerrar esto la deja exactamente como estaba.';
  body.append(note);

  // Lo que no se pudo hacer va primero. Un resultado parcial callado se lee como
  // uno completo. @guarantee ProcessingSaysWhatItDidAndWhatItCouldNot.
  if (reading.notDone.length > 0) {
    const missing = document.createElement('ul');
    missing.className = 'reading-missing';
    for (const line of reading.notDone) {
      const item = document.createElement('li');
      item.textContent = line;
      missing.append(item);
    }
    body.append(missing);
  }

  if (reading.links.length === 0) {
    const none = document.createElement('p');
    none.className = 'settings-note';
    none.textContent = 'La página no nombra ninguna dirección.';
    body.append(none);
    return;
  }

  const heading = document.createElement('h3');
  heading.className = 'settings-group';
  heading.textContent = `Enlaces (${reading.links.length})`;
  body.append(heading);

  for (const link of reading.links) {
    const row = document.createElement('div');
    row.className = 'reading-link';

    const what = document.createElement('span');
    what.className = 'reading-title';
    what.textContent = link.title ?? link.url;
    row.append(what);

    const meta = document.createElement('span');
    meta.className = 'reading-meta';
    meta.textContent =
      link.unreachable !== null ? link.unreachable : `${link.kind ?? 'desconocido'} · ${link.url}`;
    row.append(meta);

    // El título se copia; no se escribe solo. La dirección del bloque no se
    // toca: @guarantee ALinkResolvedKeepsItsAddress.
    if (link.title !== null) {
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'page-action';
      copy.textContent = 'copiar como enlace con título';
      copy.addEventListener('click', () => {
        void copyText(`[${link.title ?? ''}](${link.url})`, notify);
      });
      row.append(copy);
    }

    body.append(row);
  }
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

  // El título es contenido, así que se edita como contenido. Renombrar una
  // página es una operación como cualquier otra.
  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = page.title;
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
  header.append(title);

  // El front matter no es decoración: son propiedades del grafo, y se editan.
  const properties = document.createElement('dl');
  properties.className = 'properties';

  for (const property of page.properties) {
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
    value.textContent = property.value;
    value.tabIndex = 0;
    value.title = 'editar el valor';
    value.addEventListener('click', () => {
      editInPlace(value, property.value, `valor de ${property.key}`, async (next) => {
        if (next === property.value) return true;
        return submitAndReload(
          {
            kind: 'set_property',
            page: page.id,
            propertyKey: property.key,
            propertyValue: next,
          },
          callbacks,
        );
      });
    });

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

  header.append(properties, add);

  /*
   * Público o privado, como interruptor.
   *
   * Era una etiqueta que sólo decía el estado, así que cambiarlo no tenía dónde
   * hacerse. Nace apagado —una página es privada hasta que alguien decide lo
   * contrario— y sólo lo mueve una persona: @invariant OnlyTheOwnerPublishes.
   *
   * El `public::` que traen las páginas importadas de Logseq es otra cosa: una
   * propiedad de texto que duplica esto sin gobernarlo. Se sigue viendo en el
   * front matter porque es contenido del corpus, y quien manda es este.
   */
  const badge = document.createElement('button');
  badge.type = 'button';
  const publica = page.visibility === 'public';
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
  header.append(badge);

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
  more.innerHTML = icon('more-horizontal');
  more.addEventListener('click', (event) => {
    event.stopPropagation();
    openBlockMenu(more, [
      {
        // Deliberado y sobre esta página, nunca de oficio: resolver un enlace es
        // preguntarle al servidor que lo tiene, y eso le dice que aquí alguien
        // está leyendo sobre esto.
        label: 'Procesar la página',
        run: () => void processPage(page, toast),
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

    // Un bloque que le guarda el lugar a una grabación muestra la grabación:
    // todavía no tiene texto, y lo que hay que ver es en qué eslabón va.
    const waiting = held.get(node.block.stableId);
    const speaking = speakingIn === node.block.stableId;
    if (speaking) speakingIn = null;
    const holding = speaking || (waiting !== undefined && waiting.stage !== 'content_settled');
    if (speaking) {
      renderRecorder(body, node.block.stableId, audioHandlers);
    } else if (waiting !== undefined && waiting.stage !== 'content_settled') {
      renderAudioBlock(body, waiting, audioHandlers);
    } else {
      body.innerHTML = renderMarkdown(node.block.content, options);
      markMissingImages(body);
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
        // @guarantee TheRecordingIsAlwaysReachable: mientras el audio exista, se
        // llega a él desde el bloque que dice lo que se dijo. Vive en el menú y
        // no en la página para que leer siga siendo leer.
        ...(waiting !== undefined && waiting.stage === 'content_settled' && waiting.audioHash !== null
          ? [
              {
                label: 'Oír la grabación',
                run: () => {
                  const url = audioUrl(waiting);
                  if (url !== null) window.open(url, '_blank');
                },
              },
              {
                label: 'Borrar el audio',
                run: () => {
                  void voice.discardAudio(waiting.id).then((next) => {
                    if ('error' in next) {
                      toast(next.error);
                      return;
                    }
                    toast('el audio se borró; queda lo que dice y de dónde vino');
                    callbacks.onReload(null);
                  });
                },
              },
            ]
          : []),
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
        if (callbacks.onOpenBlock === undefined) callbacks.onOpen(ref.page);
        else callbacks.onOpenBlock(ref.page, ref.id);
        return;
      }
      if (target.tagName === 'A') return;
      // Sobre una grabación no se escribe: el bloque le guarda el lugar hasta
      // que su contenido se asiente, y abrir el editor lo taparía.
      if (holding) return;
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
  if (tree.length === 0) {
    const empty = document.createElement('button');
    empty.type = 'button';
    empty.className = 'first-block';
    empty.textContent = 'escribir el primer bloque';
    empty.addEventListener('click', () => {
      void api
        .submit({ kind: 'create_block', page: page.id, parent: null, position: 0, content: '' })
        .then((result) => {
          if (result.status === 'rejected') {
            toast(`rechazado: ${result.reason}`);
            return;
          }
          callbacks.onReload({ block: result.subjectId, at: 0 });
        })
        .catch(() => toast('no se pudo crear el bloque: sin conexión con el servidor'));
    });
    list.append(empty);
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
      link.addEventListener('click', () => callbacks.onOpen(backlink.page));
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

  body.innerHTML = '';
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

  const render = (content: string): void => {
    body.innerHTML = renderMarkdown(content, options);
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
