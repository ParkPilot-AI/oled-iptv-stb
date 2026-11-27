#!/usr/bin/env node
// Refreshes electron/data/tvlogos.json: the list of official channel logos in
// github.com/tv-logo/tv-logos (512 px PNGs), grouped by folder. Only file names
// are fetched (blobless clone); the box downloads images on demand.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvlogos-'));
try {
  execFileSync('git', ['clone', '-q', '--depth', '1', '--filter=blob:none', '--no-checkout', 'https://github.com/tv-logo/tv-logos.git', dir], { stdio: 'inherit' });
  const files = execFileSync('git', ['-C', dir, 'ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\n')
    .filter((f) => f.endsWith('.png') && (f.startsWith('countries/') || (f.startsWith('misc/') && !f.startsWith('misc/vod/'))));
  const folders = {};
  for (const f of files) {
    const d = path.posix.dirname(f);
    (folders[d] ||= []).push(path.posix.basename(f, '.png'));
  }
  const out = { source: 'https://github.com/tv-logo/tv-logos', base: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/', updated: new Date().toISOString().slice(0, 10), folders };
  fs.writeFileSync(new URL('../electron/data/tvlogos.json', import.meta.url), JSON.stringify(out));
  console.log(`tvlogos.json: ${files.length} logos in ${Object.keys(folders).length} folders`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
