// Expresiones de consulta, desde specs/query-language.allium.
//
// El vocabulario está enumerado: se puede descubrir qué es preguntable sin leer
// una gramática ni adivinar un dialecto.

import type { PageId } from './types.ts';

export type QueryExpression =
  | { readonly kind: 'TitleTerm'; readonly text: string }
  | { readonly kind: 'ContentTerm'; readonly text: string }
  | { readonly kind: 'TagTerm'; readonly tag: string }
  | { readonly kind: 'PropertyTerm'; readonly key: string; readonly value: string | null }
  | { readonly kind: 'LinksToTerm'; readonly target: PageId }
  | { readonly kind: 'LinkedFromTerm'; readonly origin: PageId }
  | { readonly kind: 'AndTerm'; readonly operands: readonly QueryExpression[] }
  | { readonly kind: 'OrTerm'; readonly operands: readonly QueryExpression[] }
  | { readonly kind: 'NotTerm'; readonly operand: QueryExpression };

export function titleTerm(text: string): QueryExpression {
  return { kind: 'TitleTerm', text };
}

export function contentTerm(text: string): QueryExpression {
  return { kind: 'ContentTerm', text };
}

export function tagTerm(tag: string): QueryExpression {
  return { kind: 'TagTerm', tag };
}

/** Sin valor, selecciona las páginas que llevan la propiedad, cualquiera sea su valor. */
export function propertyTerm(key: string, value?: string): QueryExpression {
  return { kind: 'PropertyTerm', key, value: value ?? null };
}

export function linksTo(target: PageId): QueryExpression {
  return { kind: 'LinksToTerm', target };
}

export function linkedFrom(origin: PageId): QueryExpression {
  return { kind: 'LinkedFromTerm', origin };
}

// invariant CombiningTermsNeedTwoOperands
export function and(...operands: QueryExpression[]): QueryExpression {
  if (operands.length < 2) {
    throw new Error('an AndTerm needs at least two operands');
  }
  return { kind: 'AndTerm', operands };
}

export function or(...operands: QueryExpression[]): QueryExpression {
  if (operands.length < 2) {
    throw new Error('an OrTerm needs at least two operands');
  }
  return { kind: 'OrTerm', operands };
}

export function not(operand: QueryExpression): QueryExpression {
  return { kind: 'NotTerm', operand };
}
