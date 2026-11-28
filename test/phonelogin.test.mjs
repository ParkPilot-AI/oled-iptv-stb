import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneLogin, parseSubmission, lanAddress } from '../electron/phonelogin.js';
import { encodeQr, rsRemainder, formatBits, dataCodewords } from '../src/lib/qr.js';

test('QR encoder: Reed–Solomon, format bits and capacities match the standard', () => {
  // "HELLO WORLD" 1-M example from the QR specification tutorials.
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(rsRemainder(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  assert.equal(formatBits('M', 0), 0b101010000010010);
  assert.equal(formatBits('L', 4), 0b110011000101111);
  assert.deepEqual(
    [1, 4, 7, 10].map((v) => dataCodewords(v, 'M')),
    [16, 64, 124, 216]
  );
  const qr = encodeQr('http://192.168.1.23:41837/3f9a1c7e5b2d4a60aa11bb22');
  assert.equal(qr.version, 4);
  assert.equal(qr.size, 33);
  // Finder pattern corners are dark, separators light.
  assert.ok(qr.modules[0][0] && qr.modules[0][6] && !qr.modules[0][7] && qr.modules[6][0]);
});

test('LAN address prefers a private IPv4', () => {
  const ifs = {
    lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    wlan0: [
      { family: 'IPv6', address: 'fe80::1', internal: false },
      { family: 'IPv4', address: '192.168.1.23', internal: false },
    ],
  };
  assert.equal(lanAddress(ifs), '192.168.1.23');
  assert.equal(lanAddress({}), null);
});

test('form checks: required fields, http:// added, lengths capped', () => {
  assert.match(parseSubmission('server=x').error, /needed/);
  const ok = parseSubmission('name=Den&server=provider.tv%3A8080&username=u&password=p%26w');
  assert.deepEqual(ok.fields, { name: 'Den', server: 'http://provider.tv:8080', username: 'u', password: 'p&w' });
});

test('one-time form: wrong path 404, GET form, POST fills the TV, link then expires', async () => {
  const got = [];
  const pl = createPhoneLogin({ onSubmit: (f) => got.push(f), address: () => '127.0.0.1', host: '127.0.0.1' });
  const { url } = await pl.start();
  try {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{24}$/);
    const base = url.replace(/\/[0-9a-f]+$/, '');
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    const form = await fetch(url);
    assert.equal(form.status, 200);
    assert.match(await form.text(), /Send to TV/);
    const bad = await fetch(url, { method: 'POST', body: 'server=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(bad.status, 400);
    const r = await fetch(url, {
      method: 'POST',
      body: 'server=http%3A%2F%2Fp.tv&username=u&password=p',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(got, [{ name: '', server: 'http://p.tv', username: 'u', password: 'p' }]);
    assert.equal((await fetch(url)).status, 404); // used up
    assert.notEqual((await pl.start()).url, url); // a fresh code
  } finally {
    pl.stop();
  }
});
