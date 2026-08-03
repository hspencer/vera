// Sistema de diseño de Vera.
//
// @guarantee EditableDesignSystem: los tokens y la hoja de estilo se editan
// desde dentro de Vera y siguen siendo fuente legible, no estado opaco de la
// aplicación. Por eso viven como texto y se inyectan como variables CSS.
//
// @invariant DualColourScheme: cada token declara su valor claro y su oscuro.

/** Qué clase de valor es, para saber con qué control se edita. */
export type TokenKind = 'color' | 'font' | 'text';

export interface DesignToken {
  name: string;
  light: string;
  dark: string;
}

const PLEX_SANS = "'IBM Plex Sans', system-ui, sans-serif";
const PLEX_MONO = "'IBM Plex Mono', ui-monospace, Menlo, monospace";

/** Las pilas que Vera sirve, para ofrecerlas en vez de pedir que se escriban. */
export const FONT_STACKS: { label: string; value: string }[] = [
  { label: 'IBM Plex Sans', value: PLEX_SANS },
  { label: 'IBM Plex Mono', value: PLEX_MONO },
  { label: 'la del sistema', value: 'system-ui, sans-serif' },
  { label: 'serif del sistema', value: 'Georgia, "Times New Roman", serif' },
  { label: 'monoespaciada del sistema', value: 'ui-monospace, "SF Mono", Menlo, monospace' },
];

/**
 * De qué clase es cada token.
 *
 * Se deduce del valor y no de una lista aparte, para que un token nuevo nazca
 * con el control correcto sin que nadie tenga que acordarse de registrarlo.
 */
