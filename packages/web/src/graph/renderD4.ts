import * as d3 from 'd3';
import { renderMarkdown } from '@vera/core';
import type { GraphData, GraphLink, GraphNode } from './types.ts';

type Side = -1 | 0 | 1;

const held = new Map<string, { x: number; y: number }>();

function endpoint(value: string | GraphNode): string {
  return typeof value === 'string' ? value : value.id;
}

function sentences(node: GraphNode): { block: string; text: string; gloss: boolean }[] {
  const result: { block: string; text: string; gloss: boolean }[] = [];
  for (const line of node.lines ?? []) {
    const pieces = line.content.split(/(?<=[.!?;:])\s+/u).filter(Boolean);
    for (const text of pieces) result.push({ block: line.block, text, gloss: false });
    if (line.gloss?.trim()) result.push({ block: line.block, text: line.gloss.trim(), gloss: true });
  }
  return result.length > 0 ? result : [{ block: '', text: node.name, gloss: false }];
}

function projectedSentences(
  node: GraphNode,
  data: GraphData,
): { shown: { block: string; text: string; gloss: boolean }[]; hidden: number } {
  const all = sentences(node);
  const relevant: typeof all = [];
  const seen = new Set<string>();
  for (const link of data.links) {
    if (endpoint(link.source) !== node.id || link.block == null || link.kind === 'crossing') continue;
    const candidates = all.filter((line) =>
      line.block === link.block &&
      (link.kind !== 'gloss' || line.gloss) &&
      (link.targetTitle === undefined || line.text.toLocaleLowerCase().includes(link.targetTitle.toLocaleLowerCase())),
    );
    const chosen = candidates.length > 0
      ? candidates
      : all.filter((line) => line.block === link.block && (link.kind !== 'gloss' || line.gloss));
    for (const line of chosen) {
      const key = `${line.block}\u0000${line.gloss ? 'g' : 'b'}\u0000${line.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      relevant.push(line);
    }
  }
  return { shown: relevant, hidden: Math.max(0, all.length - relevant.length) };
}

const foldedLineHeight = 11;

function sides(data: GraphData, focus: string): Map<string, Side> {
  const side = new Map<string, Side>([[focus, 0]]);
  for (const link of data.links) {
    const source = endpoint(link.source);
    const target = endpoint(link.target);
    if (target === focus) side.set(source, -1);
    if (source === focus) side.set(target, 1);
  }
  for (let pass = 0; pass < data.nodes.length; pass += 1) {
    for (const link of data.links) {
      const source = endpoint(link.source);
      const target = endpoint(link.target);
      if (!side.has(source) && side.has(target)) side.set(source, side.get(target)! || -1);
      if (!side.has(target) && side.has(source)) side.set(target, side.get(source)! || 1);
    }
  }
  for (const node of data.nodes) if (!side.has(node.id)) side.set(node.id, 1);
  return side;
}

export function renderGraphD4(
  container: HTMLElement,
  data: GraphData,
  onClickPage: (page: string) => void,
  options: { dark?: boolean; fontFamily?: string } = {},
): void {
  container.innerHTML = '';
  const focus = data.nodes.find((node) => node.central)?.id ?? data.nodes[0]?.id;
  if (focus === undefined) return;

  const width = Math.max(container.clientWidth, 960);
  const height = Math.max(container.clientHeight, 640);
  const centreX = width / 2;
  const columnGap = Math.max(360, Math.min(560, width * 0.34));
  const boxWidth = Math.max(300, Math.min(460, columnGap - 70));
  const side = sides(data, focus);
  const projections = new Map(data.nodes.map((node) => [node.id, projectedSentences(node, data)]));
  const dims = new Map<string, { w: number; h: number }>();
  for (const node of data.nodes) {
    const projection = projections.get(node.id)!;
    dims.set(node.id, {
      w: boxWidth,
      h: 48 + projection.shown.length * foldedLineHeight + (projection.hidden > 0 ? 18 : 0),
    });
  }

  const columns = new Map<number, GraphNode[]>();
  for (const node of data.nodes) {
    const degree = Math.max(0, node.distance ?? (node.central ? 0 : 1));
    const column = side.get(node.id)! * degree;
    const list = columns.get(column) ?? [];
    list.push(node);
    columns.set(column, list);
  }
  for (const [column, nodes] of columns) {
    nodes.sort((a, b) => (held.get(a.id)?.y ?? 0) - (held.get(b.id)?.y ?? 0) || a.name.localeCompare(b.name));
    const total = nodes.reduce((sum, node) => sum + dims.get(node.id)!.h, 0) + Math.max(0, nodes.length - 1) * 34;
    let y = Math.max(30, (height - total) / 2);
    for (const node of nodes) {
      const dim = dims.get(node.id)!;
      held.set(node.id, { x: centreX + column * columnGap, y: y + dim.h / 2 });
      y += dim.h + 34;
    }
  }

  const svg = d3.select(container).append('svg')
    .attr('class', 'd4-map')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('role', 'img')
    .attr('aria-label', 'D4: mapa dendrítico por grados');
  const world = svg.append('g');
  const touchStarts = new Map<number, { x: number; y: number }>();
  const movedSince = (event: PointerEvent): boolean => {
    const start = touchStarts.get(event.pointerId);
    touchStarts.delete(event.pointerId);
    return start !== undefined && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8;
  };
  svg.call(d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.25, 2.5])
    // Safari sintetiza un click al terminar un paneo táctil. Por debajo de este
    // umbral es un toque; por encima, D4 lo conserva exclusivamente como gesto
    // espacial y no deja que navegue al elemento que quedó bajo el dedo.
    .clickDistance(8)
    .on('zoom', (event) => {
    world.attr('transform', event.transform.toString());
    }));

  const lineY = (node: GraphNode, link: GraphLink): number => {
    const pos = held.get(node.id)!;
    const dim = dims.get(node.id)!;
    const lines = projections.get(node.id)!.shown;
    let index = lines.findIndex((line) =>
      line.block === link.block &&
      (link.targetTitle === undefined || line.text.toLocaleLowerCase().includes(link.targetTitle.toLocaleLowerCase())),
    );
    if (index < 0) index = Math.max(0, lines.findIndex((line) => line.block === link.block));
    return pos.y - dim.h / 2 + 48 + index * foldedLineHeight + foldedLineHeight / 2;
  };
  for (const link of data.links) {
    const source = data.nodes.find((node) => node.id === endpoint(link.source));
    const target = data.nodes.find((node) => node.id === endpoint(link.target));
    if (source === undefined || target === undefined) continue;
    const a = held.get(source.id)!;
    const b = held.get(target.id)!;
    const ad = dims.get(source.id)!;
    const bd = dims.get(target.id)!;
    const forward = a.x <= b.x;
    const x1 = a.x + (forward ? ad.w / 2 : -ad.w / 2);
    const x2 = b.x + (forward ? -bd.w / 2 : bd.w / 2);
    const y1 = lineY(source, link);
    const y2 = b.y;
    const tension = Math.max(90, Math.abs(x2 - x1) * 0.46);
    const path = world.append('path')
      .attr('class', `d4-branch ${link.kind ?? 'reference'}`)
      .attr('d', `M${x1},${y1} C${x1 + (forward ? tension : -tension)},${y1} ${x2 - (forward ? tension : -tension)},${y2} ${x2},${y2}`);
    if (link.explanation !== undefined) path.append('title').text(link.explanation);
    if (link.kind === 'crossing' && link.label?.trim()) {
      world.append('text')
        .attr('class', 'd4-relation-label')
        .attr('x', (x1 + x2) / 2)
        .attr('y', (y1 + y2) / 2 - 6)
        .attr('text-anchor', 'middle')
        .text(link.label);
    }
  }

  for (const node of data.nodes) {
    const pos = held.get(node.id)!;
    const dim = dims.get(node.id)!;
    const foreign = world.append('foreignObject')
      .attr('x', pos.x - dim.w / 2).attr('y', pos.y - dim.h / 2)
      .attr('width', dim.w).attr('height', dim.h);
    foreign.style('overflow', 'visible');
    const card = foreign.append('xhtml:article')
      .attr('class', `d4-page${node.central ? ' focus' : ''}`)
      .style('font-family', options.fontFamily ?? 'system-ui, sans-serif');
    const focusNow = (): void => {
      // La navegación trae después el nuevo vecindario, pero el gesto no debe
      // esperar dos lecturas de red para acusar recibo. Marcamos el nuevo foco
      // sobre el mapa que ya está en la mano; drawGraph lo sustituirá por el
      // vecindario canónico cuando llegue.
      world.selectAll<HTMLElement, unknown>('.d4-page').classed('focus', false);
      card.classed('focus', true);
    };
    card.append('h2')
      .attr('role', 'button')
      .attr('tabindex', 0)
      .on('click', (event: MouseEvent) => {
        if (!event.defaultPrevented) {
          focusNow();
          onClickPage(node.id);
        }
      })
      .on('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          focusNow();
          onClickPage(node.id);
        }
      })
      .text(node.name);
    const body = card.append('div').attr('class', 'd4-lines');
    const projection = projections.get(node.id)!;
    for (const line of projection.shown) {
      const leaf = body.append('div')
        .attr('class', line.gloss ? 'd4-line gloss' : 'd4-line')
        .attr('data-block', line.block)
        .attr('tabindex', 0)
        .attr('aria-label', `Ampliar: ${line.text}`);
      const content = leaf.append('div')
        .attr('class', 'd4-line-content')
        .html(renderMarkdown(line.text));
      let readingGesture: { pointer: number; y: number; scrollTop: number } | undefined;
      content.on('pointerdown', (event: PointerEvent) => {
        if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
        event.stopPropagation();
        const element = event.currentTarget as HTMLElement;
        readingGesture = { pointer: event.pointerId, y: event.clientY, scrollTop: element.scrollTop };
        element.setPointerCapture(event.pointerId);
      });
      content.on('pointermove', (event: PointerEvent) => {
        if (readingGesture?.pointer !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const element = event.currentTarget as HTMLElement;
        // El SVG debe conservar `touch-action: none` para que D4 pueda
        // desplazarse libremente. Dentro de una lectura abierta, por tanto,
        // reproducimos el scroll de manera explícita: un píxel del dedo es un
        // píxel de texto, en ambas direcciones, sin el salto del zoom al soltar.
        element.scrollTop = readingGesture.scrollTop + readingGesture.y - event.clientY;
      });
      const finishReadingGesture = (event: PointerEvent): void => {
        if (readingGesture?.pointer !== event.pointerId) return;
        event.stopPropagation();
        const element = event.currentTarget as HTMLElement;
        if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
        readingGesture = undefined;
      };
      content.on('pointerup', finishReadingGesture);
      content.on('pointercancel', finishReadingGesture);
      content.on('wheel', (event: WheelEvent) => event.stopPropagation());
      leaf.on('pointerdown', (event: PointerEvent) => {
        if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
        touchStarts.set(event.pointerId, { x: event.clientX, y: event.clientY });
      });
      leaf.on('pointerup', (event: PointerEvent) => {
        if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
        if (movedSince(event)) return;
        event.preventDefault();
        const element = event.currentTarget as HTMLElement;
        const open = element.classList.toggle('expanded');
        if (open) {
          for (const sibling of element.parentElement?.querySelectorAll('.d4-line.expanded') ?? []) {
            if (sibling !== element) sibling.classList.remove('expanded');
          }
        } else {
          element.blur();
        }
      });
      leaf.on('pointercancel', (event: PointerEvent) => {
        touchStarts.delete(event.pointerId);
      });
    }
    if (projection.hidden > 0) {
      body.append('button')
        .attr('class', 'd4-hidden-count')
        .attr('type', 'button')
        .attr('aria-label', `Abrir ${node.name}; ${projection.hidden} frases no participan en este grado`)
        .on('click', (event: MouseEvent) => {
          if (!event.defaultPrevented) {
            focusNow();
            onClickPage(node.id);
          }
        })
        .text(`${projection.hidden} frase${projection.hidden === 1 ? '' : 's'} fuera de este grado`);
    }
  }
}
