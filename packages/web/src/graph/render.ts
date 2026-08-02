import * as d3 from "d3";
import type { GraphData, GraphLink, GraphNode } from "./types.ts";

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
const MAX_LABEL_CHARS = 70;

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
  const style = settings.nodeStyle ?? "circular";

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
  const colors = {
    nodeCentral: cssVar("--node-central", dark ? "#4a9ade" : "#045591"),
    nodeFill: cssVar("--node-fill", dark ? "#777" : "#999"),
    nodeBorder: cssVar("--border", dark ? "#555" : "#ddd"),
    textCentral: cssVar("--text", dark ? "#d4d4d4" : "#333"),
    textNormal: cssVar("--text", dark ? "#d4d4d4" : "#333"),
    linkStroke: cssVar("--link-stroke", dark ? "#555" : "#ccc"),
    hoverAccent: cssVar("--accent", dark ? "#4a9ade" : "#045591"),
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

  if (style === "title") {
    renderTitleNodes(node, data, dims, historyMap, colors, fontFamily, fontSize);
  } else {
    renderCircularNodes(node, data, dims, historyMap, colors, showNodes, showTitles, fontSize);
  }

  // Accessibility: make nodes focusable
  node
    .attr("tabindex", 0)
    .attr("role", "link")
    .attr("aria-label", (d) => d.name);

  // Click and keyboard navigation
  node.on("click", (_event, d) => onClickPage(d.name));
  node.on("keydown", (_event, d) => {
    const e = _event as KeyboardEvent;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClickPage(d.name);
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

  // Simulation — title mode needs more space and stronger repulsion
  const isTitle = style === "title";
  const collisionForce = isTitle
    ? rectCollide(dims, 4)
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

  sim.on("tick", () => {
    link
      .attr("x1", (d: any) => d.source.x)
      .attr("y1", (d: any) => d.source.y)
      .attr("x2", (d: any) => d.target.x)
      .attr("y2", (d: any) => d.target.y);
    node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
  });

  node.call(drag(sim) as any);
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
  fontSize: number
) {
  // History color: nodes in history get orange tint, fading with recency
  const historyColor = (d: GraphNode): string | null => {
    const idx = historyMap.get(d.id.toLowerCase());
    if (idx === undefined) return null;
    const opacities = [1.0, 0.7, 0.5, 0.3, 0.15];
    return `rgba(239, 122, 28, ${opacities[idx]})`;
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
    const fill = historyColor(d) ?? (d.central ? colors.nodeCentral : colors.textNormal);
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
function drag(simulation: d3.Simulation<GraphNode, undefined>) {
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
    });
}
