// Renderer side of the artwork providers: a cached, de-duplicated hook.
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useStore } from './store.js';

const cache = new Map();
const pending = new Map();

/** Which TMDB title an item belongs to (episodes use their series). */
function target(item) {
  if (!item) return null;
  if (item.kind === 'movie' || item.kind === 'series') return { kind: item.kind, id: item.id, name: item.name, year: item.year, tmdbId: item.tmdbId };
  if (item.kind === 'episode' && item.seriesId) return { kind: 'series', id: item.seriesId, name: item.seriesName || '' };
  return null;
}

export function useArtSettings() {
  return useStore((s) => {
    const st = s.settings || {};
    const on = !!st.tmdbKey && st.artSource !== 'off';
    return on ? st.artSource || 'missing' : 'off';
  });
}

/**
 * { poster, backdrop, logo } from TMDB for a movie/series/episode, or null.
 * `enabled=false` skips the lookup (e.g. provider art is enough).
 */
export function useArt(item, enabled = true) {
  const mode = useArtSettings();
  const t = target(item);
  const key = t ? `${t.kind}:${t.id}` : null;
  const [art, setArt] = useState(() => (key ? cache.get(key) ?? null : null));
  useEffect(() => {
    if (mode === 'off' || !key || !enabled) return;
    if (cache.has(key)) {
      setArt(cache.get(key));
      return;
    }
    let p = pending.get(key);
    if (!p) {
      p = api
        .invoke('art:get', t)
        .catch(() => null)
        .then((a) => {
          cache.set(key, a || null);
          pending.delete(key);
          return a || null;
        });
      pending.set(key, p);
    }
    let alive = true;
    p.then((a) => alive && setArt(a));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mode, enabled, t?.tmdbId]);
  return mode === 'off' ? null : art;
}

/** Ordered image candidates (provider vs TMDB); the next is used if one fails to load. */
export function artChoices(mode, provider, tmdb) {
  if (mode === 'off') return [provider];
  return mode === 'prefer' ? [tmdb, provider] : [provider, tmdb];
}

/** Pick provider vs TMDB image according to the setting. */
export function chooseArt(mode, provider, tmdb) {
  if (mode === 'prefer') return tmdb || provider || '';
  return provider || tmdb || '';
}

export function clearArtCache() {
  cache.clear();
}
