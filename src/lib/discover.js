// TMDB discovery lists matched against the provider's catalogue, so rows only
// contain titles the user can play. Matching: provider TMDB id → title + year.
import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { useStore } from './store.js';
import { cleanTitle } from '../../electron/artmatch.js';

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');

const matcherCache = new WeakMap();
/** Matcher for a catalogue section, built once per catalogue load. */
export function matcherFor(section) {
  let m = matcherCache.get(section);
  if (!m) matcherCache.set(section, (m = buildMatcher(section.items)));
  return m;
}

/** Index a catalogue section (vod or series) for matching. */
export function buildMatcher(items) {
  const byTmdb = new Map();
  const byTitle = new Map();
  for (const it of items) {
    if (it.tmdbId) byTmdb.set(Number(it.tmdbId), it);
    const { title, year } = cleanTitle(it.name);
    const k = norm(title);
    if (!k) continue;
    let a = byTitle.get(k);
    if (!a) byTitle.set(k, (a = []));
    a.push({ it, year: it.year || year });
  }
  return { byTmdb, byTitle };
}

const QUALITY = /\b(4k|uhd|2160p)\b/i;

// Name matches the provider's details proved wrong (a same-named, different title).
const rejected = new Set();
const listeners = new Set();
const rkey = (itemId, tmdbId) => `${itemId}:${tmdbId}`;
export function rejectMatch(item) {
  if (!item?.tmdbId) return;
  const k = rkey(item.id, item.tmdbId);
  if (rejected.has(k)) return;
  rejected.add(k);
  listeners.forEach((f) => f());
}
function useRejections() {
  const [v, setV] = useState(0);
  useEffect(() => {
    const f = () => setV((x) => x + 1);
    listeners.add(f);
    return () => listeners.delete(f);
  }, []);
  return v;
}

/** TMDB results → provider items (with tmdbId and TMDB art attached), in TMDB order. */
export function matchList(results, matcher, { limit = 30, exclude } = {}) {
  if (!results?.length || !matcher) return [];
  const out = [];
  const seen = new Set();
  for (const r of results) {
    let it = matcher.byTmdb.get(r.id);
    if (!it) {
      const cands = [...(matcher.byTitle.get(norm(r.title)) || []), ...(r.original && r.original !== r.title ? matcher.byTitle.get(norm(r.original)) || [] : [])].filter(
        (c) => !rejected.has(rkey(c.it.id, r.id)) && (!c.it.tmdbId || Number(c.it.tmdbId) === r.id) // provider says it's another title
      );
      // Years must agree when both are known; a yearless title only matches if it's the only one by that name.
      const dated = cands.filter((c) => c.year && r.year && Math.abs(Number(c.year) - Number(r.year)) <= 1);
      const ok = dated.length ? dated : cands.length && cands.every((c) => !c.year) ? cands : [];
      // Same film listed in several qualities/languages: prefer a plain HD copy.
      it = (ok.find((c) => !QUALITY.test(c.it.name)) || ok[0])?.it;
    }
    if (!it || seen.has(it.id) || exclude?.has(it.id)) continue;
    seen.add(it.id);
    out.push({ ...it, tmdbId: r.id, tmdb: r });
    if (out.length >= limit) break;
  }
  return out;
}

const listCache = new Map();

const BASE = ['trending', 'popular', 'top_rated', 'most_liked'];

/**
 * Matched discovery lists for 'movie' or 'tv' (names: trending, popular, top_rated,
 * most_liked, genre:<id>[:top|:liked]). Returns {} until loaded / without a TMDB key.
 */
export function useDiscover(kind, names = BASE) {
  const sig = `${kind}|${names.join(',')}`;
  const hasKey = useStore((s) => !!s.settings?.tmdbKey && s.settings?.artSource !== 'off');
  const section = useStore((s) => s.catalog[kind === 'tv' ? 'series' : 'vod']);
  const [raw, setRaw] = useState(() => listCache.get(sig) || null);
  useEffect(() => {
    if (!hasKey || !names.length) return setRaw(null);
    setRaw(listCache.get(sig) || null);
    let alive = true;
    api
      .invoke('discover:lists', { kind, names })
      .then((r) => {
        listCache.set(sig, r);
        if (alive) setRaw(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, hasKey]);
  const matcher = useMemo(() => (raw ? matcherFor(section) : null), [raw, section]);
  const rv = useRejections();
  return useMemo(() => {
    if (!raw || !matcher) return {};
    const out = {};
    for (const [name, results] of Object.entries(raw)) out[name] = matchList(results, matcher);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, matcher, rv]);
}

const recsCache = new Map();

/**
 * "Because you watched X" rows: recommendations for the most recently watched
 * movies/series (up to `max` sources), matched to the catalogue.
 */
export function useBecauseYouWatched(max = 2) {
  const hasKey = useStore((s) => !!s.settings?.tmdbKey && s.settings?.artSource !== 'off');
  const progress = useStore((s) => s.progress);
  const catalog = useStore((s) => s.catalog);
  const sources = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const p of Object.values(progress).sort((a, b) => b.updatedAt - a.updatedAt)) {
      const e = p.item;
      if (!e) continue;
      const src =
        e.kind === 'episode' && e.seriesId
          ? catalog.series.items.find((s) => s.id === e.seriesId) || { kind: 'series', id: e.seriesId, name: e.seriesName }
          : e.kind === 'movie'
            ? e
            : null;
      if (!src) continue;
      const k = `${src.kind}:${src.id}`;
      if (seen.has(k) || (p.pos < 120 && !p.watched)) continue; // only things actually watched
      seen.add(k);
      out.push(src);
      if (out.length >= max) break;
    }
    return out;
  }, [progress, catalog]);
  const [recs, setRecs] = useState({});
  const sig = sources.map((s) => `${s.kind}:${s.id}`).join(',');
  useEffect(() => {
    if (!hasKey || !sources.length) return setRecs({});
    let alive = true;
    for (const src of sources) {
      const k = `${src.kind}:${src.id}`;
      const p = recsCache.get(k) || api.invoke('discover:recs', { item: { kind: src.kind, id: src.id, name: src.name, year: src.year, tmdbId: src.tmdbId } }).catch(() => ({ results: [] }));
      recsCache.set(k, p);
      p.then((r) => alive && setRecs((m) => ({ ...m, [k]: r.results || [] })));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, hasKey]);
  const matchers = useMemo(() => (sources.length ? { movie: matcherFor(catalog.vod), series: matcherFor(catalog.series) } : null), [catalog, sources.length]);
  return useMemo(
    () =>
      !matchers
        ? []
        : sources
        .map((src) => {
          const results = recs[`${src.kind}:${src.id}`];
          const items = matchList(results, matchers[src.kind === 'series' ? 'series' : 'movie'], { limit: 20, exclude: new Set([src.id]) });
          return { source: src, items };
        })
        .filter((r) => r.items.length),
    [sources, recs, matchers]
  );
}
