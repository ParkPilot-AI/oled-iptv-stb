import test from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, DEFAULT_THEME } from '../src/lib/theme.js';

const HEX = /^#[0-9A-F]{6}$/i;
// Relative luminance (WCAG) of a #RRGGBB colour.
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

test('every theme is complete and its focus text is readable', () => {
  assert.ok(THEMES[DEFAULT_THEME]);
  for (const [id, t] of Object.entries(THEMES)) {
    for (const k of ['name', 'accent', 'fill', 'badge', 'ink']) assert.ok(t[k], `${id}.${k}`);
    assert.match(t.accent, HEX, id);
    assert.ok(contrast(t.accent, t.ink) >= 3, `${id}: ink on accent contrast ${contrast(t.accent, t.ink).toFixed(2)}`);
  }
});

test('bold themes glow and keep their background wash near black (OLED)', () => {
  const bold = Object.entries(THEMES).filter(([, t]) => t.bold);
  assert.ok(bold.length >= 5);
  for (const [id, t] of bold) {
    assert.ok(t.glow, id);
    assert.match(t.wash, HEX, id);
    assert.ok(lum(t.wash) < 0.01, `${id}: wash too bright`);
  }
});
