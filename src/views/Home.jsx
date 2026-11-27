import { useEffect, useMemo, useState } from 'react';
import { useStore, continueWatching, resumeEntry, openItem } from '../lib/store.js';
import { useNowNext } from '../lib/epg.js';
import { PosterCard, ChannelCard, Carousel } from '../components/Cards.jsx';
import { clock, epLabel } from '../lib/format.js';

const ROW = 24;

export function Home() {
  const catalog = useStore((s) => s.catalog);
  const progress = useStore((s) => s.progress);
  const favs = useStore((s) => s.favorites);
  const cw = useMemo(() => continueWatching(progress).slice(0, ROW), [progress]);
  const favLive = favs.live.slice(0, ROW);
  const recentMovies = useMemo(() => catalog.vod.recent.slice(0, ROW), [catalog]);
  const recentSeries = useMemo(() => catalog.series.recent.slice(0, ROW), [catalog]);
  const favVod = useMemo(() => [...favs.movie, ...favs.series].slice(0, ROW), [favs]);
  const epg = useNowNext(favLive);

  return (
    <div className="home">
      <HomeHeader />
      <Carousel title="Continue Watching" group="home-cw" count={cw.length}>
        {cw.map((p, i) => (
          <PosterCard
            key={p.key}
            item={{ ...p.item, icon: p.item.icon || p.item.seriesIcon, name: p.item.seriesName || p.item.name }}
            subtitle={p.item.kind === 'episode' ? `${epLabel(p.item)} · ${p.item.name}` : undefined}
            progress={p.dur ? (p.pos / p.dur) * 100 : 0}
            onSelect={() => resumeEntry(p)}
            autoFocus={i === 0}
          />
        ))}
      </Carousel>
      <Carousel title="Favorite Channels" group="home-live" count={favLive.length}>
        {favLive.map((c, i) => (
          <ChannelCard key={c.id} item={c} nowTitle={epg[c.epg]?.now?.title} onSelect={() => openItem(c, favLive)} autoFocus={!cw.length && i === 0} />
        ))}
      </Carousel>
      <Carousel title="Recently Added Movies" group="home-movies" count={recentMovies.length}>
        {recentMovies.map((m, i) => (
          <PosterCard key={m.id} item={m} onSelect={() => openItem(m)} autoFocus={!cw.length && !favLive.length && i === 0} />
        ))}
      </Carousel>
      <Carousel title="Recently Added Series" group="home-series" count={recentSeries.length}>
        {recentSeries.map((m) => (
          <PosterCard key={m.id} item={m} subtitle={m.year} onSelect={() => openItem(m)} />
        ))}
      </Carousel>
      <Carousel title="Your Favorites" group="home-favs" count={favVod.length}>
        {favVod.map((m) => (
          <PosterCard key={`${m.kind}${m.id}`} item={m} onSelect={() => openItem(m)} />
        ))}
      </Carousel>
    </div>
  );
}

export function HomeHeader() {
  const profiles = useStore((s) => s.profiles);
  const pid = useStore((s) => s.profileId);
  const account = useStore((s) => s.account);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  const p = profiles.list.find((x) => x.id === pid);
  const exp = account?.user?.expires;
  return (
    <header className="page-head">
      <div>
        <h1>{p?.name || 'Home'}</h1>
        {exp && <small className="muted">Subscription until {new Date(exp).toLocaleDateString()}</small>}
      </div>
      <span className="clock">{clock(now)}</span>
    </header>
  );
}
