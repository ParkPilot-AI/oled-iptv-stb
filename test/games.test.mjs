import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGames, exeFromRegistry, windowsCandidates, GFN_APP_ID } from '../electron/games.js';

function rig({ platform = 'linux', installed = true, exists = () => false, reg = null, stillRunning = [] } = {}) {
  const log = [];
  const kids = [];
  const ui = {
    hide: () => log.push('hide'),
    show: () => log.push('show'),
    stopPlayer: async () => log.push('stopPlayer'),
    send: (ch, d) => log.push(`${ch}:${JSON.stringify(d)}`),
  };
  const g = createGames({
    platform,
    ui,
    env: { LOCALAPPDATA: 'C:\\Users\\tv\\AppData\\Local' },
    exists,
    exec: async (cmd, args) => {
      log.push(`exec ${cmd} ${args.join(' ')}`);
      if (cmd === 'flatpak') return installed ? { code: 0, stdout: '     Version: 2.0.80\n' } : { code: 1, stdout: '' };
      if (cmd === 'reg') return reg ? { code: 0, stdout: reg } : { code: 1, stdout: '' };
      return { code: 1, stdout: '' };
    },
    spawn: (cmd, args) => {
      log.push(`spawn ${cmd} ${args.join(' ')}`);
      const c = new EventEmitter();
      c.kill = () => c.emit('exit', 0);
      kids.push(c);
      return c;
    },
    isRunningWin: async () => stillRunning.shift() ?? false,
    sleep: async () => {},
  });
  return { g, log, kids };
}

test('Linux: launch hides ONYX, stops playback, runs the Flatpak; exit brings ONYX back', async () => {
  const { g, log, kids } = rig();
  assert.deepEqual(await g.status(), { platform: 'linux', installed: true, version: '2.0.80', flatpak: true, running: false });
  await g.launch();
  assert.ok(g.isRunning());
  assert.deepEqual(log.slice(-4), ['stopPlayer', `spawn flatpak run ${GFN_APP_ID}`, 'hide', 'games:state:{"running":true}']);
  assert.deepEqual(await g.launch(), { running: true }); // a second press does nothing
  assert.equal(kids.length, 1);
  kids[0].emit('exit', 0);
  await new Promise((r) => setImmediate(r));
  assert.ok(!g.isRunning());
  assert.deepEqual(log.slice(-2), ['show', 'games:state:{"running":false,"code":0}']);
});

test('Linux: not installed → launch refuses; spawn error also restores ONYX', async () => {
  await assert.rejects(rig({ installed: false }).g.launch(), /Install GeForce NOW first/);
  const { g, log, kids } = rig();
  await g.launch();
  kids[0].emit('error', new Error('ENOENT'));
  assert.deepEqual(log.slice(-2), ['show', 'games:state:{"running":false,"code":-1}']);
});

test('Windows: found via registry or usual path, waits for the real app to exit', async () => {
  const reg = '    DisplayIcon    REG_SZ    "C:\\Users\\tv\\AppData\\Local\\NVIDIA Corporation\\GeForceNOW\\CEF\\GeForceNOW.exe",0\n';
  const exe = 'C:\\Users\\tv\\AppData\\Local\\NVIDIA Corporation\\GeForceNOW\\CEF\\GeForceNOW.exe';
  assert.equal(exeFromRegistry(reg), exe);
  assert.equal(exeFromRegistry('    InstallLocation    REG_SZ    D:\\Apps\\GFN\n'), 'D:\\Apps\\GFN\\CEF\\GeForceNOW.exe');
  assert.deepEqual(windowsCandidates({ LOCALAPPDATA: 'C:\\L' }), ['C:\\L\\NVIDIA Corporation\\GeForceNOW\\CEF\\GeForceNOW.exe']);
  const { g, log, kids } = rig({ platform: 'win32', reg, exists: (p) => p === exe, stillRunning: [true, true, false] });
  const st = await g.status();
  assert.equal(st.installed, true);
  await g.launch();
  kids[0].emit('exit', 0); // launcher hands over and exits at once
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(log.filter((l) => l === 'show').length, 1);
  assert.ok(!g.isRunning());
  const none = rig({ platform: 'win32' });
  const s2 = await none.g.status();
  assert.equal(s2.installed, false);
  assert.match(s2.downloadUrl, /nvidia\.com\/.*geforce-now\/download/);
});
