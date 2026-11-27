// Home: "Spotlight" hero (top ~60%) that follows focus, hub tabs, and
// focus-locked rows (the focused row rises to a fixed line; the focused card is
// held ~12% from the left edge).
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, imgUrl } from '../lib/api.js';
import { useStore, continueWatching, resumeEntry, openItem } from '../lib/store.js';
import { useNowNext } from '../lib/epg.js';
import { PosterCard, LandscapeCard, ChannelTile, Carousel, useRowLock, qualityTags } from '../components/Cards.jsx';
import { PillTabs, useTabCycle } from '../components/PillTabs.jsx';
import { Icon } from '../components/Icons.jsx';
import { focusFirst } from '../nav/spatial.js';
import { clock, pad, humanDuration, progressPct } from '../lib/format.js';

const N = 24;
const TABS = [
  { id: 'featured', label: 'Featured' },
  { id: 'continue', label: 'Continue Watching' },
  { id: 'recent', label: 'Recently Added' },
  { id: 'favs', label: 'Favourites' },
];
const memory = { tab: 'featured' };
const epBadge = (e) => `S${pad(e.season)} • E${pad(e.episode)}`;

export function Home() {
  const catalog = useStore((s) => s.catalog);
  const progress = useStore((s) => s.progress);
  const favs = useStore((s) => s.favorites);
  const [tab, setTab] = useState(memory.tab);
  const [hero, setHero] = useState(null);
  const heroTimer = useRef(null);
  const rowsRef = useRef(null);
  const rowLock = useRowLock();

  const cw = useMemo(() => continueWatching(progress).slice(0, N), [progress]);
  const epg = useNowNext(favs.live.slice(0, N));

  const changeTab = (id) => {
    memory.tab = id;
    setTab(id);
  };
  useTabCycle(TABS, tab, changeTab, () => requestAnimationFrame(() => focusFirst(rowsRef.current)));
  useEffect(() => () => clearTimeout(heroTimer.current), []);

  const focusHero = (h) => {
    clearTimeout(heroTimer.current);
    heroTimer.current = setTimeout(() => setHero(h), 110);
  };

  // ---- row definitions per tab ----
  const rows = useMemo(() => {
    const cwRow = (title, list) => ({ key: `cw-${title}`, title, type: 'cw', items: list });
    const posters = (key, title, items) => ({ key, title, type: 'poster', items });
    const channels = { key: 'live', title: 'Favourite Channels', type: 'live', items: favs.live.slice(0, N) };
    const recentMovies = catalog.vod.recent.slice(0, N);
    const recentSeries = catalog.series.recent.slice(0, N);
    switch (tab) {
      case 'continue':
        return [
          cwRow('Movies', cw.filter((p) => p.item.kind === 'movie')),
          cwRow('Series', cw.filter((p) => p.item.kind === 'episode')),
        ];
      case 'recent':
        return [
          posters('rm', 'New Movies', recentMovies),
          posters('rs', 'New Series', recentSeries),
          posters('tr', 'Top Rated New Releases', [...catalog.vod.recent].sort((a, b) => b.rating - a.rating).slice(0, N)),
        ];
      case 'favs':
        return [channels, posters('fm', 'Movies', favs.movie.slice(0, N)), posters('fs', 'Series', favs.series.slice(0, N))];
      default:
        return [
          cwRow('Continue Watching', cw),
          channels,
          posters('rm', 'Recently Added Movies', recentMovies),
          posters('rs', 'Recently Added Series', recentSeries),
          posters('fv', 'Your Favourites', [...favs.movie, ...favs.series].slice(0, N)),
        ];
    }
  }, [tab, cw, favs, catalog]);
  const visibleRows = rows.filter((r) => r.items.length);

  const heroFor = (row, it) => {
    if (row.type === 'cw') {
      const e = it.item;
      return {
        kind: e.kind,
        item: e,
        title: e.seriesName || e.name,
        subtitle: e.kind === 'episode' ? `${epBadge(e)}${e.name ? ` · ${e.name}` : ''}` : '',
        left: it.dur ? it.dur - it.pos : 0,
        pct: it.dur ? (it.pos / it.dur) * 100 : 0,
      };
    }
    if (row.type === 'live') return { kind: 'live', item: it, title: it.name, now: epg[it.epg]?.now, next: epg[it.epg]?.next };
    return { kind: it.kind, item: it, title: it.name };
  };

  // Default spotlight: first item of the first row.
  const first = visibleRows[0];
  const shownHero = hero || (first ? heroFor(first, first.items[0]) : null);

  const renderCard = (row, it, i) => {
    const h = () => focusHero(heroFor(row, it));
    const auto = row === first && i === 0;
    if (row.type === 'cw') {
      const e = it.item;
      return (
        <LandscapeCard
          key={it.key}
          item={e}
          title={e.seriesName || e.name}
          badge={e.kind === 'episode' ? epBadge(e) : null}
          progress={it.dur ? (it.pos / it.dur) * 100 : 0}
          onFocus={h}
          onSelect={() => resumeEntry(it)}
          autoFocus={auto}
        />
      );
    }
    if (row.type === 'live') {
      return <ChannelTile key={it.id} item={it} now={epg[it.epg]?.now} onFocus={h} onSelect={() => openItem(it, row.items)} autoFocus={auto} />;
    }
    return <PosterCard key={`${it.kind}${it.id}`} item={it} onFocus={h} onSelect={() => openItem(it)} autoFocus={auto} />;
  };

  return (
    <div className="home2">
      <Spotlight hero={shownHero} />
      <PillTabs
        tabs={TABS}
        active={tab}
        onChange={changeTab}
        group="home-tabs"
        className="home-tabs"
        onSelected={() => requestAnimationFrame(() => focusFirst(rowsRef.current))}
      />
      <div className="home-rows" ref={rowsRef}>
        <div className="home-rows-inner" key={tab} ref={rowLock.ref} onFocus={rowLock.onFocus} style={rowLock.style}>
          {visibleRows.length === 0 && (
            <p className="empty big">
              {tab === 'continue' ? 'Nothing in progress yet — start a movie or episode and it will appear here.' : 'Press F on any channel, movie or series to add it to Favourites.'}
            </p>
          )}
          {visibleRows.map((row) => (
            <Carousel key={row.key} title={row.title} group={`home-${row.key}`} count={row.items.length} className={`row-${row.type}`}>
              {row.items.map((it, i) => renderCard(row, it, i))}
            </Carousel>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- spotlight
const infoCache = new Map();
function useDetails(hero) {
  const pid = useStore((s) => s.profileId);
  const [info, setInfo] = useState(null);
  const it = hero?.item;
  const key = it && (it.kind === 'movie' || it.kind === 'series') ? `${it.kind}:${it.id}` : null;
  useEffect(() => {
    if (!key) return setInfo(null);
    if (infoCache.has(key)) return setInfo(infoCache.get(key));
    setInfo(null);
    const t = setTimeout(() => {
      api
        .invoke(it.kind === 'movie' ? 'vod:info' : 'series:info', { profileId: pid, item: { id: it.id, name: it.name, icon: it.icon, ext: it.ext } })
        .then((r) => {
          const slim = { backdrop: r.backdrop, plot: r.plot, year: r.year, genre: r.genre, duration: r.duration, rating: r.rating, seasons: r.seasons?.length };
          infoCache.set(key, slim);
          setInfo(slim);
        })
        .catch(() => infoCache.set(key, {}));
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pid]);
  return info;
}

/** Crossfading backdrop: the new image fades in over the old once it has loaded. */
function Backdrop({ src, poster }) {
  const [layers, setLayers] = useState([]);
  useEffect(() => {
    setLayers((ls) => {
      const keep = ls.filter((l) => l.src !== src && l.ready).slice(-1).map((l) => ({ ...l, out: true }));
      return src ? [...keep, { src, ready: false, poster }] : keep;
    });
  }, [src, poster]);
  return (
    <div className="spot-backdrop">
      {layers.map((l) => (
        <img
          key={l.src}
          src={imgUrl(l.src, 1600)}
          alt=""
          decoding="async"
          className={`${l.ready && !l.out ? 'is-on' : ''} ${l.poster ? 'is-poster' : ''}`}
          onLoad={() => setLayers((ls) => ls.map((x) => (x.src === l.src ? { ...x, ready: true } : x)))}
          onError={() => setLayers((ls) => ls.filter((x) => x.src !== l.src))}
        />
      ))}
      <div className="spot-vignette" />
    </div>
  );
}

function Spotlight({ hero }) {
  const info = useDetails(hero);
  if (!hero) return <section className="spotlight" />;
  const it = hero.item;
  const live = hero.kind === 'live';
  const backdrop = live ? '' : info?.backdrop || (hero.kind === 'episode' ? it.icon : '') || it.icon || it.seriesIcon || '';
  const isPoster = !live && !info?.backdrop && !(hero.kind === 'episode' && it.icon);
  const rating = info?.rating || it.rating;
  const pills = live
    ? [it.num ? `CH ${it.num}` : null, hero.now ? `${clock(hero.now.start)} – ${clock(hero.now.stop)}` : null, ...qualityTags(it.name)]
    : [
        info?.year || it.year,
        rating ? `★ ${Number(rating).toFixed(1)}` : null,
        info?.duration ? humanDuration(info.duration) : null,
        info?.seasons ? `${info.seasons} season${info.seasons > 1 ? 's' : ''}` : hero.kind === 'series' ? 'Series' : null,
        ...qualityTags(it.name),
        info?.genre?.split(/[,/]/)[0]?.trim(),
        hero.left > 0 ? `${humanDuration(hero.left)} left` : null,
      ];
  const synopsis = live ? hero.now?.desc || (hero.next ? `Next: ${clock(hero.next.start)} ${hero.next.title}` : '') : info?.plot || it.plot || '';

  return (
    <section className="spotlight">
      <Backdrop src={backdrop} poster={isPoster} />
      <div className="spot-text" key={`${hero.kind}:${it.id}`}>
        {live && (
          <div className="spot-live">
            <span className="tag tag-live">LIVE</span>
            {it.icon && <img className="spot-logo" src={imgUrl(it.icon, 240)} alt="" />}
          </div>
        )}
        <h1 className="spot-title">{live && hero.now ? hero.now.title : hero.title}</h1>
        {(hero.subtitle || (live && hero.now)) && <div className="spot-sub">{hero.subtitle || it.name}</div>}
        <div className="spot-pills">
          {pills.filter(Boolean).map((p) => (
            <span key={p} className="meta-pill">
              {p}
            </span>
          ))}
        </div>
        {live && hero.now && (
          <div className="progress spot-progress">
            <div style={{ width: `${progressPct(hero.now.start, hero.now.stop)}%` }} />
          </div>
        )}
        {hero.pct > 0 && (
          <div className="progress spot-progress">
            <div style={{ width: `${hero.pct}%` }} />
          </div>
        )}
        {synopsis && <p className="spot-synopsis">{synopsis}</p>}
        <div className="spot-hint">
          <Icon name="play" size="1rem" /> OK to {live ? 'watch' : hero.kind === 'cw' || hero.pct ? 'resume' : 'open'} · PgUp/PgDn switch tabs
        </div>
      </div>
    </section>
  );
}
