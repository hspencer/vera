// Presentación de diagramas Mermaid.
//
// @invariant NativePresentation: un diagrama se lee dentro de la página, sin
// exportarlo a otra aplicación.
//
// @invariant ExecutableContentIsolation: Mermaid se ejecuta en modo `sandbox`,
// que dibuja dentro de un iframe aislado. Un diagrama no puede alcanzar el
// grafo ni lo que el documento tenga: recibe su texto y nada más.
//
// @invariant SourceFidelity: el bloque sigue guardando su cercado ```mermaid.
// Esto reemplaza lo que se muestra, nunca lo que se guarda, así que al editar
// reaparece la fuente tal como se escribió.
//
// La biblioteca pesa más que todo el resto de la aplicación junta, así que se
// carga sólo cuando una página trae un diagrama, y una sola vez por sesión.

type MermaidModule = typeof import('mermaid');

let loading: Promise<MermaidModule['default']> | null = null;

async function mermaidFor(dark: boolean): Promise<MermaidModule['default']> {
  if (loading === null) {
    loading = import('mermaid').then((module) => module.default);
  }
  const mermaid = await loading;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'sandbox',
    theme: dark ? 'dark' : 'default',
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-ui') || 'sans-serif',
  });
  return mermaid;
}

/** Un identificador por diagrama: Mermaid lo exige y tiene que ser único. */
let counter = 0;

/**
 * Sustituye cada bloque de código mermaid por su diagrama.
 *
 * Un diagrama que no compila deja su fuente a la vista con el error al lado.
 * Ocultar la fuente sería perder lo único que permite arreglarlo.
 */
export async function renderMermaid(root: HTMLElement): Promise<void> {
  const blocks = [...root.querySelectorAll('code.language-mermaid')];
  // El esquema lo declara el documento, así que no hace falta pasarlo por cada
  // capa de la interfaz hasta aquí.
  const dark = document.documentElement.dataset['scheme'] === 'dark';
  if (blocks.length === 0) return;

  let mermaid: MermaidModule['default'];
  try {
    mermaid = await mermaidFor(dark);
  } catch {
    // Sin la biblioteca el bloque se queda como código, que es lo que ya era.
    return;
  }

  for (const block of blocks) {
    const source = block.textContent ?? '';
    const pre = block.closest('pre');
    if (pre === null || source.trim() === '') continue;

    counter += 1;
    const figure = document.createElement('div');
    figure.className = 'mermaid-figure';

    try {
      const { svg } = await mermaid.render(`vera-mermaid-${counter}`, source);
      figure.innerHTML = svg;
      pre.replaceWith(figure);
    } catch (error) {
      // El cercado se conserva; sólo se añade por qué no se pudo dibujar.
      const note = document.createElement('p');
      note.className = 'mermaid-error';
      note.textContent =
        error instanceof Error ? `no se pudo dibujar: ${error.message}` : 'no se pudo dibujar';
      pre.after(note);
    }
  }
}