export function kindOf(token: DesignToken): TokenKind {
  if (token.name.startsWith('--font-')) return 'font';
  if (/^#[0-9a-f]{3,8}$/i.test(token.light.trim())) return 'color';
  return 'text';
}

export const DEFAULT_TOKENS: DesignToken[] = [
  { name: '--bg', light: '#fbfbf9', dark: '#16181c' },
  { name: '--bg-raised', light: '#ffffff', dark: '#1e2127' },
  { name: '--text', light: '#22242a', dark: '#d8dae0' },
  { name: '--text-dim', light: '#6b7080', dark: '#878d9c' },
  { name: '--rule', light: '#e3e3de', dark: '#2b2f38' },
  { name: '--accent', light: '#045591', dark: '#4a9ade' },
  { name: '--node-central', light: '#045591', dark: '#4a9ade' },
  { name: '--node-fill', light: '#9aa0ab', dark: '#6d7480' },
  { name: '--link-stroke', light: '#d5d7d2', dark: '#333842' },
  { name: '--warm', light: '#ef7a1c', dark: '#ef7a1c' },
  // Hasta dónde llega una línea de prosa.
  //
  // Una línea muy ancha se lee mal: el ojo pierde el comienzo de la siguiente al
  // volver del final de la anterior. Con el texto a pantalla completa las líneas
  // llegaban al borde. No lo cumplen las tablas, las imágenes, los diagramas ni
  // el código, que necesitan el ancho que necesitan y no son prosa.
  { name: '--content-width', light: '45em', dark: '45em' },
  // La reserva del sistema no sobra: el subconjunto latino que Vera sirve no
  // cubre el griego ni el árabe que el corpus también trae, y es mejor que se
  // lean en otra letra a que no se lean.
  { name: '--font-body', light: PLEX_SANS, dark: PLEX_SANS },
  { name: '--font-ui', light: PLEX_SANS, dark: PLEX_SANS },
  { name: '--font-mono', light: PLEX_MONO, dark: PLEX_MONO },
];

const TOKENS_KEY = 'vera.tokens';
const SCHEME_KEY = 'vera.scheme';
const DIVIDER_KEY = 'vera.divider';
const LAYOUT_KEY = 'vera.layout';
const VIEW_KEY = 'vera.graphView';

export type ColourScheme = 'light' | 'dark';
export type WorkspaceLayout = 'text_only' | 'graph_only' | 'split';
export type GraphViewMode = 'graph_2d' | 'graph_3d';

export function loadTokens(): DesignToken[] {
  const held = localStorage.getItem(TOKENS_KEY);
  if (held === null) return structuredClone(DEFAULT_TOKENS);
  try {
    return JSON.parse(held) as DesignToken[];
  } catch {
    return structuredClone(DEFAULT_TOKENS);
  }
}

export function saveTokens(tokens: DesignToken[]): void {
  localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
  // Y viajan. El sistema de diseño es de quien lo ajustó, no del aparato desde
  // el que lo ajustó. Si el servidor no responde no pasa nada: lo local ya está
  // escrito y se reintentará al próximo cambio.
  void push({ designTokens: JSON.stringify(tokens) });
}

/**
 * Lo recordado del participante, guardado en el servidor.
 *
 * Se escribe sin esperar respuesta y sin avisar de un fallo: es preferencia, no
 * contenido. Que se pierda un ajuste porque el servidor estaba caído es
 * molesto; interrumpir a quien escribe para contárselo lo sería más.
 */
async function push(patch: Record<string, unknown>): Promise<void> {
  try {
    await fetch('/workspace', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
  } catch {
    // Sin conexión con el servidor. Lo local sigue en pie.
  }
}

export interface RemotePresentation {
  layout: WorkspaceLayout;
  dividerPosition: number;
  graphView: GraphViewMode;
  colourScheme: ColourScheme;
  designTokens: string | null;
}

/**
 * Trae lo recordado y lo deja en local.
 *
 * El arranque no espera a esto: dibuja con lo que hay en el navegador —que es
 * instantáneo y casi siempre correcto— y esto llega después. Es lo que evita
 * que abrir Vera empiece con un destello del tema equivocado mientras se
 * consulta al servidor, y lo que la deja usable sin él.
 *
 * Devuelve si algo cambió, para que quien llama repinte sólo entonces.
 */
export async function syncPresentation(): Promise<boolean> {
  let remote: RemotePresentation;
  try {
    const answer = await fetch('/workspace');
    if (!answer.ok) return false;
    remote = (await answer.json()) as RemotePresentation;
  } catch {
    return false;
  }

  let changed = false;
  const adopt = (key: string, value: string): void => {
    if (localStorage.getItem(key) === value) return;
    localStorage.setItem(key, value);
    changed = true;
  };

  if (remote.designTokens !== null) adopt(TOKENS_KEY, remote.designTokens);
  adopt(SCHEME_KEY, remote.colourScheme);
  adopt(LAYOUT_KEY, remote.layout);
  adopt(VIEW_KEY, remote.graphView);
  adopt(DIVIDER_KEY, String(remote.dividerPosition));
  return changed;
}

export function applyTokens(tokens: DesignToken[], scheme: ColourScheme): void {
  const root = document.documentElement;
  for (const token of tokens) {
    root.style.setProperty(token.name, scheme === 'dark' ? token.dark : token.light);
  }
  root.dataset['scheme'] = scheme;
}

/**
 * @guarantee RememberedSessionPresentation. La vista dividida arranca repartida
 * por igual cuando no hay preferencia guardada; después se recuerda.
 */
export const session = {
  scheme: (): ColourScheme =>
    (localStorage.getItem(SCHEME_KEY) as ColourScheme | null) ??
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  setScheme: (scheme: ColourScheme) => {
    localStorage.setItem(SCHEME_KEY, scheme);
    void push({ colourScheme: scheme });
  },

  divider: (): number => Number(localStorage.getItem(DIVIDER_KEY) ?? '0.5'),
  setDivider: (at: number) => {
    localStorage.setItem(DIVIDER_KEY, String(at));
    void push({ dividerPosition: at });
  },

  layout: (): WorkspaceLayout =>
    (localStorage.getItem(LAYOUT_KEY) as WorkspaceLayout | null) ?? 'split',
  setLayout: (layout: WorkspaceLayout) => {
    localStorage.setItem(LAYOUT_KEY, layout);
    void push({ layout });
  },

  graphView: (): GraphViewMode =>
    (localStorage.getItem(VIEW_KEY) as GraphViewMode | null) ?? 'graph_2d',
  setGraphView: (view: GraphViewMode) => {
    localStorage.setItem(VIEW_KEY, view);
    void push({ graphView: view });
  },
};
