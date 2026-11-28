import { useEffect, useState, useDeferredValue, useMemo } from 'react';
import { useStore, openItem, getState } from '../lib/store.js';
import { api } from '../lib/api.js';
import { searchCatalog } from '../lib/search.js';
import { useNowNext } from '../lib/epg.js';
import { useDiscover } from '../lib/discover.js';
import { CHIPS, sportsChannels, uhdMovies, recentlyAdded, addRecent } from '../lib/searchChips.js';
import { VirtualKeyboard } from '../components/VirtualKeyboard.jsx';
import { PosterCard, ChannelCard, Carousel } from '../components/Cards.jsx';
import { Focusable } from '../components/Focusable.jsx';

const memory = { q: '', chip: null };

/** Recent searches for this playlist and household profile. */
function useRecentSearches() {
  const profileId = useStore((s) => s.profileId);
  const viewer = useStore((s) => s.viewer?.id);
  const [recent, setRecent] = useState([]);
  useEffect(() => {
    api
      .invoke('doc:get', { profileId, name: 'searches' })
      .then((d) => setRecent(d?.recent || []))
      .catch(() => {});
  }, [profileId, viewer]);
  const remember = (term) => {
    const next = addRecent(recent, term);
    if (next === recent || next[0] === recent[0]) return;
    setRecent(next);
    api.invoke('doc:set', { profileId: getState().profileId, name: 'searches', data: { recent: next } }).catch(() => {});
  };
  return [recent, remember];
}

export function Search() {
  const catalog = useStore((s) => s.catalog);
  const detailOpen = useStore((s) => !!s.detail);
  const [q, setQ] = useState(memory.q);
  const [chip, setChip] = useState(memory.chip);
  const dq = useDeferredValue(q);
  const res = useMemo(() => (dq.trim() ? searchCatalog(catalog, dq) : null), [catalog, dq]);
  const epg = useNowNext(res?.live.slice(0, 20) || []);
  const [recent, remember] = useRecentSearches();
  useEffect(() => {
    memory.q = q;
    memory.chip = chip;
  }, [q, chip]);
  useEffect(() => {
    if (q.trim()) setChip(null);
  }, [q]);

  // Opening something from the results remembers the search.
  const open = (item, list) => {
    if (dq.trim()) remember(dq.trim());
    openItem(item, list);
  };

  const total = res ? res.live.length + res.movies.length + res.series.length : 0;
  return (
    <div className="search">
      <div className="search-left">
        <h1>Search</h1>
        <VirtualKeyboard value={q} onChange={setQ} placeholder="Type to search…" group="search-kb" active={!detailOpen} />
      </div>
      <div className="search-results">
        {!res && (
          <>
            <div className="search-chips" data-focus-group="s-chips">
              {CHIPS.map((c) => (
                <Focusable key={c.id} className={`pill ${chip === c.id ? 'is-active' : ''}`} onSelect={() => setChip(chip === c.id ? null : c.id)}>
                  {c.label}
                </Focusable>
              ))}
            </div>
            {recent.length > 0 && (
              <div className="search-recent" data-focus-group="s-recent">
                <span className="muted">Recent</span>
                {recent.map((t) => (
                  <Focusable key={t} className="pill pill-recent" onSelect={() => setQ(t)}>
                    {t}
                  </Focusable>
                ))}
              </div>
            )}
            {chip ? <ChipResults id={chip} catalog={catalog} /> : <p className="empty big">Channels, movies and series appear here as you type.</p>}
          </>
        )}
        {res && !total && <p className="empty big">No results for “{dq}”</p>}
        {res && (
          <>
            <Carousel title={`Channels · ${res.live.length}`} group="s-live" count={res.live.length}>
              {res.live.map((c) => (
                <ChannelCard key={c.id} item={c} nowTitle={epg[c.epg]?.now?.title} onSelect={() => open(c, res.live)} />
              ))}
            </Carousel>
            <Carousel title={`Movies · ${res.movies.length}`} group="s-movies" count={res.movies.length}>
              {res.movies.map((m) => (
                <PosterCard key={m.id} item={m} caption subtitle={m.year} onSelect={() => open(m)} />
              ))}
            </Carousel>
            <Carousel title={`Series · ${res.series.length}`} group="s-series" count={res.series.length}>
              {res.series.map((m) => (
                <PosterCard key={m.id} item={m} caption subtitle={m.year} onSelect={() => open(m)} />
              ))}
            </Carousel>
          </>
        )}
      </div>
    </div>
  );
}

const TRENDING = ['trending'];

/** What a quick-filter chip shows. */
function ChipResults({ id, catalog }) {
  const films = useDiscover('movie', id === 'trending' ? TRENDING : []);
  const shows = useDiscover('tv', id === 'trending' ? TRENDING : []);
  const live = useMemo(() => (id === 'sports' ? sportsChannels(catalog.live) : []), [id, catalog]);
  const epg = useNowNext(live.slice(0, 20));
  const rows = useMemo(() => {
    if (id === 'trending')
      return [
        ['Trending films', films.trending || []],
        ['Trending TV', shows.trending || []],
      ];
    if (id === '4k') return [['4K movies', uhdMovies(catalog.vod)]];
    if (id === 'recent') return [['Recently added', recentlyAdded(catalog.vod, catalog.series)]];
    return [];
  }, [id, catalog, films, shows]);
  if (id === 'sports') {
    if (!live.length) return <p className="empty big">No sports channels found in this playlist.</p>;
    return (
      <Carousel title={`Live sports · ${live.length}`} group="s-chip-live" count={live.length}>
        {live.map((c) => (
          <ChannelCard key={c.id} item={c} nowTitle={epg[c.epg]?.now?.title} onSelect={() => openItem(c, live)} />
        ))}
      </Carousel>
    );
  }
  const any = rows.some(([, list]) => list.length);
  if (!any) return <p className="empty big">{id === 'trending' ? 'Trending needs a TMDB key (Settings → Library).' : 'Nothing here in this playlist.'}</p>;
  return rows.map(([title, list], i) =>
    list.length ? (
      <Carousel key={title} title={`${title} · ${list.length}`} group={`s-chip-${i}`} count={list.length}>
        {list.map((m) => (
          <PosterCard key={`${m.kind}:${m.id}`} item={m} caption subtitle={m.year} onSelect={() => openItem(m)} />
        ))}
      </Carousel>
    ) : null
  );
}
