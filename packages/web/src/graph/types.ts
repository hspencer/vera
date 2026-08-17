// Forma del grafo. Es exactamente lo que devuelve GET /graph/:id del servidor,
// y exactamente lo que consumen renderGraph y renderGraph3D, trasplantados de
// logseq-constel sin adaptación.

import type { SimulationNodeDatum } from 'd3';

export interface GraphNode extends SimulationNodeDatum {
  id: string;
  name: string;
  central: boolean;
  /** La página declara que el orden de sus bloques es un argumento. */
  trail?: boolean;
  degree: number;
  properties?: Record<string, unknown>;
  blockCount?: number;
  matched?: boolean;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}
