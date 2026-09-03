/** Añade a cada bloque de código un control que copia sólo su fuente. */
export function decorateCodeBlocks(root: ParentNode): void {
  for (const code of root.querySelectorAll<HTMLElement>('pre > code')) {
    const pre = code.parentElement;
    if (pre === null || pre.querySelector(':scope > .code-copy') !== null) continue;
    pre.classList.add('copyable-code');
    pre.append(codeCopyButton(code.textContent ?? ''));
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
  button.textContent = 'copiar';
  button.setAttribute('aria-label', 'copiar código');
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void navigator.clipboard.writeText(source).then(
      () => {
        button.textContent = 'copiado';
        window.setTimeout(() => { button.textContent = 'copiar'; }, 1200);
      },
      () => {
        button.textContent = 'no se pudo';
        window.setTimeout(() => { button.textContent = 'copiar'; }, 1200);
      },
    );
  });
  return button;
}
