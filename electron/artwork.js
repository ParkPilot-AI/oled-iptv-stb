// Artwork providers:
//   • TMDB (themoviedb.org) — posters, wide backdrops and title logos for movies
//     and series. Needs the user's free API key (v3 key or v4 read token).
//   • iptv-org (open database, no key) — channel logos, matched in the worker.
// Results are cached on disk and shared between profiles.
import path from 'node:path';
import { dataDir, readJson, writeJson, getSettings } from './store.js';
import { USER_AGENT } from './xtream.js';
import { cleanTitle, pickTmdbLogo } from './artmatch.js';

const API = process.env.TMDB_API_BASE || 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const TTL_HIT = 30 * 864e5;
const TTL_MISS = 7 * 864e5;
const MAX_CONCURRENT = 4;

const cacheFile = () => path.join(dataDir(), 'artwork-cache.json');
let cache = null;
let saveTimer = null;
const inflight = new Map();
let active = 0;
const queue = [];

async function loadCache() {
  if (!cache) {
    cache = await readJson(cacheFile(), {});
    // v2: better title matching — retry everything that previously wasn't found.
    if (cache.__v !== 2) {
      for (const k of Object.keys(cache)) if (cache[k]?.miss) delete cache[k];
      cache.__v = 2;
    }
  }
  return cache;
}
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeJson(cacheFile(), cache).catch(() => {}), 2000);
}

const acquire = () => new Promise((r) => (active < MAX_CONCURRENT ? (active++, r()) : queue.push(r)));
const release = () => {
  const next = queue.shift();
  next ? next() : active--;
};

export async function tmdb(pathname, params, key) {
  const u = new URL(API + pathname);
  for (const [k, v] of Object.entries(params || {})) if (v !== '' && v != null) u.searchParams.set(k, v);
  const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT };
  // v4 "API Read Access Token" (long JWT) goes in a header; v3 keys are a query param.
  if (key.length > 40) headers.Authorization = `Bearer ${key}`;
  else u.searchParams.set('api_key', key);
  await acquire();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(u, { headers, signal: ctrl.signal }).finally(() => clearTimeout(t));
    if (res.status === 401) throw Object.assign(new Error('TMDB rejected the API key'), { fatal: true });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500));
      throw new Error('TMDB rate limited');
    }
    if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
    return res.json();
  } finally {
    release();
  }
}

/** Find the TMDB id for a title (optionally with year). */
async function findId(kind, rawName, key, hintYear) {
  const { title, year: y } = cleanTitle(rawName);
  const year = hintYear || y;
  if (!title) return null;
  const isTv = kind === 'series';
  const run = (withYear) =>
    tmdb(isTv ? '/search/tv' : '/search/movie', {
      query: title,
      include_adult: 'false',
      ...(withYear && year ? (isTv ? { first_air_date_year: year } : { year }) : {}),
    }, key);
  let r = await run(true);
  if (!r?.results?.length && year) r = await run(false);
  const list = r?.results || [];
  if (!list.length) return null;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const want = norm(title);
  // Prefer exact title match (and year), else the most popular result.
  const exact = list.filter((x) => norm(x.title || x.name) === want || norm(x.original_title || x.original_name) === want);
  const pool = exact.length ? exact : list;
  const withYear = year ? pool.find((x) => String(x.release_date || x.first_air_date || '').startsWith(year)) : null;
  return (withYear || pool[0]).id;
}

/**
 * Artwork for a movie/series item: { poster, backdrop, logo } (absolute URLs) or null.
 * `tmdbId` from the provider's get_vod_info/get_series_info is used when present.
 */
export async function getArtwork({ kind, id, name, year, tmdbId }) {
  if (kind !== 'movie' && kind !== 'series') return null;
  const s = await getSettings();
  const key = (s.tmdbKey || '').trim();
  if (!key || s.artSource === 'off') return null;
  await loadCache();
  const cacheKey = `${kind}:${tmdbId ? `t${tmdbId}` : `${cleanTitle(name).title.toLowerCase()}|${year || cleanTitle(name).year}`}`;
  const hit = cache[cacheKey];
  if (hit && Date.now() - hit.at < (hit.miss ? TTL_MISS : TTL_HIT)) return hit.miss ? null : hit.art;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);

  const p = (async () => {
    try {
      const tid = tmdbId || (await findId(kind, name, key, year));
      if (!tid) {
        cache[cacheKey] = { at: Date.now(), miss: true };
        return null;
      }
      const d = await tmdb(kind === 'series' ? `/tv/${tid}` : `/movie/${tid}`, { append_to_response: 'images', include_image_language: 'en,null' }, key);
      const logo = pickTmdbLogo(d.images?.logos);
      const art = {
        tmdbId: tid,
        poster: d.poster_path ? `${IMG}/w500${d.poster_path}` : null,
        backdrop: d.backdrop_path ? `${IMG}/w1280${d.backdrop_path}` : null,
        logo: logo ? `${IMG}/w500${logo}` : null,
        overview: d.overview || null,
      };
      cache[cacheKey] = { at: Date.now(), art };
      return art;
    } catch (e) {
      if (e.fatal) throw e;
      return null; // transient: not cached, retried next time
    } finally {
      persist();
    }
  })().finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, p);
  return p;
}

/** Validate a key from Settings. */
export async function testTmdbKey(key) {
  await tmdb('/configuration', {}, key.trim());
  return true;
}

export async function clearArtworkCache() {
  cache = {};
  await writeJson(cacheFile(), cache);
}
