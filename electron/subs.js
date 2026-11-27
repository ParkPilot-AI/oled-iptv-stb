// Subtitle preferences → mpv. Pure functions (tested in test/subs.test.mjs).

// ISO 639-1 → names/codes streams use for the same language.
export const LANGS = {
  en: ['en', 'eng', 'english'],
  es: ['es', 'spa', 'esp', 'spanish', 'español', 'espanol'],
  fr: ['fr', 'fre', 'fra', 'french', 'français', 'francais'],
  de: ['de', 'ger', 'deu', 'german', 'deutsch'],
  it: ['it', 'ita', 'italian', 'italiano'],
  pt: ['pt', 'por', 'portuguese', 'português', 'portugues', 'pt-br', 'pob'],
  nl: ['nl', 'dut', 'nld', 'dutch', 'nederlands'],
  pl: ['pl', 'pol', 'polish', 'polski'],
  tr: ['tr', 'tur', 'turkish', 'türkçe'],
  ar: ['ar', 'ara', 'arabic'],
  hi: ['hi', 'hin', 'hindi'],
  ur: ['ur', 'urd', 'urdu'],
  ro: ['ro', 'rum', 'ron', 'romanian'],
  el: ['el', 'gre', 'ell', 'greek'],
  sv: ['sv', 'swe', 'swedish'],
};

export const SUB_SCALE = { small: 0.8, medium: 1, large: 1.3, xlarge: 1.6 };

function matchesLang(t, lang) {
  const names = LANGS[lang] || [lang];
  const fields = [t.lang, t.title].filter(Boolean).map((s) => String(s).toLowerCase());
  return fields.some((f) => names.some((n) => f === n || f.split(/[\s_\-()[\],/]+/).includes(n)));
}

/**
 * Choose the subtitle track for a newly loaded stream.
 * mode: 'off' | 'on' | 'forced'. Returns a track id, or 'no'.
 *  on:     preferred language → stream's default → first track
 *  forced: forced track in preferred language → any forced track → none
 */
export function pickSubtitle(trackList, { mode = 'forced', lang = 'en' } = {}) {
  const subs = (trackList || []).filter((t) => t.type === 'sub');
  if (mode === 'off' || !subs.length) return 'no';
  const isForced = (t) => t.forced || /forced/i.test(t.title || '');
  if (mode === 'forced') {
    const f = subs.filter(isForced);
    return (f.find((t) => matchesLang(t, lang)) || f[0] || { id: 'no' }).id;
  }
  const full = subs.filter((t) => !isForced(t));
  const pool = full.length ? full : subs;
  return (pool.find((t) => matchesLang(t, lang)) || pool.find((t) => t.default) || pool[0]).id;
}

/** mpv properties for subtitle appearance. */
export function subStyleProps({ subSize = 'medium', subBackground = 'box' } = {}) {
  const box = subBackground === 'box';
  return {
    'sub-scale': SUB_SCALE[subSize] ?? 1,
    'sub-border-style': box ? 'background-box' : 'outline-and-shadow',
    'sub-back-color': box ? '#B3000000' : '#00000000',
    'sub-border-size': box ? 0 : 3,
    'sub-shadow-offset': box ? 0 : 1,
    'sub-margin-y': 40,
  };
}
