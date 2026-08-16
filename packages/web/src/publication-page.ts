// La administración editorial del sitio público, dentro de Vera:Publicación.
//
// La página declara qué gobierna; los valores salen de PersonalSite y
// Publication. No se copian a bloques ni a propiedades porque entonces habría
// dos sitios capaces de contradecirse.

import { api, type PublicationSiteView } from './api.ts';
import { when } from './dates.ts';
import { cellIn, observedCell, rowIn, section } from './table.ts';

export function isPublicationPage(
  properties: readonly { key: string; value: string }[],
): boolean {
  return properties.some(
    (one) => one.key === 'special-kind' && one.value.trim().toLowerCase() === 'publication',
  );
}

function field(label: string, input: HTMLInputElement | HTMLSelectElement): HTMLLabelElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'publication-field';
  const name = document.createElement('span');
  name.textContent = label;
  wrapper.append(name, input);
  return wrapper;
}

/** Dibuja la configuración y el inventario del sitio que Vera proyecta. */
export async function renderPublicationPage(
  notify: (message: string) => void,
  openPage: (page: string) => void,
): Promise<HTMLElement | null> {
  const initial = await api.publicationSite().catch(() => null);
  if (initial === null) return null;

  const panel = document.createElement('section');
  panel.className = 'publication-page governing-tables';

  const form = document.createElement('form');
  form.className = 'publication-form';
  const title = document.createElement('input');
  title.required = true;
  title.value = initial.title;
  title.placeholder = 'Nombre del sitio';
  const domain = document.createElement('input');
  domain.required = true;
  domain.type = 'url';
  domain.value = initial.canonicalDomain;
  domain.placeholder = 'https://ejemplo.net';
  const entryPoint = document.createElement('select');
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'sin portada';
  entryPoint.append(none);
  for (const publication of initial.publications) {
    const option = document.createElement('option');
    option.value = publication.page;
    option.textContent = publication.title;
    option.selected = publication.page === initial.entryPoint;
    entryPoint.append(option);
  }
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'service-button';
  save.textContent = 'guardar configuración';
  form.append(field('Título', title), field('URL canónica', domain), field('Punto de entrada', entryPoint), save);
  panel.append(form);

  const preview = document.createElement('p');
  preview.className = 'publication-preview governing-note';
  if (initial.previewUrl === null) {
    preview.textContent = 'La vista previa interna todavía no tiene una dirección declarada.';
  } else {
    preview.append('Vista previa interna: ');
    const link = document.createElement('a');
    link.href = initial.previewUrl;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = initial.previewUrl;
    preview.append(link);
  }
  panel.append(preview);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save.disabled = true;
    void api.configurePublicationSite({
      title: title.value,
      canonicalDomain: domain.value,
      entryPoint: entryPoint.value === '' ? null : entryPoint.value,
    }).then((site) => {
      notify(site.projectionError === undefined
        ? 'configuración pública guardada'
        : `se guardó, pero no se pudo proyectar: ${site.projectionError}`);
    }).catch((error: unknown) => {
      notify(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      save.disabled = false;
    });
  });

  const table = section(panel, {
    title: 'Páginas publicadas',
    note: 'Cada fila tiene una dirección estable y conserva quién abrió su frontera pública.',
    headers: ['Página', 'Ruta', 'Publicada', 'Por', 'Portada'],
    widths: [28, 20, 18, 20, 14],
    className: 'publication-table',
  });
  for (const publication of initial.publications) {
    const row = rowIn(table);
    const page = cellIn(row, 0);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'publication-page-link';
    button.textContent = publication.title;
    button.addEventListener('click', () => openPage(publication.page));
    page.append(button);
    const route = cellIn(row, 1);
    const link = document.createElement('a');
    link.href = publication.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = publication.path;
    route.append(link);
    observedCell(cellIn(row, 2), when(publication.publishedAt));
    observedCell(cellIn(row, 3), publication.publishedBy);
    observedCell(cellIn(row, 4), publication.entryPoint ? 'sí' : '—');
  }
  if (initial.publications.length === 0) {
    const empty = rowIn(table);
    const cell = cellIn(empty, 0);
    cell.colSpan = 5;
    observedCell(cell, 'Todavía no hay páginas publicadas. Declara una página pública y publícala desde su encabezado.');
  }

  return panel;
}
