// Los atajos del editor, declarados una sola vez.
//
// El editor pregunta aquí si una pulsación es tal o cual atajo, y la página de
// configuración lee esta misma lista para mostrarlos. Una lista escrita aparte
// se desincroniza sola: sería cuestión de tiempo que la ayuda enseñara teclas
// que ya no hacen eso.
//
// Que no estuvieran escritos en ninguna parte es lo que hacía que indentar
// pareciera roto. La tecla existía; lo que faltaba era decirlo.

export interface Binding {
  id: string;
  /** Cómo se escribe la tecla para leerla. */
  keys: string;
  what: string;
  /** Cuándo aplica, porque la misma tecla hace cosas distintas según el momento. */
  when: string;
  group: 'navegación' | 'estructura' | 'edición' | 'autocompletado';
  match(event: KeyboardEvent): boolean;
}

const plain = (event: KeyboardEvent): boolean =>
  !event.metaKey && !event.ctrlKey && !event.altKey;

export const BINDINGS: Binding[] = [
  {
    id: 'close',
    keys: 'Escape',
    what: 'Cierra lo que esté abierto encima: los ajustes o el panel del mapa',
    when: 'en cualquier momento',
    group: 'navegación',
    match: (event) => event.key === 'Escape',
  },
  {
    id: 'open-node',
    keys: 'Enter o Espacio',
    what: 'Abre la página de ese nodo',
    when: 'con un nodo del mapa enfocado por teclado',
    group: 'navegación',
    match: (event) => event.key === 'Enter' || event.key === ' ',
  },
  {
    id: 'split',
    keys: 'Enter',
    what: 'Parte el bloque por el cursor y crea el siguiente',
    when: 'editando un bloque',
    group: 'estructura',
    match: (event) => event.key === 'Enter' && !event.shiftKey && plain(event),
  },
  {
    id: 'newline',
    keys: 'Shift + Enter',
    what: 'Escribe un salto de línea dentro del mismo bloque',
    when: 'editando un bloque',
    group: 'edición',
    match: (event) => event.key === 'Enter' && event.shiftKey && !event.metaKey && !event.ctrlKey,
  },
  {
    id: 'indent',
    keys: 'Tab',
    what: 'Indenta el bloque: pasa a ser hijo del hermano de encima',
    when: 'editando un bloque',
    group: 'estructura',
    match: (event) => event.key === 'Tab' && !event.shiftKey,
  },
  {
    id: 'outdent',
    keys: 'Shift + Tab',
    what: 'Desindenta el bloque hasta el nivel de su abuelo',
    when: 'editando un bloque',
    group: 'estructura',
    match: (event) => event.key === 'Tab' && event.shiftKey,
  },
  {
    id: 'merge',
    keys: 'Retroceso',
    what: 'Fusiona el bloque con el de encima, o quita el de encima si está vacío',
    when: 'con el cursor al principio del bloque',
    group: 'estructura',
    match: (event) => event.key === 'Backspace',
  },
  {
    id: 'up',
    keys: '↑',
    what: 'Sigue editando en el bloque anterior',
    when: 'con el cursor en la primera línea',
    group: 'edición',
    match: (event) => event.key === 'ArrowUp' && plain(event),
  },
  {
    id: 'down',
    keys: '↓',
    what: 'Sigue editando en el bloque siguiente',
    when: 'con el cursor en la última línea',
    group: 'edición',
    match: (event) => event.key === 'ArrowDown' && plain(event),
  },
  {
    id: 'leave',
    keys: 'Escape',
    what: 'Sale del bloque. Guarda: lo escrito ya está en el grafo',
    when: 'editando un bloque',
    group: 'edición',
    match: (event) => event.key === 'Escape',
  },
  {
    id: 'leave-cmd',
    keys: 'Cmd/Ctrl + Enter',
    what: 'Sale del bloque sin partirlo',
    when: 'editando un bloque',
    group: 'edición',
    match: (event) => event.key === 'Enter' && (event.metaKey || event.ctrlKey),
  },
  {
    id: 'complete-move',
    keys: '↑ ↓',
    what: 'Recorre las sugerencias',
    when: 'con el autocompletado abierto',
    group: 'autocompletado',
    match: (event) => event.key === 'ArrowUp' || event.key === 'ArrowDown',
  },
  {
    id: 'complete-accept',
    keys: 'Enter o Tab',
    what: 'Elige la sugerencia marcada',
    when: 'con el autocompletado abierto',
    group: 'autocompletado',
    match: (event) => event.key === 'Enter' || event.key === 'Tab',
  },
  {
    id: 'complete-close',
    keys: 'Escape',
    what: 'Cierra las sugerencias sin salir del bloque',
    when: 'con el autocompletado abierto',
    group: 'autocompletado',
    match: (event) => event.key === 'Escape',
  },
];

const byId = new Map(BINDINGS.map((binding) => [binding.id, binding]));

/** ¿Esta pulsación es ese atajo? El editor pregunta por id, no por tecla. */
export function is(id: string, event: KeyboardEvent): boolean {
  return byId.get(id)?.match(event) ?? false;
}

/**
 * Lo que hace la mano sobre el mapa.
 *
 * Un mapa no se conduce con teclas sino con el puntero, y hasta ahora eso no
 * estaba escrito en ninguna parte: había que descubrir a tientas que dos dedos
 * corren el mapa o que Shift lo desplaza. La página de configuración es donde
 * uno va a preguntar «qué puedo hacer», y la respuesta no puede depender de si
 * lo que se usa es una tecla o un dedo.
 *
 * Va aquí, junto a los atajos, por el mismo motivo que ellos: una lista escrita
 * aparte se desincroniza sola.
 */
export interface Gesture {
  /** Cómo se hace. */
  does: string;
  what: string;
  /** En qué vista. El mapa plano y el de tres dimensiones no se conducen igual. */
  where: '2D' | '3D' | 'las dos';
}

export const GESTURES: Gesture[] = [
  { does: 'Pulsar un nombre', what: 'Lo señala, sin salir de donde se está', where: 'las dos' },
  {
    does: 'Pulsar dos veces',
    what: 'Abre esa página y deja el mapa girando en torno a ella',
    where: 'las dos',
  },
  { does: 'Tocar un nombre', what: 'En un teléfono abre la página de una vez', where: 'las dos' },
  { does: 'Arrastrar', what: 'Gira el mapa alrededor de la página que se lee', where: '3D' },
  { does: 'Arrastrar el fondo', what: 'Desplaza el mapa', where: '2D' },
  { does: 'Un dedo, arrastrando', what: 'Gira el mapa', where: '3D' },
  { does: 'Dos dedos, deslizando', what: 'Corre el mapa sin girarlo', where: '3D' },
  { does: 'Dos dedos, pellizcando', what: 'Acerca y aleja', where: '3D' },
  { does: 'Shift + arrastrar', what: 'Corre el mapa sin girarlo', where: '3D' },
  { does: 'Botón de en medio', what: 'Lo mismo, para quien lo tenga', where: '3D' },
  { does: 'Rueda del ratón', what: 'Acerca y aleja', where: 'las dos' },
];

/** Los disparadores del autocompletado, para poder mostrarlos junto a las teclas. */
export const TRIGGERS: { keys: string; what: string }[] = [
  { keys: '[[', what: 'Busca una página y escribe la referencia' },
  { keys: '((', what: 'Busca un bloque y escribe la referencia' },
  { keys: '#', what: 'Busca una etiqueta' },
  { keys: '/', what: 'Abre los comandos: encabezados, cita, código, tabla, diagrama…' },
];
