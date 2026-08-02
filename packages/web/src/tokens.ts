// Sistema de diseño de Vera.
//
// @guarantee EditableDesignSystem: los tokens y la hoja de estilo se editan
// desde dentro de Vera y siguen siendo fuente legible, no estado opaco de la
// aplicación. Por eso viven como texto y se inyectan como variables CSS.
//
// @invariant DualColourScheme: cada token declara su valor claro y su oscuro.

export interface DesignToken {
  name: string;
  light: string;
  dark: string;
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
  { name: '--font-body', light: 'Georgia, "Times New Roman", serif', dark: 'Georgia, "Times New Roman", serif' },
  { name: '--font-ui', light: 'system-ui, sans-serif', dark: 'system-ui, sans-serif' },
  { name: '--font-mono', light: 'ui-monospace, "SF Mono", Menlo, monospace', dark: 'ui-monospace, "SF Mono", Menlo, monospace' },
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
  setScheme: (scheme: ColourScheme) => localStorage.setItem(SCHEME_KEY, scheme),

  divider: (): number => Number(localStorage.getItem(DIVIDER_KEY) ?? '0.5'),
  setDivider: (at: number) => localStorage.setItem(DIVIDER_KEY, String(at)),

  layout: (): WorkspaceLayout =>
    (localStorage.getItem(LAYOUT_KEY) as WorkspaceLayout | null) ?? 'split',
  setLayout: (layout: WorkspaceLayout) => localStorage.setItem(LAYOUT_KEY, layout),

  graphView: (): GraphViewMode =>
    (localStorage.getItem(VIEW_KEY) as GraphViewMode | null) ?? 'graph_2d',
  setGraphView: (view: GraphViewMode) => localStorage.setItem(VIEW_KEY, view),
};
