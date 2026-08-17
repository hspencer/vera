// El registro canónico, vuelto legible sin copiarlo a otra base.

import { api, type Change, type DeletedPageActivity } from './api.ts';

export function isActivityPage(properties: readonly { key: string; value: string }[]): boolean {
  return properties.some(
    (one) => one.key === 'special-kind' && one.value.trim().toLowerCase() === 'activity',
  );
}

type Restore = (changes: readonly Change[]) => Promise<boolean>;

function moment(at: number): string {
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(at));
}

function deletedRow(one: DeletedPageActivity, restore: Restore, refresh: () => void): HTMLElement {
  const row = document.createElement('article');
  row.className = 'activity-deletion';
  const text = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = one.title;
  const detail = document.createElement('small');
  detail.textContent = `${moment(one.deletedAt)} · ${one.by} · ${one.blocks} ${one.blocks === 1 ? 'bloque' : 'bloques'}`;
  text.append(title, detail);
  row.append(text);

  if (one.restorable) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'activity-restore';
    button.textContent = 'restaurar';
    button.onclick = async () => {
      if (!window.confirm(`Se restaurará «${one.title}» con ${one.blocks} bloques. La restauración quedará registrada como una nueva actividad.`)) return;
      button.disabled = true;
      button.textContent = 'restaurando…';
      if (await restore(one.changes)) refresh();
      else {
        button.disabled = false;
        button.textContent = 'restaurar';
      }
    };
    row.append(button);
  } else {
    const refusal = document.createElement('small');
    refusal.className = 'activity-refusal';
    refusal.textContent = one.refusal ?? 'no se puede restaurar';
    row.append(refusal);
  }
  return row;
}

export async function renderActivityPage(
  restore: Restore,
  report: (message: string) => void,
): Promise<HTMLElement> {
  const root = document.createElement('section');
  root.className = 'activity-register';
  const loading = document.createElement('p');
  loading.textContent = 'leyendo el registro…';
  root.append(loading);

  const refresh = (): void => {
    void renderActivityPage(restore, report).then((fresh) => root.replaceWith(fresh));
  };

  try {
    const view = await api.activity();
    root.replaceChildren();

    const deletedTitle = document.createElement('h2');
    deletedTitle.textContent = 'Páginas borradas';
    root.append(deletedTitle);
    if (view.deletedPages.length === 0) {
      const none = document.createElement('p');
      none.className = 'activity-empty';
      none.textContent = 'No hay páginas borradas en el registro.';
      root.append(none);
    } else {
      const deleted = document.createElement('div');
      deleted.className = 'activity-deletions';
      for (const one of view.deletedPages) deleted.append(deletedRow(one, restore, refresh));
      root.append(deleted);
    }

    const allTitle = document.createElement('h2');
    allTitle.textContent = 'Toda la actividad';
    const list = document.createElement('ol');
    list.className = 'activity-list';
    const append = (items: typeof view.activity): void => {
      for (const one of items) {
        const item = document.createElement('li');
        const summary = document.createElement('span');
        summary.textContent = one.summary;
        const detail = document.createElement('small');
        detail.textContent = `${moment(one.at)} · ${one.by} · ${one.channel}`;
        item.append(summary, detail);
        list.append(item);
      }
    };
    append(view.activity);
    root.append(allTitle, list);
    if (view.nextBefore !== null) {
      const older = document.createElement('button');
      older.type = 'button';
      older.className = 'activity-older';
      older.textContent = 'mostrar actividad anterior';
      let cursor = view.nextBefore;
      older.onclick = async () => {
        older.disabled = true;
        older.textContent = 'leyendo…';
        try {
          const next = await api.activity(cursor);
          append(next.activity);
          if (next.nextBefore === null) older.remove();
          else {
            cursor = next.nextBefore;
            older.disabled = false;
            older.textContent = 'mostrar actividad anterior';
          }
        } catch {
          older.disabled = false;
          older.textContent = 'volver a intentar';
        }
      };
      root.append(older);
    }
  } catch {
    loading.textContent = 'No se pudo leer el registro de actividad.';
    report('sin conexión con el registro de actividad');
  }
  return root;
}
