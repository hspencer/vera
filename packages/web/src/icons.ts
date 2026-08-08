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
  'chevron-left': '<polyline points="15 18 9 12 15 6"/>',

  // «Hoy» es un calendario y no una casa: lo que hay al otro lado del botón es
  // el día en curso, no un tablero ni una portada.
  calendar:
    '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>' +
    '<line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>' +
    '<line x1="3" y1="10" x2="21" y2="10"/>',

  // La lupa. En un teléfono el campo de búsqueda ocupa media barra para estar
  // esperando; plegado en su icono, ocupa lo que ocupa un botón.
  search:
    '<circle cx="11" cy="11" r="7"/>' +
    '<line x1="21" y1="21" x2="16.65" y2="16.65"/>',

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

  // El visto. Va con la cruz: aceptar y descartar son dos gestos, no uno con dos
  // estados, y se dibujan como los dos que son.
  check: '<polyline points="20 6 9 17 4 12"/>',
  // La pluma: explicar por qué esta página y aquélla se tocan es escribir.
  feather:
    '<path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/>',

  // Verticales y no horizontales: el menú cae hacia abajo, y tres puntos en
  // columna dicen hacia dónde se abre lo que hay detrás.
  'more-vertical':
    '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',

  eye:
    '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',

  // --- La familia propia de Vera -------------------------------------------
  //
  // Estos cuatro no son Feather: los dibujó Herbert, y están en
  // `packages/web/public/assets/vera_*.svg` sobre un lienzo de 64 con trazo 4.
  // Aquí van llevados al lienzo de 24 de la familia (×0.375), para que un icono
  // propio y uno prestado se pongan uno al lado del otro sin desalinearse.

  // La marca: tres nodos en V y los vínculos entre ellos. Dice lo que Vera es —
  // cosas, y lo que las une.
  vera:
    '<circle cx="6.75" cy="7.5" r="2.25"/><circle cx="12" cy="16.5" r="2.25"/>' +
    '<circle cx="17.25" cy="7.5" r="2.25"/>' +
    '<line x1="13.13" y1="14.55" x2="16.13" y2="9.45"/>' +
    '<line x1="7.88" y1="9.45" x2="10.88" y2="14.55"/>',

  // El mapa: una constelación. Es el «ante», lo general, desde donde uno se ubica.
  map:
    '<line x1="5.14" y1="10.13" x2="8.36" y2="9.56"/>' +
    '<polyline points="5.18 14.81 12.08 12.75 8.36 9.56 8.51 6.45"/>' +
    '<polyline points="14.25 18.45 11.93 15.53 7.61 18.26"/>' +
    '<polyline points="13.13 8.66 12.08 12.75 15 13.28"/>' +
    '<line x1="12.08" y1="12.75" x2="11.93" y2="15.53"/>' +
    '<polyline points="11.18 5.55 13.13 8.66 15.04 6.75"/>' +
    '<polyline points="17.7 9.49 15 13.28 18.11 16.13"/>' +
    '<line x1="18.86" y1="12.56" x2="15" y2="13.28"/>',

  // Los dos juntos: un pliego abierto. El mapa a la izquierda y el texto a la
  // derecha son las dos páginas de una misma extensión.
  spread:
    '<path d="M12,8.21s3.38-1.5,6.15-1.5v9.94c-2.78,0-6.15,1.5-6.15,1.5,0,0-3.38-1.5-6.15-1.5v-9.94' +
    'c2.78,0,6.15,1.5,6.15,1.5Z"/>' +
    '<line x1="12" y1="18.15" x2="12" y2="8.21"/>',

  // El texto: el «dentro», lo particular, donde se lee y se escribe.
  text:
    '<line x1="6.6" y1="7.69" x2="17.4" y2="7.69"/>' +
    '<line x1="6.6" y1="10.58" x2="14.51" y2="10.58"/>' +
    '<line x1="6.6" y1="13.43" x2="17.4" y2="13.43"/>' +
    '<line x1="6.6" y1="16.31" x2="14.51" y2="16.31"/>',
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
  return icon('vera', { className: 'brand-mark' });
}
