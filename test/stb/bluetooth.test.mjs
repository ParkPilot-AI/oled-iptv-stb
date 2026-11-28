// stb-update bt … against stub bluetoothctl / rfkill / systemctl (no real Bluetooth).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const SCRIPT = path.resolve('stb/overlay/airootfs/root/stb-files/stb-update');
const skip = process.platform !== 'linux' || spawnSync('sh', ['-c', 'command -v jq && command -v timeout']).status !== 0;

// State lives in files under $DIR: devices.tsv (mac|name|icon|paired|trusted|connected|battery),
// powered, rfkill, nearby (macs that answer pairing), log.
const FAKE_BTCTL = String.raw`#!/bin/bash
echo "bluetoothctl $*" >> "$DIR/log"
[ "$1" = "--timeout" ] && shift 2
db="$DIR/devices.tsv"
row() { grep -i "^$1|" "$db"; }
set_field() { awk -F'|' -v OFS='|' -v m="$1" -v f="$2" -v v="$3" 'toupper($1)==toupper(m){$f=v}1' "$db" > "$db.t" && mv "$db.t" "$db"; }
case "$1" in
  show) [ -f "$DIR/noctl" ] && exit 1
        echo "Controller 00:1A:7D:DA:71:13 (public)"; echo "	Powered: $(cat "$DIR/powered")"; echo "	Discovering: no" ;;
  power) echo yes > "$DIR/powered"; echo "Changing power on succeeded" ;;
  devices) while IFS='|' read -r mac name rest; do echo "Device $mac $name"; done < "$db" ;;
  info) r=$(row "$2") || { echo "Device $2 not available"; exit 1; }
        IFS='|' read -r mac name icon paired trusted connected battery <<<"$r"
        echo "Device $mac (public)"; echo "	Name: $name"; echo "	Alias: $name"; [ -n "$icon" ] && echo "	Icon: $icon"
        echo "	Paired: $paired"; echo "	Trusted: $trusted"; echo "	Connected: $connected"
        [ -n "$battery" ] && printf '	Battery Percentage: 0x%02x (%s)\n' "$battery" "$battery" ;;
  scan) [ "$2" = on ] && cat "$DIR/found" >> "$db" 2>/dev/null; : > "$DIR/found" ;;
  pair) if grep -qi "^$2$" "$DIR/nearby" 2>/dev/null; then set_field "$2" 4 yes; echo "Pairing successful"
        else echo "Device $2 not available"; exit 1; fi ;;
  trust) set_field "$2" 5 yes; echo "Changing $2 trust succeeded" ;;
  connect) if grep -qi "^$2$" "$DIR/nearby" 2>/dev/null; then set_field "$2" 6 yes; echo "Connection successful"
           else echo "Failed to connect: org.bluez.Error.Failed"; exit 1; fi ;;
  disconnect) set_field "$2" 6 no; echo "Successful disconnected" ;;
  remove) grep -vi "^$2|" "$db" > "$db.t"; mv "$db.t" "$db"; echo "Device has been removed" ;;
esac
`;

function setup({ adapter = true, powered = 'yes', rfkill = 'Soft blocked: no\nHard blocked: no' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stbbt-'));
  const bin = path.join(dir, 'bin');
  const sys = path.join(dir, 'sys');
  fs.mkdirSync(bin);
  fs.mkdirSync(sys);
  if (adapter) fs.mkdirSync(path.join(sys, 'hci0'));
  const fake = (name, body) => fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
  fake('bluetoothctl', FAKE_BTCTL);
  fake('rfkill', `#!/bin/sh\necho "rfkill $*" >> "$DIR/log"\n[ "$1" = list ] && { echo "0: hci0: Bluetooth"; cat "$DIR/rfkill"; }\n[ "$1" = unblock ] && echo "Soft blocked: no\nHard blocked: no" > "$DIR/rfkill"\nexit 0\n`);
  fake('systemctl', '#!/bin/sh\nexit 0\n');
  fake('sleep', '#!/bin/sh\nexit 0\n');
  fs.writeFileSync(path.join(dir, 'powered'), `${powered}\n`);
  fs.writeFileSync(path.join(dir, 'rfkill'), `${rfkill}\n`);
  fs.writeFileSync(path.join(dir, 'devices.tsv'), '98:7A:14:00:00:01|Xbox Wireless Controller|input-gaming|yes|yes|yes|80\nAA:BB:CC:DD:EE:01|Kitchen Speaker|audio-card|yes|yes|no|\n');
  const env = { ...process.env, STB_PATH_PREFIX: bin, STB_BT_SYS: sys, DIR: dir };
  return { dir, env, write: (f, s) => fs.writeFileSync(path.join(dir, f), s) };
}

const run = (env, args) =>
  new Promise((resolve) => {
    const p = spawn('bash', [SCRIPT, 'bt', ...args], { env });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, json: out.trim() ? JSON.parse(out.trim().split('\n').pop()) : null, out }));
  });

