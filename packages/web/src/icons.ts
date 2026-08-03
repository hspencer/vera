// Iconos de la interfaz.
//
// Son Feather (https://feathericons.com), de Cole Bemis, bajo licencia MIT. El
// trazo va copiado literal desde el paquete original: no se redibuja a ojo,
// porque un icono redibujado deja de ser el de la familia y empieza a
// desalinearse del resto.
//
// Van aquí dentro y no en una CDN, por lo mismo que las tipografías: una
// memoria privada no debería pedirle nada a un tercero cada vez que se abre.
// Son unos cientos de bytes, así que tampoco hay razón para que viajen aparte.
//
// El trazo usa `currentColor`, de modo que un icono toma el color de donde se
// pone y sigue respondiendo al tema sin que haya que pintarlo dos veces.

/** El interior de cada icono, tal como viene en `feather-icons@4.29.2`. */
const SHAPES = {
  // La marca de Vera: tres nodos y los vínculos entre ellos. Girado, una V.
  'share-2':
    '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/>' +
    '<circle cx="18" cy="19" r="3"/>' +
    '<line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>' +
    '<line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',

  'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
  'chevron-down': '<polyline points="6 9 12 15 18 9"/>',

  settings:
    '<circle cx="12" cy="12" r="3"/>' +
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 ' +
    '1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 ' +
    '19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 ' +
    '.33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 ' +
    '0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 ' +
    '1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 ' +
    '1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 ' +
    '0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',

  sun:
    '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/>' +
    '<line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>' +
    '<line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/>' +
    '<line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>' +
    '<line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',

  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',

  mic:
    '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>' +
    '<path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>' +
    '<line x1="8" y1="23" x2="16" y2="23"/>',

  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
} as const;

export type IconName = keyof typeof SHAPES;

export interface IconOptions {
  /** Grados de giro sobre el centro del lienzo. La marca usa -90. */
  rotate?: number;
  /** Clase extra para poder posicionarlo desde la hoja de estilo. */
  className?: string;
}

/**
 * El marcado de un icono, listo para poner dentro de un botón.
 *
 * No lleva medidas: el tamaño lo decide el CSS, para que un icono crezca junto
 * al control que lo contiene en vez de quedar clavado a un número escrito aquí.
 *
 * @invariant IconsAreDecorative: el icono se marca `aria-hidden`. Lo que se lee
 * en voz alta es la etiqueta del control, no el dibujo; anunciar los dos diría
 * dos veces lo mismo, y un icono a solas no dice nada útil.
 */
export function icon(name: IconName, options: IconOptions = {}): string {
  // Girar sobre el centro del lienzo de 24 y no sobre el del trazo: así la
  // marca conserva su caja y no se descuadra respecto de los demás iconos.
  const turn = options.rotate === undefined ? '' : ` transform="rotate(${options.rotate} 12 12)"`;
  const extra = options.className === undefined ? '' : ` ${options.className}`;
  return (
    `<svg class="icon icon-${name}${extra}" viewBox="0 0 24 24" fill="none" ` +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    `stroke-linejoin="round" aria-hidden="true" focusable="false"><g${turn}>${SHAPES[name]}</g></svg>`
  );
}

/**
 * La marca: `share-2` girado un cuarto de vuelta a la izquierda.
 *
 * El giro no es un adorno. Los tres nodos de `share-2` están en (18,5), (6,12)
 * y (18,19); girar -90° sobre el centro los manda a (5,6), (12,18) y (19,6), y
 * eso es una V. Vera queda dicha con el mismo icono que dice qué es: tres cosas
 * y los vínculos entre ellas.
 */
export function brandMark(): string {
  return icon('share-2', { rotate: -90, className: 'brand-mark' });
}
