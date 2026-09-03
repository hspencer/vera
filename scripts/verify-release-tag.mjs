import { readFileSync } from 'node:fs';

const tag = process.env['GITHUB_REF_NAME'] ?? process.argv[2];
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

if (tag === undefined || tag.length === 0) {
  throw new Error('Falta el tag de release (GITHUB_REF_NAME o primer argumento).');
}
if (tag !== `v${version}`) {
  throw new Error(`El tag ${tag} no coincide con package.json v${version}.`);
}

console.log(`Release coherente: ${tag}`);
