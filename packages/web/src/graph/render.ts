import * as d3 from "d3";
import type { GraphData, GraphLink, GraphNode } from "./types.ts";
import { is } from "../bindings.ts";

export type NodeStyle = "circular" | "title";

export interface RenderSettings {
  chargeStrength?: number;
  linkDistance?: number;
  history?: string[];
  dark?: boolean;
  fontFamily?: string;
  nodeStyle?: NodeStyle;
  showEdges?: boolean;
  showNodes?: boolean;
  showTitles?: boolean;
  fontSize?: number;
}

// ── Title-mode constants ──
const PAD_X = 0;
const PAD_Y = 0;
const FONT_MIN = 10;
const FONT_MAX = 18;
const BLOCKS_MIN = 1;
const BLOCKS_MAX = 100;

function titleFontSize(d: GraphNode): number {
  if (d.central) return FONT_MAX;
  const count = d.blockCount ?? BLOCKS_MIN;
  const t = Math.min(1, Math.max(0, (count - BLOCKS_MIN) / (BLOCKS_MAX - BLOCKS_MIN)));
  return FONT_MIN + (FONT_MAX - FONT_MIN) * Math.sqrt(t);
}

// ── Max label width before wrapping ──
// Setenta caracteres en una sola línea era casi una frase: un nombre largo
// atravesaba el mapa y empujaba a todos los demás. Al partirse antes, la caja es
// más compacta y quedan más nombres legibles en el mismo sitio.
const MAX_LABEL_CHARS = 24;

/** El aire entre dos nombres. Sin él se tocan, y tocarse ya se lee como uno. */
const COLLISION_PAD = 6;

