import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore, setState, getState, play, toggleFavorite, isFavorite } from '../lib/store.js';
import { Focusable } from '../components/Focusable.jsx';
import { LazyImg } from '../components/Cards.jsx';
import { Icon } from '../components/Icons.jsx';
import { useBack } from '../nav/keys.js';
import { pushScope, focusFirst } from '../nav/spatial.js';
import { duration, humanDuration } from '../lib/format.js';
import { useArt, useArtSettings, chooseArt, artChoices } from '../lib/art.js';

/** Full-screen overlay with its own focus scope; Back closes it. */
export function DetailOverlay({ children, className = '' }) {
  const ref = useRef(null);
  useLayoutEffect(() => pushScope(ref.current), []);
  useBack(() => (setState({ detail: null }), true), { priority: 90 });
  return (
    <div ref={ref} className={`detail ${className}`}>
      {children}
    </div>
  );
}

export function useDetailInfo(channel, item) {
  const pid = useStore((s) => s.profileId);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    api
      .invoke(channel, { profileId: pid, item: { id: item.id, name: item.name, icon: item.icon, ext: item.ext } })
      .then((r) => !cancelled && setInfo(r))
      .catch((e) => !cancelled && setError(e.message));
    return () => (cancelled = true);
  }, [channel, item, pid]);
  return { info, error };
}

/** Forget a saved position (used by "Play from start"). */
export async function clearProgress(key) {
  const { progress, profileId } = getState();
  const next = { ...progress };
  delete next[key];
  setState({ progress: next });
  await api.invoke('doc:set', { profileId, name: 'progress', data: next });
}

export function MovieDetail({ item }) {
  const { info, error } = useDetailInfo('vod:info', item);
  const prog = useStore((s) => s.progress[`movie:${item.id}`]);
  const fav = useStore((s) => isFavorite(s.favorites, item));
  const ref = useRef(null);
  const resumable = prog && !prog.watched && prog.pos > 30;
  const mode = useArtSettings();
  const art = useArt(info ? { ...item, tmdbId: info.tmdbId } : item, !!info || !!error);
  const m0 = { ...item, ...(info || {}), kind: 'movie', icon: info?.icon || item.icon };
  const m = { ...m0, icon: chooseArt(mode, m0.icon, art?.poster), backdrop: chooseArt(mode, m0.backdrop, art?.backdrop), plot: m0.plot || art?.overview || '' };

  const loaded = !!info;
  useEffect(() => {
    requestAnimationFrame(() => focusFirst(ref.current));
  }, [loaded]);

  const start = async (fromStart) => {
    const playItem = { kind: 'movie', id: m.id, name: m.name, ext: m.ext, icon: m.icon, duration: m.duration };
    if (fromStart && prog) await clearProgress(`movie:${m.id}`);
    play([playItem]);
  };

  return (
    <DetailOverlay>
      {(m0.backdrop || art?.backdrop) && <LazyImg src={artChoices(mode, m0.backdrop, art?.backdrop)} width={1920} className="detail-backdrop" />}
      <div className="detail-body" ref={ref}>
        <LazyImg src={artChoices(mode, m0.icon, art?.poster)} width={480} className="detail-poster" fallback={<Icon name="movie" size="4rem" />} />
        <div className="detail-info">
          <h1>{m.name}</h1>
          <div className="meta">
            {[m.year, humanDuration(m.duration), m.genre, m.rating ? `★ ${Number(m.rating).toFixed(1)}` : ''].filter(Boolean).join('  ·  ')}
          </div>
          {!info && !error && <p className="muted">Loading details…</p>}
          {error && <p className="error-text">{error}</p>}
          {m.plot && <p className="plot">{m.plot}</p>}
          {m.director && (
            <p className="credits">
              <b>Director</b> {m.director}
            </p>
          )}
          {m.cast && (
            <p className="credits">
              <b>Cast</b> {m.cast}
            </p>
          )}
          <div className="row-buttons" data-focus-group="detail-actions">
            {resumable && (
              <Focusable className="btn btn-primary" autoFocus onSelect={() => start(false)}>
                <Icon name="play" /> Resume {duration(prog.pos)}
              </Focusable>
            )}
            <Focusable className={`btn ${resumable ? '' : 'btn-primary'}`} autoFocus={!resumable} onSelect={() => start(true)}>
              <Icon name="play" /> {resumable ? 'Play from start' : 'Play'}
            </Focusable>
            <Focusable className={`btn ${fav ? 'is-on' : ''}`} onSelect={() => toggleFavorite(item)}>
              <Icon name="star" /> {fav ? 'In Favourites' : 'Add to Favourites'}
            </Focusable>
          </div>
        </div>
      </div>
    </DetailOverlay>
  );
}
