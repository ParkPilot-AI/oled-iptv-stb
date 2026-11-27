// imgcache:// protocol — fetches remote posters/logos once, downsizes them with
// nativeImage (keeps GPU/RAM use low on integrated graphics), stores them on disk
// and serves them from disk afterwards. Renderer never touches remote hosts.
import { protocol, net, nativeImage } from 'electron';
import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { dataDir } from './store.js';
import { USER_AGENT } from './xtream.js';

const MAX_BYTES = 512 * 1024 * 1024;
const MAX_CONCURRENT = 6;
const cacheDir = () => path.join(dataDir(), 'img-cache');
const failed = new Map(); // url -> timestamp (negative cache, 10 min)

let active = 0;
const queue = [];
const acquire = () =>
  new Promise((r) => (active < MAX_CONCURRENT ? (active++, r()) : queue.push(r)));
const release = () => {
  const next = queue.shift();
  next ? next() : active--;
};

export function registerImageScheme() {
  // Must run before app 'ready'.
  protocol.registerSchemesAsPrivileged([
    { scheme: 'imgcache', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

async function fetchAndStore(url, width, file) {
  await acquire();
  try {
    const res = await net.fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let buf = Buffer.from(await res.arrayBuffer());
    let type = res.headers.get('content-type') || 'image/jpeg';
    const img = nativeImage.createFromBuffer(buf);
    if (!img.isEmpty()) {
      const { width: w } = img.getSize();
      if (w > width) {
        const isPng = type.includes('png'); // keep alpha for channel logos
        const small = img.resize({ width, quality: 'good' });
        buf = isPng ? small.toPNG() : small.toJPEG(82);
        type = isPng ? 'image/png' : 'image/jpeg';
      }
    }
    await fsp.mkdir(cacheDir(), { recursive: true });
    await fsp.writeFile(file, buf);
    await fsp.writeFile(`${file}.type`, type);
    return { buf, type };
  } finally {
    release();
  }
}

export function handleImageProtocol() {
  protocol.handle('imgcache', async (request) => {
    const u = new URL(request.url);
    const src = u.searchParams.get('u');
    const width = Math.min(Math.max(parseInt(u.searchParams.get('w') || '480', 10), 64), 1920);
    if (!src || !/^https?:\/\//i.test(src)) return new Response(null, { status: 400 });

    const f = failed.get(src);
    if (f && Date.now() - f < 600e3) return new Response(null, { status: 404 });

    const key = crypto.createHash('sha1').update(`${width}|${src}`).digest('hex');
    const file = path.join(cacheDir(), key.slice(0, 2), key);
    try {
      const [buf, type] = await Promise.all([fsp.readFile(file), fsp.readFile(`${file}.type`, 'utf8')]);
      return new Response(buf, { headers: { 'Content-Type': type, 'Cache-Control': 'max-age=31536000' } });
    } catch {
      /* miss */
    }
    try {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      const { buf, type } = await fetchAndStore(src, width, file);
      return new Response(buf, { headers: { 'Content-Type': type, 'Cache-Control': 'max-age=31536000' } });
    } catch {
      failed.set(src, Date.now());
      return new Response(null, { status: 404 });
    }
  });
}

/** Trim the cache to MAX_BYTES, oldest files first. Runs at startup, off the hot path. */
export async function pruneImageCache() {
  const root = cacheDir();
  const files = [];
  let total = 0;
  let dirs = [];
  try {
    dirs = await fsp.readdir(root);
  } catch {
    return;
  }
  for (const d of dirs) {
    const sub = path.join(root, d);
    for (const name of await fsp.readdir(sub).catch(() => [])) {
      if (name.endsWith('.type')) continue;
      const p = path.join(sub, name);
      const st = await fsp.stat(p).catch(() => null);
      if (!st) continue;
      files.push({ p, size: st.size, t: st.mtimeMs });
      total += st.size;
    }
  }
  if (total <= MAX_BYTES) return;
  files.sort((a, b) => a.t - b.t);
  for (const f of files) {
    if (total <= MAX_BYTES * 0.8) break;
    await fsp.rm(f.p, { force: true });
    await fsp.rm(`${f.p}.type`, { force: true });
    total -= f.size;
  }
}

export async function clearImageCache() {
  await fsp.rm(cacheDir(), { recursive: true, force: true });
  failed.clear();
}
