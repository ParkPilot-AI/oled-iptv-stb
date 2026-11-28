// Catalog + EPG service. Owns the worker thread, the on-disk caches, and the
// in-memory EPG index that the renderer and the OSD query via IPC.
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { profileDir, readJson, writeJson, getCredentials, getSettings } from './store.js';
import { classifyChannel, homeCountryOf } from './artmatch.js';
import { apiUrl, fetchJson, normVodInfo, normSeriesInfo, normShortEpg } from './xtream.js';
import { nowNext, range } from './xmltv.js';

// Background work is reported for the "Updating…" pill (see sync.js).
let track = (label, p) => p;
export function setSyncTracker(t) {
  track = t.track;
}

const here = path.dirname(fileURLToPath(import.meta.url));
// Workers cannot be loaded from inside app.asar; electron-builder unpacks them.
const workerPath = path.join(here, 'workers', 'catalog-worker.js').replace('app.asar', 'app.asar.unpacked');

let worker = null;
let jobSeq = 0;
const jobs = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(workerPath);
  worker.on('message', (m) => {
    const job = jobs.get(m.id);
    if (!job) return;
    if (m.progress) return job.onProgress?.(m.progress);
    jobs.delete(m.id);
    m.ok ? job.resolve(m.result) : job.reject(new Error(m.error));
  });
  worker.on('error', (err) => {
    for (const j of jobs.values()) j.reject(err);
    jobs.clear();
    worker = null;
  });
  worker.on('exit', () => (worker = null));
  return worker;
}

function runJob(type, payload, onProgress) {
  return new Promise((resolve, reject) => {
    const id = ++jobSeq;
    jobs.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, type, ...payload });
  });
}

// ---------- catalog ----------
const memCatalog = new Map(); // profileId -> catalog
const inflight = new Map();

const catalogFile = (pid) => path.join(profileDir(pid), 'catalog.json');
const logosFile = (pid) => path.join(profileDir(pid), 'logos.json');
const LOGO_TTL = 7 * 864e5;
const memLogos = new Map();
const logoJobs = new Map();

/** Apply matched iptv-org logos to live channels according to the logo setting. */
async function withLogos(pid, cat) {
  const mode = (await getSettings()).logoSource || 'missing';
  const lg = memLogos.get(pid) || (await readJson(logosFile(pid), null));
  if (lg) memLogos.set(pid, lg);
  const map = mode === 'off' ? {} : lg?.map || {};
  const cats = lg?.cats || {};
  const home = lg?.home || homeCountryOf(cat.live.items);
  const catName = new Map((cat.live.categories || []).map((c) => [String(c.id), c.name]));
  return {
    ...cat,
    live: {
      ...cat.live,
      items: cat.live.items.map((it) => {
        const genre = classifyChannel({ name: it.name, catName: catName.get(String(it.cat)) || '', iptvCats: cats[it.id] || [], home });
        const u = map[it.id];
        if (!u) return { ...it, genre };
        return mode === 'prefer' || !it.icon ? { ...it, genre, icon: u, providerIcon: it.icon } : { ...it, genre };
      }),
    },
  };
}

/** Refresh the channel-logo match in the background when stale (or forced). */
export async function refreshLogos(pid, notify, { force = false } = {}) {
  if ((await getSettings()).logoSource === 'off') return null;
  const cat = memCatalog.get(pid);
  if (!cat) return null;
  const lg = memLogos.get(pid) || (await readJson(logosFile(pid), null));
  if (!force && lg?.v === 2 && Date.now() - lg.fetchedAt < LOGO_TTL && lg.total === cat.live.items.length) return lg;
  if (logoJobs.has(pid)) return logoJobs.get(pid);
  const job = track('Matching channel logos', runJob('logos', { items: cat.live.items.map(({ id, name, epg }) => ({ id, name, epg })) }))
    .then(async (res) => {
      memLogos.set(pid, res);
      await writeJson(logosFile(pid), res);
      notify?.('catalog:updated', { profileId: pid, catalog: await withLogos(pid, memCatalog.get(pid)), silent: true });
      return res;
    })
    .catch((e) => {
      console.warn('[logos]', e.message);
      return null;
    })
    .finally(() => logoJobs.delete(pid));
  logoJobs.set(pid, job);
  return job;
}
const epgFile = (pid) => path.join(profileDir(pid), 'epg.json');

async function fetchCatalog(pid, notify) {
  if (inflight.has(pid)) return inflight.get(pid);
  const p = (async () => {
    const creds = await getCredentials(pid);
    const cat = await runJob('catalog', { creds }, (pr) => notify?.('catalog:progress', pr));
    memCatalog.set(pid, cat);
    await writeJson(catalogFile(pid), cat);
    return cat;
  })().finally(() => inflight.delete(pid));
  inflight.set(pid, p);
  return p;
}

/**
 * Returns the catalog immediately from memory/disk when available. Stale caches
 * are returned at once and refreshed in the background (renderer gets
 * 'catalog:updated'); a missing cache is fetched synchronously.
 */
export async function loadCatalog(pid, opts = {}, notify) {
  const cat = await loadCatalogRaw(pid, opts, notify);
  setTimeout(() => refreshLogos(pid, notify), 3000);
  return withLogos(pid, cat);
}

