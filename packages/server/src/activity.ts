// El registro de actividad es una lectura del log canónico, no otro historial.
//
// Doblar las operaciones aquí permite dos cosas que el estado vigente ya no
// sabe contestar: cómo se llamaba una página borrada y qué árbol tenía antes de
// que la secuencia de eliminación la vaciara. Nada de esto se persiste otra vez.

import type { Change, Operation, VeraGraph, Visibility } from '@vera/core';

export interface ActivityItem {
  sequence: number;
  at: number;
  by: string;
  participant: string;
  channel: string;
  kind: Change['kind'];
  subjectId: string;
  page: { id: string; title: string } | null;
  summary: string;
}

export interface DeletedPageActivity {
  page: string;
  title: string;
  deletedAt: number;
  sequence: number;
  by: string;
  blocks: number;
  restorable: boolean;
  refusal: string | null;
  changes: Change[];
}

interface BlockState {
  id: string;
  page: string;
  parent: string | null;
  position: number;
  content: string;
  gloss: string | null;
  properties: Map<string, string>;
}

interface PageState {
  id: string;
  title: string;
  visibility: Visibility;
  createdAt: number;
  originCreatedAt: number | null;
  properties: Map<string, string>;
  blocks: Map<string, BlockState>;
}

interface RemovedBlock {
  operation: Operation;
  block: BlockState;
}

interface FoldedDeletion {
  page: PageState;
  operation: Operation;
  blocks: BlockState[];
}

const copyBlock = (block: BlockState): BlockState => ({
  ...block,
  properties: new Map(block.properties),
});

const summaryOf = (change: Change, title: string | null): string => {
  const page = title === null ? 'la página' : `«${title}»`;
  switch (change.kind) {
    case 'create_page': return `creó ${page}`;
    case 'rename_page': return `renombró ${page}`;
    case 'set_page_visibility': return `${change.visibility === 'public' ? 'hizo pública' : 'hizo privada'} ${page}`;
    case 'recover_page_origin': return `recuperó la fecha de origen de ${page}`;
    case 'remove_page': return `borró ${page}`;
    case 'create_block': return `creó un bloque en ${page}`;
    case 'edit_block': return `editó un bloque en ${page}`;
    case 'move_block': return `movió un bloque en ${page}`;
    case 'remove_block': return `borró un bloque de ${page}`;
    case 'set_block_gloss': return `cambió la glosa de un bloque en ${page}`;
    case 'set_property': return `cambió la propiedad «${change.propertyKey}» de ${page}`;
    case 'remove_property': return `quitó la propiedad «${change.propertyKey}» de ${page}`;
  }
};

