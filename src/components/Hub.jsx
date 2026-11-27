// Hub: a full-bleed "Spotlight" (top ~60%) above focus-locked rows. Used by Home
// and by the Discover tabs of Movies / TV Shows.
//  • With `slides` the spotlight is a carousel (trending titles): its button is
//    focusable, ◀ ▶ change slide, it advances by itself every few seconds.
//  • While a card in the rows has focus, the spotlight shows that card.
import { useEffect, useRef, useState } from 'react';
import { api, imgUrl } from '../lib/api.js';
import { useStore, resumeEntry, openItem } from '../lib/store.js';
import { useNowNext } from '../lib/epg.js';
import { PosterCard, LandscapeCard, ChannelTile, Carousel, useRowLock, qualityTags } from './Cards.jsx';
import { Focusable } from './Focusable.jsx';
import { Icon } from './Icons.jsx';
import { useKeyHandler } from '../nav/keys.js';
import { useArt, useArtSettings, chooseArt } from '../lib/art.js';
import { clock, pad, humanDuration, progressPct } from '../lib/format.js';

const SLIDE_MS = 8000;
export const epBadge = (e) => `S${pad(e.season)} • E${pad(e.episode)}`;

const slideHero = (it) => ({ kind: it.kind, item: it, title: it.name });

function heroFor(row, it, epg) {
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
}

/**
 * rows: [{ key, title, type: 'cw'|'live'|'poster'|'landscape', items }]
 * slides: provider items for the spotlight carousel (optional)
 * tabs: element drawn over the spotlight (pill tabs)
 */
