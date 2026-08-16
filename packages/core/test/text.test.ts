import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { referencedTitles, retitleLinks } from '../src/text.ts';

describe('referencias con rótulo', () => {
  it('deriva el enlace del destino y no de sus palabras visibles', () => {
    assert.deepEqual(
      referencedTitles('[[Vera: Puerta MCP|agentes identificables]] y [[Vera: Puerta MCP|la puerta]]'),
      ['Vera: Puerta MCP'],
    );
  });

  it('al renombrar conserva las palabras elegidas por quien escribió', () => {
    assert.equal(
      retitleLinks('los [[Vera: Puerta MCP|agentes identificables]]', 'Vera: Puerta MCP', 'Vera: MCP'),
      'los [[Vera: MCP|agentes identificables]]',
    );
  });
});
