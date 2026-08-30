// El diálogo del desacuerdo, y lo que hace con lo que decide.
//
// Ver specs/offline-reconciliation.allium, @guarantee
// ADisagreementIsResolvedOneBlockAtATime. No hay navegador aquí, así que el DOM
// que usa `askAboutDisagreements` es uno de mentira: lo mínimo que necesita el
// diálogo para construirse y para que un click dispare lo que dispararía un
// click de verdad.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { applyResolutions, askAboutDisagreements, type Resolved } from '../src/reconcile.ts';
import type { Disagreement } from '../src/behind.ts';
import { createOutbox, inMemory, type Pending } from '../src/outbox.ts';

// ── Un DOM de mentira ────────────────────────────────────────────────────────
//
// Sólo lo que `reconcile.ts` toca: crear elementos, encadenarlos, textContent,
// className/classList, un `click()` que dispara el handler que se registró, y
// el `addEventListener('keydown', …)` a nivel de documento que escucha Escape.

class FakeNode {
  tagName: string;
  className = '';
  textContent = '';
  value = '';
  rows = 0;
  disabled = false;
  type = '';
  children: FakeNode[] = [];
  private listeners = new Map<string, Array<() => void>>();
  private html = '';

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  // El botón de «escribo otra» pone su texto vía innerHTML y no vía textContent
  // (lleva un ícono delante). El DOM de verdad deriva `.textContent` de las
  // etiquetas hijas; aquí basta con quitarlas a mano.
  get innerHTML(): string {
    return this.html;
  }

  set innerHTML(value: string) {
    this.html = value;
    this.textContent = value.replace(/<[^>]*>/g, '');
  }

  setAttribute(): void {
    // Se fija el rol y el aria-label del diálogo; nada de esto se comprueba aquí.
  }

  append(...nodes: FakeNode[]): void {
    this.children.push(...nodes);
  }

  remove(): void {
    // Basta con que exista: nada de esto se prueba mirando el árbol después.
  }

