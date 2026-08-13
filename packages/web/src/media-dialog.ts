import { api } from './api.ts';

export interface MediaDetails {
  url: string;
  path: string;
  mediaType: string;
  description?: string | null;
  alternativeText?: string | null;
}

/** La ficha permite mirar el archivo, describirlo y volver al contexto anterior. */
export function openMediaDetails(asset: MediaDetails): void {
  const hash = asset.url.split('/').pop() ?? '';
  if (hash === '') return;
  const dialog = document.createElement('dialog');
  dialog.className = 'media-metadata';
  const form = document.createElement('form');
  form.method = 'dialog';

  const head = document.createElement('header');
  head.className = 'media-metadata-head';
  const heading = document.createElement('div');
  const title = document.createElement('h2');
  title.textContent = '¿Qué estás subiendo?';
  const filename = document.createElement('p');
  filename.className = 'media-metadata-filename';
  filename.textContent = asset.path.split('/').pop() ?? 'Archivo';
  heading.append(title, filename);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'media-metadata-close';
  close.setAttribute('aria-label', 'Cerrar y volver');
  close.textContent = '×';
  close.addEventListener('click', () => dialog.close());
  head.append(heading, close);

  const preview = document.createElement('div');
  preview.className = 'media-detail-preview';
  if (asset.mediaType.startsWith('image/')) {
    const image = document.createElement('img');
    image.src = asset.url;
    image.alt = asset.alternativeText ?? '';
    preview.append(image);
  } else if (asset.mediaType.startsWith('audio/')) {
    const audio = document.createElement('audio');
    audio.src = asset.url;
    audio.controls = true;
    preview.append(audio);
  } else if (asset.mediaType === 'application/pdf') {
    const frame = document.createElement('iframe');
    frame.src = asset.url;
    frame.title = filename.textContent;
    preview.append(frame);
  }

  const descriptionLabel = document.createElement('label');
  descriptionLabel.textContent = 'Descríbelo';
  const description = document.createElement('textarea');
  description.value = asset.description ?? '';
  description.rows = 4;
  description.placeholder = 'Qué contiene o por qué importa; se usa para buscarlo';
  descriptionLabel.append(description);
  const altLabel = document.createElement('label');
  altLabel.textContent = 'Texto alternativo';
  const alternativeText = document.createElement('textarea');
  alternativeText.value = asset.alternativeText ?? '';
  alternativeText.rows = 3;
  alternativeText.placeholder = 'Descripción breve de lo visible para quien no ve la imagen';
  altLabel.append(alternativeText);
  altLabel.hidden = !asset.mediaType.startsWith('image/');

  const actions = document.createElement('div');
  actions.className = 'media-metadata-actions';
  const open = document.createElement('a');
  open.href = asset.url;
  open.target = '_blank';
  open.rel = 'noopener';
  open.textContent = 'Abrir aparte';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Volver';
  cancel.addEventListener('click', () => dialog.close());
  const save = document.createElement('button');
  save.type = 'submit';
  save.textContent = 'Guardar';
  actions.append(open, cancel, save);
  form.append(head, preview, descriptionLabel, altLabel, actions);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save.disabled = true;
    void api.describeMedia(hash, {
      description: description.value,
      alternativeText: alternativeText.value,
    }).then((result) => {
      if ('error' in result) {
        save.disabled = false;
        save.textContent = result.error;
        return;
      }
      asset.description = result.description;
      asset.alternativeText = result.alternativeText;
      dialog.close();
    });
  });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
  description.focus();
}
