import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');
const taskPress = source.slice(
  source.indexOf("box.addEventListener('click'", source.indexOf("box.className = 'task-box'")),
  source.indexOf('body.append(box)', source.indexOf("box.className = 'task-box'")),
);

describe('marcar una tarea en una página larga', () => {
  it('actualiza la casilla presente sin redibujar la página', () => {
    assert.match(taskPress, /row\.classList\.add\(`task-\$\{TASK_CLASS\[state\]\}`\)/);
    assert.doesNotMatch(taskPress, /callbacks\.onReload/);
  });

  it('conserva el mismo botón enfocado y accesible para el estado siguiente', () => {
    assert.match(taskPress, /box\.setAttribute\('aria-checked'/);
    assert.match(taskPress, /box\.disabled = false/);
    assert.doesNotMatch(taskPress, /\.focus\(|scrollIntoView/);
  });
});
