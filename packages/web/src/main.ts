// El espacio de trabajo de Vera.
//
// Texto y grafo comparten página activa e historial, así que cambiar de
// disposición no pierde el lugar en el grafo (@guarantee NavigableGraphContext).

import './styles.css';

import { api, type PageSummary } from './api.ts';
import { renderOutliner, speakInto } from './outliner.ts';
import { renderSettings, type Section } from './settings.ts';
import { parseRoute, routeTo } from './router.ts';
import { STAGES, voice } from './voice.ts';
import { brandMark, icon, type IconName } from './icons.ts';
import { renderGraph } from './graph/render.ts';
import { renderGraph3D, cleanupGraph3D } from './graph/render3d.ts';
import {
  applyTokens,
  loadTokens,
  saveTokens,
  session,
  syncPresentation,
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
/** Cierra los ajustes. Vive aquí porque Memoria también necesita cerrarlos: una
 *  de sus entradas lleva a una página, y quedarse encima de ella no serviría. */
function closeSettings(): void {
  const panel = $('#tokens');
  panel.hidden = true;
  panel.innerHTML = '';
}

/** Lo que el grafo tiene. Se pide una vez al arrancar y se enseña en Memoria. */
let corpus: { graph: string; pages: number; blocks: number; lastSequence: number } | null = null;

/**
 * Memoria: el estado del corpus y su índice.
 *
 * Vivía en un panel lateral permanente que gastaba 15rem de cada pantalla para
 * decir algo que se mira de vez en cuando. Ese ancho es ahora del mapa y del
 * texto, que es lo que se está haciendo cuando se usa Vera.
 */
function drawMemory(host: HTMLElement): void {
  const status = document.createElement('div');
  status.id = 'status';
  status.textContent =
    corpus === null
      ? 'todavía sin datos del grafo'
      : `${corpus.pages} páginas · ${corpus.blocks} bloques · secuencia ${corpus.lastSequence}`;
  host.append(status);

  // Lo hablado que no terminó la cascada.
  //
  // Desde que toda grabación nace en un día, ninguna nueva puede quedar sin
  // sitio; esto es para las que se grabaron antes de que eso fuera cierto, y
  // para la que se quede a medias por un fallo. Darle lugar es traerla al día de
  // hoy, que es de donde habría salido si se grabara ahora.
  void voice.list().then((all) => {
    if (!Array.isArray(all)) return;
    const pending = all.filter((r) => r.stage !== 'content_settled');
    if (pending.length === 0) return;

    const title = document.createElement('h3');
    title.className = 'settings-group';
    title.textContent = 'Voz sin terminar';
    status.after(title);

    const list = document.createElement('div');
    list.id = 'pending-voice';
    for (const item of pending) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'index-item';
      const name = document.createElement('span');
      name.textContent = (item.transcript ?? '').trim().slice(0, 60) ||
        new Date(item.capturedAt).toLocaleString('es');
      const stage = document.createElement('span');
      stage.className = 'count';
      stage.textContent = STAGES.find((s) => s.id === item.stage)?.label ?? item.stage;
      row.append(name, stage);
      row.addEventListener('click', () => {
        void (async () => {
          // Si ya tiene lugar, se va a él. Si no, se le da uno en hoy: es de
          // donde habría salido si se grabara ahora.
          if (item.placedInPage !== null) {
            closeSettings();
            await openPage(item.placedInPage);
            if (item.placedInBlock !== null) revealBlock(item.placedInBlock);
            return;
          }
          closeSettings();
          const block = await startDay(today());
          if (block === null) return;
          const placed = await voice.place(item.id, block);
          if ('error' in placed) {
            notice(placed.error);
            return;
          }
          if (workspace.activePage !== null) await openPage(workspace.activePage);
        })();
      });
      list.append(row);
    }
    title.after(list);
  });

  const index = document.createElement('div');
  index.id = 'index';
  for (const page of pages.slice(0, 200)) {
    const item = document.createElement('button');
    item.type = 'button';
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
  host.append(index);
}

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
    const here = button.dataset['layout'] === workspace.layout;
    button.setAttribute('aria-pressed', String(here));
    // El switch marca su posición con la clase; `aria-pressed` sigue siendo lo
    // que se lee en voz alta.
    button.classList.toggle('selected', here);
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
// El día de hoy
// ---------------------------------------------------------------------------

/**
 * La fecha de hoy tal como la escribe el calendario.
 *
 * El reloj es el de esta máquina, no el del servidor: quien escribe está aquí, y
 * si son las once de la noche del lunes para él, es lunes, aunque el servidor
 * viva en otro huso. daily-log.allium deja abierto qué pasa cuando esos dos
 * relojes no son el mismo; mientras la instancia sea de una persona en una
 * máquina, la pregunta no se hace.
 */
function today(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** La página del día, si el día ya existe. */
function dayPage(date = today()): PageSummary | undefined {
  return pages.find((page) => page.title === date);
}

/**
 * Abre el día en curso.
 *
 * Si todavía no hay nada escrito hoy, no se crea nada: se enseña el día vacío y
 * la página nace con el primer bloque. Crearla al mirarla llenaría el corpus de
 * días en blanco —uno por cada vez que alguien abre Vera sin escribir— y un día
 * vacío no es un hecho sobre una vida, es un hecho sobre un calendario.
 *
 * @invariant ADayExistsBecauseSomethingArrived, de daily-log.allium.
 */
async function openToday(): Promise<void> {
  const date = today();
  const existing = dayPage(date);
  if (existing !== undefined) {
    await openPage(existing.id);
    return;
  }
  drawUnstartedDay(date);
}

/**
 * El día que aún no empieza.
 *
 * Un solo gesto, que es el que crea el día: escribir. Deliberadamente no hay más
 * que eso, porque la razón de que «hoy» sea el origen es no tener que decidir
 * nada antes de ponerse a escribir.
 */
function drawUnstartedDay(date: string): void {
  workspace.activePage = null;
  const url = `/p/${encodeURIComponent(date)}`;
  if (window.location.pathname !== url) window.history.pushState({}, '', url);

  const host = $('#text');
  host.innerHTML = '';

  const header = document.createElement('header');
  header.className = 'page-header';
  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = date;
  header.append(title);
  host.append(header);

  const note = document.createElement('p');
  note.className = 'settings-note';
  note.textContent = 'Hoy todavía no tiene nada. El día empieza a existir con lo primero que escribas.';
  host.append(note);

  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'first-block';
  start.textContent = 'escribir';
  start.addEventListener('click', () => void startDay(date));
  host.append(start);

  drawGraph();
}

/**
 * Hace nacer el día y devuelve su primer bloque, listo para escribir.
 *
 * Es el único camino por el que un día entra en la base, y por eso lo usan tanto
 * el botón de escribir como la grabación de voz: hablar en el día también es
 * haber escrito en él.
 */
async function startDay(date: string, content = ''): Promise<string | null> {
  const existing = dayPage(date);
  let pageId = existing?.id ?? null;

  if (pageId === null) {
    const born = await api.submit({ kind: 'create_page', title: date, visibility: 'private' });
    if (born.status === 'rejected') {
      notice(`no se pudo abrir el día: ${born.reason}`);
      return null;
    }
    pageId = born.subjectId;
    // El índice en memoria tiene que enterarse, o el día parecería no existir
    // hasta la próxima recarga.
    pages.unshift({ id: pageId, title: date, visibility: 'private', blockCount: 0, linkCount: 0 });
  }

  const block = await api.submit({
    kind: 'create_block',
    page: pageId,
    parent: null,
    position: Number.MAX_SAFE_INTEGER,
    content,
  });
  if (block.status === 'rejected') {
    notice(`no se pudo escribir en el día: ${block.reason}`);
    return null;
  }
  await openPage(pageId, { block: block.subjectId, at: 0 });
  return block.subjectId;
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
    // Hablar donde se estaba escribiendo. La grabación necesita un bloque vacío
    // que le guarde el lugar: si el bloque tenía texto, se le deja lo escrito y
    // el que habla es uno nuevo debajo, para que la transcripción no caiga
    // encima de palabras que nadie aceptó perder.
    onSpeak: async (block, rest) => {
      let place = block;
      if (rest !== '') {
        const kept = await api.submit({ kind: 'edit_block', block, content: rest });
        if (kept.status === 'rejected') {
          notice(`rechazado: ${kept.reason}`);
          return;
        }
        const near = page.blocks.find((candidate) => candidate.stableId === block);
        const born = await api.submit({
          kind: 'create_block',
          page: page.id,
          parent: near?.parent ?? null,
          position: (near?.position ?? 0) + 1,
          content: '',
        });
        if (born.status === 'rejected') {
          notice(`rechazado: ${born.reason}`);
          return;
        }
        place = born.subjectId;
      } else if (page.blocks.find((c) => c.stableId === block)?.content !== '') {
        const emptied = await api.submit({ kind: 'edit_block', block, content: '' });
        if (emptied.status === 'rejected') {
          notice(`rechazado: ${emptied.reason}`);
          return;
        }
      }
      speakInto(place);
      if (workspace.activePage !== null) await openPage(workspace.activePage);
    },
  }, focus, workspace.focusRoot);

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
    // La raíz es hoy. Antes era la página más conectada del corpus, que es una
    // buena portada y un mal sitio donde llegar: para escribir algo había que
    // decidir primero dónde, y esa decisión es justo la que un diario ahorra.
    await openToday();
    return;
  }

  // Una fecha que todavía no tiene página no es un error: es un día que no ha
  // empezado. Enseñarlo vacío es lo que permite escribir en él.
  if (/^\d{4}-\d{2}-\d{2}$/.test(route.page) && dayPage(route.page) === undefined) {
    drawUnstartedDay(route.page);
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

/*
 * El rastro ya no se dibuja en la barra: al lado de la marca era un texto que
 * repetía el título que la página ya tiene debajo. `workspace.history` se sigue
 * llevando, porque el rastro vuelve —como nav-pills en el panel del mapa, donde
 * pertenece: el mapa es donde uno se ubica.
 */

// ---------------------------------------------------------------------------
// Grafo
// ---------------------------------------------------------------------------

async function drawGraph(): Promise<void> {
  if (workspace.activePage === null) return;
  const container = $('#graph');
  // Los controles del mapa viven dentro del mapa, y el renderizador se lleva por
  // delante lo que haya en su contenedor. Se apartan y se devuelven.
  const controls = $('#map-controls');
  controls.remove();
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
  container.append(controls);
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

  // Atrás y adelante son los del navegador, no un rastro propio: cada documento
  // tiene dirección, así que el historial que ya existe es el correcto y no hay
  // dos ideas de dónde se estuvo.
  $('#back').innerHTML = icon('chevron-left');
  $('#forward').innerHTML = icon('chevron-right');

  // El botón de hoy es la fecha, sin icono. El número dice a dónde lleva mejor
  // que un dibujo, y dice además a qué día: una casa al lado sólo repetiría
  // peor lo que la fecha ya cuenta. En el orden en que se dice —día, mes, año—
  // y no en el ISO del título, porque el título es identidad y esto es lectura.
  const stamp = $('#hoy');
  const drawToday = (): void => {
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    stamp.textContent = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`;
    stamp.setAttribute('datetime', today());
  };
  drawToday();
  // Una sesión abierta pasada la medianoche seguiría enseñando el día de ayer, y
  // el botón llevaría a otro sitio del que dice.
  window.setInterval(drawToday, 60_000);
  $('#back').addEventListener('click', () => window.history.back());
  $('#forward').addEventListener('click', () => window.history.forward());
  $('#home').addEventListener('click', () => void openToday());

  // El switch de la vista, en el orden del espacio que gobierna.
  const SWITCH: Record<string, IconName> = {
    graph_only: 'map',
    split: 'spread',
    text_only: 'text',
  };
  for (const button of document.querySelectorAll<HTMLButtonElement>('#view-switch [data-layout]')) {
    const shape = SWITCH[button.dataset['layout'] ?? ''];
    if (shape !== undefined) button.innerHTML = icon(shape);
  }

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
  let section: Section = 'memoria';


  const openSettings = (): void => {
    renderSettings(panel, tokens, section, {
      drawMemory,
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

  /**
   * Hablar, desde la barra.
   *
   * Lo grabado cae en el día de hoy, y por el mismo camino que `/audio`: un
   * bloque del día le guarda el lugar y ahí se recorre la cascada. Que sea el
   * mismo camino importa más de lo que parece — es lo que hace que ninguna
   * grabación pueda volver a quedar flotando sin página, porque todas nacen con
   * un día.
   *
   * En un teléfono es la razón de ser de la aplicación: se saca del bolsillo, se
   * habla, y lo dicho ya está en el día que le corresponde.
   */
  $('#insert-voice').addEventListener('click', () => {
    void (async () => {
      const block = await startDay(today());
      if (block === null) return;
      speakInto(block);
      if (workspace.activePage !== null) await openPage(workspace.activePage);
    })();
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

  // Lo recordado del participante llega del servidor y puede diferir de lo que
  // este navegador tenía. Se pide después de pintar, no antes: dibujar con lo
  // local es instantáneo, y esperar al servidor haría que abrir Vera empezara
  // por una pantalla en blanco.
  void syncPresentation().then((changed) => {
    if (!changed) return;
    tokens = loadTokens();
    workspace.scheme = session.scheme();
    workspace.layout = session.layout();
    workspace.graphView = session.graphView();
    workspace.divider = session.divider();
    applyTokens(tokens, workspace.scheme);
    applyLayout();
  });
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

  // El estado del corpus se guarda, no se dibuja: ahora vive en Ajustes →
  // Memoria y se pinta cuando alguien lo abre.
  corpus = await api.health();

  // Ordenadas por conectividad y no por tamaño: la página más grande del
  // corpus es una transcripción sin un solo enlace, y abrirla de entrada
  // mostraría un mapa vacío.
  pages = (await api.pages()).sort(
    (a, b) => b.linkCount - a.linkCount || b.blockCount - a.blockCount,
  );

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
