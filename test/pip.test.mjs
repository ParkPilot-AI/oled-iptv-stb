import test from 'node:test';
import assert from 'node:assert/strict';
import { pipRect, mpvGeometry } from '../electron/pip.js';

const fourK = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 2 };

test('mini-player: 16:9 in the bottom-right corner, on screen, in physical pixels', () => {
  const r = pipRect('dock', fourK);
  assert.equal(r.width, 1152); // 30 % of 3840
  assert.equal(r.height, 648);
  assert.ok(r.x + r.width < 3840 && r.y + r.height < 2160 && r.x > 1920 && r.y > 1080);
  assert.equal(mpvGeometry(r), `1152x648+${r.x}+${r.y}`);
});

test('trailer preview: larger, right-hand side, vertically centred', () => {
  const r = pipRect('peek', { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 });
  assert.equal(r.width, Math.round(1920 * 0.46));
  assert.ok(Math.abs(r.y + r.height / 2 - 540) <= 1);
  assert.ok(r.x + r.width <= 1920);
});
