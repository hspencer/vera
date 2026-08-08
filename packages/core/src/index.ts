// @vera/core — el dominio de Vera.
//
// Traducido desde specs/core.allium, change-application.allium,
// query-language.allium, search-index.allium y graph-navigation.allium.
// No conoce SQL, HTTP ni el sistema de archivos: eso lo aportan packages/store,
// packages/server y packages/importer sobre esta base.

export { VeraGraph } from './graph.ts';
export { checkInvariants } from './invariants.ts';

export {
  and,
  contentTerm,
  linkedFrom,
  linksTo,
  not,
  or,
  propertyTerm,
  tagTerm,
  titleTerm,
} from './query.ts';
export type { QueryExpression } from './query.ts';

export { looksLikeQuery, readQuery, writeQuery } from './query-source.ts';

/*
 * Las dos páginas que dicen de qué está hecho este corpus: qué propiedades hay y
 * qué clase de campo es cada una, y qué objetos hay y qué propiedades los
 * constituyen. Ver ontology.ts.
 */
export {
  FIELD_KINDS,
  fieldKindOf,
  missingFor,
  readObjectDeclarations,
  readPropertyDeclarations,
} from './ontology.ts';
export type {
  DeclaredBlock,
  FieldKind,
  ObjectDeclaration,
  PropertyDeclaration,
} from './ontology.ts';

/*
 * Cómo se lee un bloque escrito en Markdown.
 *
 * Está en el dominio porque lo necesitan dos superficies —la pantalla y el
 * papel— y una segunda copia habría acabado diciendo otra cosa del mismo texto.
 */
export { embedIn, inlineMarkdown, renderMarkdown } from './markdown.ts';
export type { RenderOptions } from './markdown.ts';
export { answersIn } from './vocabulary.ts';

export {
  STARTER_RELATIONS,
  inverseOf,
  isSymmetric,
  relationKeyOf,
  senseIn,
  titleIn,
} from './relations.ts';
export {
  DEFAULT_PROPERTY_NAMES,
  DERIVED,
  SPECIAL_KIND,
  derivedRole,
  namesFromRoles,
  readPropertyNames,
} from './property-names.ts';
export type { PropertyNames, PropertyRole } from './property-names.ts';
export type { Crossing, CrossingSense, RelationTerm } from './relations.ts';
export type { QuerySource, QueryUnreadable, QueryView } from './query-source.ts';

export {
  calendarDay,
  excerpt,
  isDateTitle,
  matches,
  queryMacroText,
  referencedTags,
  referencedTitles,
  titleKey,
} from './text.ts';

export {
  CHANGE_KINDS,
  CONTRIBUTION_CHANNELS,
  PARTICIPANT_KINDS,
  PARTICIPANT_STATUSES,
  VISIBILITIES,
} from './types.ts';

export type {
  Authorship,
  Block,
  BlockId,
  Change,
  ChangeKind,
  ContributionChannel,
  GraphId,
  GraphNeighbourhood,
  InvariantViolation,
  NeighbourhoodEdge,
  NeighbourhoodNode,
  Operation,
  OperationInput,
  OriginEvidence,
  Page,
  PageId,
  PageLink,
  Participant,
  ParticipantId,
  ParticipantKind,
  ParticipantStatus,
  PropertyAssignment,
  Publication,
  Revision,
  SearchHit,
  SearchOutcome,
  SearchableField,
  Submission,
  SubmitOutcome,
  UnportedQuery,
  Visibility,
} from './types.ts';
