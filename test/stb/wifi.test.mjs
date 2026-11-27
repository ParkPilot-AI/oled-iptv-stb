// stb-update wifi … against a fake nmcli (NetworkManager) with realistic output.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const SCRIPT = path.resolve('stb/overlay/airootfs/root/stb-files/stb-update');
const skip = process.platform !== 'linux' || spawnSync('sh', ['-c', 'command -v jq']).status !== 0;

const FAKE_NMCLI = String.raw`#!/bin/bash
echo "$*" >> "$DIR/calls"
state=$(cat "$STATE" 2>/dev/null || echo disconnected)
args="$*"
case "$args" in
  "radio wifi on") ;;
  "dev wifi rescan"*) ;;
  "-g GENERAL.STATE dev show wlan0") [[ $state == connected ]] && echo "100 (connected)" || echo "30 (disconnected)";;
  "-g GENERAL.CONNECTION dev show wlan0") [[ $state == connected ]] && echo "Zyxel_D41A" || echo "";;
  "-g IP4.ADDRESS dev show wlan0") [[ $state == connected ]] && echo "192.168.1.42/24";;
  "-t -f IN-USE,SIGNAL dev wifi list ifname wlan0 --rescan no") [[ $state == connected ]] && echo "*:74"; echo " :52";;
  "-t -f IN-USE,SSID,SECURITY,SIGNAL dev wifi list ifname wlan0 --rescan no")
    m=' '; [[ $state == connected ]] && m='*'
    echo "$m:Zyxel_D41A:WPA2:74"
    echo " :Zyxel_D41A:WPA2:60"
    echo " :PLUSNET-S9C923:WPA1 WPA2:52"
    echo " :Cafe\: Free WiFi::31"
    echo " :--:WPA2:20";;
  "dev wifi connect Zyxel_D41A password right ifname wlan0") echo connected > "$STATE"; echo "Device 'wlan0' successfully activated";;
  "dev wifi connect"*) echo "Error: Connection activation failed: Secrets were required, but not provided." >&2; exit 4;;
  "connection delete id"*) [[ "$args" == *Zyxel_D41A* && -n "$FORGET" ]] && echo disconnected > "$STATE";;
esac
`;

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stbnm-'));
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(path.join(dir, 'bin', 'nmcli'), FAKE_NMCLI, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'bin', 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return { dir, env: { ...process.env, STB_PATH_PREFIX: path.join(dir, 'bin'), STB_WIFI_DEV: 'wlan0', STATE: path.join(dir, 'state'), DIR: dir } };
}
const run = (env, args, input = '') =>
  new Promise((resolve) => {
    const p = spawn('bash', [SCRIPT, 'wifi', ...args], { env });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stdin.end(input);
    p.on('close', (code) => resolve({ code, json: out.trim() ? JSON.parse(out.trim().split('\n').pop()) : null, out }));
  });

test('scan: dedupes, keeps strongest, parses escaped colons and open networks', { skip }, async () => {
  const { env } = setup();
  const r = await run(env, ['scan']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.state, 'disconnected');
  assert.deepEqual(r.json.networks.map((n) => [n.ssid, n.security, n.signal]), [
    ['Zyxel_D41A', 'WPA2', 74],
    ['PLUSNET-S9C923', 'WPA1 WPA2', 52],
    ['Cafe: Free WiFi', 'open', 31],
  ]);
});

test('connect wrong → error; right → connected; forget', { skip }, async () => {
  const { env, dir } = setup();
  const bad = await run(env, ['connect', 'Zyxel_D41A'], 'wrong\n');
  assert.notEqual(bad.code, 0);
  assert.match(bad.json.error, /Secrets were required/);
  const ok = await run(env, ['connect', 'Zyxel_D41A'], 'right\n');
  assert.equal(ok.code, 0, ok.out);
  assert.equal(ok.json.state, 'connected');
  assert.equal(ok.json.ssid, 'Zyxel_D41A');
  assert.equal(ok.json.ip, '192.168.1.42');
  assert.equal(ok.json.signal, 74);
  const scan = await run(env, ['scan']);
  assert.equal(scan.json.networks[0].connected, true);
  const f = await run({ ...env, FORGET: '1' }, ['forget', 'Zyxel_D41A']);
  assert.equal(f.json.state, 'disconnected');
  assert.match(fs.readFileSync(path.join(dir, 'calls'), 'utf8'), /connection delete id Zyxel_D41A/);
});
