import type { PageView } from './api.ts';

/**
 * Whether a retained readable page says the same thing as the canonical one.
 *
 * This deliberately compares authored meaning rather than enrichment derived
 * from the rest of the graph. Equal block counts are not enough: that was the
 * hole that allowed changed prose to masquerade as a current retained page.
 */
export function sameReadablePage(retained: PageView, canonical: PageView): boolean {
  return retained.id === canonical.id &&
    retained.title === canonical.title &&
    retained.visibility === canonical.visibility &&
    retained.lastEditedAt === canonical.lastEditedAt &&
    JSON.stringify(retained.properties) === JSON.stringify(canonical.properties) &&
    JSON.stringify(retained.blockProperties ?? {}) === JSON.stringify(canonical.blockProperties ?? {}) &&
    JSON.stringify(retained.blocks.map(({ stableId, parent, position, content }) => ({
      stableId,
      parent,
      position,
      content,
    }))) === JSON.stringify(canonical.blocks.map(({ stableId, parent, position, content }) => ({
      stableId,
      parent,
      position,
      content,
    })));
}
