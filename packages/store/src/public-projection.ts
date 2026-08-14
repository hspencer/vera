// Proyección pública estática.
//
// No es una variante de projectGraph: aquella proyección es un espejo privado
// y reconstruible. Esta cara sólo recibe páginas declaradas públicas y produce
// HTML sin identificadores internos, manifiesto, API ni acceso a la base.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderMarkdown } from '@vera/core';
import type { Block, Page, VeraGraph } from '@vera/core';

export interface PublicProjectionOptions {
  canonicalDomain: string;
  siteTitle: string;
}

export interface PublicProjectionSummary {
  pages: number;
  files: string[];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function publicPathFor(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug === '' ? 'pagina' : slug;
}

function canonical(domain: string, path: string): string {
  return `${domain.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

function sorted(blocks: Block[]): Block[] {
  return [...blocks].sort(
    (a, b) => a.position - b.position || a.stableId.localeCompare(b.stableId),
  );
}

function renderBlocks(graph: VeraGraph, page: Page): string {
  const byParent = new Map<string | null, Block[]>();
  for (const block of graph.blocksOf(page.id)) {
    const siblings = byParent.get(block.parent) ?? [];
    siblings.push(block);
    byParent.set(block.parent, siblings);
  }

  const render = (parent: string | null): string => {
    const children = sorted(byParent.get(parent) ?? []);
    if (children.length === 0) return '';
    return `<ul>${children
      .map((block) => `<li>${renderMarkdown(block.content)}${render(block.stableId)}</li>`)
      .join('')}</ul>`;
  };
  return render(null);
}

function document(input: {
  title: string;
  siteTitle: string;
  canonicalUrl: string;
  body: string;
}): string {
  const title = escapeHtml(input.title);
  const site = escapeHtml(input.siteTitle);
  const url = escapeHtml(input.canonicalUrl);
  return [
    '<!doctype html>',
    '<html lang="es">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${title} · ${site}</title>`,
    `<link rel="canonical" href="${url}">`,
    '<meta name="robots" content="index,follow">',
    '</head>',
    '<body>',
    input.body,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function clear(target: string): void {
  let entries: string[] = [];
  try {
    entries = readdirSync(target);
  } catch {
    return;
  }
  for (const entry of entries) rmSync(join(target, entry), { recursive: true, force: true });
}

export function projectPublicSite(
  graph: VeraGraph,
  target: string,
  options: PublicProjectionOptions,
): PublicProjectionSummary {
  mkdirSync(target, { recursive: true });
  clear(target);

  const pages = graph
    .pages()
    .filter((page) => page.visibility === 'public')
    .sort((a, b) => a.title.localeCompare(b.title));
  const files: string[] = [];
  const occupiedPaths = new Map<string, string>();

  for (const page of pages) {
    const path = publicPathFor(page.title);
    const occupiedBy = occupiedPaths.get(path);
    if (occupiedBy !== undefined) {
      throw new Error(`public path collision: ${occupiedBy} and ${page.title} both become /${path}/`);
    }
    occupiedPaths.set(path, page.title);
    const directory = join(target, path);
    mkdirSync(directory, { recursive: true });
    const relative = `${path}/index.html`;
    writeFileSync(
      join(target, relative),
      document({
        title: page.title,
        siteTitle: options.siteTitle,
        canonicalUrl: canonical(options.canonicalDomain, `${path}/`),
        body: `<main><h1>${escapeHtml(page.title)}</h1>${renderBlocks(graph, page)}</main>`,
      }),
      'utf8',
    );
    files.push(relative);
  }

  const links = pages
    .map((page) => `<li><a href="./${publicPathFor(page.title)}/">${escapeHtml(page.title)}</a></li>`)
    .join('');
  writeFileSync(
    join(target, 'index.html'),
    document({
      title: options.siteTitle,
      siteTitle: options.siteTitle,
      canonicalUrl: canonical(options.canonicalDomain, ''),
      body: `<main><h1>${escapeHtml(options.siteTitle)}</h1><ul>${links}</ul></main>`,
    }),
    'utf8',
  );
  files.unshift('index.html');

  return { pages: pages.length, files };
}
