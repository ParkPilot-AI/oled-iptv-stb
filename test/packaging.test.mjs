// Worker threads can't load from app.asar: every local module a worker imports
// (directly or indirectly) must be listed in electron-builder.yml asarUnpack.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('all worker dependencies are unpacked from asar', () => {
  const yml = fs.readFileSync('electron-builder.yml', 'utf8');
  const block = yml.split(/^asarUnpack:\s*$/m)[1].split(/^\S/m)[0];
  const unpack = [...block.matchAll(/^\s+- (\S+)$/gm)].map((m) => m[1]);
  const covered = (f) => unpack.some((u) => (u.endsWith('/**') ? f.startsWith(u.slice(0, -2)) : f === u));
  const seen = new Set();
  const walk = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) walk(path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1])));
  };
  for (const w of fs.readdirSync('electron/workers')) walk(`electron/workers/${w}`);
  const missing = [...seen].filter((f) => !covered(f));
  assert.deepEqual(missing, []);
});
