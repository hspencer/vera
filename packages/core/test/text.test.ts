import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { referencedTitles, retitleLinks } from '../src/text.ts';

describe('referencias con rótulo', () => {
  it('deriva el enlace del destino y no de sus palabras visibles', () => {
    assert.deepEqual(
      referencedTitles('[[VERA: Puerta MCP|agentes identificables]] y [[VERA: Puerta MCP|la puerta]]'),
      ['VERA: Puerta MCP'],
    );
  });

  it('al renombrar conserva las palabras elegidas por quien escribió', () => {
    assert.equal(
      retitleLinks('los [[VERA: Puerta MCP|agentes identificables]]', 'VERA: Puerta MCP', 'VERA: MCP'),
      'los [[VERA: MCP|agentes identificables]]',
    );
  });
});
