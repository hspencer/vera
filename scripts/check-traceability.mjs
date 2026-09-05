import { existsSync, readdirSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const matrixUrl = new URL('docs/plan-maestro/matriz-trazabilidad.md', root);
const matrix = readFileSync(matrixUrl, 'utf8');
const specs = readdirSync(new URL('specs/', root))
  .filter((name) => name.endsWith('.allium'))
  .map((name) => name.slice(0, -'.allium'.length))
  .sort();
const rows = [...matrix.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]).sort();

const missing = specs.filter((name) => !rows.includes(name));
const extra = rows.filter((name) => !specs.includes(name));
const duplicates = rows.filter((name, index) => rows.indexOf(name) !== index);

if (missing.length || extra.length || duplicates.length) {
  const detail = [
    missing.length ? `faltan: ${missing.join(', ')}` : '',
    extra.length ? `sobran: ${extra.join(', ')}` : '',
    duplicates.length ? `duplicadas: ${[...new Set(duplicates)].join(', ')}` : '',
  ].filter(Boolean).join('; ');
  throw new Error(`La matriz no cubre exactamente specs/*.allium (${detail}).`);
}

for (const path of ['docs/plan-maestro/README.md', 'docs/test-obligations.md']) {
  const content = readFileSync(new URL(path, root), 'utf8');
  if (/\b\d+\s+specs\b|\b\d+\/\d+\s+en verde\b/.test(content)) {
    throw new Error(`${path} contiene un total efímero de specs o tests; enlaza la matriz o los comandos en vez de congelarlo.`);
  }
}

if (!existsSync(matrixUrl)) throw new Error('Falta la matriz de trazabilidad.');
console.log(`Trazabilidad completa: ${specs.length} specs, una fila por spec.`);
