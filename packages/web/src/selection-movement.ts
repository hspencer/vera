export interface SiblingMove {
  block: string;
  position: number;
}

/**
 * Decide el único movimiento necesario para desplazar un tramo contiguo.
 * Se mueve el vecino alrededor del tramo, no cada elemento del tramo: así el
 * orden interno nunca se invierte y cada subárbol viaja con su raíz.
 */
export function selectedSiblingMove(
  siblings: readonly string[],
  selected: readonly string[],
  up: boolean,
): SiblingMove | null {
  if (selected.length === 0) return null;
  const indexes = selected.map((id) => siblings.indexOf(id));
  if (indexes.some((at) => at < 0)) return null;
  const first = Math.min(...indexes);
  const last = Math.max(...indexes);
  if (last - first + 1 !== indexes.length) return null;
  const neighbour = siblings[up ? first - 1 : last + 1];
  return neighbour === undefined ? null : { block: neighbour, position: up ? last : first };
}
