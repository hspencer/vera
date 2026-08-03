// El espacio de trabajo de Vera.
//
// Texto y grafo comparten página activa e historial, así que cambiar de
// disposición no pierde el lugar en el grafo (@guarantee NavigableGraphContext).

import './styles.css';

import { api, type PageSummary } from './api.ts';
import { renderOutliner } from './outliner.ts';
import { renderSettings, type Section } from './settings.ts';
import { parseRoute, routeTo } from './router.ts';
import { renderVoicePanel } from './voice-panel.ts';
import { brandMark, icon } from './icons.ts';
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
  options: { fromUrl?: boolean; reveal?: string | null } = {},
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

  // La identidad manda a partir de aquí: la URL pudo nombrarla por su título.
  workspace.activePage = page.id;
  id = page.id;

  // La dirección sigue a la página, salvo cuando es la dirección la que trajo
  // aquí: entonces escribirla otra vez apilaría una entrada por navegación y el
  // botón de atrás dejaría de deshacer un paso.
  if (options.fromUrl !== true) {
    const url = routeTo(page, { focus: workspace.focusRoot, block: options.reveal ?? null });
    if (window.location.pathname + window.location.search + window.location.hash !== url) {
      window.history.pushState({}, '', url);
    }
  }

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
      void openPage(target, null, { reveal: block }).then(() => revealBlock(block));
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
 * Abre lo que la dirección dice, sin volver a escribirla.
 *
 * Es lo que corre al arrancar y cada vez que el botón de atrás cambia la URL,
 * así que el historial del navegador y el de Vera cuentan lo mismo.
 */
async function applyRoute(): Promise<void> {
  const route = parseRoute(new URL(window.location.href));
  if (route.page === null) {
    const first = pages[0];
    if (first !== undefined) await openPage(first.id);
    return;
  }

  workspace.focusRoot = route.focus;
  await openPage(route.page, null, { fromUrl: true });
  if (route.block !== null) revealBlock(route.block);
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

  // La marca y el micrófono no cambian nunca, así que se dibujan una vez.
  $('#brand').innerHTML = brandMark();
  $('#insert-voice').innerHTML = icon('mic');
  $('#settings').innerHTML = icon('settings');

  // El botón muestra a dónde lleva, no dónde se está: con el tema oscuro
  // puesto ofrece el sol, que es lo que se obtiene al pulsarlo.
  const scheme = $('#scheme');
  const drawScheme = (): void => {
    const toLight = workspace.scheme === 'dark';
    scheme.innerHTML = icon(toLight ? 'sun' : 'moon');
    scheme.title = toLight ? 'Pasar al tema claro' : 'Pasar al tema oscuro';
  };
  drawScheme();

  scheme.addEventListener('click', () => {
    workspace.scheme = workspace.scheme === 'dark' ? 'light' : 'dark';
    session.setScheme(workspace.scheme);
    applyTokens(tokens, workspace.scheme);
    drawScheme();
    void refreshGraph();
    // El texto sigue al tema por variables CSS, pero un diagrama Mermaid ya
    // está dibujado con los colores del tema anterior y no puede repintarse:
    // hay que volver a dibujarlo.
    if (workspace.activePage !== null) void openPage(workspace.activePage);
  });

  // La configuración vive en su propia superficie, no en un panel suelto: son
  // varias secciones y van a ser más.
  const panel = $('#tokens');
  let section: Section = 'teclado';

  const closeSettings = (): void => {
    panel.hidden = true;
    panel.innerHTML = '';
  };

  const openSettings = (): void => {
    renderSettings(panel, tokens, section, {
      scheme: () => workspace.scheme,
      onTokenChange: (token, value) => {
        // Cada token guarda su valor por esquema, así que editar el oscuro no
        // puede pisar el claro.
        if (workspace.scheme === 'dark') token.dark = value;
        else token.light = value;
        saveTokens(tokens);
        applyTokens(tokens, workspace.scheme);
        void refreshGraph();
      },
      onReset: () => {
        localStorage.removeItem('vera.tokens');
        tokens = loadTokens();
        applyTokens(tokens, workspace.scheme);
        openSettings();
      },
      onClose: closeSettings,
    });
    // Recordar la sección entre aperturas: se vuelve a la misma que se dejó.
    panel.querySelectorAll('.settings-tab').forEach((tab, at) => {
      tab.addEventListener('click', () => {
        section = at === 0 ? 'teclado' : 'apariencia';
      });
    });
  };

  // Insertar voz. Vive en su propio panel: es una cascada de varios pasos, no
  // una acción suelta.
  const voicePanel = $('#voice');
  $('#insert-voice').addEventListener('click', () => {
    if (!voicePanel.hidden) {
      voicePanel.hidden = true;
      voicePanel.innerHTML = '';
      return;
    }
    renderVoicePanel(voicePanel, null, {
      page: () => {
        if (workspace.activePage === null) return null;
        const found = pages.find((p) => p.id === workspace.activePage);
        return found === undefined ? null : { id: found.id, title: found.title };
      },
      onSettled: (blocks) => {
        notice(`Asentados ${blocks.length} bloques desde la voz.`);
        if (workspace.activePage !== null) void openPage(workspace.activePage);
      },
      notify: (message) => notice(message),
      onClose: () => {
        voicePanel.hidden = true;
        voicePanel.innerHTML = '';
      },
    });
  });

  $('#settings').addEventListener('click', () => {
    if (panel.hidden) openSettings();
    else closeSettings();
  });

  // Escape cierra la configuración, como cierra cualquier cosa abierta encima.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) closeSettings();
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

  // Atrás y adelante del navegador. Sin esto la dirección cambiaría y la
  // aplicación se quedaría enseñando otra cosa.
  window.addEventListener('popstate', () => void applyRoute());

  // Redibujar el grafo pide datos al servidor: un arrastre del borde de la
  // ventana no puede disparar una petición por cuadro.
  let resizeTimer: number | undefined;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => applyLayout(), 150);
  });

  const health = await api.health();
  $('#status').textContent = `${health.pages} páginas · ${health.blocks} bloques · secuencia ${health.lastSequence}`;

  // Ordenadas por conectividad y no por tamaño: la página más grande del
  // corpus es una transcripción sin un solo enlace, y abrirla de entrada
  // mostraría un mapa vacío.
  pages = (await api.pages()).sort(
    (a, b) => b.linkCount - a.linkCount || b.blockCount - a.blockCount,
  );

  const byConnection = pages;

  const index = $('#index');
  // Reintentar el arranque no puede duplicar la lateral.
  index.innerHTML = '';
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
  await applyRoute();
}

