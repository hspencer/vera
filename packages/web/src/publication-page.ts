// La administración de todas las formas de compartir, dentro de
// Vera:Publicación.
//
// La página especial y Configuración → Compartir son dos entradas a una sola
// administración. El componente vive en settings.ts para impedir que una
// entrada avance mientras la otra conserva una versión parcial del gobierno.

import { drawSharing } from './settings.ts';

export function isPublicationPage(
  properties: readonly { key: string; value: string }[],
): boolean {
  return properties.some(
    (one) => one.key === 'special-kind' && one.value.trim().toLowerCase() === 'publication',
  );
}

/** Dibuja el gobierno público y autenticado que Vera comparte. */
export async function renderPublicationPage(): Promise<HTMLElement> {
  const panel = document.createElement('section');
  panel.className = 'publication-page settings-sharing';
  await drawSharing(panel);
  return panel;
}
