import test from 'node:test';
import assert from 'node:assert/strict';
import { padStep, heldKeys, padName, REPEAT_DELAY, REPEAT_EVERY } from '../src/lib/gamepad.js';

const btn = (...on) => Array.from({ length: 17 }, (_, i) => ({ pressed: on.includes(i), value: on.includes(i) ? 1 : 0 }));
const pad = (buttons = [], axes = [0, 0]) => ({ buttons: btn(...buttons), axes });

test('A = Enter, B = Escape, D-pad and left stick = arrows, LB/RB = page', () => {
  assert.deepEqual([...heldKeys(pad([0]))], ['Enter']);
  assert.deepEqual([...heldKeys(pad([1]))], ['Escape']);
  assert.deepEqual([...heldKeys(pad([12]))], ['ArrowUp']);
  assert.deepEqual([...heldKeys(pad([], [0.9, 0.2]))], ['ArrowRight']);
  assert.deepEqual([...heldKeys(pad([], [0.1, -0.8]))], ['ArrowUp']);
  assert.deepEqual([...heldKeys(pad([], [0.3, 0.3]))], []); // dead zone
  assert.deepEqual([...heldKeys(pad([4, 5]))].sort(), ['PageDown', 'PageUp']);
});

test('press → keydown once; release → keyup; A never repeats (long-press OK works)', () => {
  let s = {};
  let r = padStep(s, pad([0]), 0);
  assert.deepEqual(r.events, [{ type: 'keydown', key: 'Enter', repeat: false }]);
  r = padStep(r.state, pad([0]), 2000);
  assert.deepEqual(r.events, []);
  r = padStep(r.state, pad([]), 2100);
  assert.deepEqual(r.events, [{ type: 'keyup', key: 'Enter', repeat: false }]);
  s = r.state;
  assert.deepEqual(s, {});
});

test('held arrow repeats after a delay, then at a steady rate', () => {
  let r = padStep({}, pad([13]), 0);
  r = padStep(r.state, pad([13]), REPEAT_DELAY - 1);
  assert.equal(r.events.length, 0);
  r = padStep(r.state, pad([13]), REPEAT_DELAY);
  assert.deepEqual(r.events, [{ type: 'keydown', key: 'ArrowDown', repeat: true }]);
  r = padStep(r.state, pad([13]), REPEAT_DELAY + REPEAT_EVERY - 1);
  assert.equal(r.events.length, 0);
  r = padStep(r.state, pad([13]), REPEAT_DELAY + REPEAT_EVERY);
  assert.equal(r.events.length, 1);
});

test('controller names are tidied', () => {
  assert.equal(padName('Microsoft X-Box Series S|X Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b12)'), 'Xbox Series S|X Controller');
  assert.equal(padName('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'), 'Xbox Wireless Controller');
  assert.equal(padName('045e-028e-Microsoft X-Box 360 pad'), 'Xbox 360 pad');
  assert.equal(padName(''), 'Game controller');
});
