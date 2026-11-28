// Home: hub tabs over a spotlight carousel of trending titles, then rows
// (Continue Watching, Because you watched…, favourite channels, popular movies
// and shows, recently added).
import { useMemo, useRef, useState } from 'react';
import { useStore, continueWatching } from '../lib/store.js';
import { PillTabs, useTabCycle } from '../components/PillTabs.jsx';
import { Hub } from '../components/Hub.jsx';
import { focusFirst } from '../nav/spatial.js';
import { useDiscover, useBecauseYouWatched } from '../lib/discover.js';

const N = 24;
const TABS = [
  { id: 'featured', label: 'Featured' },
  { id: 'continue', label: 'Continue Watching' },
  { id: 'recent', label: 'Recently Added' },
  { id: 'favs', label: 'Favourites' },
];
const memory = { tab: 'featured' };

/** Alternate two lists: movie, show, movie, show… */
const interleave = (a = [], b = []) => {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
};

export function Home() {
  const catalog = useStore((s) => s.catalog);
  const progress = useStore((s) => s.progress);
  const favs = useStore((s) => s.favorites);
  const [tab, setTab] = useState(memory.tab);
  const hubRef = useRef(null);
  const movies = useDiscover('movie');
  const shows = useDiscover('tv');
  const byw = useBecauseYouWatched(2);

  const cw = useMemo(() => continueWatching(progress).slice(0, N), [progress]);

  const changeTab = (id) => {
    memory.tab = id;
    setTab(id);
  };
  const focusRows = () => requestAnimationFrame(() => focusFirst(hubRef.current?.querySelector('.home-rows') || hubRef.current));
  useTabCycle(TABS, tab, changeTab, focusRows);

  const slides = useMemo(() => interleave(movies.trending, shows.trending).slice(0, 10), [movies.trending, shows.trending]);

  const rows = useMemo(() => {
    const cwRow = (title, list) => ({ key: `cw-${title}`, title, type: 'cw', items: list });
    const posters = (key, title, items) => ({ key, title, type: 'poster', items: (items || []).slice(0, N) });
    const channels = { key: 'live', title: 'Favourite Channels', type: 'live', items: favs.live.slice(0, N) };
    const recentMovies = catalog.vod.recent.slice(0, N);
    const recentSeries = catalog.series.recent.slice(0, N);
    switch (tab) {
      case 'continue':
        return [cwRow('Movies', cw.filter((p) => p.item.kind === 'movie')), cwRow('Series', cw.filter((p) => p.item.kind === 'episode'))];
      case 'recent':
        return [
          posters('rm', 'New Movies', recentMovies),
          posters('rs', 'New Series', recentSeries),
          posters('tr', 'Top Rated New Releases', [...catalog.vod.recent].sort((a, b) => b.rating - a.rating)),
        ];
      case 'favs':
        return [channels, posters('fm', 'Movies', favs.movie), posters('fs', 'Series', favs.series)];
      default:
        return [
          cwRow('Continue Watching', cw),
          ...byw.map((r) => ({ key: `byw-${r.source.kind}${r.source.id}`, title: `Because you watched ${r.source.name}`, type: 'landscape', items: r.items })),
          channels,
          posters('pm', 'Popular Movies', movies.popular),
          posters('ps', 'Popular TV Shows', shows.popular),
          posters('rm', 'Recently Added Movies', recentMovies),
          posters('rs', 'Recently Added Series', recentSeries),
          posters('fv', 'Your Favourites', [...favs.movie, ...favs.series]),
        ];
    }
  }, [tab, cw, favs, catalog, byw, movies.popular, shows.popular]);

  return (
    <div ref={hubRef} className="hub-host">
      <Hub
        rows={rows}
        slides={tab === 'featured' ? slides : null}
        rowsKey={tab}
        tabs={<PillTabs tabs={TABS} active={tab} onChange={changeTab} group="home-tabs" className="home-tabs" onSelected={focusRows} />}
        empty={
          <p className="empty big">
            {tab === 'continue' ? 'Nothing in progress yet — start a movie or episode and it will appear here.' : tab === 'favs' ? 'Hold OK (or press F) on any channel, film or series to add it to Favourites.' : 'Nothing here yet.'}
          </p>
        }
      />
    </div>
  );
}
