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

export const PosterCard = memo(function PosterCard({ item, onSelect, progress, subtitle, focusKey, ...rest }) {
  const fav = useStore((s) => isFavorite(s.favorites, item));
  return (
    <Focusable className="poster-card" onSelect={onSelect} favItem={item} focusKey={focusKey} {...rest}>
      <LazyImg src={item.icon} width={360} className="poster-img" fallback={<span className="poster-initials">{initials(item.name)}</span>} />
      {fav && <Icon name="star" size="1.3rem" className="badge-fav" />}
      {item.rating > 0 && <span className="badge-rating">★ {Number(item.rating).toFixed(1)}</span>}
      {progress > 0 && (
        <div className="card-progress">
          <div style={{ width: `${Math.min(100, progress)}%` }} />
        </div>
      )}
      <div className="poster-title">
        <span>{item.name}</span>
        {subtitle && <small>{subtitle}</small>}
      </div>
    </Focusable>
  );
});

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

/** Horizontal row of cards with its own focus memory. */
export function Carousel({ title, group, children, count }) {
  if (!count) return null;
  return (
    <section className="carousel">
      <h2>{title}</h2>
      <div className="carousel-track" data-focus-group={group}>
        {children}
      </div>
    </section>
  );
}
