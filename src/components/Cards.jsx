import { memo, useEffect, useRef, useState } from 'react';
import { Focusable } from './Focusable.jsx';
import { Icon } from './Icons.jsx';
import { imgUrl } from '../lib/api.js';
import { useStore, isFavorite } from '../lib/store.js';

// One shared IntersectionObserver for all lazy images.
let io = null;
const watchers = new WeakMap();
function observe(el, cb) {
  io ||= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          watchers.get(e.target)?.();
          io.unobserve(e.target);
          watchers.delete(e.target);
        }
      }
    },
    { rootMargin: '400px 600px' }
  );
  watchers.set(el, cb);
  io.observe(el);
  return () => {
    io.unobserve(el);
    watchers.delete(el);
  };
}

export const LazyImg = memo(function LazyImg({ src, width = 480, alt = '', className = '', fallback }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const url = imgUrl(src, width);
  useEffect(() => {
    setFailed(false);
    if (!url || !ref.current) return;
    return observe(ref.current, () => setVisible(true));
  }, [url]);
  return (
    <div ref={ref} className={`lazyimg ${className}`}>
      {url && visible && !failed ? (
        <img src={url} alt={alt} decoding="async" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <div className="lazyimg-fallback">{fallback}</div>
      )}
    </div>
  );
});

const initials = (name) =>
  String(name || '?')
    .replace(/^[A-Z]{2}\s*[|:-]\s*/, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

const QUALITY = [
  [/\b(4k|uhd|2160p)\b/i, '4K'],
  [/\b(hdr10\+?|hdr|dolby vision|dv)\b/i, 'HDR'],
  [/\b(fhd|1080p)\b/i, 'FHD'],
  [/\b(hd|720p)\b/i, 'HD'],
];
/** Quality badges guessed from provider titles ("Film (2024) 4K HDR"). */
export function qualityTags(name = '') {
  const out = [];
  for (const [re, tag] of QUALITY) if (re.test(name) && !(tag === 'HD' && out.length)) out.push(tag);
  return out;
}

/** 2:3 poster card. Image-only in rows (the hero shows the title); `caption` adds a title below. */
export const PosterCard = memo(function PosterCard({ item, onSelect, progress, subtitle, caption = false, focusKey, ...rest }) {
  const fav = useStore((s) => isFavorite(s.favorites, item));
  return (
    <Focusable className={`poster-card ${caption ? 'has-caption' : ''}`} onSelect={onSelect} favItem={item} focusKey={focusKey} {...rest}>
      <div className="card-frame">
        <LazyImg
          src={item.icon}
          width={360}
          className="poster-img"
          fallback={
            <div className="card-fallback">
              <span className="poster-initials">{initials(item.name)}</span>
              <span className="fallback-name">{item.name}</span>
            </div>
          }
        />
        {fav && <Icon name="star" size="1.2rem" className="badge-fav" />}
        {progress > 0 && (
          <div className="card-progress">
            <div style={{ width: `${Math.min(100, progress)}%` }} />
          </div>
        )}
      </div>
      {caption && (
        <div className="poster-title">
          <span>{item.name}</span>
          {subtitle && <small>{subtitle}</small>}
        </div>
      )}
    </Focusable>
  );
});

/** 16:9 card for Continue Watching: artwork, title, episode badge, progress. */
export const LandscapeCard = memo(function LandscapeCard({ item, title, badge, progress, onSelect, ...rest }) {
  return (
    <Focusable className="landscape-card" onSelect={onSelect} favItem={item.kind === 'episode' ? undefined : item} {...rest}>
      <div className="card-frame">
        <LazyImg src={item.icon || item.seriesIcon} width={640} className="poster-img" fallback={<span className="poster-initials">{initials(title)}</span>} />
        <div className="landscape-shade" />
        <div className="landscape-text">
          {badge && <span className="ep-badge">{badge}</span>}
          <span className="landscape-title">{title}</span>
        </div>
        {progress > 0 && (
          <div className="card-progress">
            <div style={{ width: `${Math.min(100, progress)}%` }} />
          </div>
        )}
      </div>
    </Focusable>
  );
});

/** 16:9 live channel tile: centred logo, name, what's on now + progress. */
export const ChannelTile = memo(function ChannelTile({ item, now, onSelect, ...rest }) {
  const fav = useStore((s) => isFavorite(s.favorites, item));
  const pct = now ? Math.min(100, Math.max(0, ((Date.now() - now.start) / (now.stop - now.start)) * 100)) : 0;
  return (
    <Focusable className="landscape-card channel-tile" onSelect={onSelect} favItem={item} {...rest}>
      <div className="card-frame">
        <LazyImg src={item.icon} width={320} className="tile-logo" fallback={<span className="poster-initials">{initials(item.name)}</span>} />
        <div className="landscape-text">
          <span className="landscape-title">
            {item.num ? <b>{item.num}</b> : null} {item.name}
          </span>
          {now && <small>{now.title}</small>}
        </div>
        {fav && <Icon name="star" size="1.2rem" className="badge-fav" />}
        {now && (
          <div className="card-progress">
            <div style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </Focusable>
  );
});

/** Compact channel card (search results, favourites). */
export const ChannelCard = memo(function ChannelCard({ item, onSelect, nowTitle, ...rest }) {
  return (
    <Focusable className="channel-card" onSelect={onSelect} favItem={item} {...rest}>
      <LazyImg src={item.icon} width={240} className="channel-logo" fallback={<span>{initials(item.name)}</span>} />
      <div className="channel-card-text">
        <span className="channel-card-name">
          {item.num ? <b>{item.num}</b> : null} {item.name}
        </span>
        {nowTitle && <small>{nowTitle}</small>}
      </div>
    </Focusable>
  );
});

/**
 * Horizontal row with focus-locked scrolling: the focused card is held ~12%
 * from the screen's left edge while the track slides underneath (transform
 * only, so it stays at 60 fps). The viewport uses overflow:clip so the spatial
 * engine's scrollIntoView can never fight the transform.
 */
export function Carousel({ title, group, children, count, className = '' }) {
  const vp = useRef(null);
  const track = useRef(null);
  const [x, setX] = useState(0);
  const onFocus = (e) => {
    const card = e.target.closest('.carousel-track > *');
    if (!card || !vp.current) return;
    const vpRect = vp.current.getBoundingClientRect();
    const anchor = Math.max(0, window.innerWidth * 0.12 - vpRect.left);
    const max = Math.max(0, track.current.scrollWidth - vp.current.clientWidth);
    setX(Math.min(max, Math.max(0, card.offsetLeft - anchor)));
  };
  if (!count) return null;
  return (
    <section className={`carousel ${className}`} data-row={group}>
      {title && <h2>{title}</h2>}
      <div className="carousel-viewport" ref={vp} onFocus={onFocus}>
        <div className="carousel-track" ref={track} data-focus-group={group} style={{ transform: `translate3d(${-x}px,0,0)` }}>
          {children}
        </div>
      </div>
    </section>
  );
}

/** Vertical counterpart: keeps the focused row at the top of a clipped rows area. */
export function useRowLock() {
  const ref = useRef(null);
  const [y, setY] = useState(0);
  const onFocus = (e) => {
    const row = e.target.closest('[data-row]');
    if (!row || !ref.current?.contains(row)) return;
    setY(row.offsetTop);
  };
  return { ref, onFocus, style: { transform: `translate3d(0,${-y}px,0)` } };
}
