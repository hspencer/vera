// El espacio de trabajo de Vera.
//
// Texto y grafo comparten página activa e historial, así que cambiar de
// disposición no pierde el lugar en el grafo (@guarantee NavigableGraphContext).

import './styles.css';

import { api, type PageSummary } from './api.ts';
import { renderOutliner } from './outliner.ts';
import { renderGraph } from './graph/render.ts';
import { renderGraph3D, cleanupGraph3D } from './graph/render3d.ts';
import {
  applyTokens,
  loadTokens,
  saveTokens,
  session,
  type ColourScheme,
  type GraphViewMode,
  type WorkspaceLayout,
} from './tokens.ts';

const PHONE = 640;

interface Workspace {
  activePage: string | null;
  layout: WorkspaceLayout;
  graphView: GraphViewMode;
  /** Bloque en el que está enraizada la vista, o null para la página entera. */
  focusRoot: string | null;
  scheme: ColourScheme;
  divider: number;
  history: string[];
  depth: number;
}

const workspace: Workspace = {
  activePage: null,
  layout: session.layout(),
  graphView: session.graphView(),
  focusRoot: null,
  scheme: session.scheme(),
  divider: session.divider(),
  history: [],
  depth: 2,
};

let tokens = loadTokens();
let pages: PageSummary[] = [];

const $ = <T extends HTMLElement>(selector: string): T =>
  document.querySelector<T>(selector) as T;

const isPhone = (): boolean => window.innerWidth <= PHONE;

// ---------------------------------------------------------------------------
// Disposición
// ---------------------------------------------------------------------------

function applyLayout(): void {
  const root = $('#vera-root');
  // @invariant SinglePaneOnNarrowScreens: en un teléfono nunca hay vista dividida.
  const effective: WorkspaceLayout =
    isPhone() && workspace.layout === 'split' ? 'text_only' : workspace.layout;

  root.dataset['layout'] = effective;
  root.style.setProperty('--divider', String(workspace.divider));

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-layout]')) {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset['layout'] === workspace.layout),
    );
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset['view'] === workspace.graphView));
  }

  if (effective !== 'text_only') drawGraph();
  else cleanupGraph3D();
}

function setLayout(layout: WorkspaceLayout): void {
  workspace.layout = layout;
  session.setLayout(layout);
  applyLayout();
}

// ---------------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------------

const HISTORY = 50;

async function openPage(
  id: string,
  focus: { block: string; at: number } | null = null,
): Promise<void> {
  let page;
  try {
    page = await api.page(id);
  } catch (error) {
    // Una página que no se pudo traer se dice; no se deja la vista anterior
    // fingiendo que la navegación ocurrió.
    notice(`No se pudo abrir la página: ${error instanceof Error ? error.message : 'error'}.`);
    return;
  }

  workspace.activePage = id;
  // Volver a la misma página no la repite en el rastro, y el rastro no crece
  // sin término durante una sesión larga.
  if (workspace.history.at(-1) !== id) workspace.history.push(id);
  if (workspace.history.length > HISTORY) workspace.history.splice(0, workspace.history.length - HISTORY);

  renderOutliner($('#text'), page, {
    onNavigate: (title) => void openTitle(title),
    onOpen: (target) => void openPage(target),
    onChanged: () => void refreshGraph(),
    // @invariant ReferenceResolvesToItsBlock: seguir una referencia deja al
    // participante en el bloque que nombra, no sólo en su página. Llegar a una
    // página de cien bloques y tener que buscarlo no es haberla seguido.
    onOpenBlock: (target, block) => {
      void openPage(target).then(() => revealBlock(block));
    },
    // Un cambio estructural rehace la página desde el grafo y devuelve el cursor
    // donde el modelo dice que quedó. Parchear el árbol dibujado en vez de
    // volver a pedirlo sería mantener una segunda idea de cómo quedó.
    onReload: (focus) => {
      if (workspace.activePage !== null) void openPage(workspace.activePage, focus);
    },
    // @invariant FocusBoundsTheStructure: con la vista enraizada en un bloque,
    // sólo se dibuja su subárbol, así que desindentar, fusionar y mover se
    // detienen ahí sin que ninguna tecla tenga que saberlo.
    onFocusBlock: (block) => {
      workspace.focusRoot = block;
      if (workspace.activePage !== null) void openPage(workspace.activePage);
    },
  }, focus, workspace.focusRoot);

  drawBreadcrumbs();
  if (!isPhone() && workspace.layout !== 'text_only') void drawGraph();
}

