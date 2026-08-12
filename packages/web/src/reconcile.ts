// El diálogo del desacuerdo: dos manos, un bloque, una decisión.
//
// Ver specs/offline-reconciliation.allium, @guarantee ADisagreementIsResolvedOneBlockAtATime.
//
// La unidad es el bloque y no la línea, y no es una decisión de dibujo: el bloque
// es lo único de lo que Vera tiene identidad. Elegir línea a línea dejaría un texto
// que no escribió ninguna de las dos manos, en un bloque cuya autoría ya no se
// podría afirmar — y en este corpus también escribe una máquina, así que «quién
// dijo esto» tiene que sobrevivir a resolver un desacuerdo.
//
// Las líneas que difieren sí se enseñan, porque elegir entre dos versiones sin ver
// en qué difieren es elegir a ciegas.
//
// Las tres salidas son las que la spec nombra: quedarse con lo de uno, tomar lo del
// corpus, o escribir una tercera cosa. La tercera no es un lujo: cuando dos
// versiones dicen algo que la otra no dice, quedarse con una es perder texto, y
// perder texto en silencio es lo único que este módulo existe para impedir.

import { sideBySide, type Disagreement } from './behind.ts';
import { icon } from './icons.ts';

export type Resolution =
  | { kind: 'keep_local' }
  | { kind: 'keep_canonical' }
  | { kind: 'replace'; content: string };

/** Qué se decidió para cada bloque en desacuerdo. */
export type Resolved = Map<string, Resolution>;

/**
 * Abre el diálogo y no vuelve hasta que se decidió todo, o hasta que se dejó.
 *
 * Dejarlo devuelve `null` y no es lo mismo que elegir: lo pendiente se queda
 * pendiente, el aviso sigue encendido y no se ha perdido nada. Un diálogo que al
 * cerrarse aplicara algo estaría eligiendo por quien lo cerró.
 */
export function askAboutDisagreements(
  found: readonly Disagreement[],
  hostDocument: Document = document,
): Promise<Resolved | null> {
  return new Promise((resolve) => {
    const decided: Resolved = new Map();

    const back = hostDocument.createElement('div');
    back.className = 'reconcile-back';

    const box = hostDocument.createElement('div');
    box.className = 'reconcile';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Dos manos escribieron lo mismo');

    const head = hostDocument.createElement('header');
    head.className = 'reconcile-head';
    const what = hostDocument.createElement('h2');
    what.textContent =
      found.length === 1
        ? 'Dos manos escribieron este bloque'
        : `Dos manos escribieron ${found.length} bloques`;
    const why = hostDocument.createElement('p');
    why.className = 'reconcile-why';
    why.textContent =
      'Ninguna de las dos versiones se pierde hasta que elijas. Nada se ha guardado todavía.';
    head.append(what, why);

    const list = hostDocument.createElement('div');
    list.className = 'reconcile-list';

    const done = hostDocument.createElement('button');
    done.type = 'button';
    done.className = 'reconcile-done';
    done.disabled = true;

    const sayHowMany = (): void => {
      const left = found.length - decided.size;
      done.disabled = left > 0;
      done.textContent =
        left > 0
          ? `Faltan ${left} de ${found.length}`
          : found.length === 1
            ? 'Aplicar'
            : `Aplicar los ${found.length}`;
    };

    found.forEach((one, at) => {
      list.append(oneBlock(one, at, found.length, hostDocument, (choice) => {
        decided.set(one.block, choice);
        sayHowMany();
      }));
    });

    const leave = hostDocument.createElement('button');
    leave.type = 'button';
    leave.className = 'reconcile-leave';
    leave.textContent = 'Ahora no';

    const close = (answer: Resolved | null): void => {
      back.remove();
      hostDocument.removeEventListener('keydown', onKey);
      resolve(answer);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close(null);
    };
    hostDocument.addEventListener('keydown', onKey);
    leave.addEventListener('click', () => close(null));
    done.addEventListener('click', () => close(decided));

    const foot = hostDocument.createElement('footer');
    foot.className = 'reconcile-foot';
    foot.append(leave, done);

    sayHowMany();
    box.append(head, list, foot);
    back.append(box);
    hostDocument.body.append(back);
    return;
  });
}

