// Adult content filter, applied once when the catalogue is indexed (store.js).
// Live: channels classified 'adult' (electron/artmatch.js) or in an adult category.
// Movies / series: anything in a category whose name looks adult ("XXX", "Adult 18+").
import { ADULT_RE } from '../../electron/artmatch.js';

const adultCat = (c) => ADULT_RE.test(c?.name || '');

/** { raw: catalogue without adult content (or unchanged when shown), hidden: Set of hidden live ids } */
export function filterAdult(raw, show) {
  const hidden = new Set();
  if (!raw || show) return { raw, hidden };
  const section = (sec, isLive) => {
    const badCats = new Set((sec.categories || []).filter(adultCat).map((c) => c.id));
    const items = sec.items.filter((it) => {
      const bad = badCats.has(it.cat) || (isLive && it.genre === 'adult');
      if (bad && isLive) hidden.add(it.id);
      return !bad;
    });
    return { ...sec, categories: (sec.categories || []).filter((c) => !badCats.has(c.id)), items };
  };
  return { raw: { ...raw, live: section(raw.live, true), vod: section(raw.vod), series: section(raw.series) }, hidden };
}

/** Favourites as shown: hidden adult channels (and adult-tagged favourites) left out. */
export function filterFavs(favs, hidden, show) {
  if (show || !favs) return favs;
  return { ...favs, live: (favs.live || []).filter((c) => !hidden.has(c.id) && c.genre !== 'adult') };
}