/**
 * Lleva a la vista el bloque que una referencia nombra y lo señala un momento.
 *
 * El destello es lo que convierte «esta es la página» en «este es el bloque».
 * Se retira solo, porque un resalte permanente se confundiría con estado.
 */
function revealBlock(stableId: string): void {
  const row = document.querySelector<HTMLElement>(`.block[data-id="${CSS.escape(stableId)}"]`);
  if (row === null) return;
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  row.classList.add('landed');
  window.setTimeout(() => row.classList.remove('landed'), 2000);
}

/** Un aviso a la vez, en texto plano: el corpus no dicta marcado. */
function notice(message: string): void {
  const text = $('#text');
  text.querySelector('.notice')?.remove();
  const paragraph = document.createElement('p');
  paragraph.className = 'notice';
  paragraph.textContent = message;
  text.prepend(paragraph);
}

/** Abrir por título es lo que hace un [[enlace]]. */
async function openTitle(title: string): Promise<void> {
  const found = pages.find((page) => page.title.toLowerCase() === title.toLowerCase());
  if (found === undefined) {
    // La página no existe todavía: se dice, no se inventa.
    notice(`«${title}» aún no existe. La referencia queda esperando.`);
    return;
  }
  await openPage(found.id);
}

function drawBreadcrumbs(): void {
  const trail = $('#breadcrumbs');
  trail.innerHTML = '';
  for (const id of workspace.history.slice(-4)) {
    const page = pages.find((p) => p.id === id);
    const crumb = document.createElement('button');
    crumb.className = 'crumb';
    crumb.textContent = page?.title ?? id;
    crumb.addEventListener('click', () => void openPage(id));
    trail.append(crumb);
  }
}

// ---------------------------------------------------------------------------
// Grafo
// ---------------------------------------------------------------------------

async function drawGraph(): Promise<void> {
  if (workspace.activePage === null) return;
  const container = $('#graph');
  const data = await api.graph(workspace.activePage, workspace.depth);

  const onClick = (id: string): void => {
    // @invariant GraphNodeOpensTextPage: en un teléfono, tocar un nodo abre su
    // página y cambia a la vista de texto.
    void openPage(id).then(() => {
      if (isPhone()) setLayout('text_only');
    });
  };

  const settings = {
    dark: workspace.scheme === 'dark',
    history: workspace.history,
    showEdges: true,
    showTitles: true,
    nodeStyle: 'circular' as const,
  };

  if (workspace.graphView === 'graph_3d') {
    renderGraph3D(container, data, onClick, settings);
  } else {
    cleanupGraph3D();
    renderGraph(container, data, onClick, settings);
  }
}

async function refreshGraph(): Promise<void> {
  if (workspace.layout !== 'text_only') await drawGraph();
}

// ---------------------------------------------------------------------------
// Búsqueda
// ---------------------------------------------------------------------------

let searchTimer: number | undefined;
/** Cada búsqueda lleva turno: una respuesta lenta no pisa a una más reciente. */
let searchTurn = 0;

function wireSearch(): void {
  const input = $<HTMLInputElement>('#search');
  const results = $('#results');
  const wrap = $('#search-wrap');

  const close = (): void => {
    results.innerHTML = '';
    results.hidden = true;
  };

  input.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(async () => {
      const text = input.value.trim();
      if (text === '') {
        close();
        return;
      }

      const turn = ++searchTurn;
      let hits;
      try {
        hits = await api.search(text);
      } catch {
        close();
        return;
      }
      if (turn !== searchTurn) return;

      results.innerHTML = '';
      results.hidden = hits.length === 0;
      for (const hit of hits.slice(0, 30)) {
        const item = document.createElement('button');
        item.className = 'hit';

        // Texto del corpus, puesto como texto. Hay bloques con SVG y HTML
        // dentro: interpretarlos aquí sería dejar que el contenido dicte la
        // interfaz.
        const where = document.createElement('span');
        where.className = 'hit-page';
        where.textContent = pages.find((p) => p.id === hit.page)?.title ?? hit.page;

        const excerpt = document.createElement('span');
        excerpt.className = 'hit-excerpt';
        excerpt.textContent = hit.excerpt;

        item.append(where, excerpt);
        item.addEventListener('click', () => {
          close();
          input.value = '';
          void openPage(hit.page);
        });
        results.append(item);
      }
    }, 120);
  });

  // Los resultados tapan el grafo: se cierran con Escape y al tocar fuera.
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      input.value = '';
      close();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!wrap.contains(event.target as Node)) close();
  });
}