/**
 * Arrancar puede fallar, y hasta ahora fallaba en silencio.
 *
 * `start()` pedía `/health` sin recoger el error: bastaba que el servidor
 * estuviera un segundo caído —un reinicio, la máquina despertando, Tailscale
 * reconectando— para que la promesa se rechazara, no se dibujara nada, y la
 * aplicación quedara en blanco sin decir por qué ni recuperarse sola.
 *
 * Ahora lo dice y lo reintenta. Un servidor que vuelve en unos segundos no
 * debería costar una recarga a mano.
 */
async function boot(attempt = 1): Promise<void> {
  // El aviso del HTML sólo tiene sentido mientras el guion no haya arrancado.
  // Que lo retire esto y no el HTML es lo que lo vuelve fiable: aparece salvo
  // que este código llegue a correr.
  document.querySelector('#sin-arranque')?.remove();
  try {
    await start();
  } catch (error) {
    const why = error instanceof Error ? error.message : 'error desconocido';
    const wait = Math.min(attempt * 2, 10);

    const root = $('#text');
    root.innerHTML = '';
    const message = document.createElement('p');
    message.className = 'notice';
    message.textContent =
      `No se pudo hablar con el servidor de Vera (${why}). ` +
      `Reintentando en ${wait} segundos…`;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'notice-retry';
    retry.textContent = 'reintentar ahora';
    let timer: number | undefined;
    const again = (): void => {
      window.clearTimeout(timer);
      void boot(attempt + 1);
    };
    retry.addEventListener('click', again);
    message.append(' ', retry);
    root.append(message);

    timer = window.setTimeout(again, wait * 1000);
  }
}

void boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}
