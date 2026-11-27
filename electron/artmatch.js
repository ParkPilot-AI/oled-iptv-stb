// Pure helpers for artwork matching (no Electron, no network) — unit tested.

const COUNTRY_PREFIX = {
  UK: 'GB', GB: 'GB', US: 'US', USA: 'US', CA: 'CA', AU: 'AU', IE: 'IE', DE: 'DE', AT: 'AT', CH: 'CH', FR: 'FR',
  BE: 'BE', NL: 'NL', IT: 'IT', ES: 'ES', PT: 'PT', BR: 'BR', MX: 'MX', PL: 'PL', TR: 'TR', GR: 'GR',
  SE: 'SE', NO: 'NO', DK: 'DK', FI: 'FI', RO: 'RO', HU: 'HU', CZ: 'CZ', IN: 'IN', PK: 'PK', RU: 'RU',
};

const QUALITY_RE = /\b(4k|uhd|fhd|hd|sd|hq|lq|hevc|h\.?265|h\.?264|x265|raw|backup|1080p|720p|2160p|50fps|60fps)\b/gi;

/** "UK: BBC One HD" → { name: 'bbcone', country: 'GB' } */
export function normChannelName(raw = '') {
  let s = String(raw).trim();
  let country = null;
  const m = /^\s*(?:\[|\|)?\s*([A-Z]{2,3})\s*(?:\]|\||:|-)\s*/.exec(s);
  if (m && COUNTRY_PREFIX[m[1]]) {
    country = COUNTRY_PREFIX[m[1]];
    s = s.slice(m[0].length);
  }
  s = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(QUALITY_RE, ' ')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\+/g, 'plus')
    .replace(/[^a-z0-9]+/g, '');
  return { name: s, country };
}

/** Best logo per iptv-org channel id: current, channel-level (not feed), PNG/SVG, reasonable size. */
export function pickLogos(logos) {
  const best = new Map();
  const score = (l) =>
    (l.in_use === false ? -100 : 0) +
    (l.feed ? -10 : 0) +
    (l.format === 'PNG' ? 6 : l.format === 'SVG' ? 5 : l.format === 'WebP' ? 3 : 0) +
    Math.min(l.width || 0, 600) / 100 -
    (l.width > 2000 ? 3 : 0);
  for (const l of logos || []) {
    if (!l?.channel || !l.url) continue;
    const cur = best.get(l.channel);
    if (!cur || score(l) > score(cur)) best.set(l.channel, l);
  }
  return best;
}

/**
 * Build an index over iptv-org channels and return a matcher for provider
 * channels: by EPG id first (XMLTV ids often equal iptv-org ids), then by
 * normalised name (+ alt names), preferring the country from the name prefix.
 */
export function buildLogoMatcher(channels, logos) {
  const logoBy = pickLogos(logos);
  const find = buildIptvMatcher(channels, (c) => logoBy.has(c.id));
  return (item) => {
    const ch = find(item);
    return ch ? logoBy.get(ch.id).url : null;
  };
}

/** item → iptv-org channel (by EPG id, then name + country). `keep` filters channels. */
export function buildIptvMatcher(channels, keep = () => true) {
  const byId = new Map();
  const byName = new Map();
  for (const c of channels || []) {
    if (!c?.id || c.closed || !keep(c)) continue;
    byId.set(c.id.toLowerCase(), c);
    for (const n of [c.name, ...(c.alt_names || [])]) {
      const k = normChannelName(n).name;
      if (!k) continue;
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(c);
    }
  }
  return (item) => {
    const epg = String(item.epg || '').toLowerCase().replace(/@.*$/, '');
    let ch = epg && byId.get(epg);
    if (!ch) {
      const { name, country } = normChannelName(item.name);
      const list = name && byName.get(name);
      if (list?.length) {
        const epgCountry = /\.([a-z]{2})$/.exec(epg)?.[1]?.toUpperCase();
        const want = country || epgCountry;
        ch = (want && list.find((c) => c.country === want)) || (list.length === 1 || !want ? list[0] : null);
      }
    }
    return ch || null;
  };
}

// ---------------------------------------------------------------- official logos (tv-logo/tv-logos)

