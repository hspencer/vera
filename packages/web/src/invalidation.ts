import { referencedTags, referencedTitles } from '@vera/core';

function graphReferences(content: string): string {
  return JSON.stringify({
    pages: [...referencedTitles(content)].sort(),
    tags: [...referencedTags(content)].sort(),
  });
}

/** Prosa, formato y ortografía no cambian el mapa. Enlaces y etiquetas sí. */
export function changesGraphMeaning(before?: string, after?: string): boolean {
  if (before === undefined || after === undefined) return true;
  return graphReferences(before) !== graphReferences(after);
}
