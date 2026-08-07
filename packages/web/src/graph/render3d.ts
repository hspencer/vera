import ForceGraph3D from "3d-force-graph";
// @ts-expect-error three no publica tipos propios en esta versión
import * as THREE from "three";
import type { GraphData, GraphNode } from "./types.ts";
import type { RenderSettings } from "./render";
import { frame } from "./frame.ts";

const RING_COLOR = "#ef7a1c";

// Store active graph instance and event listeners for cleanup
let activeGraph: any = null;
let activeListeners: { target: EventTarget; event: string; fn: EventListener }[] = [];
let activeTimers: ReturnType<typeof setTimeout>[] = [];

/**
 * Dónde está la cámara y qué mira, entre un dibujo y el siguiente.
 *
 * Lo mismo que `positions` y `heldTransform` en dos dimensiones, y por la misma
 * razón: un mapa que se recoloca solo deja de poder recorrerse. `lookAt` es
 * además el centro de la órbita, así que conservarlo es conservar en torno a qué
 * se está girando.
 */
let heldCamera: { position: { x: number; y: number; z: number }; lookAt: { x: number; y: number; z: number } } | null = null;

/** Olvida la cámara. Para cuando el grafo cambia de veras, como al variar el alcance. */
export function forgetCamera(): void {
  heldCamera = null;
}

export function cleanupGraph3D() {
  // Remove event listeners from previous render
  for (const { target, event, fn } of activeListeners) {
    target.removeEventListener(event, fn);
  }
  activeListeners = [];

  // Un reencuadre pendiente sobre un grafo ya destruido no debe sobrevivir al
  // cambio de vista.
  for (const timer of activeTimers) clearTimeout(timer);
  activeTimers = [];

  if (activeGraph) {
    activeGraph._destructor?.();
    activeGraph = null;
  }
}