export function Hub({ rows, slides, tabs, rowsKey, empty, className = '' }) {
  const [hero, setHero] = useState(null);
  const [slide, setSlide] = useState(0);
  const [onSpot, setOnSpot] = useState(false);
  const heroTimer = useRef(null);
  const ctaRef = useRef(null);
  const rowLock = useRowLock();
  const liveRow = rows.find((r) => r.type === 'live');
  const epg = useNowNext(liveRow ? liveRow.items : []);
  const visibleRows = rows.filter((r) => r.items.length);
  const hasSlides = !!slides?.length;
  const cur = hasSlides ? slides[slide % slides.length] : null;

  useEffect(() => () => clearTimeout(heroTimer.current), []);
  // Trending loads a moment after the page: if the user hasn't moved yet, start on the carousel.
  const hostRef = useRef(null);
  const moved = useRef(false);
  useEffect(() => {
    const onKey = () => (moved.current = true);
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  useEffect(() => {
    if (!hasSlides || !ctaRef.current || moved.current) return;
    const a = document.activeElement;
    if (!a || a === document.body || hostRef.current?.contains(a)) ctaRef.current.focus();
  }, [hasSlides]);
  useEffect(() => setSlide(0), [slides]);
  // Auto-advance while the carousel has focus (or nothing below has been chosen yet).
  useEffect(() => {
    if (!hasSlides || (!onSpot && hero)) return;
    const t = setInterval(() => setSlide((i) => (i + 1) % slides.length), SLIDE_MS);
    return () => clearInterval(t);
  }, [hasSlides, onSpot, hero, slides, slide]);

  useKeyHandler(
    (action) => {
      if (!hasSlides || document.activeElement !== ctaRef.current) return false;
      if (action === 'left' && slide === 0) return false; // let focus go to the side menu
      if (action !== 'left' && action !== 'right') return false;
      setSlide((i) => (i + (action === 'right' ? 1 : -1) + slides.length) % slides.length);
      return true;
    },
    { priority: 25 }
  );

  const focusHero = (h) => {
    clearTimeout(heroTimer.current);
    heroTimer.current = setTimeout(() => setHero(h), 110);
  };

  const first = visibleRows[0];
  const shownHero = cur && (onSpot || !hero) ? slideHero(cur) : hero || (first ? heroFor(first, first.items[0], epg) : null);

  const renderCard = (row, it, i) => {
    const h = () => {
      setOnSpot(false);
      focusHero(heroFor(row, it, epg));
    };
    const auto = !hasSlides && row === first && i === 0;
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
    if (row.type === 'landscape') {
      return <LandscapeCard key={`${it.kind}${it.id}`} item={it} title={it.name} onFocus={h} onSelect={() => openItem(it)} autoFocus={auto} />;
    }
    if (row.type === 'live') {
      return <ChannelTile key={it.id} item={it} now={epg[it.epg]?.now} onFocus={h} onSelect={() => openItem(it, row.items)} autoFocus={auto} />;
    }
    return <PosterCard key={`${it.kind}${it.id}`} item={it} onFocus={h} onSelect={() => openItem(it)} autoFocus={auto} />;
  };

  return (
    <div ref={hostRef} className={`home2 ${hasSlides ? 'has-carousel' : ''} ${className}`}>
      <Spotlight hero={shownHero} carousel={hasSlides && (onSpot || !hero)} />
      {tabs}
      {hasSlides && (
        <div className="spot-carousel">
          <Focusable
            ref={ctaRef}
            className="btn btn-primary spot-cta"
            autoFocus
            onFocus={() => {
              clearTimeout(heroTimer.current);
              setOnSpot(true);
              setHero(null);
            }}
            onSelect={() => cur && openItem(cur)}
          >
            <Icon name="play" size="1.2rem" /> {cur?.kind === 'series' ? 'View show' : 'View film'}
          </Focusable>
          <div className="spot-dots" aria-hidden="true">
            {slides.map((s, i) => (
              <i key={`${s.kind}${s.id}`} className={i === slide % slides.length ? 'is-on' : ''} />
            ))}
          </div>
          {onSpot && <span className="spot-carousel-hint">◀ ▶ more trending</span>}
        </div>
      )}
      <div className="home-rows">
        <div className="home-rows-inner" key={rowsKey} ref={rowLock.ref} onFocus={rowLock.onFocus} style={rowLock.style}>
          {visibleRows.length === 0 && empty}
          {visibleRows.map((row) => (
            <Carousel key={row.key} title={row.title} group={`hub-${rowsKey}-${row.key}`} count={row.items.length} className={`row-${row.type}`}>
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
          const slim = { backdrop: r.backdrop, plot: r.plot, year: r.year, genre: r.genre, duration: r.duration, rating: r.rating, seasons: r.seasons?.length, tmdbId: r.tmdbId };
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

function Spotlight({ hero, carousel }) {
  const info = useDetails(hero);
  const mode = useArtSettings();
  const it0 = hero?.item;
  // Wait for provider details (may carry a TMDB id) before asking TMDB.
  const art = useArt(it0 && info?.tmdbId ? { ...it0, tmdbId: info.tmdbId } : it0, !!hero && hero.kind !== 'live');
  if (!hero) return <section className="spotlight" />;
  const it = hero.item;
  const live = hero.kind === 'live';
  const wide = chooseArt(mode, info?.backdrop || (hero.kind === 'episode' ? it.icon : ''), art?.backdrop || it.tmdb?.backdrop);
  const backdrop = live ? '' : wide || it.icon || it.seriesIcon || '';
  const isPoster = !live && !wide;
  const clearlogo = !live && art?.logo;
  const rating = info?.rating || it.rating || (it.tmdb?.rating ? it.tmdb.rating / 2 : 0);
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
  const synopsis = live ? hero.now?.desc || (hero.next ? `Next: ${clock(hero.next.start)} ${hero.next.title}` : '') : info?.plot || it.plot || art?.overview || it.tmdb?.overview || '';

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
        {clearlogo ? (
          <h1 className="spot-title spot-title-logo">
            <img src={imgUrl(clearlogo, 800)} alt={hero.title} />
          </h1>
        ) : (
          <h1 className="spot-title">{live && hero.now ? hero.now.title : hero.title}</h1>
        )}
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
        {carousel ? null : (
        <div className="spot-hint">
          <Icon name="play" size="1rem" /> OK to {live ? 'watch' : hero.kind === 'cw' || hero.pct ? 'resume' : 'open'} · PgUp/PgDn switch tabs
        </div>
        )}
      </div>
    </section>
  );
}
