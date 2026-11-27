// Integration test: drives a real mpv (headless, null outputs) over JSON IPC.
// Skipped automatically when mpv/ffmpeg are not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { Mpv, buildMpvArgs, makeIpcPath, resolveMpvBinary, INPUT_CONF } from '../electron/mpv.js';

const binary = resolveMpvBinary();
let hasFfmpeg = true;
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  hasFfmpeg = false;
}

test('mpv IPC: load, observe, seek, pause, eof, client-message', { skip: !binary || !hasFfmpeg, timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpvtest-'));
  const clip = path.join(dir, 'clip.ts');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'ac3', clip]);
  const inputConf = path.join(dir, 'input.conf');
  fs.writeFileSync(inputConf, INPUT_CONF);
  const ipcPath = makeIpcPath();
  const args = buildMpvArgs({ ipcPath, inputConf, hwdec: 'no' }).filter((a) => !a.startsWith('--vo=') && a !== '--fullscreen');
  const mpv = new Mpv({ binary, ipcPath, args: [...args, '--vo=null', '--ao=null'] });
  await mpv.start();

  const props = {};
  mpv.on('property', (n, v) => (props[n] = v));
  const events = [];
  mpv.on('event', (e) => events.push(e));
  const waitFor = (pred, ms = 15000) =>
    new Promise((res, rej) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (pred()) {
          clearInterval(iv);
          res();
        } else if (Date.now() - t0 > ms) {
          clearInterval(iv);
          rej(new Error('timeout'));
        }
      }, 50);
    });

  await mpv.load(clip, { start: 1 });
  await waitFor(() => events.some((e) => e.event === 'file-loaded'));
  await waitFor(() => props['video-params']?.w === 1280 && props['audio-codec-name']);
  assert.equal(props['video-codec']?.toLowerCase().includes('h264') || props['video-codec']?.toLowerCase().includes('264'), true);
  assert.equal(props['audio-codec-name'], 'ac3');
  assert.ok(props['time-pos'] >= 0.9, `resume start honoured (time-pos ${props['time-pos']})`);

  await mpv.command('cycle', 'pause');
  await waitFor(() => props.pause === true);
  await mpv.set('pause', false);

  // Key bindings route back to us as client-message events.
  const msg = new Promise((r) => mpv.once('client-message', r));
  await mpv.command('keypress', 'UP');
  assert.deepEqual(await msg, ['iptv-key', 'ArrowUp']);

  await waitFor(() => events.some((e) => e.event === 'end-file' && e.reason === 'eof'));
  assert.equal(await mpv.get('idle-active'), true, 'stays alive idle after eof (force-window/idle)');

  await mpv.quit();
  assert.equal(mpv.alive, false);
  fs.rmSync(dir, { recursive: true, force: true });
});