export function renderGraph3D(
  container: HTMLElement,
  data: GraphData,
  onClickPage: (pageName: string) => void,
  settings: RenderSettings = {}
) {
  // Cleanup previous instance
  cleanupGraph3D();
  container.innerHTML = "";

  const width = container.clientWidth;
  const height = container.clientHeight;
  const dark = settings.dark ?? false;

  // Read CSS vars from #vera-root
  const rootEl = document.getElementById("vera-root");
  const cs = rootEl ? getComputedStyle(rootEl) : null;
  const cssVar = (name: string, fallback: string) =>
    cs?.getPropertyValue(name).trim() || fallback;

  const colors = {
    nodeCentral: cssVar("--node-central", dark ? "#4a9ade" : "#045591"),
    nodeFill: cssVar("--node-fill", dark ? "#777" : "#999"),
    linkStroke: cssVar("--link-stroke", dark ? "#333842" : "#d5d7d2"),
    // Los nombres corrientes van atenuados, igual que en 2D: lo que se busca en
    // un mapa es lo excepcional, y si todo pesa igual no destaca nada.
    text: cssVar("--node-fill", dark ? "#6d7480" : "#9aa0ab"),
    // El fondo de la placa es el fondo de Vera, sin inventar un gris propio.
    bg: cssVar("--bg", dark ? "#16181c" : "#fbfbf9"),
    accent: cssVar("--accent", dark ? "#4a9ade" : "#045591"),
  };

  // History lookup for coloring
  const historyTail = (settings.history ?? []).slice(-5).reverse();
  const historyMap = new Map<string, number>();
  historyTail.forEach((name, i) => {
    const key = name.toLowerCase();
    if (!historyMap.has(key)) historyMap.set(key, i);
  });

  // Prepare data — 3d-force-graph mutates the data, so deep clone
  const nodes3d = data.nodes.map((n) => ({
    id: n.id,
    name: n.name,
    central: n.central,
    degree: n.degree,
    blockCount: n.blockCount ?? 1,
    properties: n.properties,
    matched: n.matched,
  }));

  const links3d = data.links.map((l) => ({
    source: typeof l.source === "string" ? l.source : (l.source as any).id,
    target: typeof l.target === "string" ? l.target : (l.target as any).id,
  }));

  // Node size based on blockCount
  const minBlocks = 1;
  const maxBlocks = 100;
  const minSize = 2;
  const maxSize = 8;

  function nodeSize(node: any): number {
    if (node.central) return maxSize + 2;
    const count = node.blockCount ?? minBlocks;
    const t = Math.min(1, Math.max(0, (count - minBlocks) / (maxBlocks - minBlocks)));
    return minSize + (maxSize - minSize) * Math.sqrt(t);
  }

  function nodeColor(node: any): string {
    if (node.central) return colors.nodeCentral;
    const histIdx = historyMap.get(node.id.toLowerCase());
    if (histIdx !== undefined) {
      const opacities = [1.0, 0.8, 0.6, 0.4, 0.2];
      return `rgba(239, 122, 28, ${opacities[histIdx]})`;
    }
    return colors.nodeFill;
  }

  // En 2D la etiqueta es texto en pantalla y 70 caracteres caben en una línea.
  // Aquí es un cartel en el espacio del grafo: una línea larga se vuelve un
  // billboard más ancho que toda la constelación. Se envuelve corto.
  const MAX_LABEL_CHARS = 24;
  function wrapText3D(text: string, maxChars: number): string[] {
    if (text.length <= maxChars) return [text];
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      if (current && (current.length + 1 + word.length) > maxChars) {
        lines.push(current);
        current = word;
      } else {
        current = current ? current + " " + word : word;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [text];
  }

  /*
   * El nodo es su nombre, también en tres dimensiones.
   *
   * @guarantee GraphNodesAreTheirNames. La esfera detrás del texto decía lo
   * mismo que el texto y le quitaba sitio; sin ella el mapa en 3D se lee como el
   * de 2D y las dos vistas son la misma cosa desde otro ángulo.
   *
   * Queda la placa detrás del nombre, que no es decoración: sin ella un nombre
   * cae sobre otro que está detrás en profundidad y los dos se vuelven ilegibles.
   * Va del color del fondo y translúcida, para tapar lo justo sin ser una caja.
   */
  function createNodeSprite(node: any): THREE.Group {
    const baseFontSize = settings.fontSize ?? 12;
    const spriteFontSize = node.central ? baseFontSize * 4.5 : baseFontSize * 3.3;
    const textColor = node.central ? colors.nodeCentral : colors.text;
    const dpr = 2;
    const fontStr = `${node.central ? "bold " : ""}${spriteFontSize * dpr}px system-ui, -apple-system, sans-serif`;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const lines = showTitles ? wrapText3D(node.name, MAX_LABEL_CHARS) : [];
    const lineHeight = spriteFontSize * dpr * 1.3;

    // Measure max line width
    ctx.font = fontStr;
    let maxLineW = 0;
    for (const line of lines) {
      const w = ctx.measureText(line).width;
      if (w > maxLineW) maxLineW = w;
    }

    const textBlockH = lines.length * lineHeight;
    // El margen tiene que dar cabida al desenfoque, o la placa se corta contra
    // el borde del lienzo y vuelve a leerse como una caja.
    const padding = 18 * dpr;
    const hPad = 24 * dpr;

    // El lienzo lo decide el texto y nada más: sin esfera no hay un mínimo que
    // respetar, y una placa más ancha que su nombre tapa vecinos sin motivo.
    const totalWidth = maxLineW + hPad + padding * 2;
    const totalHeight = textBlockH + padding * 2;
    canvas.width = totalWidth;
    canvas.height = totalHeight;

    const cx = totalWidth / 2;
    const cy = totalHeight / 2;

    // Re-set font after resize
    ctx.font = fontStr;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    if (showTitles && lines.length > 0) {
      const pillH = textBlockH + 12 * dpr;
      const pillW = maxLineW + hPad;
      /*
       * La placa va difuminada, no recortada.
       *
       * Con el borde duro se lee como una caja pegada detrás del nombre; con el
       * borde desvanecido se lee como que el nombre trae su propia sombra y el
       * mapa sigue siendo mapa.
       *
       * Es un desenfoque de la placa, no de lo que hay detrás: un sprite no
       * puede leer la escena que tiene a su espalda sin un paso de render
       * aparte, y ese precio no lo vale un fondo.
       */
      ctx.filter = `blur(${Math.round(6 * dpr)}px)`;
      ctx.globalAlpha = 0.78;
      ctx.fillStyle = colors.bg;
      const rx = cx - pillW / 2, ry = cy - pillH / 2, rr = Math.min(pillH / 2, 12 * dpr);
      ctx.beginPath();
      ctx.moveTo(rx + rr, ry);
      ctx.lineTo(rx + pillW - rr, ry);
      ctx.quadraticCurveTo(rx + pillW, ry, rx + pillW, ry + rr);
      ctx.lineTo(rx + pillW, ry + pillH - rr);
      ctx.quadraticCurveTo(rx + pillW, ry + pillH, rx + pillW - rr, ry + pillH);
      ctx.lineTo(rx + rr, ry + pillH);
      ctx.quadraticCurveTo(rx, ry + pillH, rx, ry + pillH - rr);
      ctx.lineTo(rx, ry + rr);
      ctx.quadraticCurveTo(rx, ry, rx + rr, ry);
      ctx.closePath();
      ctx.fill();

      // El texto va nítido encima: el desenfoque era para el fondo.
      ctx.filter = "none";
      ctx.globalAlpha = 1.0;
      ctx.fillStyle = textColor;
      const startY = cy - ((lines.length - 1) * lineHeight) / 2;
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i] ?? '', cx, startY + i * lineHeight);
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    // Sin declarar el espacio de color, three.js trata el lienzo como lineal y
    // lo convierte a sRGB al pintar: la placa salía de un tono distinto al del
    // fondo de Vera aunque el color fuera literalmente el mismo. Con esto, el
    // `--bg` que se dibuja es el `--bg` que se ve.
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      opacity: 1.0,
    });
    const sprite = new THREE.Sprite(spriteMaterial);

    const worldScale = totalWidth / (dpr * 8);
    const aspect = totalWidth / totalHeight;
    sprite.scale.set(worldScale, worldScale / aspect, 1);

    const group = new THREE.Group();
    group.add(sprite);
    return group;
  }

  const showEdges = settings.showEdges ?? true;
  const showNodes = settings.showNodes ?? true;
  const showTitles = settings.showTitles ?? true;

  // Para distinguir un doble clic de dos clics sueltos sobre nodos distintos.
  let lastClick: { id: string | null; at: number } = { id: null, at: 0 };

  const graph = new ForceGraph3D(container, { controlType: "orbit" })
    .width(width)
    .height(height)
    .backgroundColor("rgba(0,0,0,0)")
    // La librería rotula al pie «Left-click: rotate, Mouse-wheel: zoom…». Es una
    // instrucción de uso permanente sobre el mapa, que se lee una vez y estorba
    // siempre. Se apaga por su propia API y no tapándola con CSS.
    .showNavInfo(false)
    .graphData({ nodes: nodes3d, links: links3d })
    .nodeThreeObject((node: any) => createNodeSprite(node))
    .nodeThreeObjectExtend(false)
    .linkColor(() => showEdges ? colors.linkStroke : "rgba(0,0,0,0)")
    .linkOpacity(showEdges ? 0.4 : 0)
    .linkWidth(showEdges ? 0.5 : 0)
    /*
     * Un clic señala; dos abren y centran. Igual que en 2D: mirar algo no es
     * entrar en ello.
     *
     * La librería no distingue el doble clic, así que se cuenta el tiempo entre
     * dos clics sobre el mismo nodo. En una pantalla táctil un toque hace las
     * dos cosas, porque no hay segundo toque que enseñar.
     */
    .onNodeClick((node: any) => {
      if (!node?.name) return;
      const touch = window.matchMedia("(hover: none)").matches;
      const now = Date.now();
      const again = lastClick.id === node.id && now - lastClick.at < 400;
      lastClick = { id: node.id, at: now };

      if (touch || again) {
        /*
         * El nodo pasa a ser el centro de la órbita.
         *
         * No sólo se mira hacia él: se gira en torno a él. `lookAt` es el objetivo
         * de los controles de órbita, así que cambiarlo es cambiar el marco de
         * referencia de la cámara, y a partir de aquí arrastrar el ratón da
         * vueltas alrededor de esta página y no del origen del grafo.
         *
         * Se conserva la distancia a la que se estaba mirando: acercarse o
         * alejarse es decisión de quien mira, y saltar de página no lo es.
         */
        const at = { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 };
        const camera = graph.cameraPosition();
        const target = (graph.controls() as { target?: { x: number; y: number; z: number } })
          ?.target;
        const from = target ?? { x: 0, y: 0, z: 0 };
        // El vector de la cámara respecto de lo que orbitaba: se traslada tal
        // cual al nodo nuevo, así que el ángulo de vista no cambia.
        const offset = {
          x: camera.x - from.x,
          y: camera.y - from.y,
          z: camera.z - from.z,
        };
        const position = { x: at.x + offset.x, y: at.y + offset.y, z: at.z + offset.z };

        graph.cameraPosition(position, at, 600);
        heldCamera = { position, lookAt: at };
        // Ya se movió por decisión de alguien: no reencuadrar.
        moved = true;
        onClickPage(node.name);
      }
    })
    .onNodeHover((node: any) => {
      container.style.cursor = node ? "pointer" : "default";
    })
    .enableNavigationControls(true);

  /*
   * Las fuerzas, que hasta ahora eran las que la librería trae por defecto.
   *
   * Están pensadas para nodos que son puntos. Aquí un nodo es un nombre, y un
   * nombre ocupa sitio: con la repulsión de fábrica el grafo quedaba apelmazado
   * en un puño en el centro y las etiquetas se pisaban unas a otras, que es
   * exactamente lo que en 2D se resolvió separando cajas.
   *
   * En tres dimensiones no hace falta separar cajas —la profundidad ya despeja—
   * pero sí darles aire, y el aire lo dan estas dos.
   */
  const charge = graph.d3Force("charge");
  if (charge !== undefined) charge.strength(settings.chargeStrength ?? -260);
  const linkForce = graph.d3Force("link");
  if (linkForce !== undefined) linkForce.distance(settings.linkDistance ?? 90);
  // Cambiar una fuerza no reordena lo ya colocado: hay que volver a calentar la
  // simulación, o el grafo se queda exactamente como estaba con las de fábrica.
  graph.d3ReheatSimulation();

  // Encuadrar a los 500 ms dejaba la cámara dentro del cúmulo: a esa altura los
  // nodos siguen casi encima del origen, la simulación los separa después y ya
  // no había vuelta atrás, porque zoomToFit sólo aleja la cámara en la
  // dirección en que ya mira y desde el centro esa dirección es degenerada.
  // Por eso cada encuadre parte de una posición conocida, y se encuadra otra
  // vez cuando la simulación se detiene, que es cuando el grafo ya tiene su
  // tamaño definitivo.
  /** Anota dónde quedó la cámara y en torno a qué está orbitando. */
  const remember = (): void => {
    const position = graph.cameraPosition();
    // Los tipos de la librería declaran `controls()` como `object`; el objetivo
    // de la órbita está ahí y es lo que hace falta para conservar el centro.
    const target = (graph.controls() as { target?: { x: number; y: number; z: number } })?.target;
    heldCamera = {
      position: { x: position.x, y: position.y, z: position.z },
      lookAt:
        target === undefined
          ? { x: 0, y: 0, z: 0 }
          : { x: target.x, y: target.y, z: target.z },
    };
  };

  let moved = false;
  const noteInteraction = (event: Event): void => {
    // Los controles del mapa viven dentro del mapa, así que pulsarlos disparaba
    // este mismo evento: abrir el panel o cambiar de dimensión contaba como
    // haber movido la cámara, y el encuadre no llegaba a ocurrir nunca. Tocar un
    // botón no es mover el grafo.
    const from = event.target as HTMLElement | null;
    if (from?.closest("#map-controls, #map-trail") != null) return;

    moved = true;
    // Lo que la mano hizo se conserva: al repintar se vuelve a esta cámara en
    // vez de reencuadrar. Se anota en el turno siguiente porque los controles
    // actualizan la cámara después del evento.
    setTimeout(remember, 0);
  };
  container.addEventListener("pointerdown", noteInteraction);
  container.addEventListener("wheel", noteInteraction, { passive: true });

  /**
   * La caja que ocupa el grafo, midiendo lo que se dibuja y no dónde se dibuja.
   *
   * Aquí está el fallo que este archivo lleva arrastrando y que vuelve cada vez
   * que alguien reescribe el encuadre: la caja se calculaba con las *posiciones*
   * de los nodos, y en este mapa el nodo no es un punto sino su nombre. Un
   * nombre de diez letras es un cartel de unas treinta unidades de ancho; un
   * grafo de un solo nodo tiene radio cero medido entre centros. Encuadrar ese
   * cero deja la cámara a cuatro unidades de un cartel de treinta, o sea dentro
   * del cartel: el mapa se veía en blanco, y alejando la rueda aparecía una
   * letra ocupando la pantalla entera.
   *
   * `Box3.expandByObject` recorre el objeto de cada nodo y lo mide con su escala
   * puesta, así que el cartel entra en la cuenta. Es lo mismo que hace
   * `getGraphBbox` de la librería, y es por lo que `zoomToFit` —que sí mide los
   * objetos— nunca tuvo este problema donde se ha usado tal cual.
   *
   * No se usa `zoomToFit` porque apunta siempre al origen del mundo, no al
   * centro de lo que hay: si el grafo se ha desplazado, encuadra un centro que
   * no es el suyo. La caja se mide igual y el centro se toma de la caja.
   *
   * @guarantee TheMapArrivesFramed
   */
  const graphBox = (): THREE.Box3 | null => {
    const nodes = (
      graph.graphData() as {
        nodes: { x?: number; y?: number; z?: number; __threeObj?: THREE.Object3D }[];
      }
    ).nodes;

    const box = new THREE.Box3();
    for (const node of nodes) {
      // Antes de la primera vuelta de simulación los nodos no tienen posición, y
      // encuadrar la nada pondría la cámara en cualquier parte.
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || !Number.isFinite(node.z)) continue;
      const object = node.__threeObj;
      if (object === undefined) {
        // Un nodo cuyo cartel aún no se ha construido cuenta al menos como el
        // punto donde está: más vale un encuadre corto que uno que lo ignora.
        box.expandByPoint(new THREE.Vector3(node.x, node.y, node.z));
        continue;
      }
      // La matriz del mundo la actualiza el motor de render en su turno; aquí se
      // mira entre turnos, así que hay que ponerla al día o se mide dónde estaba
      // el nodo hace un cuadro.
      object.updateWorldMatrix(true, true);
      box.expandByObject(object);
    }

    return box.isEmpty() ? null : box;
  };

  /** Poner la cámara donde el grafo entero se vea. */
  const fit = (ms = 0): void => {
    // Encuadrar por encima de la mano del usuario sería quitarle el grafo.
    if (moved || heldCamera !== null) return;

    const box = graphBox();
    if (box === null) return;

    const camera = graph.camera() as { fov?: number };
    const { position, lookAt } = frame(box, camera.fov ?? 50, graph.width() / graph.height());
    graph.cameraPosition(position, lookAt, ms);
  };

  /*
   * Encuadrar cuando el grafo deja de moverse, mirándolo en vez de que nos
   * avisen.
   *
   * Esto colgaba de `onEngineStop`, que es lo que la librería ofrece para
   * decirte que la simulación terminó. Medido: no llega nunca. Ni al cargar, ni
   * al cambiar de dimensión, ni forzando `d3ReheatSimulation()` y esperando
   * diecisiete segundos con un `cooldownTime` de quince mil. Los nodos sí se
   * quedan quietos —la simulación termina de verdad— pero el aviso no sale, así
   * que el encuadre no ocurría y la cámara se quedaba en el z=1000 con que nace
   * la librería: para un grafo de cincuenta unidades de lado, veinte veces
   * demasiado lejos. Eso es el mapa que se veía como una mancha ilegible.
   *
   * Esperar un aviso que no llega no tiene arreglo desde aquí. Mirar si el grafo
   * todavía se mueve, sí: se mide su radio cada poco, y cuando dos medidas
   * seguidas son iguales el grafo ya tiene su tamaño definitivo. Es la misma
   * pregunta que el evento pretendía contestar, hecha directamente.
   *
   * El tope existe para un grafo que nunca se aquiete: más vale un encuadre
   * aproximado que ninguno.
   */
  activeTimers = [];
  /*
   * El encuadre acompaña al grafo mientras se acomoda, en vez de adivinar
   * cuándo terminó.
   *
   * Intenté detectar el reposo comparando el tamaño entre dos medidas, y falla
   * por donde no se ve: al empezar, todos los nodos están casi encima del
   * origen, así que dos medidas seguidas salen iguales y el grafo parece quieto
   * cuando aún no ha empezado a separarse. Cualquier umbral que evite ese falso
   * positivo llega tarde en un grafo grande, y cualquiera que llegue a tiempo lo
   * provoca en uno pequeño.
   *
   * Encuadrar en cada vuelta quita la adivinanza: la cámara sigue al grafo
   * mientras crece y la última vuelta lo deja bien encuadrado, sea cual sea el
   * tiempo que tardó. Se paran en cuanto una mano toca el mapa.
   *
   * La ventana cubre la vida del motor —`cooldownTime` son quince segundos— y no
   * menos: con seis, el grafo seguía acomodándose después del último encuadre y
   * la vista quedaba holgada de nuevo. Ochenta cuentas de trigonometría no le
   * cuestan nada a nadie.
   */
  const FOLLOW_MS = 200;
  const FOLLOW_LOOKS = 85;

  let looks = 0;
  const follow = (): void => {
    // Encuadrar por encima de la mano del usuario sería quitarle el grafo.
    if (moved || heldCamera !== null) return;
    fit();
    looks += 1;
    if (looks < FOLLOW_LOOKS) activeTimers.push(setTimeout(follow, FOLLOW_MS));
  };
  activeTimers.push(setTimeout(follow, FOLLOW_MS));

  // Y si ya había una cámara, se vuelve a ella: cada repintado reencuadraba
  // desde el origen, así que abrir una página desde el mapa devolvía la vista al
  // principio justo cuando uno acababa de llegar a alguna parte.
  graph.onEngineStop(() => {
    if (heldCamera !== null) {
      graph.cameraPosition(heldCamera.position, heldCamera.lookAt, 0);
    }
  });

  // Al llegar, se vuelve a donde se estaba mirando, sin esperar a la simulación.
  if (heldCamera !== null) {
    graph.cameraPosition(heldCamera.position, heldCamera.lookAt, 0);
  }

  activeGraph = graph;

  // Listen for external zoom/center events from controls toolbar
  const onZoom = ((e: CustomEvent) => {
    const pos = graph.cameraPosition();
    const factor = e.detail === "in" ? 0.67 : 1.5;
    graph.cameraPosition(
      { x: pos.x * factor, y: pos.y * factor, z: pos.z * factor },
      undefined, // keep same lookAt
      300
    );
  }) as EventListener;
  const onCenter = (() => {
    // Reset camera to look at origin, then fit all nodes
    graph.cameraPosition(
      { x: 0, y: 0, z: 200 },  // camera position
      { x: 0, y: 0, z: 0 },    // look-at
      600                        // transition ms
    );
    setTimeout(() => graph.zoomToFit(400, 40), 650);
  }) as EventListener;
  document.addEventListener("constel:zoom", onZoom);
  document.addEventListener("constel:center", onCenter);
  activeListeners = [
    { target: document, event: "constel:zoom", fn: onZoom },
    { target: document, event: "constel:center", fn: onCenter },
    // El contenedor sobrevive al cambio de vista: sin retirar estos oyentes se
    // acumularían uno por cada render.
    { target: container, event: "pointerdown", fn: noteInteraction },
    { target: container, event: "wheel", fn: noteInteraction },
  ];
}