/** Split text into lines respecting word boundaries and max char width. */
function wrapText(text: string, maxChars: number): string[] {
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

// ── History ring config ──
const RING_COLOR = "#ef7a1c";

// Track listeners for cleanup on re-render
let active2dListeners: { event: string; fn: EventListener }[] = [];

/**
 * Dónde quedó cada nodo, entre un dibujo y el siguiente.
 *
 * @guarantee TheMapHoldsItsPositions. La simulación de fuerzas se corría entera
 * en cada repintado, así que colapsar el panel, redimensionarlo o volver a una
 * página vecina reordenaba el mapa completo. El costo era real —se notaba como
 * lag sobre un corpus de este tamaño— pero no es la razón principal: un mapa que
 * se reacomoda mientras uno lo mira no se puede recordar, y un mapa que no se
 * recuerda es una imagen y no un lugar. Reconocer una región por su forma es
 * para lo que sirve dibujarla.
 */
const positions = new Map<string, { x: number; y: number }>();

/** El encuadre. Se conserva por lo mismo: volver no debe reencuadrar. */
let heldTransform: d3.ZoomTransform | null = null;

/** Olvida lo colocado. Para cuando el grafo cambia de centro de verdad. */
export function forgetPositions(): void {
  positions.clear();
  heldTransform = null;
}

/** Señala un nodo desde fuera, para que abrir una página lo marque en el mapa. */
export function selectNode(id: string | null): void {
  selected = id;
}

/** El nodo señalado ahora mismo. Se conserva entre dibujos, como las posiciones. */
let selected: string | null = null;
/** El último que se llevó al centro, para no volver a hacerlo en cada repintado. */
let centred: string | null = null;

export function renderGraph(
  container: HTMLElement,
  data: GraphData,
  onClickPage: (pageName: string) => void,
  settings: RenderSettings = {}
) {
  // Clean up previous listeners
  for (const { event, fn } of active2dListeners) {
    document.removeEventListener(event, fn);
  }
  active2dListeners = [];

  container.innerHTML = "";

  const width = container.clientWidth;
  const height = container.clientHeight;
  // El nodo es su nombre. Un círculo al lado no dice nada que el nombre no diga,
  // y gasta el mismo sitio diciendo menos.
  const style = settings.nodeStyle ?? "title";

  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [0, 0, width, height])
    .attr("role", "img")
    .attr("aria-label", "Knowledge graph visualization");

  const showEdges = settings.showEdges ?? true;
  const showNodes = settings.showNodes ?? true;
  const showTitles = settings.showTitles ?? true;
  const fontSize = settings.fontSize ?? 12;

  const g = svg.append("g");
  const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.2, 5])
    .on("zoom", (event) => g.attr("transform", event.transform));
  svg.call(zoomBehavior as any);

  // Listen for external zoom/center events from the controls toolbar
  const onZoom = ((e: CustomEvent) => {
    if (e.detail === "in") {
      svg.transition().duration(300).call(zoomBehavior.scaleBy as any, 1.5);
    } else {
      svg.transition().duration(300).call(zoomBehavior.scaleBy as any, 0.67);
    }
  }) as EventListener;
  const onCenter = (() => {
    svg.transition().duration(300).call(
      zoomBehavior.transform as any,
      d3.zoomIdentity.translate(width / 2, height / 2).scale(0.8).translate(-width / 2, -height / 2)
    );
  }) as EventListener;
  document.addEventListener("constel:zoom", onZoom);
  document.addEventListener("constel:center", onCenter);
  active2dListeners = [
    { event: "constel:zoom", fn: onZoom },
    { event: "constel:center", fn: onCenter },
  ];

  // Theme colors — read CSS variables from #vera-root, fall back to defaults
  const dark = settings.dark ?? false;
  const rootEl = document.getElementById("vera-root");
  const cs = rootEl ? getComputedStyle(rootEl) : null;
  const cssVar = (name: string, fallback: string) =>
    cs?.getPropertyValue(name).trim() || fallback;
  // Todo color sale de los tokens, que es lo que hace que el mapa siga al tema
  // que se elija sin tener una paleta propia escondida aquí. `--border` no
  // existe y nunca existió: la línea del tema es `--rule`.
  const colors = {
    nodeCentral: cssVar("--node-central", dark ? "#4a9ade" : "#045591"),
    nodeFill: cssVar("--node-fill", dark ? "#777" : "#999"),
    nodeBorder: cssVar("--rule", dark ? "#2b2f38" : "#e3e3de"),
    textCentral: cssVar("--node-central", dark ? "#4a9ade" : "#045591"),
    // Los nombres corrientes van atenuados a propósito: lo que se busca en un
    // mapa es lo excepcional, y si todo pesa igual no destaca nada.
    textNormal: cssVar("--node-fill", dark ? "#6d7480" : "#9aa0ab"),
    linkStroke: cssVar("--link-stroke", dark ? "#333842" : "#d5d7d2"),
    hoverAccent: cssVar("--accent", dark ? "#4a9ade" : "#045591"),
    visited: cssVar("--warm", "#ef7a1c"),
  };

  // History lookup
  const historyTail = (settings.history ?? []).slice(-5).reverse();
  const historyMap = new Map<string, number>();
  historyTail.forEach((name, i) => {
    const key = name.toLowerCase();
    if (!historyMap.has(key)) historyMap.set(key, i);
  });

  // Links (conditional on showEdges)
  const linkGroup = g.append("g")
    .attr("stroke", colors.linkStroke)
    .attr("stroke-opacity", 0.6);
  // El ternario original producía una unión de tipos que perdía .attr bajo
  // strict. Se elige el conjunto de datos en vez de la rama de la expresión.
  const link = linkGroup
    .selectAll<SVGLineElement, GraphLink>("line")
    .data(showEdges ? data.links : [])
    .join("line")
    .attr("stroke-width", 1);
  link.style("transition", "stroke-opacity 0.2s, stroke 0.2s");

  // Nodes
  const node = g
    .append("g")
    .selectAll<SVGGElement, GraphNode>("g")
    .data(data.nodes)
    .join("g")
    .attr("cursor", "pointer")
    .style("transition", "opacity 0.2s");

  // ── Dimensions map (used for title-mode collision and both modes for history rings) ──
  const dims = new Map<string, { w: number; h: number }>();

  const fontFamily = settings.fontFamily ?? "system-ui, -apple-system, sans-serif";

  /** El color que le toca a cada nombre por su historia, para poder restaurarlo. */
  const fills = new Map<string, string>();

  if (style === "title") {
    renderTitleNodes(node, data, dims, historyMap, colors, fontFamily, fontSize, fills);
  } else {
    renderCircularNodes(node, data, dims, historyMap, colors, showNodes, showTitles, fontSize);
  }

  // Accessibility: make nodes focusable
  node
    .attr("tabindex", 0)
    .attr("role", "link")
    .attr("aria-label", (d) => d.name);

  /*
   * Un clic señala; dos abren.
   *
   * Es la convención de cualquier mapa y de cualquier escritorio: mirar algo no
   * es entrar en ello. Señalar deja ver de qué se trata sin perder la página que
   * se está leyendo, y sólo el segundo clic la cambia.
   *
   * En un teléfono no hay segundo clic, así que ahí un toque hace las dos cosas:
   * exigir un doble toque en una pantalla táctil sería pedir un gesto que el
   * aparato no enseña.
   */
  const touch = window.matchMedia("(hover: none)").matches;

  const draw = (): void => {
    node.classed("selected", (d) => d.id === selected);
    node
      .select<SVGTextElement>("text")
      .attr("fill", (d: any) =>
        d.id === selected ? colors.hoverAccent : (fills.get(d.id) ?? colors.textNormal),
      );
  };

  const open = (d: any): void => {
    selected = d.id;
    draw();
    // No se centra aquí: abrir la página trae otro grafo, y centrar sobre el
    // viejo no significa nada. Se centra al dibujar, abajo, cuando la selección
    // resulta ser distinta de la última que se llevó al centro.
    onClickPage(d.name);
  };

  node.on("click", (_event, d: any) => {
    if (touch) {
      open(d);
      return;
    }
    selected = d.id;
    draw();
  });
  node.on("dblclick", (event, d: any) => {
    // Sin esto el doble clic también dispara el zoom por defecto de d3.
    (event as Event).stopPropagation();
    open(d);
  });
  node.on("keydown", (_event, d: any) => {
    // Se pregunta a `bindings`, que es de donde la pagina de configuracion saca
    // lo que enseña: asi el atajo anunciado y el atendido son el mismo.
    const e = _event as KeyboardEvent;
    if (is("open-node", e)) {
      e.preventDefault();
      open(d);
    }
  });

  // Hover highlight
  node
    .on("mouseenter", function (_event, d) {
      link.attr("stroke-opacity", 0.1);
      node.attr("opacity", 0.2);
      const connected = new Set<string>([d.id]);
      data.links.forEach((l) => {
        const src = typeof l.source === "string" ? l.source : (l.source as any).id;
        const tgt = typeof l.target === "string" ? l.target : (l.target as any).id;
        if (src === d.id) connected.add(tgt);
        if (tgt === d.id) connected.add(src);
      });
      node.filter((n) => connected.has(n.id)).attr("opacity", 1);
      link
        .filter((l) => {
          const src = typeof l.source === "string" ? l.source : (l.source as any).id;
          const tgt = typeof l.target === "string" ? l.target : (l.target as any).id;
          return src === d.id || tgt === d.id;
        })
        .attr("stroke-opacity", 0.8)
        .attr("stroke", colors.hoverAccent);
    })
    .on("mouseleave", function () {
      link.attr("stroke-opacity", 0.6).attr("stroke", colors.linkStroke);
      node.attr("opacity", 1);
    });

  /*
   * Lo colocado se conserva.
   *
   * Si todos los nodos ya tienen sitio, no se corre la simulación: se dibuja
   * donde estaban. Si aparecieron nodos nuevos, se siembra a los conocidos con
   * su posición y sólo lo nuevo tiene que encontrar hueco, así que el mapa no se
   * reordena entero por haber entrado una página más.
   */
  let allPlaced = data.nodes.length > 0;
  for (const item of data.nodes as any[]) {
    const held = positions.get(item.id);
    if (held === undefined) {
      allPlaced = false;
    } else {
      item.x = held.x;
      item.y = held.y;
    }
  }

  const remember = (): void => {
    for (const item of data.nodes as any[]) {
      if (typeof item.x === "number" && typeof item.y === "number") {
        positions.set(item.id, { x: item.x, y: item.y });
      }
    }
  };

  const place = (): void => {
    link
      .attr("x1", (d: any) => d.source.x)
      .attr("y1", (d: any) => d.source.y)
      .attr("x2", (d: any) => d.target.x)
      .attr("y2", (d: any) => d.target.y);
    node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
  };

  // El encuadre también se conserva: volver a una página no debe reencuadrar.
  if (heldTransform !== null) {
    svg.call(zoomBehavior.transform as any, heldTransform);
  }
  zoomBehavior.on("zoom", (event) => {
    heldTransform = event.transform;
    g.attr("transform", event.transform);
  });

  // Simulation — title mode needs more space and stronger repulsion
  const isTitle = style === "title";
  const collisionForce = isTitle
    ? rectCollide(dims, COLLISION_PAD)
    : d3.forceCollide<GraphNode>().radius(20);

  const linkDist = settings.linkDistance ?? (isTitle ? 120 : 80);
  const charge = settings.chargeStrength ?? (isTitle ? -400 : -200);

  const sim = d3
    .forceSimulation<GraphNode>(data.nodes)
    .force(
      "link",
      d3.forceLink<GraphNode, any>(data.links)
        .id((d) => d.id)
        .distance(linkDist)
    )
    .force("charge", d3.forceManyBody().strength(charge))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", collisionForce as any);

  /*
   * Los nombres no se traslapan. Punto.
   *
   * La simulación se detiene cuando su alpha baja, no cuando los choques están
   * resueltos, así que quedaban nombres uno encima de otro —«Postgraduate
   * Research Symposium» sobre «PICTOS.net»— y dos nombres superpuestos no son
   * ninguno de los dos. Al terminar se sigue separando, ya sin fuerzas que tiren
   * en contra, hasta que no quede ningún choque o hasta un tope: converge en
   * unas pocas pasadas y el tope está para que un caso patológico no cuelgue la
   * pestaña.
   *
   * @guarantee GraphNodesAreTheirNames.
   */
  /*
   * Vuelve a medir cada nombre.
   *
   * Las cajas se miden en cuanto se dibujan, y en ese momento la tipografía
   * puede no haber llegado todavía: `font-display: swap` enseña la de reserva
   * primero, así que se medía una letra y se dibujaba otra, más ancha. Por eso
   * había nombres pisándose aunque la separación funcionara. Se vuelve a medir
   * sobre lo que hay de verdad en la pantalla.
   */
  const remeasure = (): void => {
    node.each(function (d) {
      const box = (this as SVGGElement).getBBox();
      if (box.width > 0) dims.set(d.id, { w: box.width, h: box.height });
    });
  };

  const untangle = (): void => {
    const items = data.nodes as any[];
    for (let pass = 0; pass < 60; pass += 1) {
      let moved = false;
      for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
          const a = items[i];
          const b = items[j];
          const da = dims.get(a.id) ?? { w: 40, h: 16 };
          const db = dims.get(b.id) ?? { w: 40, h: 16 };
          const halfW = (da.w + db.w) / 2 + COLLISION_PAD;
          const halfH = (da.h + db.h) / 2 + COLLISION_PAD;

          let dx = b.x - a.x;
          let dy = b.y - a.y;
          if (dx === 0 && dy === 0) {
            // Exactamente encima: hay que romper el empate de algún modo.
            dx = 0.5;
            dy = 0.5;
          }

          const overlapX = halfW - Math.abs(dx);
          const overlapY = halfH - Math.abs(dy);
          if (overlapX <= 0 || overlapY <= 0) continue;

          moved = true;
          // Se separa por donde menos cuesta, que es lo que mantiene el dibujo
          // parecido al que la simulación había encontrado.
          if (overlapX < overlapY) {
            const shift = (overlapX / 2) * (dx > 0 ? 1 : -1);
            a.x -= shift;
            b.x += shift;
          } else {
            const shift = (overlapY / 2) * (dy > 0 ? 1 : -1);
            a.y -= shift;
            b.y += shift;
          }
        }
      }
      if (!moved) break;
    }
  };

  /*
   * Se resuelve de una vez, sin animación.
   *
   * Antes se dibujaba en cada tick y la separación de nombres corría al terminar
   * la simulación, confiando en el evento `end` de d3 — que con repintados
   * encadenados no siempre llega, así que quedaban nombres pisándose. Ahora la
   * simulación se corre entera aquí, se separan los nombres y se dibuja una vez.
   *
   * Además es lo que hace falta para que el mapa se pueda recordar: sin
   * animación no hay nada que se reacomode mientras uno mira, y lo que aparece
   * ya está en su sitio.
   */
  /**
   * Deja el nodo en el centro, sin cambiar cuánto se está acercando.
   *
   * De una vez y sin animar. Una transición de d3 vive atada al elemento, y cada
   * repintado empieza vaciando el contenedor: la transición moría con el SVG que
   * la esperaba y el nodo se quedaba donde estaba, sin error ni aviso. Además, un
   * mapa que no se mueve solo es lo que el resto de esta vista ya promete.
   */
  const centre = (d: any): void => {
    const at = heldTransform ?? d3.zoomIdentity;
    const to = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(at.k)
      .translate(-d.x, -d.y);
    zoomBehavior.transform(svg as any, to);
  };

  // Si en este dibujo hay que llevar algo al centro. Local y no global: la
  // separación de nombres vuelve a correr cuando llega la tipografía y mueve los
  // nodos, así que centrar una sola vez dejaba el nodo desplazado.
  const needsCentre = selected !== null && selected !== centred;

  const settle = (): void => {
    if (isTitle) {
      remeasure();
      untangle();
    }
    place();
    remember();
    if (needsCentre) {
      const target = (data.nodes as any[]).find((item) => item.id === selected);
      if (target !== undefined) centre(target);
    }
  };

  sim.stop();
  if (!allPlaced) {
    // Trescientos pasos es lo que d3 haría por su cuenta antes de detenerse. En
    // un mapa acotado por alcance son unas decenas de nodos: se hace en un
    // suspiro y no se ve moverse nada.
    for (let step = 0; step < 300; step += 1) sim.tick();
  }
  settle();
  draw();

  /*
   * Queda anotado que ya se centró en este nodo.
   *
   * Centrar en cada repintado desharía la panorámica que alguien hizo a mano
   * —colapsar el panel, cambiar de tamaño la ventana— y un mapa que se recoloca
   * solo deja de poder recorrerse. Se centra al llegar a una página, y después
   * el mapa es de quien lo mira.
   */
  if (selected !== null) centred = selected;

  // Y otra vez cuando la tipografía haya llegado: las cajas se miden con la
  // letra que hay en pantalla, y `font-display: swap` enseña la de reserva
  // primero. `document.fonts.ready` resuelve de inmediato si ya estaba.
  if (isTitle) {
    void document.fonts.ready.then(() => {
      // Entretanto pudo haberse redibujado el mapa; si estos nodos ya no están
      // en el documento, no hay nada que reacomodar.
      if (!container.isConnected || svg.node()?.isConnected !== true) return;
      settle();
    });
  }

  // El arrastre sí anima: mover un nodo a mano es la única vez que uno quiere
  // ver moverse el mapa, porque lo está moviendo.
  sim.on("tick", place);

  node.call(drag(sim, remember) as any);
}

