// Exercises stb/…/stb-update against a fake GitHub API and fake pacman tools.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync, spawn } from 'node:child_process';

const SCRIPT = path.resolve('stb/overlay/airootfs/root/stb-files/stb-update');
const have = (c) => spawnSync('sh', ['-c', `command -v ${c}`]).status === 0;
const skip = !['jq', 'zstd', 'curl', 'flock', 'bash'].every(have) || process.platform !== 'linux';

function setup({ latest = '2026.11.27-new', corrupt = false, withApp = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stbupd-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const fake = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  fake('pacman', `echo "pacman $*" >> "${dir}/calls"`);
  fake('checkupdates', `printf 'linux 6.1 -> 6.2\\nmpv 0.38 -> 0.39\\nmesa 1 -> 2\\n'`);
  fake('paccache', 'true');
  fake('systemctl', `echo "systemctl $*" >> "${dir}/calls"`);
  fake('sudo', 'exec "$@"');

  // Installed app + new build tarball
  const app = path.join(dir, 'opt', 'oled-iptv');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'stb-version.txt'), '2026.11.01-old\n');
  fs.writeFileSync(path.join(app, 'oled-iptv-player'), 'old', { mode: 0o755 });
  const build = path.join(dir, 'build');
  fs.mkdirSync(build);
  fs.writeFileSync(path.join(build, 'oled-iptv-player'), '#!/bin/sh\necho new', { mode: 0o755 });
  fs.writeFileSync(path.join(build, 'chrome-sandbox'), 'x');
  fs.writeFileSync(path.join(build, 'stb-version.txt'), `${latest}\n`);
  fs.mkdirSync(path.join(build, 'stb-system'));
  fs.writeFileSync(path.join(build, 'stb-system', 'stb-update'), '#!/bin/bash\n# new helper\n');
  fs.writeFileSync(path.join(build, 'stb-system', 'nm-stb.conf'), '[device]\n');
  const tarball = path.join(dir, 'app.tar.zst');
  execFileSync('tar', ['-C', build, '-I', 'zstd', '-cf', tarball, '.']);
  const tarBuf = fs.readFileSync(tarball);
  const sum = crypto.createHash('sha256').update(corrupt ? Buffer.from('nope') : tarBuf).digest('hex');
  const assets = {
    1: ['app-version.txt', Buffer.from(`${latest}\n`)],
    2: ['oled-iptv-app.tar.zst', tarBuf],
    3: ['SHA256SUMS', Buffer.from(`${sum}  oled-iptv-app.tar.zst\n`)],
  };
  if (!withApp) delete assets[2];
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    if (req.url === '/repos/me/box/releases/latest') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ tag_name: 'x', assets: Object.entries(assets).map(([id, [name]]) => ({ id: Number(id), name })) }));
    }
    const m = /^\/repos\/me\/box\/releases\/assets\/(\d+)$/.exec(req.url);
    if (m && assets[m[1]]) return res.end(assets[m[1]][1]);
    res.statusCode = 404;
    res.end();
  });
  const conf = path.join(dir, 'update.conf');
  return new Promise((resolve) =>
    server.listen(0, () => {
      const env = {
        ...process.env,
        STB_PATH_PREFIX: bin,
        STB_APP_DIR: app,
        STB_GITHUB_API: `http://127.0.0.1:${server.address().port}`,
        STB_UPDATE_LOG: path.join(dir, 'update.log'),
        STB_LOCK: path.join(dir, 'lock'),
        STB_ROOT: path.join(dir, 'root'),
      };
      fs.writeFileSync(conf, 'REPO="me/box"\nGITHUB_TOKEN="tok123"\n');
      // The script reads /etc/stb/update.conf; point it at ours by rewriting the path in a copy.
      const script = path.join(dir, 'stb-update');
      fs.writeFileSync(script, fs.readFileSync(SCRIPT, 'utf8').replace('CONF=/etc/stb/update.conf', `CONF=${conf}`), { mode: 0o755 });
      resolve({ dir, app, env, script, seen, close: () => server.close() });
    })
  );
}

// Async spawn: the fake GitHub server lives in this process, so we must not block the event loop.
const run = (ctx, arg) =>
  new Promise((resolve) => {
    const p = spawn('bash', [ctx.script, arg], { env: ctx.env });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (status) => resolve({ status, stdout, stderr }));
  });

test('check reports pending packages and versions', { skip }, async () => {
  const ctx = await setup();
  const r = await run(ctx, 'check');
  ctx.close();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { system: 3, appInstalled: '2026.11.01-old', appLatest: '2026.11.27-new', repo: 'me/box', hasToken: true });
  assert.ok(ctx.seen.every((s) => s.auth === 'Bearer tok123'), 'token sent to GitHub');
});

test('run updates packages, swaps the app atomically and reports', { skip }, async () => {
  const ctx = await setup();
  const r = await run(ctx, 'run');
  ctx.close();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const lines = r.stdout.split('\n').filter((l) => l.startsWith('@@ '));
  assert.ok(lines.includes('@@ APP_UPDATED 2026.11.27-new'), lines.join('\n'));
  assert.equal(lines.at(-1), '@@ DONE');
  const calls = fs.readFileSync(path.join(ctx.dir, 'calls'), 'utf8');
  assert.match(calls, /pacman -Sy --noconfirm --needed archlinux-keyring/);
  assert.match(calls, /pacman -Su --noconfirm/);
  assert.equal(fs.readFileSync(path.join(ctx.app, 'stb-version.txt'), 'utf8').trim(), '2026.11.27-new');
  assert.equal(fs.readFileSync(path.join(ctx.app + '.old', 'stb-version.txt'), 'utf8').trim(), '2026.11.01-old');
  assert.ok(fs.statSync(path.join(ctx.app, 'chrome-sandbox')).mode & 0o4000, 'setuid sandbox');
  // Box helpers shipped inside the app are installed too.
  assert.match(fs.readFileSync(path.join(ctx.dir, 'root/usr/local/sbin/stb-update'), 'utf8'), /new helper/);
  assert.ok(fs.statSync(path.join(ctx.dir, 'root/usr/local/sbin/stb-update')).mode & 0o100, 'helper executable');
  assert.ok(fs.existsSync(path.join(ctx.dir, 'root/etc/NetworkManager/conf.d/stb.conf')));
});

test('corrupt download is rejected and the old app is kept', { skip }, async () => {
  const ctx = await setup({ corrupt: true });
  const r = await run(ctx, 'run');
  ctx.close();
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /@@ ERROR App download is corrupt/);
  assert.equal(fs.readFileSync(path.join(ctx.app, 'stb-version.txt'), 'utf8').trim(), '2026.11.01-old');
});

test('already up to date → no swap', { skip }, async () => {
  const ctx = await setup({ latest: '2026.11.01-old' });
  const r = await run(ctx, 'run');
  ctx.close();
  assert.equal(r.status, 0);
  assert.match(r.stdout, /@@ STEP App is up to date/);
  assert.ok(!fs.existsSync(ctx.app + '.old'));
});
