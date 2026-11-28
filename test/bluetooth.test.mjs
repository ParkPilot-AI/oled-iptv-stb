import test from 'node:test';
import assert from 'node:assert/strict';
import { createBluetooth, MAC_RE } from '../electron/bluetooth.js';

const mk = (over = {}) => {
  const calls = [];
  const bt = createBluetooth({
    platform: 'linux',
    hasUpdater: () => true,
    helper: async (args) => {
      calls.push(args.join(' '));
      return { ok: true, adapter: true, devices: [] };
    },
    openExternal: async (u) => calls.push(`open ${u}`),
    ...over,
  });
  return { bt, calls };
};

test('box: commands go to stb-update bt with checked, upper-cased MACs', async () => {
  const { bt, calls } = mk();
  await bt.status();
  await bt.scan(99);
  await bt.pair('98:7a:14:00:00:02');
  await bt.forget('98:7A:14:00:00:02');
  assert.deepEqual(calls, ['bt status', 'bt scan 30', 'bt pair 98:7A:14:00:00:02', 'bt forget 98:7A:14:00:00:02']);
  await assert.rejects(bt.pair('98:7A:14:00:00:02; reboot'), /Invalid controller address/);
  assert.equal(calls.length, 4);
  assert.ok(MAC_RE.test('AA:bb:CC:dd:EE:ff'));
});

test('Windows: no adapter (reason windows) and a link to its Bluetooth settings', async () => {
  const { bt, calls } = mk({ platform: 'win32', hasUpdater: () => false });
  assert.deepEqual(await bt.status(), { adapter: false, reason: 'windows', devices: [] });
  await bt.openSystemSettings();
  assert.deepEqual(calls, ['open ms-settings:bluetooth']);
  await assert.rejects(bt.scan(), /Windows Bluetooth settings/);
});

test('helper failure on status reads as "no adapter" instead of throwing', async () => {
  const { bt } = mk({ helper: async () => Promise.reject(new Error('sudo: a password is required')) });
  const st = await bt.status();
  assert.equal(st.adapter, false);
  assert.equal(st.reason, 'error');
  const other = mk({ hasUpdater: () => false });
  assert.equal((await other.bt.status()).reason, 'unsupported');
});
