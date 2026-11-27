// TMDB discovery lists (trending, popular, top rated, most liked) and
// "because you watched" recommendations. The renderer matches these against the
// provider's catalogue, so only titles the user can actually play are shown.
import path from 'node:path';
import { dataDir, readJson, writeJson, getSettings } from './store.js';
import { tmdb, getArtwork } from './artwork.js';

const IMG = 'https://image.tmdb.org/t/p';
const LIST_TTL = 12 * 3600e3;
const RECS_TTL = 3 * 864e5;
const PAGES = 5; // 100 titles per list: enough to find plenty the provider carries

const LISTS = {
  trending: (k) => [`/trending/${k}/week`, {}],
  popular: (k) => [`/${k}/popular`, {}],
  top_rated: (k) => [`/${k}/top_rated`, {}],
  // TMDB has no "likes": the most-voted titles are the most loved ones.
  most_liked: (k) => [`/discover/${k}`, { sort_by: 'vote_count.desc', 'vote_count.gte': 1000 }],
};

const cacheFile = () => path.join(dataDir(), 'discover-cache.json');
let cache = null;
let saveTimer = null;
const inflight = new Map();

async function loadCache() {
  cache ??= await readJson(cacheFile(), {});
  return cache;
}
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeJson(cacheFile(), cache).catch(() => {}), 1500);
}

/** Slim a TMDB result to what the UI and the matcher need. */
export function slim(r) {
  const date = r.release_date || r.first_air_date || '';
  return {
    id: r.id,
    title: r.title || r.name || '',
    original: r.original_title || r.original_name || '',
    year: date.slice(0, 4),
    overview: r.overview || '',
    backdrop: r.backdrop_path ? `${IMG}/w1280${r.backdrop_path}` : null,
    poster: r.poster_path ? `${IMG}/w500${r.poster_path}` : null,
    rating: r.vote_average || 0,
  };
}

async function key() {
  const s = await getSettings();
  const k = (s.tmdbKey || '').trim();
  return k && s.artSource !== 'off' ? k : null;
}

async function cached(cacheKey, ttl, fetcher) {
  await loadCache();
  const hit = cache[cacheKey];
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);
  const p = fetcher()
    .then((data) => {
      cache[cacheKey] = { at: Date.now(), data };
      persist();
      return data;
    })
    .catch((e) => {
      if (hit) return hit.data; // stale beats nothing when offline
      throw e;
    })
    .finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, p);
  return p;
}

async function pages(pathname, params, k, n) {
  const out = [];
  for (let page = 1; page <= n; page++) {
    const r = await tmdb(pathname, { ...params, page, language: 'en-GB' }, k);
    out.push(...(r?.results || []).map(slim));
    if (page >= (r?.total_pages || 1)) break;
  }
  return out;
}

/** { trending: [...], popular: [...], ... } for 'movie' or 'tv'. Empty without a TMDB key. */
export async function getLists(kind, names = Object.keys(LISTS)) {
  const k = await key();
  if (!k || (kind !== 'movie' && kind !== 'tv')) return {};
  const out = {};
  await Promise.all(
    names
      .filter((n) => LISTS[n])
      .map(async (n) => {
        const [p, params] = LISTS[n](kind);
        out[n] = await cached(`${kind}:${n}`, LIST_TTL, () => pages(p, params, k, PAGES)).catch(() => []);
      })
  );
  return out;
}

/** Recommendations for a provider item (movie or series) the user watched. */
export async function getRecommendations(item) {
  const k = await key();
  if (!k || !item) return { source: null, results: [] };
  const art = await getArtwork({ kind: item.kind, id: item.id, name: item.name, year: item.year, tmdbId: item.tmdbId }).catch(() => null);
  const tid = art?.tmdbId;
  if (!tid) return { source: null, results: [] };
  const kind = item.kind === 'series' ? 'tv' : 'movie';
  const results = await cached(`${kind}:recs:${tid}`, RECS_TTL, () => pages(`/${kind}/${tid}/recommendations`, {}, k, 2)).catch(() => []);
  return { source: tid, results };
}
