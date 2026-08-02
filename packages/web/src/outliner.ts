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

import { api, type BlockView, type PageView } from './api.ts';
import { renderMarkdown, type RenderOptions } from './markdown.ts';
import { renderMermaid } from './mermaid.ts';

export interface OutlinerCallbacks {
  onNavigate(title: string): void;
  onOpen(page: string): void;
  onChanged(): void;
  /** Seguir una referencia hasta el bloque que nombra. */
  onOpenBlock?(page: string, block: string): void;
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

  const at = anchor.getBoundingClientRect();
  menu.style.left = `${Math.round(at.left + window.scrollX)}px`;
  menu.style.top = `${Math.round(at.bottom + window.scrollY + 4)}px`;

  document.body.append(menu);
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

export type LeaveAction =
  | { action: 'ignore' }
  | { action: 'restore' }
  | { action: 'submit'; content: string };

/**
 * Una edición se resuelve una sola vez.
 *
 * Escape descarta y salir del bloque guarda, pero descartar retira del DOM el
 * campo enfocado y el navegador emite entonces un `blur` tardío. Sin este
 * guardián ese `blur` guardaba justamente lo que se acababa de descartar.
 */
export function editSession(original: string) {
  let settled = false;

  return {
    settled: (): boolean => settled,

    /** Salir del bloque: guarda si el texto cambió. */
    leave(next: string): LeaveAction {
      if (settled) return { action: 'ignore' };
      settled = true;
      if (next === original) return { action: 'restore' };
      return { action: 'submit', content: next };
    },

    /** Escape descarta: ninguna salida posterior puede guardar. */
    cancel(): LeaveAction {
      if (settled) return { action: 'ignore' };
      settled = true;
      return { action: 'restore' };
    },

    /** Un fallo al guardar devuelve la edición al usuario sin perder su texto. */
    reopen(): void {
      settled = false;
    },
  };
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

export interface Node {
  block: BlockView;
  children: Node[];
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
): void {
  container.innerHTML = '';
  const options: RenderOptions = {};
  const asset = assetResolver(page);
  if (asset !== undefined) options.resolveAsset = asset;
  const block = blockResolver(page);
  if (block !== undefined) options.resolveBlock = block;

  const header = document.createElement('header');
  header.className = 'page-header';

  const title = document.createElement('h1');
  title.textContent = page.title;
  header.append(title);

  if (page.properties.length > 0) {
    const properties = document.createElement('dl');
    properties.className = 'properties';
    for (const property of page.properties) {
      const key = document.createElement('dt');
      key.textContent = property.key;
      const value = document.createElement('dd');
      value.textContent = property.value;
      properties.append(key, value);
    }
    header.append(properties);
  }

  const badge = document.createElement('span');
  badge.className = `visibility ${page.visibility}`;
  badge.textContent = page.visibility === 'public' ? 'pública' : 'privada';
  header.append(badge);

  container.append(header);

  const list = document.createElement('div');
  list.className = 'blocks';
  container.append(list);

  const drawBlock = (node: Node, depth: number): void => {
    const row = document.createElement('div');
    row.className = 'block';
    row.style.paddingLeft = `${depth * 1.25}rem`;
    row.dataset['id'] = node.block.stableId;

    const bullet = document.createElement('button');
    bullet.type = 'button';
    bullet.className = 'bullet';
    bullet.title = node.block.stableId;
    bullet.textContent = '•';
    bullet.setAttribute('aria-haspopup', 'menu');
    bullet.setAttribute('aria-label', 'acciones del bloque');

    const body = document.createElement('div');
    body.className = 'body';
    body.innerHTML = renderMarkdown(node.block.content, options);
    markMissingImages(body);

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
      startEditing(node.block, body, callbacks, options, row);
    });

    row.append(bullet, body);
    list.append(row);
    for (const child of node.children) drawBlock(child, depth + 1);
  };

  for (const root of buildTree(page.blocks)) drawBlock(root, 0);

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

function startEditing(
  block: BlockView,
  body: HTMLElement,
  callbacks: OutlinerCallbacks,
  options: RenderOptions,
  row: HTMLElement,
): void {
  if (body.querySelector('textarea') !== null) return;
  const original = block.content;
  const session = editSession(original);

  const editor = document.createElement('textarea');
  editor.className = 'editor';
  editor.value = original;
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
  editor.addEventListener('input', autosize);

  editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);

  const render = (content: string): void => {
    body.innerHTML = renderMarkdown(content, options);
    markMissingImages(body);
    void renderMermaid(body);
  };

  const save = async (content: string): Promise<void> => {
    let result;
    try {
      result = await api.submit({ kind: 'edit_block', block: block.stableId, content });
    } catch {
      // Sin red no se pierde lo escrito: la edición vuelve al usuario tal cual.
      session.reopen();
      editor.classList.add('failed');
      editor.title = 'no se pudo guardar: sin conexión con el servidor';
      return;
    }

    if (result.status === 'rejected') {
      // El dominio rechazó el cambio: se restituye lo que había y se dice por qué.
      render(original);
      body.title = `rechazado: ${result.reason}`;
      return;
    }

    block.content = content;
    render(content);
    callbacks.onChanged();
  };

  const apply = (outcome: LeaveAction): void => {
    if (outcome.action === 'ignore') return;
    if (outcome.action === 'restore') {
      render(original);
      return;
    }
    void save(outcome.content);
  };

  editor.addEventListener('blur', () => apply(session.leave(editor.value)));
  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      apply(session.cancel());
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      editor.blur();
    }

    // @invariant OnlyEmptyBlocksAreDiscarded: sólo se elimina un bloque que ya
    // está vacío, así que esta tecla nunca puede llevarse texto por delante.
    // Vaciarlo y pulsar una vez más es la forma de descartarlo.
    if (event.key === 'Backspace' && editor.value === '') {
      event.preventDefault();
      // Se resuelve la sesión antes de retirar el campo: si no, el `blur` que
      // provoca quitarlo del DOM intentaría guardar el bloque recién eliminado.
      session.cancel();
      void removeBlock(block, row, callbacks);
    }
  });
}
