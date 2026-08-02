// Outliner de bloques con edición Markdown nativa.
//
// @invariant SourceRemainsMarkdown: al editar se ve y se guarda el Markdown del
// bloque, no un formato opaco. Al salir del bloque se renderiza una vista
// mínima y el original sigue siendo la fuente.
//
// Cada edición emite una operación. No hay guardado implícito ni estado local
// que pueda divergir del grafo.

import { api, type BlockView, type PageView } from './api.ts';

export interface OutlinerCallbacks {
  onNavigate(title: string): void;
  onOpen(page: string): void;
  onChanged(): void;
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

/** Render mínimo de Markdown en línea. La fuente nunca se pierde. */
export function inlineMarkdown(source: string): string {
  const escaped = source
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    .replace(/\[\[([^\]]+)\]\]/g, '<a class="wiki" data-page="$1" href="#">$1</a>')
    .replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, '$1<span class="tag">#$2</span>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
    .replace(/\[([^\]]*)\]\((https?:[^)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>')
    .replace(/\n/g, '<br>');
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

export function renderOutliner(
  container: HTMLElement,
  page: PageView,
  callbacks: OutlinerCallbacks,
): void {
  container.innerHTML = '';

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

    const bullet = document.createElement('span');
    bullet.className = 'bullet';
    bullet.title = node.block.stableId;
    bullet.textContent = '•';

    const body = document.createElement('div');
    body.className = 'body';
    body.innerHTML = inlineMarkdown(node.block.content);

    // Al enfocar, el bloque muestra su Markdown; al salir, su render.
    body.tabIndex = 0;
    body.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.classList.contains('wiki')) {
        event.preventDefault();
        callbacks.onNavigate(target.dataset['page'] ?? '');
        return;
      }
      if (target.tagName === 'A') return;
      startEditing(node.block, body, callbacks);
    });

    row.append(bullet, body);
    list.append(row);
    for (const child of node.children) drawBlock(child, depth + 1);
  };

  for (const root of buildTree(page.blocks)) drawBlock(root, 0);

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

function startEditing(block: BlockView, body: HTMLElement, callbacks: OutlinerCallbacks): void {
  if (body.querySelector('textarea') !== null) return;
  const original = block.content;
  const session = editSession(original);

  const editor = document.createElement('textarea');
  editor.className = 'editor';
  editor.value = original;
  editor.rows = Math.max(1, original.split('\n').length);

  body.innerHTML = '';
  body.append(editor);
  editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);

  const render = (content: string): void => {
    body.innerHTML = inlineMarkdown(content);
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
  });
}