/** Un bloque en desacuerdo: las dos versiones y las tres salidas. */
function oneBlock(
  one: Disagreement,
  at: number,
  total: number,
  hostDocument: Document,
  chose: (choice: Resolution) => void,
): HTMLElement {
  const item = hostDocument.createElement('section');
  item.className = 'reconcile-block';

  const which = hostDocument.createElement('p');
  which.className = 'reconcile-which';
  which.textContent = total === 1 ? 'ambos lo tocaron' : `bloque ${at + 1} de ${total}`;
  item.append(which);

  const lines = sideBySide(one.mine, one.theirs);

  const side = (
    title: string,
    rows: { text: string; mark: string }[],
    mark: 'mine' | 'theirs',
  ): HTMLElement => {
    const column = hostDocument.createElement('div');
    column.className = `reconcile-side reconcile-${mark}`;
    const label = hostDocument.createElement('p');
    label.className = 'reconcile-label';
    label.textContent = title;
    const body = hostDocument.createElement('pre');
    body.className = 'reconcile-text';
    for (const row of rows) {
      const line = hostDocument.createElement('span');
      line.className = row.mark === 'same' ? 'reconcile-line' : 'reconcile-line changed';
      // Una línea vacía tiene que ocupar su renglón, o el diff se lee corrido.
      line.textContent = row.text === '' ? ' ' : row.text;
      body.append(line);
    }
    column.append(label, body);
    return column;
  };

  const both = hostDocument.createElement('div');
  both.className = 'reconcile-sides';
  both.append(
    side('lo tuyo, escrito aquí', lines.mine, 'mine'),
    side(`lo de ${one.hand}, en el corpus`, lines.theirs, 'theirs'),
  );
  item.append(both);

  const choices = hostDocument.createElement('div');
  choices.className = 'reconcile-choices';

  const mark = (chosen: HTMLElement): void => {
    for (const button of choices.querySelectorAll('button')) button.classList.remove('chosen');
    chosen.classList.add('chosen');
    item.classList.add('decided');
  };

  const choice = (label: string, what: () => Resolution): HTMLButtonElement => {
    const button = hostDocument.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => {
      mark(button);
      chose(what());
    });
    return button;
  };

  const mine = choice('dejo la mía', () => ({ kind: 'keep_local' }));
  const theirs = choice('tomo la suya', () => ({ kind: 'keep_canonical' }));

  /*
   * Y escribir una tercera.
   *
   * Es `replace_with_participant_edit` de la spec, y hace falta cuando cada versión
   * dice algo que la otra no: quedarse con una sería perder texto. Se abre con las
   * dos delante, que es cuando se sabe qué hay que escribir.
   */
  const third = hostDocument.createElement('button');
  third.type = 'button';
  third.className = 'reconcile-third';
  third.innerHTML = `${icon('edit-2')}<span>escribo otra</span>`;
  third.addEventListener('click', () => {
    if (item.querySelector('.reconcile-write') !== null) return;
    const write = hostDocument.createElement('textarea');
    write.className = 'reconcile-write';
    write.value = one.mine;
    write.rows = Math.max(3, one.mine.split('\n').length + 1);
    const keep = hostDocument.createElement('button');
    keep.type = 'button';
    keep.className = 'reconcile-keep';
    keep.textContent = 'ésta es';
    keep.addEventListener('click', () => {
      mark(third);
      chose({ kind: 'replace', content: write.value });
    });
    const holder = hostDocument.createElement('div');
    holder.className = 'reconcile-writing';
    holder.append(write, keep);
    item.append(holder);
    write.focus();
  });

  choices.append(mine, theirs, third);
  item.append(choices);
  return item;
}
