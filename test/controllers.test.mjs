import test from 'node:test';
import assert from 'node:assert/strict';
import { diffGamepads, bluetoothState, connectedPadText } from '../src/lib/controllers.js';

const pad = (mac, connected, battery = null) => ({ mac, name: 'Xbox Wireless Controller', gamepad: true, connected, paired: true, battery });

test('connect / disconnect toasts only for gamepads, never on the first check', () => {
  const a = { adapter: true, devices: [pad('A', false), { mac: 'S', name: 'Speaker', gamepad: false, connected: true }] };
  const b = { adapter: true, devices: [pad('A', true, 80)] };
  assert.deepEqual(diffGamepads(null, b), []);
  assert.deepEqual(diffGamepads(a, b), ['Controller connected · Xbox Wireless Controller (80%)']);
  assert.deepEqual(diffGamepads(b, a), ['Controller disconnected · Xbox Wireless Controller']);
  assert.deepEqual(diffGamepads(b, b), []);
});

test('status line and the greyed-out reason', () => {
  assert.equal(bluetoothState({ adapter: false, devices: [] }).text, 'No Bluetooth adapter found');
  assert.equal(bluetoothState({ adapter: false, devices: [] }).enabled, false);
  assert.equal(bluetoothState({ adapter: true, blocked: true }).text, 'Blocked');
  assert.equal(bluetoothState({ adapter: true, powered: false }).text, 'Off');
  assert.deepEqual(bluetoothState({ adapter: true, powered: true }), { enabled: true, text: 'On', reason: '' });
  assert.equal(bluetoothState({ adapter: false, reason: 'windows' }).windows, true);
  assert.equal(connectedPadText({ devices: [pad('A', true, 80)] }), 'Xbox Wireless Controller connected · 80%');
  assert.equal(connectedPadText({ devices: [] }), null);
});

test('spatial navigation never lands on disabled (greyed-out) rows', async () => {
  const { SEL } = await import('../src/nav/spatial.js');
  assert.match(SEL, /\[data-focusable\]:not\(\[data-disabled\]\)/);
  const fs = await import('node:fs');
  const f = fs.readFileSync('src/components/Focusable.jsx', 'utf8');
  assert.match(f, /data-disabled=\{disabled \? '' : undefined\}/);
  assert.match(f, /onClick=\{disabled \? undefined : onSelect\}/);
});
