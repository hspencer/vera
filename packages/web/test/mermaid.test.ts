import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mermaidTheme } from '../src/mermaid.ts';

describe('mermaidTheme', () => {
  for (const dark of [false, true]) {
    it(`declara colores legibles para todos los textos en modo ${dark ? 'oscuro' : 'claro'}`, () => {
      const { theme, themeVariables: colors } = mermaidTheme(dark);

      assert.equal(theme, 'base');
      assert.equal(colors.primaryTextColor, colors.textColor);
      assert.equal(colors.secondaryTextColor, colors.textColor);
      assert.equal(colors.tertiaryTextColor, colors.textColor);
      assert.equal(colors.labelTextColor, colors.textColor);
      assert.equal(colors.actorTextColor, colors.textColor);
      assert.equal(colors.signalTextColor, colors.textColor);
      assert.equal(colors.noteTextColor, colors.textColor);
      assert.notEqual(colors.textColor, colors.primaryColor);
      assert.notEqual(colors.textColor, colors.secondaryColor);
      assert.notEqual(colors.textColor, colors.tertiaryColor);
    });
  }
});