// ── Circular mode ──
function renderCircularNodes(
  node: d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>,
  _data: GraphData,
  dims: Map<string, { w: number; h: number }>,
  historyMap: Map<string, number>,
  colors: Record<string, string>,
  showNodes: boolean,
  showTitles: boolean,
  fontSize: number
) {
  const RING_LEVELS = [
    { strokeWidth: 6, opacity: 1.0 },
    { strokeWidth: 5, opacity: 0.8 },
    { strokeWidth: 4, opacity: 0.6 },
    { strokeWidth: 4, opacity: 0.4 },
    { strokeWidth: 4, opacity: 0.2 },
  ];

  if (showNodes) {
    node
      .append("circle")
      .attr("r", (d) => (d.central ? 12 : 4 + Math.min(d.degree * 1.5, 10)))
      .attr("fill", (d) => (d.central ? colors.nodeCentral : colors.nodeFill) ?? "#999")
      .attr("fill-opacity", 0.7)
      .attr("stroke", "none")
      .attr("stroke-width", 0);

    // History rings
    node
      .filter((d) => historyMap.has(d.id.toLowerCase()))
      .append("circle")
      .attr("r", (d) => {
        const baseR = d.central ? 12 : 4 + Math.min(d.degree * 1.5, 10);
        const idx = historyMap.get(d.id.toLowerCase()) ?? 0;
        const level = RING_LEVELS[idx] ?? RING_LEVELS[0];
        return baseR + (level?.strokeWidth ?? 0) / 2 + 2;
      })
      .attr("fill", "none")
      .attr("stroke", RING_COLOR)
      .attr("stroke-width", (d) => RING_LEVELS[historyMap.get(d.id.toLowerCase()) ?? 0]?.strokeWidth ?? 1)
      .attr("stroke-opacity", (d) => RING_LEVELS[historyMap.get(d.id.toLowerCase()) ?? 0]?.opacity ?? 1);
  }

  if (showTitles) {
    // Multiline labels centered on the node
    node.each(function (d) {
      const g = d3.select(this);
      const fs = d.central ? fontSize + 2 : fontSize;
      const lines = wrapText(d.name, MAX_LABEL_CHARS);
      const lineHeight = fs * 1.2;
      const yOffset = -((lines.length - 1) * lineHeight) / 2;
      const textEl = g.append("text")
        .attr("text-anchor", "middle")
        .attr("font-size", `${fs}px`)
        .attr("font-weight", d.central ? "bold" : "normal")
        .attr("fill", colors.textNormal ?? "#333");
      lines.forEach((line, i) => {
        textEl.append("tspan")
          .attr("x", 0)
          .attr("dy", i === 0 ? `${yOffset}px` : `${lineHeight}px`)
          .text(line);
      });
    });
  } else {
    // Tooltip only (native SVG title element)
    node.append("title").text((d) => d.name);
  }

  // Store dims for collision (approximate)
  node.each((d) => {
    const r = d.central ? 12 : 4 + Math.min(d.degree * 1.5, 10);
    dims.set(d.id, { w: r * 2, h: r * 2 });
  });
}

