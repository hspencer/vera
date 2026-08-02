// El grafo de Vera materializado en memoria.
//
// Regla que gobierna este archivo: submitOperation() es la única vía de
// escritura. Todo lo demás es lectura. Eso es lo que materializa
// @guarantee EqualMutationPath: humanos y agentes cruzan la misma frontera, y
// ninguno tiene una puerta trasera.

import {
  excerpt,
  matches,
  queryMacroText,
  referencedTags,
  referencedTitles,
  titleKey,
} from './text.ts';
import type { QueryExpression } from './query.ts';
import type {
  Block,
  BlockId,
  Change,
  GraphId,
  GraphNeighbourhood,
  NeighbourhoodEdge,
  NeighbourhoodNode,
  OperationInput,
  Operation,
  Page,
  PageId,
  PageLink,
  Participant,
  ParticipantId,
  ParticipantKind,
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

const FIELD_ORDER: Record<SearchableField, number> = {
  page_title: 0,
  block_content: 1,
  property_value: 2,
  audio_transcript: 3,
};

export class VeraGraph {
  readonly id: GraphId;
  readonly name: string;

  #participants = new Map<ParticipantId, Participant>();
  #memberships = new Map<ParticipantId, 'active' | 'suspended'>();
  #owner: ParticipantId | null = null;

  #pages = new Map<PageId, Page>();
  #blocks = new Map<BlockId, Block>();
  #tags = new Map<BlockId, string[]>();

  // Índices. Sin ellos cada bloque nuevo recorre todos los enlaces existentes,
  // y el corpus de 42.000 bloques tarda segundos en importarse en vez de
  // milisegundos. Los mantiene #setLinkTarget y compañía; nada más los toca.
  #blocksByPage = new Map<PageId, Set<BlockId>>();
  #childrenByParent = new Map<BlockId, Set<BlockId>>();
  #pageByTitleKey = new Map<string, PageId>();
  #propertiesBySubject = new Map<string, PropertyAssignment[]>();
  #linksByBlock = new Map<BlockId, PageLink[]>();
  #linksByTarget = new Map<PageId, Set<PageLink>>();
  #unresolvedByTitleKey = new Map<string, Set<PageLink>>();
  #unportedByBlock = new Map<BlockId, UnportedQuery>();
  #publications: Publication[] = [];

  #operations: Operation[] = [];
  #revisions: Revision[] = [];
  #origins = new Map<string, Operation>();
  #lastSequence = 0;
  #counter = 0;

  private constructor(id: GraphId, name: string) {
    this.id = id;
    this.name = name;
  }

  static create(options: { name: string; id?: string }): VeraGraph {
    return new VeraGraph(options.id ?? 'graph:1', options.name);
  }

  // -------------------------------------------------------------------------
  // Participación (identity-access.allium)
  // -------------------------------------------------------------------------

  addParticipant(input: { id: ParticipantId; name: string; kind: ParticipantKind }): void {
    this.#participants.set(input.id, { ...input, status: 'active' });
    // El primer humano funda la instancia y es su dueño soberano.
    if (this.#owner === null && input.kind === 'human') this.#owner = input.id;
  }

  admit(participant: ParticipantId): void {
    if (!this.#participants.has(participant)) {
      throw new Error(`unknown participant ${participant}`);
    }
    this.#memberships.set(participant, 'active');
  }

  /** @guarantee OwnerCannotBeRemoved */
  suspend(participant: ParticipantId): void {
    if (participant === this.#owner) {
      throw new Error('the sovereign owner cannot be suspended or removed');
    }
    if (!this.#memberships.has(participant)) {
      throw new Error(`no membership for ${participant}`);
    }
    this.#memberships.set(participant, 'suspended');
    const held = this.#participants.get(participant);
    // @invariant HistoricalIdentitySurvivesRemoval: la identidad permanece.
    if (held) held.status = 'suspended';
  }

  get owner(): ParticipantId | null {
    return this.#owner;
  }

  participant(id: ParticipantId): Participant | undefined {
    return this.#participants.get(id);
  }

  #isActive(participant: ParticipantId): boolean {
    return this.#memberships.get(participant) === 'active';
  }

  /** surface GraphParticipation */
  participationSurface(participant: ParticipantId): { name: string; pages: Page[] } {
    if (!this.#isActive(participant)) {
      throw new Error(`${participant} has no active membership in this graph`);
    }
    return { name: this.name, pages: this.pages() };
  }

  // -------------------------------------------------------------------------
  // Lectura
  // -------------------------------------------------------------------------

  pages(): Page[] {
    return [...this.#pages.values()];
  }

  page(id: PageId): Page | undefined {
    return this.#pages.get(id);
  }

  allBlocks(): Block[] {
    return [...this.#blocks.values()];
  }

  block(id: BlockId): Block | undefined {
    return this.#blocks.get(id);
  }

  blocksOf(page: PageId): Block[] {
    return this.#idsToBlocks(this.#blocksByPage.get(page));
  }

  childrenOf(block: BlockId): Block[] {
    return this.#idsToBlocks(this.#childrenByParent.get(block));
  }

  #idsToBlocks(ids: Set<BlockId> | undefined): Block[] {
    if (ids === undefined) return [];
    const out: Block[] = [];
    for (const id of ids) {
      const block = this.#blocks.get(id);
      if (block !== undefined) out.push(block);
    }
    return out;
  }

  descendantsOf(block: BlockId): Block[] {
    const out: Block[] = [];
    const queue = [block];
    while (queue.length > 0) {
      const next = queue.shift();
      if (next === undefined) break;
      for (const child of this.childrenOf(next)) {
        out.push(child);
        queue.push(child.stableId);
      }
    }
    return out;
  }

  propertiesOf(subject: PageId | BlockId): PropertyAssignment[] {
    return [...(this.#propertiesBySubject.get(subject) ?? [])];
  }

  #allProperties(): PropertyAssignment[] {
    return [...this.#propertiesBySubject.values()].flat();
  }

  links(): PageLink[] {
    return [...this.#linksByBlock.values()].flat();
  }

  backlinks(target: PageId): PageLink[] {
    return [...(this.#linksByTarget.get(target) ?? [])];
  }

  /** Enlaces que nacen de un bloque, sin recorrer todos los del grafo. */
  linksOf(block: BlockId): PageLink[] {
    return [...(this.#linksByBlock.get(block) ?? [])];
  }

  tagsOf(block: BlockId): string[] {
    return this.#tags.get(block) ?? [];
  }

  unportedQueries(): UnportedQuery[] {
    return [...this.#unportedByBlock.values()];
  }

  operations(): Operation[] {
    return [...this.#operations];
  }

  revisions(): Revision[] {
    return [...this.#revisions];
  }

  publications(): Publication[] {
    return [...this.#publications];
  }

  log(): { lastSequence: number } {
    return { lastSequence: this.#lastSequence };
  }

  // -------------------------------------------------------------------------
  // Escritura: la única vía
  // -------------------------------------------------------------------------

  submitOperation(input: OperationInput): SubmitOutcome {
    const channel = input.channel ?? 'typed_text';

    // rule AcceptParticipantSubmission
    if (!this.#isActive(input.participant)) {
      return { status: 'rejected', reason: 'no active membership in this graph' };
    }
    if (channel === 'authenticated_voice' && input.evidence === undefined) {
      return { status: 'rejected', reason: 'authenticated voice requires origin evidence' };
    }

    // @invariant OriginIdentityIsTheIdempotencyKey
    const seen = this.#origins.get(input.originId);
    if (seen !== undefined) {
      return { status: 'duplicate', operation: seen };
    }

    const refusal = this.#validate(input.change);
    if (refusal !== null) {
      return { status: 'rejected', reason: refusal };
    }

    const at = Date.now();
    const subjectId = this.#apply(input.change, null);

    const submission: Submission = {
      graph: this.id,
      originId: input.originId,
      submittedBy: input.participant,
      change: input.change,
      channel,
      evidence: input.evidence,
      submittedAt: input.submittedAt ?? at,
      status: 'accepted',
    };

    this.#recordRevision(submission, subjectId, at);

    // rule RecordAcceptedSubmission: la secuencia se asigna aquí y sólo aquí.
    this.#lastSequence += 1;
    const operation: Operation = {
      id: this.#nextId('op'),
      originId: input.originId,
      submission,
      sequence: this.#lastSequence,
      subjectId,
      appliedAt: at,
    };
    this.#operations.push(operation);
    this.#origins.set(input.originId, operation);

    return { status: 'applied', operation, subjectId };
  }

  #recordRevision(submission: Submission, subjectId: string, at: number): void {
    const change = submission.change;
    const isBlockChange =
      change.kind === 'create_block' ||
      change.kind === 'edit_block' ||
      change.kind === 'move_block' ||
      change.kind === 'remove_block';

    let page: PageId | null = null;
    let block: BlockId | null = null;
    if (isBlockChange) {
      block = subjectId;
      page = this.#blocks.get(subjectId)?.page ?? null;
    } else if (change.kind === 'set_property' || change.kind === 'remove_property') {
      page = change.page ?? null;
      block = change.block ?? null;
    } else {
      page = subjectId;
    }

    this.#revisions.push({
      graph: this.id,
      page,
      block,
      authoredBy: submission.submittedBy,
      channel: submission.channel,
      evidence: submission.evidence,
      recordedAt: at,
      // La voz autenticada prueba autoría, no verdad factual.
      originIsCanonical:
        submission.channel === 'authenticated_voice' && submission.evidence !== undefined,
    });
  }

  // -------------------------------------------------------------------------
  // Precondiciones: los `requires` de change-application.allium
  // -------------------------------------------------------------------------

  #validate(change: Change): string | null {
    switch (change.kind) {
      case 'create_page': {
        if (change.title.trim() === '') return 'a page needs a title';
        if (this.#pageTitled(change.title) !== undefined) {
          return `a page already carries the title ${change.title}`;
        }
        return null;
      }
      case 'rename_page': {
        if (!this.#pages.has(change.page)) return 'no such page';
        if (change.title.trim() === '') return 'a page needs a title';
        const held = this.#pageTitled(change.title);
        if (held !== undefined && held.id !== change.page) {
          return `a page already carries the title ${change.title}`;
        }
        return null;
      }
      case 'set_page_visibility':
        return this.#pages.has(change.page) ? null : 'no such page';
      case 'remove_page': {
        if (!this.#pages.has(change.page)) return 'no such page';
        if (this.blocksOf(change.page).length > 0) {
          return 'a page is removable only once it is empty';
        }
        return null;
      }
      case 'create_block': {
        if (!this.#pages.has(change.page)) return 'no such page';
        if (change.parent !== null) {
          const parent = this.#blocks.get(change.parent);
          if (parent === undefined) return 'no such parent block';
          if (parent.page !== change.page) return 'the parent lives on another page';
        }
        if (change.stableId !== undefined && this.#blocks.has(change.stableId)) {
          return `a block already holds the stable id ${change.stableId}`;
        }
        return null;
      }
      case 'edit_block':
        return this.#blocks.has(change.block) ? null : 'no such block';
      case 'move_block': {
        const block = this.#blocks.get(change.block);
        if (block === undefined) return 'no such block';
        if (!this.#pages.has(change.page)) return 'no such page';
        if (change.parent === change.block) return 'a block cannot be its own parent';
        if (change.parent !== null) {
          const parent = this.#blocks.get(change.parent);
          if (parent === undefined) return 'no such parent block';
          if (parent.page !== change.page) return 'the parent lives on another page';
          if (this.descendantsOf(change.block).some((d) => d.stableId === change.parent)) {
            return 'a block cannot be moved beneath itself';
          }
        }
        return null;
      }
      case 'remove_block': {
        if (!this.#blocks.has(change.block)) return 'no such block';
        if (this.childrenOf(change.block).length > 0) {
          return 'only a leaf is removable; remove its children first';
        }
        return null;
      }
      case 'set_property': {
        const refusal = this.#validateSubject(change.page, change.block);
        if (refusal !== null) return refusal;
        if (change.propertyKey.trim() === '') return 'a property needs a key';
        return null;
      }
      case 'remove_property': {
        const refusal = this.#validateSubject(change.page, change.block);
        if (refusal !== null) return refusal;
        if (this.#findProperty(change.page, change.block, change.propertyKey) === undefined) {
          return 'no such property assignment';
        }
        return null;
      }
    }
  }

  // invariant PropertyTargetsOneSubject
  #validateSubject(page: PageId | undefined, block: BlockId | undefined): string | null {
    const hasPage = page !== undefined;
    const hasBlock = block !== undefined;
    if (hasPage === hasBlock) {
      return 'a property assignment names exactly one of a page or a block';
    }
    if (hasPage && !this.#pages.has(page)) return 'no such page';
    if (hasBlock && !this.#blocks.has(block)) return 'no such block';
    return null;
  }

  #findProperty(
    page: PageId | undefined,
    block: BlockId | undefined,
    key: string,
  ): PropertyAssignment | undefined {
    const subject = page ?? block;
    if (subject === undefined) return undefined;
    return this.#propertiesBySubject.get(subject)?.find((p) => p.key === key);
  }

  #pageTitled(title: string): Page | undefined {
    const id = this.#pageByTitleKey.get(titleKey(title));
    return id === undefined ? undefined : this.#pages.get(id);
  }

  // -------------------------------------------------------------------------
  // Aplicación: los `ensures` de change-application.allium
  // -------------------------------------------------------------------------

  #apply(change: Change, recordedSubject: string | null): string {
    switch (change.kind) {
      case 'create_page': {
        const id = recordedSubject ?? this.#nextId('page');
        this.#pages.set(id, {
          id,
          graph: this.id,
          title: change.title,
          visibility: change.visibility,
          createdAt: Date.now(),
        });
        this.#pageByTitleKey.set(titleKey(change.title), id);
        this.#resolveWaitingLinks(id);
        return id;
      }
      case 'rename_page': {
        const page = this.#pages.get(change.page);
        if (page) {
          this.#pageByTitleKey.delete(titleKey(page.title));
          page.title = change.title;
          this.#pageByTitleKey.set(titleKey(change.title), change.page);
        }
        // Un enlace nombró el título viejo: deja de resolver, y los que
        // esperaban el nuevo se conectan.
        for (const link of [...(this.#linksByTarget.get(change.page) ?? [])]) {
          this.#setLinkTarget(link, null);
        }
        this.#resolveWaitingLinks(change.page);
        return change.page;
      }
      case 'set_page_visibility': {
        const page = this.#pages.get(change.page);
        if (page) page.visibility = change.visibility;
        return change.page;
      }
      case 'remove_page': {
        const page = this.#pages.get(change.page);
        if (page) this.#pageByTitleKey.delete(titleKey(page.title));
        this.#pages.delete(change.page);
        this.#blocksByPage.delete(change.page);
        // La referencia sobrevive a su destino, igual que una página nunca escrita.
        for (const link of [...(this.#linksByTarget.get(change.page) ?? [])]) {
          this.#setLinkTarget(link, null);
        }
        return change.page;
      }
      case 'create_block': {
        // La identidad propuesta por la importación gana: adoptar la que el
        // corpus ya traía es lo que hace que sus referencias sobrevivan.
        const id = recordedSubject ?? change.stableId ?? this.#nextId('block');
        this.#blocks.set(id, {
          stableId: id,
          page: change.page,
          parent: change.parent,
          position: change.position,
          content: change.content,
          createdAt: Date.now(),
        });
        this.#indexBlock(id, change.page, change.parent);
        this.#settleBlock(id);
        return id;
      }
      case 'edit_block': {
        const block = this.#blocks.get(change.block);
        // stableId, page, parent y position no se tocan: esa ausencia es la garantía.
        if (block) block.content = change.content;
        this.#settleBlock(change.block);
        return change.block;
      }
      case 'move_block': {
        const block = this.#blocks.get(change.block);
        if (block) {
          this.#deindexBlock(change.block, block.page, block.parent);
          block.page = change.page;
          block.parent = change.parent;
          block.position = change.position;
          this.#indexBlock(change.block, change.page, change.parent);
        }
        // El subárbol viaja con su raíz: el padre debe vivir en la misma página.
        for (const descendant of this.descendantsOf(change.block)) {
          this.#deindexBlock(descendant.stableId, descendant.page, descendant.parent);
          descendant.page = change.page;
          this.#indexBlock(descendant.stableId, change.page, descendant.parent);
          this.#settleBlock(descendant.stableId);
        }
        this.#settleBlock(change.block);
        return change.block;
      }
      case 'remove_block': {
        const block = this.#blocks.get(change.block);
        if (block) this.#deindexBlock(change.block, block.page, block.parent);
        this.#blocks.delete(change.block);
        this.#clearLinksOf(change.block);
        this.#tags.delete(change.block);
        this.#unportedByBlock.delete(change.block);
        return change.block;
      }
      case 'set_property': {
        const held = this.#findProperty(change.page, change.block, change.propertyKey);
        if (held !== undefined) {
          held.value = change.propertyValue;
        } else {
          const subject = change.page ?? change.block ?? '';
          const held = this.#propertiesBySubject.get(subject) ?? [];
          held.push({
            graph: this.id,
            page: change.page ?? null,
            block: change.block ?? null,
            key: change.propertyKey,
            value: change.propertyValue,
          });
          this.#propertiesBySubject.set(subject, held);
        }
        return change.page ?? change.block ?? '';
      }
      case 'remove_property': {
        const subject = change.page ?? change.block ?? '';
        const held = this.#propertiesBySubject.get(subject);
        if (held !== undefined) {
          this.#propertiesBySubject.set(
            subject,
            held.filter((p) => p.key !== change.propertyKey),
          );
        }
        return change.page ?? change.block ?? '';
      }
    }
  }

  // -------------------------------------------------------------------------
  // Índices derivados (graph-navigation.allium, query-language.allium)
  // -------------------------------------------------------------------------

  /**
   * rule RecomputeLinksForSettledBlock. Recalcula el bloque entero en vez de
   * diferenciarlo: así no hay camino por el que un enlace sobreviva a la frase
   * que lo creó.
   */
  #settleBlock(id: BlockId): void {
    const block = this.#blocks.get(id);
    if (block === undefined) return;

    this.#clearLinksOf(id);
    const fresh: PageLink[] = [];
    for (const title of referencedTitles(block.content)) {
      const target = this.#pageTitled(title);
      const link: PageLink = {
        id: this.#nextId('link'),
        graph: this.id,
        sourcePage: block.page,
        sourceBlock: id,
        targetTitle: title,
        target: null,
      };
      fresh.push(link);
      this.#registerLink(link, target?.id ?? null);
    }
    this.#linksByBlock.set(id, fresh);

    this.#tags.set(id, referencedTags(block.content));

    // @invariant NoSilentTranslation: se preserva el literal, no se traduce.
    this.#unportedByBlock.delete(id);
    const macro = queryMacroText(block.content);
    if (macro !== null) {
      this.#unportedByBlock.set(id, {
        id: this.#nextId('unported'),
        graph: this.id,
        block: id,
        sourceText: macro,
        portedTo: null,
        portedBy: null,
        portedAt: null,
      });
    }
  }

  /** rule ResolveWaitingLinksToNewPage */
  #resolveWaitingLinks(page: PageId): void {
    const held = this.#pages.get(page);
    if (held === undefined) return;
    const waiting = this.#unresolvedByTitleKey.get(titleKey(held.title));
    if (waiting === undefined) return;
    for (const link of [...waiting]) this.#setLinkTarget(link, page);
  }

  // -------------------------------------------------------------------------
  // Mantenimiento de índices
  // -------------------------------------------------------------------------

  #indexBlock(id: BlockId, page: PageId, parent: BlockId | null): void {
    let onPage = this.#blocksByPage.get(page);
    if (onPage === undefined) {
      onPage = new Set();
      this.#blocksByPage.set(page, onPage);
    }
    onPage.add(id);
    if (parent !== null) {
      let siblings = this.#childrenByParent.get(parent);
      if (siblings === undefined) {
        siblings = new Set();
        this.#childrenByParent.set(parent, siblings);
      }
      siblings.add(id);
    }
  }

  #deindexBlock(id: BlockId, page: PageId, parent: BlockId | null): void {
    this.#blocksByPage.get(page)?.delete(id);
    if (parent !== null) this.#childrenByParent.get(parent)?.delete(id);
  }

  /** Registra un enlace nuevo en el índice que le corresponde según resuelva o no. */
  #registerLink(link: PageLink, target: PageId | null): void {
    link.target = target;
    if (target === null) {
      const key = titleKey(link.targetTitle);
      let waiting = this.#unresolvedByTitleKey.get(key);
      if (waiting === undefined) {
        waiting = new Set();
        this.#unresolvedByTitleKey.set(key, waiting);
      }
      waiting.add(link);
    } else {
      let inbound = this.#linksByTarget.get(target);
      if (inbound === undefined) {
        inbound = new Set();
        this.#linksByTarget.set(target, inbound);
      }
      inbound.add(link);
    }
  }

  /** Mueve un enlace entre el índice de resueltos y el de los que esperan. */
  #setLinkTarget(link: PageLink, target: PageId | null): void {
    if (link.target !== null) this.#linksByTarget.get(link.target)?.delete(link);
    else this.#unresolvedByTitleKey.get(titleKey(link.targetTitle))?.delete(link);
    this.#registerLink(link, target);
  }

  #clearLinksOf(block: BlockId): void {
    for (const link of this.#linksByBlock.get(block) ?? []) {
      if (link.target !== null) this.#linksByTarget.get(link.target)?.delete(link);
      else this.#unresolvedByTitleKey.get(titleKey(link.targetTitle))?.delete(link);
    }
    this.#linksByBlock.delete(block);
  }

  /** rule PortLegacyQueryToVeraExpression */
  portLegacyQuery(input: {
    unported: string;
    expression: QueryExpression;
    participant: ParticipantId;
  }): void {
    if (!this.#isActive(input.participant)) {
      throw new Error(`${input.participant} has no active membership in this graph`);
    }
    const held = this.unportedQueries().find((u) => u.id === input.unported);
    if (held === undefined) throw new Error('no such unported query');
    if (held.portedTo !== null) throw new Error('this query has already been ported');
    held.portedTo = input.expression;
    held.portedBy = input.participant;
    held.portedAt = Date.now();
  }

  // -------------------------------------------------------------------------
  // Búsqueda (search-index.allium)
  // -------------------------------------------------------------------------

  search(input: { text: string; participant: ParticipantId }): SearchOutcome {
    if (!this.#isActive(input.participant)) {
      throw new Error(`${input.participant} has no active membership in this graph`);
    }

    const found: Omit<SearchHit, 'rank'>[] = [];
    if (input.text !== '') {
      for (const page of this.pages()) {
        if (matches(page.title, input.text)) {
          found.push({
            page: page.id,
            block: null,
            field: 'page_title',
            excerpt: excerpt(page.title, input.text),
          });
        }
      }
      for (const block of this.allBlocks()) {
        if (matches(block.content, input.text)) {
          found.push({
            page: block.page,
            block: block.stableId,
            field: 'block_content',
            excerpt: excerpt(block.content, input.text),
          });
        }
      }
      for (const property of this.#allProperties()) {
        if (!matches(property.value, input.text)) continue;
        const page = property.page ?? this.#blocks.get(property.block ?? '')?.page;
        if (page === undefined) continue;
        found.push({
          page,
          block: property.block,
          field: 'property_value',
          excerpt: `${property.key}: ${property.value}`,
        });
      }
    }

    // @invariant StableOrdering: desempate determinista, para que dos búsquedas
    // idénticas no cambien de orden entre sí.
    found.sort((a, b) => {
      const byField = FIELD_ORDER[a.field] - FIELD_ORDER[b.field];
      if (byField !== 0) return byField;
      if (a.page !== b.page) return a.page < b.page ? -1 : 1;
      return (a.block ?? '') < (b.block ?? '') ? -1 : (a.block ?? '') > (b.block ?? '') ? 1 : 0;
    });

    return {
      graph: this.id,
      text: input.text,
      searchedBy: input.participant,
      hits: found.map((hit, at) => ({ ...hit, rank: at + 1 })),
    };
  }

  // -------------------------------------------------------------------------
  // Consulta (query-language.allium)
  // -------------------------------------------------------------------------

  query(input: {
    expression: QueryExpression;
    participant: ParticipantId;
  }): { graph: GraphId; matchingPages: PageId[] } {
    if (!this.#isActive(input.participant)) {
      throw new Error(`${input.participant} has no active membership in this graph`);
    }
    const selected = this.#select(input.expression);
    return {
      graph: this.id,
      matchingPages: this.pages()
        .filter((p) => selected.has(p.id))
        .map((p) => p.id),
    };
  }

  #select(expression: QueryExpression): Set<PageId> {
    switch (expression.kind) {
      case 'TitleTerm':
        return this.#pagesWhere((page) => matches(page.title, expression.text));
      case 'ContentTerm':
        return this.#pagesWhere((page) =>
          this.blocksOf(page.id).some((b) => matches(b.content, expression.text)),
        );
      case 'TagTerm':
        return this.#pagesWhere((page) =>
          this.blocksOf(page.id).some((b) => this.tagsOf(b.stableId).includes(expression.tag)),
        );
      case 'PropertyTerm':
        return this.#pagesWhere((page) =>
          this.propertiesOf(page.id).some(
            (p) =>
              p.key === expression.key &&
              (expression.value === null || p.value === expression.value),
          ),
        );
      case 'LinksToTerm':
        return new Set(
          this.links().filter((l) => l.target === expression.target).map((l) => l.sourcePage),
        );
      case 'LinkedFromTerm':
        return new Set(
          this.links()
            .filter((l) => l.sourcePage === expression.origin && l.target !== null)
            .map((l) => l.target as PageId),
        );
      case 'AndTerm': {
        const sets = expression.operands.map((o) => this.#select(o));
        const first = sets[0] ?? new Set<PageId>();
        return new Set([...first].filter((p) => sets.every((s) => s.has(p))));
      }
      case 'OrTerm': {
        const union = new Set<PageId>();
        for (const operand of expression.operands) {
          for (const page of this.#select(operand)) union.add(page);
        }
        return union;
      }
      case 'NotTerm': {
        // @invariant NegationIsGraphScoped: el complemento es dentro de este grafo.
        const excluded = this.#select(expression.operand);
        return this.#pagesWhere((page) => !excluded.has(page.id));
      }
    }
  }

  #pagesWhere(predicate: (page: Page) => boolean): Set<PageId> {
    return new Set(this.pages().filter(predicate).map((p) => p.id));
  }

  // -------------------------------------------------------------------------
  // Vecindad (graph-navigation.allium)
  // -------------------------------------------------------------------------

  neighbourhood(input: {
    centre: PageId;
    depth: number;
    participant: ParticipantId;
  }): GraphNeighbourhood {
    if (!this.#isActive(input.participant)) {
      throw new Error(`${input.participant} has no active membership in this graph`);
    }
    if (!this.#pages.has(input.centre)) throw new Error('no such page');
    if (input.depth < 0) throw new Error('depth cannot be negative');

    // Aristas no dirigidas entre páginas, sólo desde enlaces resueltos.
    const adjacency = new Map<PageId, Set<PageId>>();
    const connect = (a: PageId, b: PageId): void => {
      if (a === b) return;
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      if (!adjacency.has(b)) adjacency.set(b, new Set());
      adjacency.get(a)?.add(b);
      adjacency.get(b)?.add(a);
    };
    for (const link of this.links()) {
      if (link.target !== null) connect(link.sourcePage, link.target);
    }

    // Expansión por anchura, acotada: termina en cualquier grafo, también cíclico.
    const distance = new Map<PageId, number>([[input.centre, 0]]);
    let frontier: PageId[] = [input.centre];
    for (let step = 0; step < input.depth; step += 1) {
      const next: PageId[] = [];
      for (const page of frontier) {
        for (const neighbour of adjacency.get(page) ?? []) {
          if (distance.has(neighbour) || !this.#pages.has(neighbour)) continue;
          distance.set(neighbour, step + 1);
          next.push(neighbour);
        }
      }
      if (next.length === 0) break;
      frontier = next;
    }

    const included = new Set(distance.keys());
    const seenEdge = new Set<string>();
    const edges: NeighbourhoodEdge[] = [];
    for (const link of this.links()) {
      const target = link.target;
      if (target === null) continue;
      if (!included.has(link.sourcePage) || !included.has(target)) continue;
      if (link.sourcePage === target) continue;
      const key = [link.sourcePage, target].sort().join('||');
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      edges.push({ source: link.sourcePage, target });
    }

    const nodes: NeighbourhoodNode[] = [...distance.entries()].map(([page, at]) => ({
      page,
      distance: at,
      degree: edges.filter((e) => e.source === page || e.target === page).length,
      blockCount: this.blocksOf(page).length,
    }));

    return { graph: this.id, centre: input.centre, depth: input.depth, nodes, edges };
  }

  // -------------------------------------------------------------------------
  // Publicación (core.allium)
  // -------------------------------------------------------------------------

  publish(input: { page: PageId; path: string; participant: ParticipantId }): Publication {
    const participant = this.#participants.get(input.participant);
    if (participant === undefined || participant.kind !== 'human') {
      throw new Error('only a human participant may publish');
    }
    if (input.participant !== this.#owner) {
      throw new Error('only the site owner may publish');
    }
    const page = this.#pages.get(input.page);
    if (page === undefined) throw new Error('no such page');
    // @invariant PrivatePagesAreNeverPublished
    if (page.visibility !== 'public') {
      throw new Error('a private page is never published; set its visibility first');
    }
    const publication: Publication = {
      page: input.page,
      path: input.path,
      publishedAt: Date.now(),
    };
    this.#publications.push(publication);
    return publication;
  }

  // -------------------------------------------------------------------------
  // Reproducción del log (@invariant ReplayReconstructsState)
  // -------------------------------------------------------------------------

  replayFromLog(): VeraGraph {
    const replayed = new VeraGraph(this.id, this.name);
    for (const participant of this.#participants.values()) {
      replayed.addParticipant(participant);
    }
    for (const [id, status] of this.#memberships) {
      replayed.#memberships.set(id, status);
    }
    replayed.#owner = this.#owner;

    // Las operaciones ya fueron validadas al admitirse: reproducir es aplicar,
    // reutilizando el sujeto que quedó registrado.
    for (const operation of [...this.#operations].sort((a, b) => a.sequence - b.sequence)) {
      replayed.#apply(operation.submission.change, operation.subjectId);
      replayed.#recordRevision(operation.submission, operation.subjectId, operation.appliedAt);
      replayed.#lastSequence = operation.sequence;
      replayed.#operations.push(operation);
      replayed.#origins.set(operation.originId, operation);
    }
    replayed.#counter = this.#counter;
    return replayed;
  }

  // -------------------------------------------------------------------------
  // Sólo para pruebas del verificador de invariantes
  // -------------------------------------------------------------------------

  /** Corrompe el estado a propósito, saltándose la vía de escritura. */
  unsafeSetBlockStableId(block: BlockId, stableId: BlockId): void {
    const held = this.#blocks.get(block);
    if (held === undefined) throw new Error('no such block');
    (held as { stableId: BlockId }).stableId = stableId;
  }

  #nextId(prefix: string): string {
    this.#counter += 1;
    return `${prefix}:${this.#counter}`;
  }
}
