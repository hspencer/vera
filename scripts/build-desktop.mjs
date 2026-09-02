import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const outdir = 'dist/desktop';
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: ['packages/desktop/src/main.ts'],
  outfile: `${outdir}/main.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['electron'],
  sourcemap: true,
});

await build({
  entryPoints: ['packages/desktop/src/preload.ts'],
  outfile: `${outdir}/preload.cjs`,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  sourcemap: true,
});

copyFileSync('packages/desktop/src/setup.html', `${outdir}/setup.html`);
