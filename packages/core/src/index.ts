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

export {
  excerpt,
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