/** ISO-ish country (from the channel prefix) → tv-logos file suffix. */
const TVL_CC = { GB: 'uk' };
const tvlCc = (country) => (country ? TVL_CC[country] || country.toLowerCase() : null);

/**
 * Matcher over the tv-logos index ({ base, folders: { 'countries/united-kingdom': ['bbc-one-uk', …] } }).
 * File names are "<channel>-<cc>"; "-hz-" marks horizontal variants (used as a fallback).
 */
export function buildTvLogoMatcher(index, homeCountry) {
  const bySlug = new Map();
  for (const [folder, names] of Object.entries(index?.folders || {})) {
    for (const n of names) {
      const parts = n.split('-');
      if (parts.length < 2) continue;
      const cc = parts.at(-1);
      const hz = parts.includes('hz');
      const slug = parts.slice(0, -1).filter((p) => p !== 'hz').join('');
      if (!slug) continue;
      let a = bySlug.get(slug);
      if (!a) bySlug.set(slug, (a = []));
      a.push({ cc, hz, url: `${index.base}${folder}/${n}.png` });
    }
  }
  const home = tvlCc(homeCountry);
  const pick = (list, want) => {
    const ok = (cc) => list.filter((e) => e.cc === cc).sort((x, y) => x.hz - y.hz)[0];
    return (want && ok(want)) || (home && ok(home)) || ok('int') || (new Set(list.map((e) => e.cc)).size === 1 ? list.sort((x, y) => x.hz - y.hz)[0] : null);
  };
  return (item) => {
    const { name, country } = normChannelName(item.name);
    if (!name) return null;
    const want = tvlCc(country);
    // "Challenge +1" is "challenge-plus" in tv-logos; "BBC One UK" may carry the country in its name.
    const keys = [name, name.replace(/plus1$/, 'plus'), name.replace(/(uk|us|tv)$/, ''), name.replace(/^(uk|us)/, ''), `bbc${name}`, /^\d+$/.test(name) ? `channel${name}` : ''];
    for (const k of new Set(keys)) {
      const list = k && bySlug.get(k);
      const hit = list && pick(list, want);
      if (hit) return hit.url;
    }
    return null;
  };
}