// ---------------------------------------------------------------------------
// Tema
// ---------------------------------------------------------------------------

function wireTheme(): void {
  applyTokens(tokens, workspace.scheme);

  $('#scheme').addEventListener('click', () => {
    workspace.scheme = workspace.scheme === 'dark' ? 'light' : 'dark';
    session.setScheme(workspace.scheme);
    applyTokens(tokens, workspace.scheme);
    void refreshGraph();
    // El texto sigue al tema por variables CSS, pero un diagrama Mermaid ya
    // está dibujado con los colores del tema anterior y no puede repintarse:
    // hay que volver a dibujarlo.
    if (workspace.activePage !== null) void openPage(workspace.activePage);
  });

  const panel = $('#tokens');
  $('#edit-tokens').addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (panel.hidden) return;

    panel.innerHTML = '<h2>Tokens de diseño</h2>';
    for (const token of tokens) {
      const row = document.createElement('label');
      row.className = 'token';
      const name = document.createElement('span');
      name.textContent = token.name;
      const field = document.createElement('input');
      field.value = workspace.scheme === 'dark' ? token.dark : token.light;
      field.addEventListener('change', () => {
        if (workspace.scheme === 'dark') token.dark = field.value;
        else token.light = field.value;
        saveTokens(tokens);
        applyTokens(tokens, workspace.scheme);
        void refreshGraph();
      });
      row.append(name, field);
      panel.append(row);
    }

    const reset = document.createElement('button');
    reset.textContent = 'Restituir';
    reset.addEventListener('click', () => {
      localStorage.removeItem('vera.tokens');
      tokens = loadTokens();
      applyTokens(tokens, workspace.scheme);
      panel.hidden = true;
    });
    panel.append(reset);
  });
}

// ---------------------------------------------------------------------------
// Divisor
// ---------------------------------------------------------------------------

function wireDivider(): void {
  const handle = $('#divider');
  let dragging = false;

  handle.addEventListener('pointerdown', (event) => {
    dragging = true;
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const at = Math.min(0.85, Math.max(0.15, event.clientX / window.innerWidth));
    workspace.divider = at;
    $('#vera-root').style.setProperty('--divider', String(at));
  });
  handle.addEventListener('pointerup', () => {
    dragging = false;
    session.setDivider(workspace.divider);
    void refreshGraph();
  });
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  wireTheme();
  wireSearch();
  wireDivider();

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-layout]')) {
    button.addEventListener('click', () => setLayout(button.dataset['layout'] as WorkspaceLayout));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
    button.addEventListener('click', () => {
      workspace.graphView = button.dataset['view'] as GraphViewMode;
      session.setGraphView(workspace.graphView);
      applyLayout();
    });
  }

  // Redibujar el grafo pide datos al servidor: un arrastre del borde de la
  // ventana no puede disparar una petición por cuadro.
  let resizeTimer: number | undefined;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => applyLayout(), 150);
  });

  const health = await api.health();
  $('#status').textContent = `${health.pages} páginas · ${health.blocks} bloques · secuencia ${health.lastSequence}`;

  pages = await api.pages();

  // Ordenar por conectividad y no por tamaño: la página con más bloques del
  // corpus es una transcripción sin un solo enlace, y abrirla de entrada
  // mostraría un grafo vacío.
  const byConnection = [...pages].sort(
    (a, b) => b.linkCount - a.linkCount || b.blockCount - a.blockCount,
  );

  const index = $('#index');
  for (const page of byConnection.slice(0, 200)) {
    const item = document.createElement('button');
    item.className = 'index-item';
    const name = document.createElement('span');
    name.textContent = page.title;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(page.linkCount);
    item.append(name, count);
    item.addEventListener('click', () => void openPage(page.id));
    index.append(item);
  }

  applyLayout();
  const first = byConnection[0];
  if (first !== undefined) await openPage(first.id);
}

void start();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}
