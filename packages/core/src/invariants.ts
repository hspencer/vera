// Los `invariant` de las specs, ejecutables sobre un grafo real.
//
// Cada función lleva el nombre exacto del invariante en la spec, de modo que un
// fallo señale la línea que se violó y no una descripción aproximada.

import type { VeraGraph } from './graph.ts';
import { titleKey } from './text.ts';
import type { InvariantViolation } from './types.ts';

type Check = (graph: VeraGraph, report: (invariant: string, detail: string) => void) => void;

// --- core.allium -----------------------------------------------------------

const pageTitleIsUniqueWithinGraph: Check = (graph, report) => {
  const seen = new Set<string>();
  for (const page of graph.pages()) {
    const key = titleKey(page.title);
    if (seen.has(key)) {
      report('PageTitleIsUniqueWithinGraph', `two pages carry the title ${page.title}`);
    }
    seen.add(key);
  }
};

const blockStableIdentityIsUnique: Check = (graph, report) => {
  const seen = new Set<string>();
  for (const block of graph.allBlocks()) {
    if (seen.has(block.stableId)) {
      report('BlockStableIdentityIsUnique', `two blocks share the stable id ${block.stableId}`);
    }
    seen.add(block.stableId);
  }
};

const blockParentBelongsToSamePage: Check = (graph, report) => {
  for (const block of graph.allBlocks()) {
    if (block.parent === null) continue;
    const parent = graph.block(block.parent);
    if (parent === undefined) {
      report('BlockParentBelongsToSamePage', `block ${block.stableId} points at a missing parent`);
    } else if (parent.page !== block.page) {
      report(
        'BlockParentBelongsToSamePage',
        `block ${block.stableId} sits on ${block.page} but its parent is on ${parent.page}`,
      );
    }
  }
};

const blockBelongsToAnExistingPage: Check = (graph, report) => {
  for (const block of graph.allBlocks()) {
    if (graph.page(block.page) === undefined) {
      report('BlockBelongsToAnExistingPage', `block ${block.stableId} sits on a removed page`);
    }
  }
};

const propertyTargetsOneSubject: Check = (graph, report) => {
  for (const page of graph.pages()) {
    for (const property of graph.propertiesOf(page.id)) {
      if ((property.page === null) === (property.block === null)) {
        report(
          'PropertyTargetsOneSubject',
          `property ${property.key} names ${property.page === null ? 'neither' : 'both'} subjects`,
        );
      }
    }
  }
};

const propertyKeyIsUniquePerSubject: Check = (graph, report) => {
  for (const page of graph.pages()) {
    const seen = new Set<string>();
    for (const property of graph.propertiesOf(page.id)) {
      if (seen.has(property.key)) {
        report(
          'PropertyKeyIsUniquePerSubject',
          `page ${page.id} carries ${property.key} more than once`,
        );
      }
      seen.add(property.key);
    }
  }
};

const revisionParticipantBelongsToGraph: Check = (graph, report) => {
  for (const revision of graph.revisions()) {
    if (graph.participant(revision.authoredBy) === undefined) {
      report(
        'RevisionParticipantBelongsToGraph',
        `revision attributed to unknown participant ${revision.authoredBy}`,
      );
    }
  }
};

const voiceCanonicalityRequiresEvidence: Check = (graph, report) => {
  for (const revision of graph.revisions()) {
    if (revision.originIsCanonical && revision.evidence === undefined) {
      report('VoiceCanonicalityRequiresEvidence', 'a canonical revision carries no evidence');
    }
  }
};

const privatePagesAreNeverPublished: Check = (graph, report) => {
  for (const publication of graph.publications()) {
    if (graph.page(publication.page)?.visibility !== 'public') {
      report('PrivatePagesAreNeverPublished', `${publication.page} is published but not public`);
    }
  }
};

// --- change-application.allium ---------------------------------------------

const operationSequenceIsUniqueWithinLog: Check = (graph, report) => {
  const seen = new Set<number>();
  for (const operation of graph.operations()) {
    if (seen.has(operation.sequence)) {
      report('OperationSequenceIsUniqueWithinLog', `sequence ${operation.sequence} repeats`);
    }
    seen.add(operation.sequence);
  }
};

const operationOriginIsUniqueWithinLog: Check = (graph, report) => {
  const seen = new Set<string>();
  for (const operation of graph.operations()) {
    if (seen.has(operation.originId)) {
      report('OperationOriginIsUniqueWithinLog', `origin ${operation.originId} repeats`);
    }
    seen.add(operation.originId);
  }
};

