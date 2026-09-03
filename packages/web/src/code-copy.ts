import { icon } from './icons.ts';

/** Añade a cada bloque de código un control que copia sólo su fuente. */
export function decorateCodeBlocks(root: ParentNode): void {
  for (const code of root.querySelectorAll<HTMLElement>('pre > code')) {
    const pre = code.parentElement;
    if (pre === null) continue;
    // MediaWiki presenta la fuente dentro de un `details`: el control pertenece
    // a la vista completa, no a un recinto que nace cerrado.
    const rendered = code.closest<HTMLElement>('.mediawiki-figure');
    const host = rendered ?? pre;
    if (host.querySelector(':scope > .code-copy') !== null) continue;
    host.classList.add(rendered === null ? 'copyable-code' : 'copyable-render');
    host.append(codeCopyButton(code.textContent ?? ''));
  }
}

/**
 * El texto llega desde `<code>`, no desde el bloque Markdown que lo contiene:
 * por eso no incluye la valla, el nombre del lenguaje ni controles del DOM.
 */
export function codeCopyButton(source: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'code-copy';
  button.innerHTML = icon('copy');
  button.title = 'copiar código';
  button.setAttribute('aria-label', 'copiar código');
  const reset = (): void => {
    button.innerHTML = icon('copy');
    button.title = 'copiar código';
    button.setAttribute('aria-label', 'copiar código');
    delete button.dataset['state'];
  };
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void navigator.clipboard.writeText(source).then(
      () => {
        button.innerHTML = icon('check');
        button.title = 'código copiado';
        button.setAttribute('aria-label', 'código copiado');
        button.dataset['state'] = 'copied';
        window.setTimeout(reset, 1200);
      },
      () => {
        button.title = 'no se pudo copiar';
        button.setAttribute('aria-label', 'no se pudo copiar');
        button.dataset['state'] = 'failed';
        window.setTimeout(reset, 1200);
      },
    );
  });
  return button;
}
