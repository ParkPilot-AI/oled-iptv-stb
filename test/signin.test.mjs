import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDropped, isLoopback, plainUserAgent, watchSignin, signinDir } from '../electron/signin.js';

test('only http(s) addresses are accepted', () => {
  assert.equal(parseDropped('https://login.nvidia.com/x?a=1&b=2\n'), 'https://login.nvidia.com/x?a=1&b=2');
  assert.equal(parseDropped('file:///etc/passwd'), null);
  assert.equal(parseDropped('javascript:alert(1)'), null);
  assert.equal(parseDropped('not a url'), null);
});

test('loopback callback detection and plain user agent', () => {
  assert.ok(isLoopback('http://localhost:12345/callback?code=x'));
  assert.ok(isLoopback('http://127.0.0.1:8080/'));
  assert.ok(!isLoopback('https://login.nvidia.com/'));
  assert.equal(
    plainUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) oled-iptv-player/1.2.1 Chrome/140.0.0.0 Electron/45.0.0 Safari/537.36'
    ),
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
  );
  assert.equal(signinDir({ XDG_RUNTIME_DIR: '/run/user/1000' }), '/run/user/1000/onyx-open-url');
});

test('dropped files open once, in order, and are removed; junk is ignored', async () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'signin-')), 'onyx-open-url');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'url.1.1'), 'https://a.example/\n'); // before start
  const opened = [];
  const stop = watchSignin({ dir, open: (u) => opened.push(u) });
  fs.writeFileSync(path.join(dir, 'url.2.2'), 'https://b.example/login\n');
  fs.writeFileSync(path.join(dir, 'url.3.3'), 'file:///etc/shadow\n');
  fs.writeFileSync(path.join(dir, '.url.tmp'), 'https://partial.example/\n'); // being written
  await new Promise((r) => setTimeout(r, 2300));
  stop();
  assert.deepEqual(opened, ['https://a.example/', 'https://b.example/login']);
  assert.deepEqual(fs.readdirSync(dir), ['.url.tmp']);
});
