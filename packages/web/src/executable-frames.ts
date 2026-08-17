// Recintos de HTML, p5.js y SVG escritos deliberadamente.
//
// El iframe no puede leer Vera: sólo recibe una copia de los valores visuales
// y sólo puede responder con la altura que necesita. El origen opaco impuesto
// por `sandbox` mantiene esa frontera incluso cuando la fuente ejecuta scripts.

const MESSAGE = 'vera-executable-frame';
const MIN_HEIGHT = 24;
const MAX_HEIGHT = 2400;

function frames(): HTMLIFrameElement[] {
  return [...document.querySelectorAll<HTMLIFrameElement>('iframe[data-executable-frame]')];
}

function appearance(): { scheme: 'light' | 'dark'; tokens: Record<string, string> } {
  const root = document.documentElement;
  const computed = getComputedStyle(root);
  const tokens: Record<string, string> = {};
  for (const name of [
    '--bg', '--bg-raised', '--text', '--text-dim', '--rule', '--accent',
    '--text-size', '--line-height', '--font-body', '--font-ui', '--font-mono',
  ]) tokens[name] = computed.getPropertyValue(name).trim();
  return { scheme: root.dataset['scheme'] === 'dark' ? 'dark' : 'light', tokens };
}

function send(frame: HTMLIFrameElement): void {
  frame.contentWindow?.postMessage({ type: MESSAGE, appearance: appearance() }, '*');
}

export function syncExecutableFrames(): void {
  for (const frame of frames()) send(frame);
}

addEventListener('message', (event: MessageEvent<unknown>) => {
  const data = event.data as { type?: unknown; height?: unknown } | null;
  if (data?.type !== MESSAGE) return;
  const frame = frames().find((one) => one.contentWindow === event.source);
  if (frame === undefined) return;
  const asked = typeof data.height === 'number' && Number.isFinite(data.height) ? data.height : MIN_HEIGHT;
  frame.style.height = `${Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(asked)))}px`;
  send(frame);
});

// Los tokens y el esquema viven como atributos de la raíz. Observarlos hace
// que una edición de apariencia llegue a los recintos ya visibles sin recargar.
new MutationObserver(syncExecutableFrames).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['style', 'data-scheme'],
});