/** Dobla el log en actividad legible y tumbas restaurables. */
export function activityOf(graph: VeraGraph): {
  activity: ActivityItem[];
  deletedPages: DeletedPageActivity[];
} {
  const pages = new Map<string, PageState>();
  const blocks = new Map<string, BlockState>();
  const activity: ActivityItem[] = [];
  const deletions: FoldedDeletion[] = [];
  let removalRun: RemovedBlock[] = [];

  for (const operation of graph.operations().sort((a, b) => a.sequence - b.sequence)) {
    const change = operation.submission.change;
    let pageId: string | null = null;

    if (change.kind === 'create_page') pageId = operation.subjectId;
    else if ('page' in change && typeof change.page === 'string') pageId = change.page;
    else if ('block' in change && typeof change.block === 'string') pageId = blocks.get(change.block)?.page ?? null;

    const beforeTitle = pageId === null ? null : pages.get(pageId)?.title ?? null;

    // `remove_page` cierra la corrida de bloques borrados; no debe borrarla
    // antes de poder convertirla en una tumba restaurable.
    if (change.kind !== 'remove_block' && change.kind !== 'remove_page') removalRun = [];

    switch (change.kind) {
      case 'create_page': {
        const page: PageState = {
          id: operation.subjectId,
          title: change.title,
          visibility: change.visibility,
          createdAt: operation.appliedAt,
          originCreatedAt: null,
          properties: new Map(),
          blocks: new Map(),
        };
        pages.set(page.id, page);
        pageId = page.id;
        break;
      }
      case 'rename_page': {
        const page = pages.get(change.page);
        if (page !== undefined) page.title = change.title;
        break;
      }
      case 'set_page_visibility': {
        const page = pages.get(change.page);
        if (page !== undefined) page.visibility = change.visibility;
        break;
      }
      case 'recover_page_origin': {
        const page = pages.get(change.page);
        if (page !== undefined) page.originCreatedAt = change.originCreatedAt;
        break;
      }
      case 'create_block': {
        const block: BlockState = {
          id: operation.subjectId,
          page: change.page,
          parent: change.parent,
          position: change.position,
          content: change.content,
          gloss: null,
          properties: new Map(),
        };
        blocks.set(block.id, block);
        pages.get(block.page)?.blocks.set(block.id, block);
        break;
      }
      case 'edit_block': {
        const block = blocks.get(change.block);
        if (block !== undefined) block.content = change.content;
        break;
      }
      case 'move_block': {
        const block = blocks.get(change.block);
        if (block !== undefined) {
          pages.get(block.page)?.blocks.delete(block.id);
          block.page = change.page;
          block.parent = change.parent;
          block.position = change.position;
          pages.get(block.page)?.blocks.set(block.id, block);
          pageId = block.page;
        }
        break;
      }
      case 'set_block_gloss': {
        const block = blocks.get(change.block);
        if (block !== undefined) block.gloss = change.content;
        break;
      }
      case 'set_property': {
        if (change.block !== undefined) {
          blocks.get(change.block)?.properties.set(change.propertyKey, change.propertyValue);
        } else if (change.page !== undefined) {
          pages.get(change.page)?.properties.set(change.propertyKey, change.propertyValue);
        }
        break;
      }
      case 'remove_property': {
        if (change.block !== undefined) blocks.get(change.block)?.properties.delete(change.propertyKey);
        else if (change.page !== undefined) pages.get(change.page)?.properties.delete(change.propertyKey);
        break;
      }
      case 'remove_block': {
        const block = blocks.get(change.block);
        if (block !== undefined) {
          pageId = block.page;
          removalRun.push({ operation, block: copyBlock(block) });
          blocks.delete(block.id);
          pages.get(block.page)?.blocks.delete(block.id);
        }
        break;
      }
      case 'remove_page': {
        const page = pages.get(change.page);
        if (page !== undefined) {
          const sameGesture = removalRun.filter(
            (one) =>
              one.block.page === page.id &&
              one.operation.submission.submittedBy === operation.submission.submittedBy &&
              one.operation.submission.channel === operation.submission.channel,
          );
          deletions.push({
            page: { ...page, properties: new Map(page.properties), blocks: new Map() },
            operation,
            blocks: sameGesture.map((one) => copyBlock(one.block)),
          });
          pages.delete(page.id);
        }
        removalRun = [];
        break;
      }
    }

    const title = pageId === null ? null : pages.get(pageId)?.title ?? beforeTitle;
    activity.push({
      sequence: operation.sequence,
      at: operation.appliedAt,
      by: graph.participant(operation.submission.submittedBy)?.name ?? operation.submission.submittedBy,
      participant: operation.submission.submittedBy,
      channel: operation.submission.channel,
      kind: change.kind,
      subjectId: operation.subjectId,
      page: pageId === null ? null : { id: pageId, title: title ?? pageId },
      summary: summaryOf(change, title),
    });
  }

  const deletedPages = deletions
    .map(({ page, operation, blocks: removed }): DeletedPageActivity => {
      const alive = graph.page(page.id);
      const conflicting = graph.pageTitled(page.title);
      const refusal =
        alive !== undefined
          ? 'esa identidad ya volvió al corpus'
          : conflicting !== undefined
            ? `otra página se llama ahora «${page.title}»`
            : null;
      const changes: Change[] = [
        { kind: 'create_page', title: page.title, visibility: page.visibility, stableId: page.id },
        { kind: 'recover_page_origin', page: page.id, originCreatedAt: page.originCreatedAt ?? page.createdAt },
        ...[...page.properties].map(([propertyKey, propertyValue]): Change => ({
          kind: 'set_property', page: page.id, propertyKey, propertyValue,
        })),
      ];

      const pending = new Map(removed.map((block) => [block.id, block]));
      const ordered: BlockState[] = [];
      while (pending.size > 0) {
        const ready = [...pending.values()].filter(
          (block) => block.parent === null || ordered.some((parent) => parent.id === block.parent),
        );
        if (ready.length === 0) break;
        ready.sort((a, b) => a.position - b.position);
        for (const block of ready) {
          ordered.push(block);
          pending.delete(block.id);
        }
      }
      for (const block of ordered) {
        changes.push({
          kind: 'create_block', page: page.id, parent: block.parent,
          position: block.position, content: block.content, stableId: block.id,
        });
        if (block.gloss !== null) changes.push({ kind: 'set_block_gloss', block: block.id, content: block.gloss });
        for (const [propertyKey, propertyValue] of block.properties) {
          changes.push({ kind: 'set_property', block: block.id, propertyKey, propertyValue });
        }
      }

      return {
        page: page.id,
        title: page.title,
        deletedAt: operation.appliedAt,
        sequence: operation.sequence,
        by: graph.participant(operation.submission.submittedBy)?.name ?? operation.submission.submittedBy,
        blocks: removed.length,
        restorable: refusal === null && pending.size === 0,
        refusal: pending.size > 0 ? 'el árbol histórico no se pudo ordenar entero' : refusal,
        changes,
      };
    })
    .reverse();

  return { activity: activity.reverse(), deletedPages };
}
