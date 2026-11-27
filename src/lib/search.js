import { normText } from './store.js';

const BOUNDARY = /[\s\-_:|.([]/;

/** Rank: prefix match > word-start match > substring. Items carry precomputed `_s`. */
export function searchItems(items, query, limit = 40) {
  const q = normText(query).trim();
  if (!q) return [];
  const prefix = [];
  const word = [];
  const sub = [];
  for (const it of items) {
    const i = it._s.indexOf(q);
    if (i < 0) continue;
    if (i === 0) {
      prefix.push(it);
      if (prefix.length >= limit) break;
    } else if (BOUNDARY.test(it._s[i - 1])) word.length < limit && word.push(it);
    else sub.length < limit && sub.push(it);
  }
  return prefix.concat(word, sub).slice(0, limit);
}

export function searchCatalog(catalog, query, limit = 40) {
  return {
    live: searchItems(catalog.live.items, query, limit),
    movies: searchItems(catalog.vod.items, query, limit),
    series: searchItems(catalog.series.items, query, limit),
  };
}