const sequenceNeverExceedsLogPosition: Check = (graph, report) => {
  const last = graph.log().lastSequence;
  for (const operation of graph.operations()) {
    if (operation.sequence < 1 || operation.sequence > last) {
      report(
        'SequenceNeverExceedsLogPosition',
        `sequence ${operation.sequence} falls outside 1..${last}`,
      );
    }
  }
};

const operationRecordsItsSubmissionOrigin: Check = (graph, report) => {
  for (const operation of graph.operations()) {
    if (operation.originId !== operation.submission.originId) {
      report('OperationRecordsItsSubmissionOrigin', `operation ${operation.id} disagrees`);
    }
  }
};

const appliedOperationsAreAccepted: Check = (graph, report) => {
  for (const operation of graph.operations()) {
    if (operation.submission.status !== 'accepted') {
      report('AppliedOperationsAreAccepted', `operation ${operation.id} was not accepted`);
    }
  }
};

const everyOperationHasARevision: Check = (graph, report) => {
  if (graph.operations().length !== graph.revisions().length) {
    report(
      'AttributedHistory',
      `${graph.operations().length} operations but ${graph.revisions().length} revisions`,
    );
  }
};

// --- graph-navigation.allium -----------------------------------------------

const linkSourceBlockBelongsToSourcePage: Check = (graph, report) => {
  for (const link of graph.links()) {
    const block = graph.block(link.sourceBlock);
    if (block === undefined) {
      report('LinkSourceBlockBelongsToSourcePage', `link ${link.id} outlived its block`);
    } else if (block.page !== link.sourcePage) {
      report('LinkSourceBlockBelongsToSourcePage', `link ${link.id} names the wrong source page`);
    }
  }
};

const resolvedLinkMatchesTheTitleItNamed: Check = (graph, report) => {
  for (const link of graph.links()) {
    if (link.target === null) continue;
    const target = graph.page(link.target);
    if (target === undefined) {
      report('ResolvedLinkStaysWithinOneGraph', `link ${link.id} points at a removed page`);
    } else if (titleKey(target.title) !== titleKey(link.targetTitle)) {
      report(
        'ResolvedLinkMatchesTheTitleItNamed',
        `link ${link.id} named ${link.targetTitle} but resolves to ${target.title}`,
      );
    }
  }
};

// --- query-language.allium -------------------------------------------------

const oneUnportedRecordPerBlock: Check = (graph, report) => {
  const seen = new Set<string>();
  for (const unported of graph.unportedQueries()) {
    if (seen.has(unported.block)) {
      report('OneUnportedRecordPerBlock', `block ${unported.block} holds two unported records`);
    }
    seen.add(unported.block);
  }
};

const portingIsAttributed: Check = (graph, report) => {
  for (const unported of graph.unportedQueries()) {
    if (unported.portedTo !== null && unported.portedBy === null) {
      report('PortingIsAttributed', `unported query ${unported.id} was ported by nobody`);
    }
  }
};

const CHECKS: readonly Check[] = [
  pageTitleIsUniqueWithinGraph,
  blockStableIdentityIsUnique,
  blockParentBelongsToSamePage,
  blockBelongsToAnExistingPage,
  propertyTargetsOneSubject,
  propertyKeyIsUniquePerSubject,
  revisionParticipantBelongsToGraph,
  voiceCanonicalityRequiresEvidence,
  privatePagesAreNeverPublished,
  operationSequenceIsUniqueWithinLog,
  operationOriginIsUniqueWithinLog,
  sequenceNeverExceedsLogPosition,
  operationRecordsItsSubmissionOrigin,
  appliedOperationsAreAccepted,
  everyOperationHasARevision,
  linkSourceBlockBelongsToSourcePage,
  resolvedLinkMatchesTheTitleItNamed,
  oneUnportedRecordPerBlock,
  portingIsAttributed,
];

/**
 * Verifica todos los invariantes de v0 sobre un grafo. Devuelve la lista vacía
 * cuando el grafo está sano. Es lo que ejecutan las pruebas de propiedad tras
 * cada secuencia de operaciones.
 */
export function checkInvariants(graph: VeraGraph): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const report = (invariant: string, detail: string): void => {
    violations.push({ invariant, detail });
  };
  for (const check of CHECKS) check(graph, report);
  return violations;
}