  addEventListener(type: string, handler: () => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, handler: () => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((one) => one !== handler));
  }

  click(): void {
    for (const handler of this.listeners.get('click') ?? []) handler();
  }

  focus(): void {}

  get classList(): { add(name: string): void; remove(name: string): void; contains(name: string): boolean } {
    const node = this;
    const parts = (): Set<string> => new Set(node.className.split(/\s+/).filter(Boolean));
    return {
      add(name: string): void {
        const said = parts();
        said.add(name);
        node.className = [...said].join(' ');
      },
      remove(name: string): void {
        const said = parts();
        said.delete(name);
        node.className = [...said].join(' ');
      },
      contains(name: string): boolean {
        return parts().has(name);
      },
    };
  }

  querySelectorAll(selector: string): FakeNode[] {
    const out: FakeNode[] = [];
    const walk = (node: FakeNode): void => {
      for (const child of node.children) {
        if (matches(child, selector)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector: string): FakeNode | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function matches(node: FakeNode, selector: string): boolean {
  if (selector.startsWith('.')) return node.className.split(/\s+/).filter(Boolean).includes(selector.slice(1));
  return node.tagName === selector;
}

class FakeDocument {
  body = new FakeNode('body');
  private listeners = new Map<string, Array<(event: { key: string }) => void>>();

  createElement(tag: string): FakeNode {
    return new FakeNode(tag);
  }

  addEventListener(type: string, handler: (event: { key: string }) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, handler: (event: { key: string }) => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((one) => one !== handler));
  }

  pressEscape(): void {
    for (const handler of this.listeners.get('keydown') ?? []) handler({ key: 'Escape' });
  }
}

const asDocument = (dom: FakeDocument): Document => dom as unknown as Document;
const buttons = (dom: FakeDocument): FakeNode[] => dom.body.querySelectorAll('button');
const byText = (nodes: FakeNode[], text: string): FakeNode => {
  const found = nodes.find((one) => one.textContent === text);
  assert.ok(found, `no hay botón con el texto «${text}»`);
  return found;
};

const disagreementFor = (block: string, over: Partial<Disagreement> = {}): Disagreement => ({
  block,
  mine: 'lo que escribí aquí',
  theirs: 'lo que dice el corpus',
  hand: 'cotito',
  ...over,
});

// ── El diálogo: las tres salidas ─────────────────────────────────────────────

describe('el diálogo de un desacuerdo', () => {
  it('keep_local: «dejo la mía» decide quedarse con lo escrito aquí', async () => {
    const dom = new FakeDocument();
    const found = [disagreementFor('block:1')];
    const promise = askAboutDisagreements(found, asDocument(dom));

    byText(buttons(dom), 'dejo la mía').click();
    byText(buttons(dom), 'Aplicar').click();

    const decided = await promise;
    assert.deepEqual(decided?.get('block:1'), { kind: 'keep_local' });
  });

  it('keep_canonical: «tomo la suya» decide quedarse con lo del corpus', async () => {
    const dom = new FakeDocument();
    const found = [disagreementFor('block:1')];
    const promise = askAboutDisagreements(found, asDocument(dom));

    byText(buttons(dom), 'tomo la suya').click();
    byText(buttons(dom), 'Aplicar').click();

    const decided = await promise;
    assert.deepEqual(decided?.get('block:1'), { kind: 'keep_canonical' });
  });

  it('replace_with_participant_edit: «escribo otra» conserva el texto que se escribió', async () => {
    const dom = new FakeDocument();
    const found = [disagreementFor('block:1')];
    const promise = askAboutDisagreements(found, asDocument(dom));

    byText(buttons(dom), 'escribo otra').click();
    const write = dom.body.querySelector('.reconcile-write');
    assert.ok(write, 'el botón «escribo otra» debería abrir un textarea');
    write.value = 'lo que dice uno, y también lo que dice el otro';
    byText(buttons(dom), 'ésta es').click();
    byText(buttons(dom), 'Aplicar').click();

    const decided = await promise;
    assert.deepEqual(decided?.get('block:1'), {
      kind: 'replace',
      content: 'lo que dice uno, y también lo que dice el otro',
    });
  });

  it('no deja aplicar hasta que se decidió cada bloque en desacuerdo', async () => {
    const dom = new FakeDocument();
    const found = [disagreementFor('block:1'), disagreementFor('block:2')];
    const promise = askAboutDisagreements(found, asDocument(dom));

    const done = () => buttons(dom).find((one) => one.className.includes('reconcile-done'));
    assert.equal(done()?.disabled, true);
    assert.equal(done()?.textContent, 'Faltan 2 de 2');

    const dejoLaMía = () => buttons(dom).filter((one) => one.textContent === 'dejo la mía');
    dejoLaMía()[0]?.click();
    assert.equal(done()?.disabled, true, 'todavía falta el segundo bloque');
    assert.equal(done()?.textContent, 'Faltan 1 de 2');

    dejoLaMía()[1]?.click();
    assert.equal(done()?.disabled, false);
    done()?.click();

    const decided = await promise;
    assert.equal(decided?.size, 2);
    assert.equal(decided?.get('block:1')?.kind, 'keep_local');
    assert.equal(decided?.get('block:2')?.kind, 'keep_local');
  });

  it('«ahora no» deja el desacuerdo sin resolver: no es lo mismo que elegir', async () => {
    const dom = new FakeDocument();
    const found = [disagreementFor('block:1')];
    const promise = askAboutDisagreements(found, asDocument(dom));

    byText(buttons(dom), 'tomo la suya').click(); // se decidió y no se aplicó
    byText(buttons(dom), 'Ahora no').click();

    assert.equal(await promise, null);
  });

  it('Escape también deja el desacuerdo sin resolver', async () => {
    const dom = new FakeDocument();
    const found = [disagreementFor('block:1')];
    const promise = askAboutDisagreements(found, asDocument(dom));

    dom.pressEscape();

    assert.equal(await promise, null);
  });
});

// ── Aplicar lo decidido ───────────────────────────────────────────────────────

const pendingEdit = (originId: string, block: string, content: string, at = 1): Pending => ({
  originId,
  change: { kind: 'edit_block', block, content },
  channel: 'typed_text',
  at,
  status: 'local',
});

describe('aplicar la resolución al grafo', () => {
  it('keep_local no manda nada y deja lo pendiente tal cual: saldrá y ganará por ser posterior', async () => {
    const outbox = createOutbox(inMemory());
    await outbox.remember(pendingEdit('origin:1', 'block:1', 'lo que escribí aquí'));
    const submitted: unknown[] = [];

    const ok = await applyResolutions(
      [disagreementFor('block:1')],
      new Map([['block:1', { kind: 'keep_local' }]]) as Resolved,
      {
        outbox,
        submit: async (change) => {
          submitted.push(change);
          return { status: 'applied', sequence: 1, subjectId: 'block:1' };
        },
        notice: () => assert.fail('keep_local no debería avisar de nada'),
      },
    );

    assert.equal(ok, true);
    assert.deepEqual(submitted, []);
    assert.deepEqual(
      outbox.pending().map((one) => one.originId),
      ['origin:1'],
    );
  });

  it('keep_canonical retira lo pendiente de la bandeja y no manda nada nuevo', async () => {
    const outbox = createOutbox(inMemory());
    await outbox.remember(pendingEdit('origin:1', 'block:1', 'lo que escribí aquí'));
    const submitted: unknown[] = [];

    const ok = await applyResolutions(
      [disagreementFor('block:1')],
      new Map([['block:1', { kind: 'keep_canonical' }]]) as Resolved,
      {
        outbox,
        submit: async (change) => {
          submitted.push(change);
          return { status: 'applied', sequence: 1, subjectId: 'block:1' };
        },
        notice: () => assert.fail('keep_canonical no debería avisar de nada'),
      },
    );

    assert.equal(ok, true);
    assert.deepEqual(submitted, []);
    assert.deepEqual(outbox.pending(), []);
  });

  it('replace_with_participant_edit manda exactamente la versión nueva y sólo entonces suelta la vieja', async () => {
    const outbox = createOutbox(inMemory());
    await outbox.remember(pendingEdit('origin:1', 'block:1', 'lo que escribí aquí'));
    const submitted: { kind: string; block: string; content: string }[] = [];

    const ok = await applyResolutions(
      [disagreementFor('block:1')],
      new Map([['block:1', { kind: 'replace', content: 'una tercera cosa' }]]) as Resolved,
      {
        outbox,
        submit: async (change) => {
          submitted.push(change);
          return { status: 'applied', sequence: 7, subjectId: 'block:1' };
        },
        notice: () => assert.fail('un reemplazo aceptado no debería avisar de nada'),
      },
    );

    assert.equal(ok, true);
    assert.deepEqual(submitted, [{ kind: 'edit_block', block: 'block:1', content: 'una tercera cosa' }]);
    assert.deepEqual(outbox.pending(), []);
  });

  it('varios bloques: cada uno manda y suelta sólo lo suyo', async () => {
    const outbox = createOutbox(inMemory());
    await outbox.remember(pendingEdit('origin:1', 'block:1', 'mío uno'));
    await outbox.remember(pendingEdit('origin:2', 'block:2', 'mío dos'));
    const submitted: { block: string; content: string }[] = [];

    const ok = await applyResolutions(
      [disagreementFor('block:1'), disagreementFor('block:2')],
      new Map([
        ['block:1', { kind: 'keep_canonical' }],
        ['block:2', { kind: 'replace', content: 'la de los dos' }],
      ]) as Resolved,
      {
        outbox,
        submit: async (change) => {
          submitted.push({ block: change.block, content: change.content });
          return { status: 'applied', sequence: 2, subjectId: change.block };
        },
        notice: () => assert.fail('no debería avisar de nada'),
      },
    );

    assert.equal(ok, true);
    assert.deepEqual(submitted, [{ block: 'block:2', content: 'la de los dos' }]);
    assert.deepEqual(outbox.pending(), []);
  });

  // ── El caso límite: un bloque borrado en un lado mientras el otro lo editó ──
  //
  // `disagreements()` (behind.ts) nunca deja llegar aquí un desacuerdo así: si el
  // corpus ya no tiene el bloque, `theirs` sale `undefined` y no se cuenta como
  // desacuerdo; y el filtro de `main.ts` que arma `pending` sólo mira operaciones
  // `edit_block`, así que un `remove_block` local en cola tampoco entra. El hueco
  // real está en la brecha async entre que el diálogo se abrió con un desacuerdo
  // legítimo y el momento en que `applyResolutions` por fin actúa: en el medio,
  // cualquiera de las dos manos pudo borrar el bloque.

  it('[corregido] un reemplazo rechazado ya no pierde la versión local original', async () => {
    // Antes de esta corrección, `applyResolutions` soltaba lo pendiente de la
    // bandeja ANTES de intentar mandar la reemplazante. Si el bloque había sido
    // borrado mientras tanto —por cualquiera de las dos manos— y el envío volvía
    // rechazado, las dos versiones desaparecían: la original ya se había
    // descartado de la bandeja, y la reemplazante nunca llegó a ningún sitio.
    // El aviso decía que algo había fallado; no había manera de recuperar lo que
    // se perdió. Ahora el envío se intenta primero, y sólo se suelta lo pendiente
    // si el corpus aceptó lo nuevo.
    const outbox = createOutbox(inMemory());
    await outbox.remember(pendingEdit('origin:1', 'block:1', 'mi versión original, todavía sin mandar'));
    const notices: string[] = [];

    const ok = await applyResolutions(
      [disagreementFor('block:1')],
      new Map([['block:1', { kind: 'replace', content: 'la tercera cosa que se había escrito' }]]) as Resolved,
      {
        outbox,
        submit: async () => ({ status: 'rejected', reason: 'no such block' }),
        notice: (message) => notices.push(message),
      },
    );

    assert.equal(ok, false);
    assert.match(notices[0] ?? '', /no such block/);

    // La versión original sigue en la bandeja, intacta: no se perdió nada.
    const left = outbox.pending();
    assert.equal(left.length, 1);
    assert.equal(left[0]?.change.kind, 'edit_block');
    assert.equal(
      left[0]?.change.kind === 'edit_block' ? left[0].change.content : undefined,
      'mi versión original, todavía sin mandar',
    );
  });

  it('[conocido, sin resolver] keep_canonical no cancela un remove_block ya en cola del mismo bloque', async () => {
    // Si el bloque se editó y después, todavía sin mandar ninguna de las dos
    // cosas, se borró localmente, la bandeja tiene un `edit_block` y un
    // `remove_block` pendientes del mismo bloque. `disagreements()` sólo mira
    // `edit_block`, así que el diálogo se abre igual —y con contenido que ya no
    // es el que hay en la mano: lo que se está mirando es la edición vieja, no
    // el borrado que la siguió—.
    //
    // Elegir «tomo la suya» aquí sólo retira de la bandeja el `edit_block`: el
    // `remove_block` que ya estaba en cola no se toca y se manda igual. El
    // bloque que la persona acaba de decidir conservar del corpus se borra de
    // todos modos en cuanto se drene la bandeja, sin ningún aviso de que su
    // elección quedó deshecha.
    //
    // Si «tomo la suya» debería cancelar también un borrado local en cola es una
    // pregunta de producto —¿gana la decisión explícita del diálogo, o gana la
    // intención más reciente de la mano, que fue borrar?— y no se resuelve aquí:
    // se deja señalada. Lo que sigue es lo que el código hace hoy, para que no
    // quede escondido.
    const outbox = createOutbox(inMemory());
    await outbox.remember(pendingEdit('origin:1', 'block:1', 'lo que edité primero'));
    await outbox.remember({
      originId: 'origin:2',
      change: { kind: 'remove_block', block: 'block:1' },
      channel: 'typed_text',
      at: 2,
      status: 'local',
    });

    const ok = await applyResolutions(
      [disagreementFor('block:1')],
      new Map([['block:1', { kind: 'keep_canonical' }]]) as Resolved,
      {
        outbox,
        submit: async () => {
          throw new Error('keep_canonical no debería mandar nada');
        },
        notice: () => assert.fail('no debería avisar de nada: nada de esto falla'),
      },
    );

    assert.equal(ok, true);
    const left = outbox.pending();
    assert.equal(left.length, 1);
    assert.equal(left[0]?.change.kind, 'remove_block'); // sigue en cola, y se mandará
  });
});