// ── Title mode ──
function renderTitleNodes(
  node: d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>,
  _data: GraphData,
  dims: Map<string, { w: number; h: number }>,
  historyMap: Map<string, number>,
  colors: Record<string, string>,
  fontFamily: string,
  fontSize: number,
  fills: Map<string, string>
) {
  void colors.nodeBorder;
  // History color: nodes in history get orange tint, fading with recency
  // Por dónde se ha pasado, desvaneciéndose con la distancia en el rastro. El
  // color es `--warm`, el mismo token que usa el resto de la interfaz para lo
  // que pide atención sin ser un error.
  const historyColor = (d: GraphNode): string | null => {
    const idx = historyMap.get(d.id.toLowerCase());
    if (idx === undefined) return null;
    const opacities = [1, 0.7, 0.5, 0.3, 0.15];
    return `color-mix(in srgb, ${colors.visited} ${(opacities[idx] ?? 0.15) * 100}%, transparent)`;
  };

  // Font size range based on user's fontSize setting
  const fMin = fontSize;
  const fMax = fontSize + 8;

  function scaledTitleFontSize(d: GraphNode): number {
    if (d.central) return fMax;
    const count = d.blockCount ?? BLOCKS_MIN;
    const t = Math.min(1, Math.max(0, (count - BLOCKS_MIN) / (BLOCKS_MAX - BLOCKS_MIN)));
    return fMin + (fMax - fMin) * Math.sqrt(t);
  }

  // Text labels with word wrap — the only visible element per node
  node.each(function (d) {
    const g = d3.select(this);
    const fs = scaledTitleFontSize(d);
    const lines = wrapText(d.name, MAX_LABEL_CHARS);
    const lineHeight = fs * 1.25;
    const yOffset = -((lines.length - 1) * lineHeight) / 2;
    const fill = historyColor(d) ?? (d.central ? colors.nodeCentral : colors.textNormal) ?? '#888';
    fills.set(d.id, fill);
    const textEl = g.append("text")
      .attr("font-size", `${fs}px`)
      .attr("font-weight", d.central ? "bold" : "normal")
      .attr("font-family", fontFamily ?? "sans-serif")
      .attr("text-anchor", "middle")
      .attr("fill", fill ?? "#333");
    lines.forEach((line, i) => {
      textEl.append("tspan")
        .attr("x", 0)
        .attr("dy", i === 0 ? `${yOffset}px` : `${lineHeight}px`)
        .text(line);
    });
  });

  // Measure bounding boxes for collision
  node.each(function (d) {
    const bbox = (this as SVGGElement).getBBox();
    dims.set(d.id, {
      w: bbox.width + PAD_X * 2,
      h: bbox.height + PAD_Y * 2,
    });
  });
}

