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
  const dims = new Map<string, { w: number; h: number }>();
  for (const node of data.nodes) {
    const rows = sentences(node);
    dims.set(node.id, { w: boxWidth, h: 48 + rows.length * foldedLineHeight });
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
  svg.call(d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.25, 2.5]).on('zoom', (event) => {
    world.attr('transform', event.transform.toString());
  }));

  const lineY = (node: GraphNode, link: GraphLink): number => {
    const pos = held.get(node.id)!;
    const dim = dims.get(node.id)!;
    const lines = sentences(node);
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
    card.append('h2')
      .attr('role', 'button')
      .attr('tabindex', 0)
      .on('click', () => onClickPage(node.id))
      .on('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') onClickPage(node.id);
      })
      .text(node.name);
    const body = card.append('div').attr('class', 'd4-lines');
    for (const line of sentences(node)) {
      const leaf = body.append('div')
        .attr('class', line.gloss ? 'd4-line gloss' : 'd4-line')
        .attr('data-block', line.block)
        .attr('tabindex', 0)
        .attr('aria-label', line.text)
        .html(renderMarkdown(line.text));
      leaf.on('pointerup', (event: PointerEvent) => {
        if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
        event.stopPropagation();
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
    }
  }
}
