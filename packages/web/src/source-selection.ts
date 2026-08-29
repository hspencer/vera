export interface SourceSelection {
  start: number;
  end: number;
}

/**
 * Encuentra en la fuente Markdown el texto que alguien acaba de escoger en la
 * lectura. La pista decide entre repeticiones: es la posición que habría
 * recibido el caret al soltar el puntero.
 *
 * No se normaliza ni se adivina. Si el render cambió los caracteres —por
 * ejemplo, el texto visible de un enlace no aparece literalmente en la
 * fuente— es preferible abrir un caret honesto a seleccionar otra cosa.
 */
export function sourceSelection(
  source: string,
  selected: string,
  near: number,
): SourceSelection | null {
  if (selected.length === 0) return null;

  const starts: number[] = [];
  let from = 0;
  while (from <= source.length - selected.length) {
    const at = source.indexOf(selected, from);
    if (at < 0) break;
    starts.push(at);
    from = at + Math.max(1, selected.length);
  }
  if (starts.length === 0) return null;

  const hint = Math.max(0, Math.min(near, source.length));
  const start = starts.reduce((closest, candidate) => {
    const candidateDistance = Math.min(
      Math.abs(hint - candidate),
      Math.abs(hint - (candidate + selected.length)),
    );
    const closestDistance = Math.min(
      Math.abs(hint - closest),
      Math.abs(hint - (closest + selected.length)),
    );
    return candidateDistance < closestDistance ? candidate : closest;
  });
  return { start, end: start + selected.length };
}
