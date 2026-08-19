// Recintos de HTML, p5.js y SVG escritos deliberadamente.
//
// El iframe no puede leer Vera: sólo recibe una copia de los valores visuales
// y sólo puede responder con la altura que necesita. El origen opaco impuesto
// por `sandbox` mantiene esa frontera incluso cuando la fuente ejecuta scripts.

import { icon } from './icons.ts';

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

function setMaximized(figure: HTMLElement, button: HTMLButtonElement, maximized: boolean): void {
  figure.classList.toggle('executable-maximized', maximized);
  document.documentElement.classList.toggle('has-maximized-executable', maximized);
  button.innerHTML = icon(maximized ? 'arrows-minimize' : 'arrows-maximize');
  button.title = maximized ? 'minimizar HTML' : 'maximizar HTML';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-pressed', String(maximized));
  if (maximized) button.focus({ preventScroll: true });
}

function wireHtmlControls(root: ParentNode = document): void {
  for (const figure of root.querySelectorAll<HTMLElement>('.executable-html-live')) {
    if (figure.querySelector('.executable-size-toggle') !== null) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'executable-size-toggle';
    setMaximized(figure, button, false);
    button.addEventListener('click', () => {
      setMaximized(figure, button, !figure.classList.contains('executable-maximized'));
    });
    figure.append(button);
  }
}

export function syncExecutableFrames(): void {
  wireHtmlControls();
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

new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.matches('.executable-html-live')) wireHtmlControls(node.parentNode ?? document);
      else wireHtmlControls(node);
    }
  }
}).observe(document.body, { childList: true, subtree: true });

addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const figure = document.querySelector<HTMLElement>('.executable-html-live.executable-maximized');
  const button = figure?.querySelector<HTMLButtonElement>('.executable-size-toggle');
  if (figure !== null && figure !== undefined && button !== null && button !== undefined) {
    setMaximized(figure, button, false);
    button.focus();
  }
});
