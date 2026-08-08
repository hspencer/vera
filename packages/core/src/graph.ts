// El grafo de Vera materializado en memoria.
//
// Regla que gobierna este archivo: submitOperation() es la única vía de
// escritura. Todo lo demás es lectura. Eso es lo que materializa
// @guarantee EqualMutationPath: humanos y agentes cruzan la misma frontera, y
// ninguno tiene una puerta trasera.

import {
  excerpt,
  isDateTitle,
  matches,
  queryMacroText,
  referencedTags,
  referencedTitles,
  retitleLinks,
  titleKey,
} from './text.ts';
import type { QueryExpression } from './query.ts';
import type {
  Authorship,
  Block,
  BlockId,
  Change,
  ContributionChannel,
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

  // @invariant EveryBlockNamesItsHand. Se mantiene junto al bloque y no dentro
  // de él porque responde otra pregunta: el bloque dice qué palabras hay, esto
  // dice de quién son.
  #authorship = new Map<BlockId, Authorship>();

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

  /*
   * Reproducir no es someter.
   *
   * Hay dos clases de negativa y confundirlas rompe el registro. Una es
   * estructural —no existe esa página, no existe ese bloque—: si aparece al
   * reproducir, el registro está corrupto y hay que parar. La otra es de
   * política —un día no se queda sin su tipo, un miembro suspendido no escribe—:
   * dice qué se permite hoy, y lo que se permitía ayer ya ocurrió. Aplicarla al
   * reproducir haría que cada regla nueva invalidara la historia anterior a ella,
   * y el grafo dejaría de levantar por haber tenido razón.
   *
   * El precedente ya estaba en loadGraph, que vuelve a suspender a los
   * participantes después de reproducir y no antes, por esta misma razón.
   */
  #replaying = false;

  beginReplay(): void {
    this.#replaying = true;
  }

  endReplay(): void {
    this.#replaying = false;
  }

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

  /**
   * Qué valores se le han dado ya a una propiedad, y cuántas veces cada uno.
   *
   * El vocabulario real de un corpus heredado no está declarado en ninguna
   * parte: está en lo que se escribió durante años. Esto lo lee, que es lo que
   * permite ofrecer respuestas antes de que exista una ontología que las
   * gobierne — y lo que después alimenta a rule ProposePropertyDomainFromUsage,
   * cuando la haya.
   *
   * Sale ordenado por uso y luego alfabético: lo más dicho primero, porque es lo
   * más probable, y el desempate estable para que la lista no baile entre dos
   * lecturas.
   */
  observedValuesOf(key: string): { value: string; uses: number }[] {
    const counts = new Map<string, number>();
    for (const property of this.#allProperties()) {
      if (property.key !== key) continue;
      const value = property.value.trim();
      if (value === '') continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts]
      .map(([value, uses]) => ({ value, uses }))
      .sort((a, b) => b.uses - a.uses || a.value.localeCompare(b.value));
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

  /** Última revisión real de una página; recuperar procedencia no la edita. */
  lastEditedAt(page: PageId): number | null {
    const times = this.#revisions
      .filter((revision) => revision.page === page && revision.changeKind !== 'recover_page_origin')
      .map((r) => r.recordedAt);
    return times.length === 0 ? null : Math.max(...times);
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

    // @invariant ChannelFollowsParticipantKind: la procedencia no la elige quien
    // escribe. Un agente no puede presentar su generación como texto tecleado, y
    // una persona no puede firmar como generada la frase que escribió a mano. Si
    // el canal fuese seleccionable registraría intención, no hecho, y entonces
    // distinguir lo escrito de lo generado dejaría de significar nada.
    const kind = this.#participants.get(input.participant)?.kind;
    if (kind === 'agent' && channel !== 'agent_generation') {
      return {
        status: 'rejected',
        reason: `an agent submits through agent_generation, not ${channel}`,
      };
    }
    if (kind === 'human' && channel === 'agent_generation') {
      return { status: 'rejected', reason: 'agent_generation belongs to agent participants' };
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

    // Quien envía puede saber cuándo ocurrió esto —lo sabe la importación, y lo
    // sabe la reproducción del registro—. Si no lo sabe nadie, es ahora.
    const at = input.submittedAt ?? Date.now();
    const subjectId = this.#apply(input.change, input.subjectId ?? null, at);
    this.#recordAuthorship(input.change, subjectId, input.participant, channel, at);

    const submission: Submission = {
      graph: this.id,
      originId: input.originId,
      submittedBy: input.participant,
      change: input.change,
      channel,
      evidence: input.evidence,
      submittedAt: at,
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

  /**
   * rule WritingRecordsItsHand y rule RewritingTransfersTheHand.
   *
   * Sólo escribir cambia la mano. Mover un bloque de una página a otra no es
   * haber escrito una palabra suya, así que `move_block` no aparece aquí: es
   * @invariant... bueno, es rule MovingLeavesTheHandAlone, escrita como el
   * silencio deliberado de este switch. Un bibliotecario que ordena no firma.
   */
  #recordAuthorship(
    change: Change,
    subjectId: string,
    participant: ParticipantId,
    channel: ContributionChannel,
    at: number,
  ): void {
    if (change.kind !== 'create_block' && change.kind !== 'edit_block') return;
    this.#authorship.set(subjectId, {
      block: subjectId,
      participant,
      channel,
      writtenAt: at,
    });
  }

  /** De qué mano salió el texto que este bloque tiene ahora. */
  authorship(block: BlockId): Authorship | undefined {
    return this.#authorship.get(block);
  }

  /** Toda la autoría del grafo, para materializarla y para verificarla. */
  authorships(): Authorship[] {
    return [...this.#authorship.values()];
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
      changeKind: change.kind,
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
      case 'recover_page_origin':
        if (!this.#pages.has(change.page)) return 'no such page';
        if (!Number.isFinite(change.originCreatedAt) || change.originCreatedAt <= 0) {
          return 'originCreatedAt must be a positive timestamp';
        }
        return null;
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
        // rule ADayKeepsItsKind: quitar el tipo de un día no hace que la página
        // deje de ser el 6 de agosto; hace que deje de contestar cuando se
        // pregunta por los días, y nada avisa. Se rechaza aquí y no en la
        // interfaz porque una regla que sólo vive en un botón no es una regla.
        //
        // Es política y no estructura: gobierna lo que se somete hoy, no lo que
        // se sometió antes de que existiera. Ver #replaying.
        if (!this.#replaying && change.propertyKey === 'type' && change.page !== undefined) {
          const page = this.#pages.get(change.page);
          if (page !== undefined && isDateTitle(page.title)) {
            return 'un día es una bitácora; su tipo no se quita';
          }
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

  /**
   * La página que lleva ese título, sin distinguir mayúsculas ni acentos.
   *
   * Pública porque una URL la nombra por su título: [[LogSeq]] y [[Logseq]] son
   * la misma página, y una dirección escrita a mano también debería serlo.
   */
  pageTitled(title: string): Page | undefined {
    return this.#pageTitled(title);
  }

  #pageTitled(title: string): Page | undefined {
    const id = this.#pageByTitleKey.get(titleKey(title));
    return id === undefined ? undefined : this.#pages.get(id);
  }

  // -------------------------------------------------------------------------
  // Aplicación: los `ensures` de change-application.allium
  // -------------------------------------------------------------------------

  /**
   * `at` es cuándo ocurrió la operación, no cuándo se está aplicando.
   *
   * Importa porque aplicar pasa dos veces: al enviarse y al reproducir el
   * registro, que es como se levanta el grafo en cada arranque. Con el reloj de
   * la máquina, la segunda vez volvía a estampar cada página con la hora de
   * arranque, y un corpus de años terminaba diciendo que nació hoy. Con la fecha
   * de la operación, reproducir devuelve el mismo grafo — que es lo que
   * @invariant ReplayReconstructsState pide, y esto lo estaba incumpliendo en
   * silencio porque el único síntoma era una fecha.
   */
  #apply(change: Change, recordedSubject: string | null, at: number): string {
    if (recordedSubject !== null) this.#observeId(recordedSubject);
    switch (change.kind) {
      case 'create_page': {
        const id = recordedSubject ?? this.#nextId('page');
        this.#pages.set(id, {
          id,
          graph: this.id,
          title: change.title,
          visibility: change.visibility,
          createdAt: at,
          originCreatedAt: null,
        });
        this.#pageByTitleKey.set(titleKey(change.title), id);
        this.#resolveWaitingLinks(id);
        return id;
      }
      case 'recover_page_origin': {
        const page = this.#pages.get(change.page);
        if (page !== undefined) page.originCreatedAt = change.originCreatedAt;
        return change.page;
      }
      case 'rename_page': {
        const page = this.#pages.get(change.page);
        if (page === undefined) return change.page;
        const before = page.title;

        /*
         * Renombrar arrastra a los enlaces que la nombraban.
         *
         * Antes no: la frase que decía el título viejo no había cambiado, así
         * que su enlace volvía a quedar esperando. Era coherente y dejaba el
         * grafo peor, porque un enlace roto no le sirve a nadie: la conexión
         * existía, nadie la deshizo, y la única razón de que se perdiera era que
         * el nombre se escribe en dos sitios. Que Vera sepa cuáles son esos dos
         * sitios es exactamente lo que la hace capaz de repararlo.
         *
         * Se reescribe sólo lo que está entre corchetes. El mismo nombre suelto
         * en la prosa no es un enlace y no se toca: cambiarlo sería reescribir
         * lo que alguien dijo, no a dónde apuntaba.
         *
         * Va dentro de aplicar el renombrado y no como operaciones aparte. Un
         * corpus donde renombrar deja treinta `edit_block` a nombre de quien
         * renombró convierte un gesto en treinta hechos falsos sobre quién
         * escribió qué. Aquí es un solo hecho —se renombró— con la consecuencia
         * que le corresponde, y @invariant ReplayReconstructsState se sostiene
         * porque reproducir el registro vuelve a hacer la misma reescritura.
         */
        const naming = [...(this.#linksByTarget.get(change.page) ?? [])].map(
          (link) => link.sourceBlock,
        );

        this.#pageByTitleKey.delete(titleKey(before));
        page.title = change.title;
        this.#pageByTitleKey.set(titleKey(change.title), change.page);

        for (const id of new Set(naming)) {
          const block = this.#blocks.get(id);
          if (block === undefined) continue;
          const next = retitleLinks(block.content, before, change.title);
          if (next === block.content) continue;
          block.content = next;
          // Recalcular el bloque entero, como cualquier otro cambio de texto:
          // así el enlace nuevo nace por el mismo camino que los demás.
          this.#settleBlock(id);
        }

        // Lo que quede nombrando el título viejo —prosa que el corchete no
        // cubría, o un enlace que ya esperaba— se recoloca aquí.
        for (const link of [...(this.#linksByTarget.get(change.page) ?? [])]) {
          if (titleKey(link.targetTitle) !== titleKey(change.title)) {
            this.#setLinkTarget(link, null);
          }
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
          createdAt: at,
        });
        this.#indexBlock(id, change.page, change.parent);
        this.#reseat(change.page, change.parent, id, change.position);
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
          const fromPage = block.page;
          const fromParent = block.parent;
          this.#deindexBlock(change.block, fromPage, fromParent);
          block.page = change.page;
          block.parent = change.parent;
          this.#indexBlock(change.block, change.page, change.parent);
          // El grupo que deja atrás cierra su hueco; el que lo recibe lo sienta
          // en el índice pedido. Las dos renumeraciones son parte de aplicar
          // esta operación, no operaciones aparte.
          this.#renumber(fromPage, fromParent);
          this.#reseat(change.page, change.parent, change.block, change.position);
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
        const page = block?.page;
        const parent = block?.parent ?? null;
        if (block) this.#deindexBlock(change.block, block.page, block.parent);
        this.#blocks.delete(change.block);
        this.#clearLinksOf(change.block);
        this.#tags.delete(change.block);
        this.#unportedByBlock.delete(change.block);
        // El grupo cierra el hueco: las posiciones de un grupo de hermanos son
        // densas, y un hueco haría que el siguiente índice pedido cayera mal.
        if (page !== undefined) this.#renumber(page, parent);
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

  /** Los hermanos de un bloque: los hijos de su padre, o las raíces de la página. */
  #siblings(page: PageId, parent: BlockId | null): Block[] {
    const group =
      parent === null
        ? this.blocksOf(page).filter((block) => block.parent === null)
        : this.childrenOf(parent);
    return group.sort((a, b) => a.position - b.position);
  }

  /**
   * Sienta un bloque en el índice pedido entre sus hermanos y renumera el grupo.
   *
   * `position` en un cambio es el lugar que se pide, no un número que se copia.
   * Renumerar aquí es lo que permite que insertar en medio sea UNA operación: si
   * el emisor tuviera que correr a los hermanos, pulsar Enter en una página con
   * treinta bloques se registraría como treinta cambios, y el log dejaría de
   * decir qué hizo alguien para decir cómo lo hizo la interfaz.
   */
  #reseat(page: PageId, parent: BlockId | null, moved: BlockId, index: number): void {
    const block = this.#blocks.get(moved);
    if (block === undefined) return;

    const order = this.#siblings(page, parent).filter((sibling) => sibling.stableId !== moved);
    const at = Math.max(0, Math.min(Math.trunc(index), order.length));
    order.splice(at, 0, block);

    for (const [position, sibling] of order.entries()) sibling.position = position;
  }

  /** Cierra el hueco que deja un bloque al salir de su grupo de hermanos. */
  #renumber(page: PageId, parent: BlockId | null): void {
    const order = this.#siblings(page, parent);
    for (const [position, sibling] of order.entries()) sibling.position = position;
  }

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
      replayed.#apply(operation.submission.change, operation.subjectId, operation.appliedAt);
      // La autoría es materialización del registro, no un hecho aparte: se
      // reconstruye reproduciendo, o @invariant ReplayReconstructsState dejaría
      // de cubrirla y el grafo reproducido no sabría de quién son las palabras.
      replayed.#recordAuthorship(
        operation.submission.change,
        operation.subjectId,
        operation.submission.submittedBy,
        operation.submission.channel,
        operation.appliedAt,
      );
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

  /**
   * Mantiene el contador por delante de un identificador que vino dado.
   *
   * Al reproducir el registro los identificadores salen de él y no del contador,
   * así que el contador no avanza solo. Sin esto, lo primero que se creara
   * después de arrancar tomaría un número ya usado y pisaría algo.
   */
  #observeId(id: string): void {
    const n = Number(id.slice(id.indexOf(':') + 1));
    if (Number.isFinite(n) && n > this.#counter) this.#counter = n;
  }
}
