import ForceGraph3D from "3d-force-graph";
// @ts-expect-error three no publica tipos propios en esta versión
import * as THREE from "three";
import type { GraphData, GraphNode } from "./types.ts";
import type { RenderSettings } from "./render";

const RING_COLOR = "#ef7a1c";

// Store active graph instance and event listeners for cleanup
let activeGraph: any = null;
let activeListeners: { target: EventTarget; event: string; fn: EventListener }[] = [];
let activeTimers: ReturnType<typeof setTimeout>[] = [];

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
    linkStroke: cssVar("--link-stroke", dark ? "#555" : "#ccc"),
    text: cssVar("--text", dark ? "#d4d4d4" : "#333"),
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

  // Create billboard sprite for each node: centered circle behind text, always facing camera
  function createNodeSprite(node: any): THREE.Group {
    const size = nodeSize(node);
    const color = nodeColor(node);
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
    const circleRadius = size * dpr * 12;
    const padding = 8 * dpr;
    const hPad = 36 * dpr;

    const totalWidth = Math.max(circleRadius * 2, maxLineW + hPad) + padding * 2;
    const totalHeight = Math.max(circleRadius * 2, textBlockH) + padding * 2;
    canvas.width = totalWidth;
    canvas.height = totalHeight;

    const cx = totalWidth / 2;
    const cy = totalHeight / 2;

    // Re-set font after resize
    ctx.font = fontStr;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    // Draw circle behind text if nodes visible
    if (showNodes) {
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(cx, cy, circleRadius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }

    // Draw text with opaque background pill for legibility
    if (showTitles && lines.length > 0) {
      const pillH = textBlockH + 12 * dpr;
      const pillW = maxLineW + hPad;
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = dark ? "rgba(30,30,30,0.9)" : "rgba(255,255,255,0.9)";
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

      ctx.globalAlpha = 1.0;
      ctx.fillStyle = textColor;
      const startY = cy - ((lines.length - 1) * lineHeight) / 2;
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i] ?? '', cx, startY + i * lineHeight);
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
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

  const graph = new ForceGraph3D(container, { controlType: "orbit" })
    .width(width)
    .height(height)
    .backgroundColor("rgba(0,0,0,0)")
    .graphData({ nodes: nodes3d, links: links3d })
    .nodeThreeObject((node: any) => createNodeSprite(node))
    .nodeThreeObjectExtend(false)
    .linkColor(() => showEdges ? colors.linkStroke : "rgba(0,0,0,0)")
    .linkOpacity(showEdges ? 0.4 : 0)
    .linkWidth(showEdges ? 0.5 : 0)
    .onNodeClick((node: any) => {
      if (node?.name) onClickPage(node.name);
    })
    .onNodeHover((node: any) => {
      container.style.cursor = node ? "pointer" : "default";
    })
    .enableNavigationControls(true);

  // Encuadrar a los 500 ms dejaba la cámara dentro del cúmulo: a esa altura los
  // nodos siguen casi encima del origen, la simulación los separa después y ya
  // no había vuelta atrás, porque zoomToFit sólo aleja la cámara en la
  // dirección en que ya mira y desde el centro esa dirección es degenerada.
  // Por eso cada encuadre parte de una posición conocida, y se encuadra otra
  // vez cuando la simulación se detiene, que es cuando el grafo ya tiene su
  // tamaño definitivo.
  let moved = false;
  const noteInteraction = (): void => {
    moved = true;
  };
  container.addEventListener("pointerdown", noteInteraction);
  container.addEventListener("wheel", noteInteraction, { passive: true });

  const fit = (): void => {
    // Encuadrar por encima de la mano del usuario sería quitarle el grafo.
    if (moved) return;
    graph.cameraPosition({ x: 0, y: 0, z: 400 }, { x: 0, y: 0, z: 0 }, 0);
    // El reencuadre va en el turno siguiente: pedido de inmediato, zoomToFit
    // calcula la dirección con la posición anterior de la cámara, y si esa
    // quedó dentro del cúmulo el encuadre no sale de ahí.
    activeTimers.push(
      setTimeout(() => {
        if (!moved) graph.zoomToFit(400, 60);
      }, 80),
    );
  };

  // Un único encuadre, cuando la simulación se detiene y el grafo ya tiene su
  // tamaño definitivo. Encuadrar antes no es adelantar el resultado: mientras
  // los nodos siguen encimados, el encuadre acerca la cámara al centro del
  // cúmulo y ahí se queda hasta que la simulación termina.
  activeTimers = [];
  graph.onEngineStop(fit);

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
