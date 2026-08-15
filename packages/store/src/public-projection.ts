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
  /** Páginas que una publicación humana asignó explícitamente a este sitio. */
  publishedPages: ReadonlySet<string>;
  /** Página publicada cuya proyección ocupa la raíz del sitio. */
  entryPoint?: string;
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

function renderBlocks(graph: VeraGraph, page: Page, published: ReadonlyMap<string, Page>): string {
  const byParent = new Map<string | null, Block[]>();
  for (const block of graph.blocksOf(page.id)) {
    const siblings = byParent.get(block.parent) ?? [];
    siblings.push(block);
    byParent.set(block.parent, siblings);
  }

  const renderBlockMarkdown = (source: string): string =>
    renderMarkdown(source, { pageExists: (title) => published.has(title) })
      .replace(
        /<a class="wiki([^"]*) pending" data-page="[^"]*" href="#">([\s\S]*?)<\/a>/g,
        '<span class="wiki$1 unavailable">$2</span>',
      )
      .replace(
        /<a class="wiki([^"]*)" data-page="([^"]+)" href="#">([\s\S]*?)<\/a>/g,
        (_whole, extra: string, title: string, label: string) => {
          const destination = published.get(title);
          return destination === undefined
            ? `<span class="wiki${extra} unavailable">${label}</span>`
            : `<a class="wiki${extra}" href="/${publicPathFor(destination.title)}/">${label}</a>`;
        },
      );

  const render = (parent: string | null): string => {
    const children = sorted(byParent.get(parent) ?? []);
    if (children.length === 0) return '';
    return `<ul>${children
      .map((block) => `<li>${renderBlockMarkdown(block.content)}${render(block.stableId)}</li>`)
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
    '<style>',
    ':root{color-scheme:light dark;font-family:ui-serif,Georgia,Cambria,"Times New Roman",serif;line-height:1.58;background:#f7f5ef;color:#24231f}',
    '*{box-sizing:border-box}',
    'body{margin:0}',
    'main{max-width:48rem;margin:0 auto;padding:clamp(2rem,7vw,6rem) clamp(1.25rem,5vw,3rem) 8rem}',
    'h1{font-size:clamp(2.7rem,8vw,5rem);line-height:.95;letter-spacing:-.045em;margin:0 0 3rem}',
    'h2,h3{font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.15;letter-spacing:-.025em;margin:3rem 0 1rem}',
    'h3{font-size:clamp(1.35rem,3vw,1.75rem)}',
    'p{font-size:clamp(1.08rem,2vw,1.28rem);margin:0 0 1.35rem}',
    'strong{font-weight:700}',
    'ul{list-style:none;margin:0;padding:0}',
    'li>ul{border-left:1px solid color-mix(in srgb,currentColor 20%,transparent);padding-left:1.25rem}',
    'a{color:inherit;text-decoration-thickness:.08em;text-underline-offset:.18em}',
    '.unavailable{color:color-mix(in srgb,currentColor 72%,transparent)}',
    'nav{border-top:1px solid color-mix(in srgb,currentColor 20%,transparent);margin-top:4rem;padding-top:2rem;font-family:ui-sans-serif,system-ui,sans-serif}',
    '@media(prefers-color-scheme:dark){:root{background:#1c1b18;color:#ece8df}}',
    '</style>',
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
    .filter((page) => page.visibility === 'public' && options.publishedPages.has(page.id))
    .sort((a, b) => a.title.localeCompare(b.title));
  const files: string[] = [];
  const occupiedPaths = new Map<string, string>();
  const entryPoint =
    options.entryPoint === undefined
      ? null
      : pages.find((page) => page.id === options.entryPoint) ?? null;
  if (options.entryPoint !== undefined && entryPoint === null) {
    throw new Error('entry point must be an explicitly published public page');
  }
  const publishedByTitle = new Map(pages.map((page) => [page.title, page]));

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
        body: `<main><h1>${escapeHtml(page.title)}</h1>${renderBlocks(graph, page, publishedByTitle)}</main>`,
      }),
      'utf8',
    );
    files.push(relative);
  }

  const links = pages
    .filter((page) => page.id !== entryPoint?.id)
    .map((page) => `<li><a href="./${publicPathFor(page.title)}/">${escapeHtml(page.title)}</a></li>`)
    .join('');
  const indexTitle = entryPoint?.title ?? options.siteTitle;
  const indexBody =
    entryPoint === null
      ? `<main><h1>${escapeHtml(options.siteTitle)}</h1><ul>${links}</ul></main>`
      : `<main><h1>${escapeHtml(entryPoint.title)}</h1>${renderBlocks(graph, entryPoint, publishedByTitle)}${
          links === '' ? '' : `<nav aria-label="Páginas publicadas"><ul>${links}</ul></nav>`
        }</main>`;
  writeFileSync(
    join(target, 'index.html'),
    document({
      title: indexTitle,
      siteTitle: options.siteTitle,
      canonicalUrl: canonical(options.canonicalDomain, ''),
      body: indexBody,
    }),
    'utf8',
  );
  files.unshift('index.html');

  return { pages: pages.length, files };
}
