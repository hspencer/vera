import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const invitation = readFileSync(new URL('../src/shared-access.ts', import.meta.url), 'utf8');

describe('entrada por invitación', () => {
  it('lleva consigo el estilo crítico aunque falle la hoja del armazón', () => {
    assert.match(invitation, /invitation-critical-style/);
    assert.match(invitation, /#vera-root\[data-layout='invitation'\]/);
  });

  it('reintenta la ceremonia sin volver a gastar la invitación', () => {
    assert.match(invitation, /let redeemed: any \| null = null/);
    assert.match(invitation, /redeemed \?\?= await json/);
    assert.match(invitation, /volver a intentar la passkey/);
  });
});
