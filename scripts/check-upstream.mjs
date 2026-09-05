import { execFileSync } from 'node:child_process';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

if (process.argv.includes('--fetch')) {
  execFileSync('git', ['fetch', '--prune', 'origin'], { stdio: 'inherit' });
}

let upstream;
try {
  upstream = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}');
} catch {
  upstream = git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
}

const behind = Number(git('rev-list', '--count', `HEAD..${upstream}`));
const ahead = Number(git('rev-list', '--count', `${upstream}..HEAD`));

if (behind > 0) {
  throw new Error(`La rama está ${behind} commit(s) detrás de ${upstream}. Integra esos cambios antes de continuar.`);
}

console.log(`Rama al día con ${upstream}; ${ahead} commit(s) local(es) por delante.`);
