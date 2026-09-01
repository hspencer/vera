import { isDateTitle } from '@vera/core';
import type { GraphData, GraphNode } from './types.ts';

function endpoint(value: string | GraphNode): string {
  return typeof value === 'string' ? value : value.id;
}

/**
 * La ley del interruptor de diarios.
 *
 * Un diario nunca es vecindad: aparece únicamente cuando él mismo es el foco y
 * la persona decidió encender los diarios. Apagarlos mientras se está mirando
 * uno deja el mapa vacío en vez de dibujar sus vecinos sin el centro que les da
 * sentido.
 */
export function journalsInMap(data: GraphData, focus: string, enabled: boolean): GraphData {
  const focused = data.nodes.find((node) => node.id === focus);
  const focusIsJournal = focused !== undefined && isDateTitle(focused.name);
  if (focusIsJournal && !enabled) return { nodes: [], links: [] };

  const nodes = data.nodes.filter((node) =>
    !isDateTitle(node.name) || (enabled && focusIsJournal && node.id === focus),
  );
  const kept = new Set(nodes.map((node) => node.id));
  const links = data.links.filter((link) =>
    kept.has(endpoint(link.source)) && kept.has(endpoint(link.target)),
  );
  return { nodes, links };
}
