// Borrar una página es vaciarla de abajo hacia arriba y quitarla al final.
//
// El dominio rechaza tanto un bloque con hijos como una página con bloques. La
// secuencia vive aquí para que cualquier superficie que ofrezca «borrar» cumpla
// esas mismas reglas y cada ausencia siga quedando registrada por separado.

import type { Change, PageView } from './api.ts';

type Write = (change: Change) => Promise<boolean>;

export async function removePageAndBlocks(
  page: Pick<PageView, 'id' | 'blocks'>,
  write: Write,
): Promise<boolean> {
  const parents = new Map(page.blocks.map((block) => [block.stableId, block.parent]));
  const depthOf = (id: string): number => {
    let depth = 0;
    let at = parents.get(id) ?? null;
    // Un corpus dañado no debe dejar al navegador atrapado en un ciclo.
    while (at !== null && depth < 1000) {
      depth += 1;
      at = parents.get(at) ?? null;
    }
    return depth;
  };
  const deepestFirst = [...page.blocks].sort(
    (left, right) => depthOf(right.stableId) - depthOf(left.stableId),
  );

  for (const block of deepestFirst) {
    if (!(await write({ kind: 'remove_block', block: block.stableId }))) return false;
  }
  return write({ kind: 'remove_page', page: page.id });
}
