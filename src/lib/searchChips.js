// Search page shortcuts before anything is typed: quick-filter chips and the
// person's recent searches (saved per household profile).

const SPORT =
  /\b(sports?|football|soccer|premier league|f1|formula|nba|nfl|nhl|mlb|cricket|golf|tennis|boxing|ufc|wwe|rugby|racing|darts|snooker|espn|eurosport|bein|dazn|tnt sports|sky sports)\b/i;
const UHD = /(\b4k\b|\buhd\b|2160p?|ultra ?hd)/i;

export const CHIPS = [
  { id: 'trending', label: 'Trending tonight' },
  { id: 'sports', label: 'Live sports' },
  { id: '4k', label: '4K movies' },
  { id: 'recent', label: 'Recently added' },
];

/** Live channels that look like sport (channel or category name). */
export function sportsChannels(live, limit = 60) {
  const catName = new Map((live?.cats || []).map((c) => [c.id, c.name]));
  return (live?.items || []).filter((c) => SPORT.test(c.name) || SPORT.test(catName.get(c.cat) || '')).slice(0, limit);
}

/** Films in 4K / UHD (title or category). */
export function uhdMovies(vod, limit = 60) {
  const catName = new Map((vod?.cats || []).map((c) => [c.id, c.name]));
  return (vod?.items || []).filter((m) => UHD.test(m.name) || UHD.test(catName.get(m.cat) || '')).slice(0, limit);
}

/** Newest films and series together, newest first. */
export function recentlyAdded(vod, series, limit = 40) {
  return [...(vod?.recent || []).slice(0, limit), ...(series?.recent || []).slice(0, limit)].sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, limit);
}

export const MAX_RECENT = 8;

/** Add a search term to the recent list (case-insensitive de-duplication, newest first). */
export function addRecent(list, term) {
  const t = String(term || '').trim();
  if (t.length < 2) return list || [];
  return [t, ...(list || []).filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, MAX_RECENT);
}