/** Most common country prefix among the provider's channels (the viewer's "home"). */
export function homeCountryOf(items) {
  const n = new Map();
  for (const it of items || []) {
    const c = normChannelName(it.name).country;
    if (c) n.set(c, (n.get(c) || 0) + 1);
  }
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

// ---------------------------------------------------------------- channel genres

export const GENRES = ['entertainment', 'documentaries', 'kids', 'movies', 'music', 'sports', 'news', 'international', 'adult'];
const ENGLISH = new Set(['GB', 'US', 'IE', 'CA', 'AU']);
const RULES = [
  ['adult', /\b(xxx|adult|18\+|porn|playboy|hustler|brazzers|private|dorcel|redlight|blue hustler)\b/i],
  ['kids', /\b(kids?|child(ren)?|cartoons?|junior|jr|baby|toons?|cbeebies|cbbc|nick(elodeon|jr|toons)?|disney (channel|jr|junior|xd)|boomerang|pop|tiny pop|cartoonito|ketchup|duck ?tv|kika|gulli)\b/i],
  ['sports', /\b(sports?|football|soccer|futbol|nba|nfl|nhl|mlb|f1|formula|golf|racing|tennis|cricket|boxing|ufc|wwe|ppv|espn|eurosport|bein|dazn|tnt sport|premier league|la ?liga|serie a|bundesliga|motogp|rugby|darts|snooker|racing tv|sky sports|bt sport|arena sport|supersport)\b/i],
  ['news', /\b(news|cnn|bbc news|sky news|fox news|msnbc|cnbc|bloomberg|al ?jazeera|euronews|france ?24|dw|rt|gb ?news|newsmax|talk ?tv|parliament|weather)\b/i],
  ['movies', /\b(movies?|cinema|cine|films?|kino|hbo|showtime|starz|cinemax|tcm|sky (cinema|premiere)|film ?4|great movies|talking pictures|movies ?24|paramount ?network)\b/i],
  ['music', /\b(music|musique|mtv|vh1|kiss|4music|clubland|kerrang|box hits|the box|magic|capital|radio|hits|vevo|trace|now (70|80|90|rock)s?|stingray)\b/i],
  ['documentaries', /\b(docs?|documentar(y|ies)|discovery|nat ?geo|national geographic|history|animal planet|science|investigation|crime ?\+ ?investigation|yesterday|smithsonian|curiosity|pbs|nature|wild|viasat (explore|history|nature)|blaze|quest)\b/i],
];
const IPTV_ORG = {
  xxx: 'adult', kids: 'kids', animation: 'kids', sports: 'sports', news: 'news', weather: 'news', movies: 'movies', music: 'music',
  documentary: 'documentaries', science: 'documentaries', education: 'documentaries', outdoor: 'documentaries', travel: 'documentaries',
};

/**
 * One genre per channel. Order: adult → provider category / channel name keywords →
 * iptv-org categories → International (foreign-language country) → Entertainment.
 */
export function classifyChannel({ name = '', catName = '', iptvCats = [], home = null }) {
  const text = `${catName} | ${name}`;
  if (RULES[0][1].test(text) || iptvCats.includes('xxx')) return 'adult';
  // The provider's category is the strongest signal ("UK | Sports"), then the channel name.
  for (const src of [catName, name]) for (const [g, re] of RULES.slice(1)) if (re.test(src)) return g;
  for (const c of iptvCats) if (IPTV_ORG[c]) return IPTV_ORG[c];
  const country = normChannelName(name).country || normChannelName(catName).country;
  const homeLang = home ? ENGLISH.has(home) : true;
  if (country && country !== home && !(homeLang && ENGLISH.has(country))) return 'international';
  if (/\b(international|world|foreign|arabic|turkish|polish|india[n]?|african|latino|asian|kurdish|persian|russian|portug|span|italia|french|german|greek|albania|ex-?yu|balkan|romania|bulgaria)\b/i.test(catName)) return 'international';
  return 'entertainment';
}

/** "EN - The Matrix (1999) [4K]" → { title: 'The Matrix', year: '1999' } */
export function cleanTitle(raw = '') {
  // Provider prefixes: "EN - ", "UK: ", "|EN| ", "[4K] ", "4K-NF - ", "D+ | ", "EN|"…
  // ":" only after a 2-letter code, so "CSI: Vegas" / "M3GAN: …" keep their names.
  let s = String(raw).replace(/^\s*(?:\[[^\]]*\]|\|[^|]*\||[A-Z0-9+]{1,6}(?:-[A-Z0-9+]{1,6})?(?:\s*\|\s*|\s+-\s+|-\s+)|[A-Z]{2}:\s*)+/, '');
  let year = '';
  const paren = /\((19\d{2}|20\d{2})\)/.exec(s);
  if (paren) {
    year = paren[1];
    s = s.replace(paren[0], ' ');
  }
  s = s
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/[._]/g, ' ')
    .replace(/\b(4k|uhd|fhd|hd|sd|hdr10\+?|hdr|dv|dolby vision|x265|x264|hevc|multi|vostfr|dual audio|subbed|dubbed|imax|extended|remastered|1080p|720p|2160p)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!year) {
    // Trailing year ("Blade Runner 2049 2017"), but not a title number from the future.
    const m = /\s(19\d{2}|20\d{2})$/.exec(s);
    if (m && Number(m[1]) <= new Date().getFullYear() + 1) {
      year = m[1];
      s = s.slice(0, m.index);
    }
  }
  s = s.replace(/\s*[-|:]\s*$/, '').trim();
  return { title: s, year };
}

/** Choose the best TMDB logo (clearlogo): English or language-less, PNG preferred, highest voted. */
export function pickTmdbLogo(logos = [], lang = 'en') {
  const ok = logos.filter((l) => !l.iso_639_1 || l.iso_639_1 === lang);
  ok.sort((a, b) => (b.file_path?.endsWith('.png') - a.file_path?.endsWith('.png')) || (b.vote_average || 0) - (a.vote_average || 0) || (b.width || 0) - (a.width || 0));
  return ok[0]?.file_path || null;
}