// ── Rectangular collision force ──
// Hard constraint: text boxes must never overlap.
// Runs multiple passes per tick to fully resolve collisions.
function rectCollide(
  dims: Map<string, { w: number; h: number }>,
  padding: number
) {
  let nodes: GraphNode[] = [];
  const ITERATIONS = 4; // passes per tick for convergence

  function force(_alpha: number) {
    for (let iter = 0; iter < ITERATIONS; iter++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i] as any;
          const b = nodes[j] as any;

          const da = dims.get(a.id) ?? { w: 40, h: 16 };
          const db = dims.get(b.id) ?? { w: 40, h: 16 };

          const halfW = (da.w + db.w) / 2 + padding;
          const halfH = (da.h + db.h) / 2 + padding;

          let dx = b.x - a.x;
          let dy = b.y - a.y;

          // Prevent exact overlap (jitter escape)
          if (dx === 0 && dy === 0) {
            dx = (Math.random() - 0.5) * 2;
            dy = (Math.random() - 0.5) * 2;
          }

          const overlapX = halfW - Math.abs(dx);
          const overlapY = halfH - Math.abs(dy);

          if (overlapX > 0 && overlapY > 0) {
            // Push along the axis with less overlap (full resolution)
            if (overlapX < overlapY) {
              const shift = overlapX * 0.5;
              const sx = dx > 0 ? shift : -shift;
              if (!a.fx) a.x -= sx;
              if (!b.fx) b.x += sx;
            } else {
              const shift = overlapY * 0.5;
              const sy = dy > 0 ? shift : -shift;
              if (!a.fy) a.y -= sy;
              if (!b.fy) b.y += sy;
            }
          }
        }
      }
    }
  }

  force.initialize = (n: GraphNode[]) => {
    nodes = n;
  };

  return force;
}

// ── Drag behavior ──
function drag(simulation: d3.Simulation<GraphNode, undefined>, remember: () => void) {
  return d3
    .drag<SVGGElement, GraphNode>()
    .on("start", (event, d: any) => {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    })
    .on("drag", (event, d: any) => {
      d.fx = event.x;
      d.fy = event.y;
    })
    .on("end", (event, d: any) => {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
      remember();
    });
}
