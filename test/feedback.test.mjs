import test from 'node:test';
import assert from 'node:assert/strict';
import { noteInput, inputMode, SOUNDS, RUMBLES } from '../src/lib/feedback.js';
import { hintsFor, GLYPHS } from '../src/lib/hints.js';
import { BUTTON_KEYS } from '../src/lib/gamepad.js';

test('last input device: controller buttons are synthetic key events', () => {
  noteInput({ isTrusted: false });
  assert.equal(inputMode(), 'gamepad');
  noteInput({ isTrusted: true });
  assert.equal(inputMode(), 'remote');
});

test('sound and rumble specs are short and gentle', () => {
  for (const [, , ms, gain] of Object.values(SOUNDS)) assert.ok(ms <= 100 && gain <= 0.08);
  for (const [ms, s, w] of Object.values(RUMBLES)) assert.ok(ms <= 100 && s <= 0.5 && w <= 0.5);
});

test('hints follow the focused item and name the right buttons', () => {
  const card = { dataset: { fav: 'movie:12' }, closest: () => null };
  assert.deepEqual(
    hintsFor(card).map((h) => h.key),
    ['enter', 'hold', 'info', 'back']
  );
  const chan = { dataset: { fav: 'live:3' }, closest: () => null };
  assert.ok(!hintsFor(chan).some((h) => h.key === 'info')); // no trailers for channels
  const setting = { dataset: {}, closest: (s) => (s === '.settings' ? {} : null) };
  assert.deepEqual(
    hintsFor(setting).map((h) => h.key),
    ['enter', 'tabs', 'back']
  );
  assert.ok(hintsFor(null, { docked: true }).some((h) => h.key === 'play'));
  // Glyphs match the controller mapping: Y opens info/trailer, X plays/pauses.
  assert.equal(GLYPHS.gamepad.info, 'Y');
  assert.equal(BUTTON_KEYS[3], 'i');
  assert.equal(BUTTON_KEYS[2], ' ');
});
