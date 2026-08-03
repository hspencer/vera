// Tipos del dominio, traducidos 1:1 desde specs/core.allium y
// specs/change-application.allium. Los campos de las specs son snake_case; la
// superficie TypeScript es camelCase y la correspondencia es uno a uno.

export type ParticipantId = string;
export type GraphId = string;
export type PageId = string;
export type BlockId = string;
export type OperationId = string;

export const PARTICIPANT_KINDS = ['human', 'agent'] as const;
export type ParticipantKind = (typeof PARTICIPANT_KINDS)[number];

export const PARTICIPANT_STATUSES = ['active', 'suspended'] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];

export const CONTRIBUTION_CHANNELS = [
  'typed_text',
  'authenticated_voice',
  'agent_generation',
  'import',
] as const;
export type ContributionChannel = (typeof CONTRIBUTION_CHANNELS)[number];

export const VISIBILITIES = ['private', 'public'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

// El vocabulario de cambio que change-application.allium fijó. No incluye
// link_pages: los enlaces se derivan del contenido, así que son consecuencia de
// edit_block y nunca una operación que alguien envíe.
export const CHANGE_KINDS = [
  'create_page',
  'rename_page',
  'set_page_visibility',
  'remove_page',
  'create_block',
  'edit_block',
  'move_block',
  'remove_block',
  'set_property',
  'remove_property',
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export interface OriginEvidence {
  readonly reference: string;
  readonly capturedAt: number;
}

export type Change =
  | { readonly kind: 'create_page'; readonly title: string; readonly visibility: Visibility }
  | { readonly kind: 'rename_page'; readonly page: PageId; readonly title: string }
  | {
      readonly kind: 'set_page_visibility';
      readonly page: PageId;
      readonly visibility: Visibility;
    }
  | { readonly kind: 'remove_page'; readonly page: PageId }
  | {
      readonly kind: 'create_block';
      readonly page: PageId;
      readonly parent: BlockId | null;
      readonly position: number;
      readonly content: string;
      /**
       * Identidad propuesta por quien envía. Sólo la usa la importación, para
       * adoptar los identificadores que el corpus ya traía en vez de inventar
       * otros y romper las referencias que existían fuera de Vera.
       */
      readonly stableId?: BlockId | undefined;
    }
  | { readonly kind: 'edit_block'; readonly block: BlockId; readonly content: string }
  | {
      readonly kind: 'move_block';
      readonly block: BlockId;
      readonly page: PageId;
      readonly parent: BlockId | null;
      readonly position: number;
    }
  | { readonly kind: 'remove_block'; readonly block: BlockId }
  | {
      readonly kind: 'set_property';
      readonly page?: PageId | undefined;
      readonly block?: BlockId | undefined;
      readonly propertyKey: string;
      readonly propertyValue: string;
    }
  | {
      readonly kind: 'remove_property';
      readonly page?: PageId | undefined;
      readonly block?: BlockId | undefined;
      readonly propertyKey: string;
    };

export interface Participant {
  readonly id: ParticipantId;
  readonly name: string;
  readonly kind: ParticipantKind;
  status: ParticipantStatus;
}

export interface Page {
  readonly id: PageId;
  readonly graph: GraphId;
  title: string;
  visibility: Visibility;
  readonly createdAt: number;
}

export interface Block {
  /** La identidad que sobrevive a editar y mover. Nunca se reasigna. */
  readonly stableId: BlockId;
  page: PageId;
  parent: BlockId | null;
  position: number;
  content: string;
  readonly createdAt: number;
}

export interface PropertyAssignment {
  readonly graph: GraphId;
  readonly page: PageId | null;
  readonly block: BlockId | null;
  readonly key: string;
  value: string;
}

export interface Submission {
  readonly graph: GraphId;
  readonly originId: string;
  readonly submittedBy: ParticipantId;
  readonly change: Change;
  readonly channel: ContributionChannel;
  readonly evidence?: OriginEvidence | undefined;
  readonly submittedAt: number;
  readonly status: 'submitted' | 'accepted' | 'rejected';
}

export interface Revision {
  readonly graph: GraphId;
  readonly page: PageId | null;
  readonly block: BlockId | null;
  readonly authoredBy: ParticipantId;
  readonly channel: ContributionChannel;
  readonly evidence?: OriginEvidence | undefined;
  readonly recordedAt: number;
  /** La voz autenticada prueba autoría, no verdad factual. */
  readonly originIsCanonical: boolean;
}

/**
 * De qué mano salió el texto que un bloque tiene ahora.
 *
 * @invariant GeneratedContentIsAlwaysDistinguishable: todo bloque la tiene, así
 * que saber si un pasaje se escribió o se generó nunca obliga a recorrer el
 * registro.
 *
 * Es cosa distinta de la denominación de origen. `SpokenOrigin` dice de dónde
 * vinieron las palabras y no cambia nunca; esto dice quién las escribió por
 * última vez y cambia con cada edición. Un bloque puede tener las dos y nombrar
 * participantes distintos: dictado por Herbert, reescrito por un agente.
 */
export interface Authorship {
  readonly block: BlockId;
  readonly participant: ParticipantId;
  readonly channel: ContributionChannel;
  readonly writtenAt: number;
}

export interface Operation {
  readonly id: OperationId;
  readonly originId: string;
  readonly submission: Submission;
  readonly sequence: number;
  /** La página o bloque que la operación creó o tocó. Permite reproducir el log. */
  readonly subjectId: string;
  readonly appliedAt: number;
}

export type SubmitOutcome =
  | { readonly status: 'applied'; readonly operation: Operation; readonly subjectId: string }
  | { readonly status: 'duplicate'; readonly operation: Operation }
  | { readonly status: 'rejected'; readonly reason: string };

export interface OperationInput {
  readonly originId: string;
  readonly participant: ParticipantId;
  readonly change: Change;
  readonly channel?: ContributionChannel | undefined;
  readonly evidence?: OriginEvidence | undefined;
  readonly submittedAt?: number | undefined;
}

export interface PageLink {
  readonly id: string;
  readonly graph: GraphId;
  readonly sourcePage: PageId;
  readonly sourceBlock: BlockId;
  readonly targetTitle: string;
  target: PageId | null;
}

export interface UnportedQuery {
  readonly id: string;
  readonly graph: GraphId;
  readonly block: BlockId;
  sourceText: string;
  portedTo: unknown | null;
  portedBy: ParticipantId | null;
  portedAt: number | null;
}

export interface Publication {
  readonly page: PageId;
  readonly path: string;
  readonly publishedAt: number;
}

export type SearchableField =
  | 'page_title'
  | 'block_content'
  | 'property_value'
  | 'audio_transcript';

export interface SearchHit {
  readonly page: PageId;
  readonly block: BlockId | null;
  readonly field: SearchableField;
  readonly excerpt: string;
  readonly rank: number;
}

export interface SearchOutcome {
  readonly graph: GraphId;
  readonly text: string;
  readonly searchedBy: ParticipantId;
  readonly hits: readonly SearchHit[];
}

export interface NeighbourhoodNode {
  readonly page: PageId;
  readonly distance: number;
  readonly degree: number;
  readonly blockCount: number;
}

export interface NeighbourhoodEdge {
  readonly source: PageId;
  readonly target: PageId;
}

export interface GraphNeighbourhood {
  readonly graph: GraphId;
  readonly centre: PageId;
  readonly depth: number;
  readonly nodes: readonly NeighbourhoodNode[];
  readonly edges: readonly NeighbourhoodEdge[];
}

export interface InvariantViolation {
  readonly invariant: string;
  readonly detail: string;
}