async function loadCatalogRaw(pid, { force = false } = {}, notify) {
  const ttl = (await getSettings()).catalogTtlHours * 3600e3;
  if (force) return fetchCatalog(pid, notify);
  let cat = memCatalog.get(pid) || (await readJson(catalogFile(pid), null));
  if (cat) {
    memCatalog.set(pid, cat);
    if (Date.now() - cat.fetchedAt > ttl) {
      track('Updating playlist', fetchCatalog(pid, notify))
        .then(async (fresh) => notify?.('catalog:updated', { profileId: pid, catalog: await withLogos(pid, fresh) }))
        .catch((e) => console.warn('[catalog] background refresh failed:', e.message));
    }
    return cat;
  }
  return fetchCatalog(pid, notify);
}

// ---------- EPG ----------
const memEpg = new Map(); // profileId -> {index, fetchedAt}
const epgInflight = new Map();

export async function loadEpg(pid, { force = false } = {}, notify) {
  const ttl = (await getSettings()).epgTtlHours * 3600e3;
  if (!force) {
    let epg = memEpg.get(pid) || (await readJson(epgFile(pid), null));
    if (epg && Date.now() - epg.fetchedAt < ttl) {
      memEpg.set(pid, epg);
      return { channels: Object.keys(epg.index).length, fetchedAt: epg.fetchedAt };
    }
    if (epg) memEpg.set(pid, epg); // serve stale while refreshing
  }
  if (!epgInflight.has(pid)) {
    const p = track(
      'Loading TV guide',
      (async () => {
        const creds = await getCredentials(pid);
        const cat = memCatalog.get(pid) || (await loadCatalogRaw(pid, {}, notify));
        const wanted = [...new Set(cat.live.items.map((s) => s.epg).filter(Boolean))];
        const epg = await runJob('epg', { creds, options: { wanted } }, (pr) => notify?.('epg:progress', pr));
        memEpg.set(pid, { index: epg.index, fetchedAt: epg.fetchedAt });
        await writeJson(epgFile(pid), { index: epg.index, fetchedAt: epg.fetchedAt });
        notify?.('epg:updated', { profileId: pid });
        return { channels: Object.keys(epg.index).length, fetchedAt: epg.fetchedAt, parsed: epg.parsed };
      })()
    ).finally(() => epgInflight.delete(pid));
    epgInflight.set(pid, p);
  }
  return epgInflight.get(pid);
}

/** Now/next for many channels at once (used by channel lists & OSD banner). */
export function epgNowNext(pid, epgIds, at = Date.now()) {
  const idx = memEpg.get(pid)?.index;
  const out = {};
  if (!idx) return out;
  for (const id of epgIds) {
    if (!id) continue;
    const r = nowNext(idx[id.toLowerCase()], at);
    if (r.now || r.next) out[id] = r;
  }
  return out;
}

export function epgRange(pid, epgId, from = Date.now(), limit = 12) {
  const idx = memEpg.get(pid)?.index;
  return idx && epgId ? range(idx[epgId.toLowerCase()], from, limit) : [];
}

/** Full schedules for many channels within [from, to] (TV-guide grid). */
export function epgGrid(pid, epgIds, from, to) {
  const idx = memEpg.get(pid)?.index;
  const out = {};
  for (const id of epgIds) {
    const list = idx?.[String(id).toLowerCase()];
    out[id] = list ? list.filter((p) => p[1] > from && p[0] < to).map((p) => ({ start: p[0], stop: p[1], title: p[2], desc: p[3] })) : [];
  }
  return out;
}

export async function shortEpg(pid, streamId, limit = 6) {
  const creds = await getCredentials(pid);
  const data = await fetchJson(apiUrl(creds, 'get_short_epg', { stream_id: streamId, limit }), {
    timeoutMs: 10000,
  });
  return normShortEpg(data);
}

// ---------- details (small payloads, LRU-ish memory cache) ----------
const detailCache = new Map();
async function cached(key, fn) {
  if (detailCache.has(key)) return detailCache.get(key);
  const v = await fn();
  detailCache.set(key, v);
  if (detailCache.size > 400) detailCache.delete(detailCache.keys().next().value);
  return v;
}

export function vodInfo(pid, item) {
  return cached(`${pid}:vod:${item.id}`, async () => {
    const creds = await getCredentials(pid);
    return normVodInfo(await fetchJson(apiUrl(creds, 'get_vod_info', { vod_id: item.id })), item);
  });
}

export function seriesInfo(pid, item) {
  return cached(`${pid}:series:${item.id}`, async () => {
    const creds = await getCredentials(pid);
    return normSeriesInfo(await fetchJson(apiUrl(creds, 'get_series_info', { series_id: item.id })), item);
  });
}

export async function clearCaches(pid) {
  memCatalog.delete(pid);
  memEpg.delete(pid);
  memLogos.delete(pid);
  await fsp.rm(logosFile(pid), { force: true });
  detailCache.clear();
  await Promise.all([fsp.rm(catalogFile(pid), { force: true }), fsp.rm(epgFile(pid), { force: true })]);
}

export function shutdownWorker() {
  worker?.terminate();
  worker = null;
}