test('status: paired devices with battery and gamepad detection', { skip }, async () => {
  const { env } = setup();
  const r = await run(env, ['status']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.adapter, true);
  assert.equal(r.json.powered, true);
  assert.equal(r.json.blocked, false);
  assert.deepEqual(r.json.devices, [
    { mac: '98:7A:14:00:00:01', name: 'Xbox Wireless Controller', paired: true, connected: true, trusted: true, battery: 80, gamepad: true },
    { mac: 'AA:BB:CC:DD:EE:01', name: 'Kitchen Speaker', paired: true, connected: false, trusted: true, battery: null, gamepad: false },
  ]);
});

test('status: no adapter (no hci, or no controller) → adapter false', { skip }, async () => {
  assert.equal((await run(setup({ adapter: false }).env, ['status'])).json.adapter, false);
  const s = setup();
  s.write('noctl', '');
  assert.equal((await run(s.env, ['status'])).json.adapter, false);
  const p = await run(setup({ adapter: false }).env, ['pair', '98:7A:14:00:00:02']);
  assert.equal(p.json.error, 'No Bluetooth adapter found');
});

test('status: soft-blocked and powered-off adapters are switched on; hard block is reported', { skip }, async () => {
  const s = setup({ powered: 'no', rfkill: 'Soft blocked: yes\nHard blocked: no' });
  const r = await run(s.env, ['status']);
  assert.equal(r.json.powered, true);
  const log = fs.readFileSync(path.join(s.dir, 'log'), 'utf8');
  assert.match(log, /rfkill unblock bluetooth/);
  assert.match(log, /bluetoothctl power on/);
  const h = await run(setup({ rfkill: 'Soft blocked: no\nHard blocked: yes' }).env, ['status']);
  assert.equal(h.json.blocked, true);
});

test('scan: clamps time, new controllers first', { skip }, async () => {
  const s = setup();
  s.write('found', '98:7A:14:00:00:02|Xbox Wireless Controller||no|no|no|\n11:22:33:44:55:66|Phone|phone|no|no|no|\n');
  const r = await run(s.env, ['scan', '99']);
  assert.match(fs.readFileSync(path.join(s.dir, 'log'), 'utf8'), /bluetoothctl --timeout 30 scan on/);
  assert.deepEqual(
    r.json.devices.map((d) => [d.name, d.paired, d.gamepad]),
    [
      ['Xbox Wireless Controller', false, true],
      ['Phone', false, false],
      ['Xbox Wireless Controller', true, true],
      ['Kitchen Speaker', true, false],
    ]
  );
});

test('pair: success (pair, trust, connect) and a plain-English error', { skip }, async () => {
  const s = setup();
  s.write('found', '98:7A:14:00:00:02|Xbox Wireless Controller||no|no|no|\n');
  await run(s.env, ['scan', '5']);
  const bad = await run(s.env, ['pair', '98:7a:14:00:00:02']);
  assert.equal(bad.code, 1);
  assert.deepEqual(bad.json, { ok: false, error: 'Controller not in pairing mode — hold the pair button until the Xbox button flashes quickly' });
  s.write('nearby', '98:7A:14:00:00:02\n');
  const ok = await run(s.env, ['pair', '98:7a:14:00:00:02']);
  assert.equal(ok.code, 0, ok.out);
  assert.equal(ok.json.ok, true);
  assert.deepEqual([ok.json.device.paired, ok.json.device.trusted, ok.json.device.connected], [true, true, true]);
  const log = fs.readFileSync(path.join(s.dir, 'log'), 'utf8');
  assert.match(log, /pair 98:7A:14:00:00:02\n[\s\S]*trust 98:7A:14:00:00:02\n[\s\S]*connect 98:7A:14:00:00:02/);
});

test('connect / disconnect / forget', { skip }, async () => {
  const s = setup();
  const d = await run(s.env, ['disconnect', '98:7A:14:00:00:01']);
  assert.equal(d.json.device.connected, false);
  const c = await run(s.env, ['connect', '98:7A:14:00:00:01']);
  assert.equal(c.json.ok, false); // not switched on
  assert.match(c.json.error, /switch the controller on/);
  s.write('nearby', '98:7A:14:00:00:01\n');
  assert.equal((await run(s.env, ['connect', '98:7A:14:00:00:01'])).json.device.connected, true);
  assert.deepEqual((await run(s.env, ['forget', '98:7A:14:00:00:01'])).json, { ok: true });
  assert.equal((await run(s.env, ['status'])).json.devices.length, 1);
});

test('MAC addresses are validated before any command runs', { skip }, async () => {
  const s = setup();
  for (const bad of ['98:7A:14:00:00', '98:7A:14:00:00:0G', '98:7A:14:00:00:01; reboot', '$(id)', '']) {
    const r = await run(s.env, ['pair', bad]);
    assert.deepEqual(r.json, { ok: false, error: 'Invalid controller address' }, bad);
  }
  const log = fs.existsSync(path.join(s.dir, 'log')) ? fs.readFileSync(path.join(s.dir, 'log'), 'utf8') : '';
  assert.doesNotMatch(log, /pair|reboot|id/);
});
