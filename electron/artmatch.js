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
  const byId = new Map();
  const byName = new Map();
  for (const c of channels || []) {
    if (!c?.id || !logoBy.has(c.id) || c.closed) continue;
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
    return ch ? logoBy.get(ch.id).url : null;
  };
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
