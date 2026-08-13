// El contexto que Vera entrega al lector local.
//
// Qwen no es la memoria: Vera lo es. Este módulo selecciona una porción pequeña
// y comprobable del grafo para que el modelo clasifique con el idioma del corpus
// sin meter dos mil títulos en cada prompt.

import { titleKey, type ObjectDeclaration, type PropertyDeclaration } from '@vera/core';

export interface ConceptCandidate {
  /** Identidad canónica: es lo que el modelo debe devolver. */
  id: string;
  title: string;
  /** Cuántas páginas ya usan este título como concepto. */
  uses: number;
  backlinks: number;
  /** Ya enlazado desde la página que se está leyendo. */
  linked: boolean;
  /** Una glosa corta de la propia página candidata. */
  excerpt: string | null;
}

export interface OntologyContext {
  objects: readonly ObjectDeclaration[];
  properties: readonly PropertyDeclaration[];
  candidates: readonly ConceptCandidate[];
}

const STOP = new Set([
  'a', 'al', 'ante', 'como', 'con', 'de', 'del', 'el', 'en', 'entre', 'es', 'esta', 'este',
  'la', 'las', 'lo', 'los', 'o', 'para', 'por', 'que', 'se', 'sin', 'su', 'sus', 'un', 'una',
  'y', 'the', 'of', 'and', 'to', 'in', 'for', 'is', 'on', 'with',
]);

const words = (text: string): Set<string> =>
  new Set(
    titleKey(text)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 1 && !STOP.has(word)),
  );

/**
 * Recupera los conceptos que vale la pena mostrar en este pase.
 *
 * La mención literal y los enlaces mandan. Después vienen la afinidad del
 * título, el uso real como concepto y la centralidad. Los dos últimos sólo
 * desempatan: una página famosa no debe desplazar a una palabra que el texto sí
 * está diciendo.
 */
export function relevantConcepts(
  text: string,
  candidates: readonly ConceptCandidate[],
  most = 24,
): ConceptCandidate[] {
  const normalized = ` ${titleKey(text)} `;
  const terms = words(text);
  return candidates
    .map((candidate, order) => {
      const title = titleKey(candidate.title);
      const overlap = [...words(candidate.title)].filter((word) => terms.has(word)).length;
      const exact = title !== '' && normalized.includes(` ${title} `);
      const score =
        (exact ? 1_000 : 0) +
        (candidate.linked ? 400 : 0) +
        overlap * 80 +
        Math.log2(candidate.uses + 1) * 5 +
        Math.log2(candidate.backlinks + 1) * 2;
      return { candidate, score, order };
    })
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, Math.max(0, most))
    .map(({ candidate }) => candidate);
}

/** Texto compacto, estable y deliberadamente aburrido para el prompt. */
export function describeOntology(context: OntologyContext): string {
  const types = context.objects.map((object) => {
    const says = object.says === null ? '' : ` — ${object.says}`;
    const properties = object.properties.length === 0 ? '' : `; propiedades: ${object.properties.join(', ')}`;
    return `- ${object.name}${says}${properties}`;
  });
  const roles = context.properties
    .filter((property) => property.role === 'kind' || property.role === 'topic')
    .map((property) => {
      const says = property.says === null ? '' : ` — ${property.says}`;
      return `- ${property.name} (${property.role}, ${property.field ?? 'texto'}${property.many ? ', varios' : ''})${says}`;
    });
  return [
    'CLASES DE OBJETO:',
    ...(types.length > 0 ? types : ['- (usa sólo el vocabulario permitido)']),
    'PAPELES ONTOLÓGICOS:',
    ...(roles.length > 0 ? roles : ['- tipo = clase de cosa; concepto = asunto del que trata']),
  ].join('\n');
}

export function describeCandidates(candidates: readonly ConceptCandidate[]): string {
  if (candidates.length === 0) return '- (ningún candidato recuperado)';
  return candidates
    .map((candidate) => {
      const evidence = [
        candidate.uses > 0 ? `${candidate.uses} usos` : '',
        candidate.backlinks > 0 ? `${candidate.backlinks} enlaces` : '',
        candidate.linked ? 'ya enlazado aquí' : '',
      ].filter(Boolean).join(', ');
      const excerpt = candidate.excerpt === null ? '' : ` — ${candidate.excerpt}`;
      return `- ${candidate.id} | ${candidate.title}${evidence === '' ? '' : ` (${evidence})`}${excerpt}`;
    })
    .join('\n');
}
