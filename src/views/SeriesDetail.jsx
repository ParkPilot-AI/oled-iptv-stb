import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, play, toggleFavorite, isFavorite, episodePlaylist } from '../lib/store.js';
import { Focusable } from '../components/Focusable.jsx';
import { LazyImg } from '../components/Cards.jsx';
import { Icon } from '../components/Icons.jsx';
import { VirtualList } from '../components/VirtualGrid.jsx';
import { DetailOverlay, useDetailInfo } from './MovieDetail.jsx';
import { focusFirst } from '../nav/spatial.js';
import { epLabel, humanDuration, duration } from '../lib/format.js';

export function SeriesDetail({ item }) {
  const { info, error } = useDetailInfo('series:info', item);
  const progress = useStore((s) => s.progress);
  const fav = useStore((s) => isFavorite(s.favorites, item));
  const [seasonIdx, setSeasonIdx] = useState(0);
  const ref = useRef(null);
  const listRef = useRef(null);

  const playlist = useMemo(() => (info ? episodePlaylist(info, item) : []), [info, item]);

  // Most recent unfinished (or next unwatched) episode for the Resume button.
  const resume = useMemo(() => {
    if (!playlist.length) return null;
    let best = null;
    for (const e of playlist) {
      const p = progress[`episode:${e.id}`];
      if (p && (!best || p.updatedAt > best.p.updatedAt)) best = { e, p };
    }
    if (!best) return { e: playlist[0], p: null, label: `Play ${epLabel(playlist[0])}` };
    if (best.p.watched) {
      const next = playlist[playlist.indexOf(best.e) + 1];
      return next ? { e: next, p: null, label: `Play ${epLabel(next)}` } : null;
    }
    return { ...best, label: `Resume ${epLabel(best.e)} · ${duration(best.p.pos)}` };
  }, [playlist, progress]);

  // Open on the season of the resume episode.
  useEffect(() => {
    if (!info || !resume) return;
    const si = info.seasons.findIndex((s) => s.season === resume.e.season);
    if (si >= 0) setSeasonIdx(si);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  useEffect(() => {
    requestAnimationFrame(() => focusFirst(ref.current));
  }, [!!info]);

  const season = info?.seasons[seasonIdx];
  const playEpisode = (ep) => play(playlist, Math.max(0, playlist.findIndex((x) => x.id === ep.id)));

  return (
    <DetailOverlay className="series-detail">
      {info?.backdrop && <LazyImg src={info.backdrop} width={1920} className="detail-backdrop" />}
      <div className="detail-body" ref={ref}>
        <div className="series-side">
          <LazyImg src={info?.icon || item.icon} width={480} className="detail-poster small" fallback={<Icon name="series" size="4rem" />} />
          <h1>{item.name}</h1>
          <div className="meta">{[info?.year || item.year, info?.genre, item.rating ? `★ ${Number(item.rating).toFixed(1)}` : ''].filter(Boolean).join('  ·  ')}</div>
          {!info && !error && <p className="muted">Loading episodes…</p>}
          {error && <p className="error-text">{error}</p>}
          {info?.plot && <p className="plot clamp">{info.plot}</p>}
          <div className="col-buttons" data-focus-group="series-actions" data-focus-trap="up,down">
            {/* Right always goes to the season column (not straight to episodes). */}
            {resume && (
              <Focusable className="btn btn-primary" autoFocus data-nav-right=".seasons [data-focus-default]" onSelect={() => playEpisode(resume.e)}>
                <Icon name="play" /> {resume.label}
              </Focusable>
            )}
            <Focusable className={`btn ${fav ? 'is-on' : ''}`} data-nav-right=".seasons [data-focus-default]" onSelect={() => toggleFavorite(item)}>
              <Icon name="star" /> {fav ? 'In Favorites' : 'Add to Favorites'}
            </Focusable>
          </div>
        </div>
        {info && (
          <div className="seasons" data-focus-group="seasons" data-focus-trap="up,down">
            {info.seasons.map((s, i) => (
              <Focusable
                key={s.season}
                className={`list-row season-row ${i === seasonIdx ? 'is-active' : ''}`}
                data-focus-default={i === seasonIdx ? '' : undefined}
                onFocus={() => setSeasonIdx(i)}
                onSelect={() => requestAnimationFrame(() => listRef.current?.focusIndex(0))}
              >
                {s.name}
                <span className="count">{s.episodes.length}</span>
              </Focusable>
            ))}
          </div>
        )}
        {season && (
          <VirtualList
            ref={listRef}
            className="episodes"
            group="episodes"
            items={season.episodes}
            rowHeight={6.5}
            renderItem={(e) => {
              const p = progress[`episode:${e.id}`];
              const pct = p?.dur ? (p.pos / p.dur) * 100 : 0;
              return (
                <Focusable className="list-row ep-row" onSelect={() => playEpisode(e)}>
                  <span className="ep-num">{epLabel(e)}</span>
                  <div className="ep-text">
                    <span className="ep-name">{e.name || `Episode ${e.episode}`}</span>
                    <small className="muted">{humanDuration(e.duration || p?.dur)}</small>
                    {pct > 0 && !p.watched && (
                      <div className="mini-progress">
                        <div style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                  {p?.watched && <Icon name="check" className="watched" />}
                </Focusable>
              );
            }}
          />
        )}
      </div>
    </DetailOverlay>
  );
}
