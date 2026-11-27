import { useEffect, useState, useDeferredValue, useMemo } from 'react';
import { useStore, openItem } from '../lib/store.js';
import { searchCatalog } from '../lib/search.js';
import { useNowNext } from '../lib/epg.js';
import { VirtualKeyboard } from '../components/VirtualKeyboard.jsx';
import { PosterCard, ChannelCard, Carousel } from '../components/Cards.jsx';

const memory = { q: '' };

export function Search() {
  const catalog = useStore((s) => s.catalog);
  const detailOpen = useStore((s) => !!s.detail);
  const [q, setQ] = useState(memory.q);
  const dq = useDeferredValue(q);
  const res = useMemo(() => (dq.trim() ? searchCatalog(catalog, dq) : null), [catalog, dq]);
  const epg = useNowNext(res?.live.slice(0, 20) || []);
  useEffect(() => void (memory.q = q), [q]);

  const total = res ? res.live.length + res.movies.length + res.series.length : 0;
  return (
    <div className="search">
      <div className="search-left">
        <h1>Search</h1>
        <VirtualKeyboard value={q} onChange={setQ} placeholder="Type to search…" group="search-kb" active={!detailOpen} />
      </div>
      <div className="search-results">
        {!res && <p className="empty big">Channels, movies and series appear here as you type.</p>}
        {res && !total && <p className="empty big">No results for “{dq}”</p>}
        {res && (
          <>
            <Carousel title={`Channels · ${res.live.length}`} group="s-live" count={res.live.length}>
              {res.live.map((c) => (
                <ChannelCard key={c.id} item={c} nowTitle={epg[c.epg]?.now?.title} onSelect={() => openItem(c, res.live)} />
              ))}
            </Carousel>
            <Carousel title={`Movies · ${res.movies.length}`} group="s-movies" count={res.movies.length}>
              {res.movies.map((m) => (
                <PosterCard key={m.id} item={m} caption subtitle={m.year} onSelect={() => openItem(m)} />
              ))}
            </Carousel>
            <Carousel title={`Series · ${res.series.length}`} group="s-series" count={res.series.length}>
              {res.series.map((m) => (
                <PosterCard key={m.id} item={m} caption subtitle={m.year} onSelect={() => openItem(m)} />
              ))}
            </Carousel>
          </>
        )}
      </div>
    </div>
  );
}
