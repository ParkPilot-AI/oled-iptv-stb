// stb-update games … against a stub flatpak.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const SCRIPT = path.resolve('stb/overlay/airootfs/root/stb-files/stb-update');
const skip = process.platform !== 'linux' || spawnSync('sh', ['-c', 'command -v jq && command -v flock']).status !== 0;

const FAKE_FLATPAK = `#!/bin/sh
echo "flatpak $*" >> "$DIR/log"
case "$1" in
  info) [ -f "$DIR/installed" ] || exit 1; printf 'GeForce NOW - Cloud gaming\\n\\n          ID: com.nvidia.geforcenow\\n     Version: 2.0.80\\n' ;;
  remote-add) [ -f "$DIR/offline" ] && exit 1; exit 0 ;;
  install) touch "$DIR/installed" ;;
  update) exit 0 ;;
esac`;

function setup({ flatpak = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stbgfn-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  if (flatpak) fs.writeFileSync(path.join(bin, 'flatpak'), FAKE_FLATPAK, { mode: 0o755 });
  // Hide any real flatpak on this machine when testing "not installed".
  const env = { ...process.env, DIR: dir, STB_PATH_PREFIX: bin, STB_LOCK: path.join(dir, 'lock'), STB_UPDATE_LOG: path.join(dir, 'update.log') };
  if (!flatpak) env.PATH = bin; // the script prepends /usr/bin anyway; test relies on no system flatpak
  return { dir, env, log: () => (fs.existsSync(path.join(dir, 'log')) ? fs.readFileSync(path.join(dir, 'log'), 'utf8') : '') };
}

const run = (env, args) =>
  new Promise((resolve) => {
    const p = spawn('bash', [SCRIPT, 'games', ...args], { env });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
const lastJson = (out) => JSON.parse(out.trim().split('\n').pop());

test('status before and after install; install adds Flathub + NVIDIA remotes system-wide', { skip }, async () => {
  const s = setup();
  assert.deepEqual(lastJson((await run(s.env, ['status'])).out), { installed: false, version: null, flatpak: true });
  const r = await run(s.env, ['install']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /@@ STEP Adding NVIDIA's GeForce NOW repository/);
  assert.match(r.out, /@@ STEP Installed GeForce NOW 2.0.80/);
  assert.equal(r.out.trim().split('\n').pop(), '@@ DONE');
  const log = s.log();
  assert.match(log, /flatpak remote-add --system --if-not-exists flathub https:\/\/dl.flathub.org\/repo\/flathub.flatpakrepo/);
  assert.match(
    log,
    /flatpak remote-add --system --if-not-exists GeForceNOW https:\/\/international.download.nvidia.com\/GFNLinux\/flatpak\/geforcenow.flatpakrepo/
  );
  assert.match(log, /flatpak install -y --noninteractive --system GeForceNOW com.nvidia.geforcenow/);
  assert.deepEqual(lastJson((await run(s.env, ['status'])).out), { installed: true, version: '2.0.80', flatpak: true });
});

test('install reports a network failure as @@ ERROR', { skip }, async () => {
  const s = setup();
  fs.writeFileSync(path.join(s.dir, 'offline'), '');
  const r = await run(s.env, ['install']);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /@@ ERROR Couldn't add Flathub/);
});

test('update only touches GeForce NOW when it is installed', { skip }, async () => {
  const s = setup();
  await run(s.env, ['update']);
  assert.doesNotMatch(s.log(), /flatpak update/);
  fs.writeFileSync(path.join(s.dir, 'installed'), '');
  const r = await run(s.env, ['update']);
  assert.match(r.out, /@@ STEP Updating GeForce NOW/);
  assert.match(s.log(), /flatpak update -y --noninteractive --system com.nvidia.geforcenow/);
});
