/** Un bloque visible y dónde estaba respecto del borde superior del visor. */
export interface ViewportSeat {
  block: string;
  top: number;
}

export interface HeldViewport {
  scrollTop: number;
  seats: ViewportSeat[];
}

/**
 * Guarda varios testigos, no uno solo: el gesto puede borrar justamente el
 * bloque que estaba más cerca del borde. El siguiente superviviente conserva
 * entonces el lugar y la página no salta.
 */
export function holdViewport(container: HTMLElement): HeldViewport {
  const frame = container.getBoundingClientRect();
  const seats = [...container.querySelectorAll<HTMLElement>('.block[data-id]')]
    .map((block) => {
      const rect = block.getBoundingClientRect();
      return {
        block: block.dataset['id'] ?? '',
        top: rect.top - frame.top,
        bottom: rect.bottom - frame.top,
      };
    })
    .filter((seat) => seat.block !== '' && seat.bottom >= 0 && seat.top <= frame.height)
    .sort((a, b) => Math.abs(a.top) - Math.abs(b.top))
    .slice(0, 12)
    .map(({ block, top }) => ({ block, top }));
  return { scrollTop: container.scrollTop, seats };
}

/** Devuelve cuánto corregir el scroll para que el primer testigo vivo no se mueva. */
export function viewportDelta(
  held: HeldViewport,
  now: ReadonlyMap<string, number>,
): number | null {
  for (const seat of held.seats) {
    const top = now.get(seat.block);
    if (top !== undefined) return top - seat.top;
  }
  return null;
}

export function restoreViewport(container: HTMLElement, held: HeldViewport): void {
  const frame = container.getBoundingClientRect();
  const now = new Map<string, number>();
  for (const block of container.querySelectorAll<HTMLElement>('.block[data-id]')) {
    const id = block.dataset['id'];
    if (id !== undefined) now.set(id, block.getBoundingClientRect().top - frame.top);
  }
  const delta = viewportDelta(held, now);
  container.scrollTop = delta === null ? held.scrollTop : container.scrollTop + delta;
}
