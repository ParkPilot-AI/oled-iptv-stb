// stb-update wifi … against a fake iwctl that prints iwd's real table layout.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const SCRIPT = path.resolve('stb/overlay/airootfs/root/stb-files/stb-update');
const skip = process.platform !== 'linux' || spawnSync('sh', ['-c', 'command -v jq']).status !== 0;
const E = '\x1b[0m';

const FAKE_IWCTL = `#!/bin/bash
state=$(cat "$STATE" 2>/dev/null || echo disconnected)
args="$*"
case "$args" in
  *"station wlan0 scan"*) echo scanning > "$DIR/scanned";;
  *"station wlan0 show"*)
    printf '                                 Station: wlan0\\n'
    printf '%s\\n' '--------------------------------------------------------------------------------'
    printf '  Settable  Property              Value\\n'
    printf '%s\\n' '--------------------------------------------------------------------------------'
    printf '            Scanning              no\\n'
    printf '            State                 %s\\n' "$state"
    if [[ $state == connected ]]; then
      printf '            Connected network     Zyxel_D41A\\n'
      printf '            IPv4 address          192.168.1.42\\n'
      printf '            RSSI                  -56 dBm\\n'
    fi;;
  *"get-networks rssi-dbms"*)
    printf '                               Available networks\\n'
    printf '%s\\n' '--------------------------------------------------------------------------------'
    printf '      Network name                      Security            Signal\\n'
    printf '%s\\n' '--------------------------------------------------------------------------------'
    m=' '; [[ $state == connected ]] && m='\\x1b[0m>'
    printf "  $m   \\x1b[1mZyxel_D41A\\x1b[0m                        psk                 -5600\\n"
    printf '      USNET-S9C923                      psk                 -7200\\n'
    printf '      Cafe Free WiFi                    open                -8100\\n';;
  *"--passphrase right station wlan0 connect Zyxel_D41A"*) echo connected > "$STATE";;
  *"--passphrase"*"connect"*) echo "Operation failed" ; exit 1;;
  *"known-networks"*"forget"*) echo disconnected > "$STATE";;
esac
`;

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stbwifi-'));
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(path.join(dir, 'bin', 'iwctl'), FAKE_IWCTL, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'bin', 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const env = { ...process.env, STB_PATH_PREFIX: path.join(dir, 'bin'), STB_WIFI_DEV: 'wlan0', STATE: path.join(dir, 'state'), DIR: dir };
  return { dir, env };
}
const run = (env, args, input = '') =>
  new Promise((resolve) => {
    const p = spawn('bash', [SCRIPT, 'wifi', ...args], { env });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stdin.end(input);
    p.on('close', (code) => resolve({ code, json: out.trim() ? JSON.parse(out.trim().split('\n').pop()) : null, out }));
  });

test('wifi scan lists networks strongest first', { skip }, async () => {
  const { env } = setup();
  const r = await run(env, ['scan']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.state, 'disconnected');
  assert.deepEqual(r.json.networks.map((n) => [n.ssid, n.security, n.rssi]), [
    ['Zyxel_D41A', 'psk', -56],
    ['USNET-S9C923', 'psk', -72],
    ['Cafe Free WiFi', 'open', -81],
  ]);
});

test('wifi connect with wrong then right password; status; forget', { skip }, async () => {
  const { env } = setup();
  const bad = await run(env, ['connect', 'Zyxel_D41A'], 'wrong\n');
  assert.notEqual(bad.code, 0);
  assert.match(bad.json.error, /Operation failed/);
  const ok = await run(env, ['connect', 'Zyxel_D41A'], 'right\n');
  assert.equal(ok.code, 0, ok.out);
  assert.deepEqual({ ...ok.json, driver: undefined }, { device: 'wlan0', driver: undefined, state: 'connected', ssid: 'Zyxel_D41A', ip: '192.168.1.42', rssi: -56, scanning: false });
  const scan = await run(env, ['scan']);
  assert.equal(scan.json.networks.find((n) => n.ssid === 'Zyxel_D41A').connected, true);
  const f = await run(env, ['forget', 'Zyxel_D41A']);
  assert.equal(f.json.state, 'disconnected');
});
