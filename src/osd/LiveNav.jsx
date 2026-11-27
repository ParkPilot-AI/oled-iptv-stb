// Live TV extras for the playback overlay:
//  • Channel surf (▲/▼): preview the next/previous channel in a bottom-third
//    banner; tunes automatically after a short pause, or at once on OK.
//  • Glass channel guide (◀): channel list with now/next drawn over the
//    still-playing video; ▲/▼ browse, OK tunes, ▶/Back closes.
import { useEffect, useRef, useState } from 'react';
import { api, imgUrl } from '../lib/api.js';
import { clock, progressPct, humanDuration } from '../lib/format.js';
import { Icon } from '../components/Icons.jsx';

const SURF_DELAY = 1800;
const GUIDE_IDLE = 15000;
const GUIDE_ROWS = 9;

export function useLiveNav(st, cmd) {
  const [playlist, setPlaylist] = useState([]);
  const [surf, setSurf] = useState(null);
  const [guide, setGuide] = useState(null);
  const surfT = useRef(null);
  const guideT = useRef(null);
  const cache = useRef(new Map());
  const [, bump] = useState(0);
  const live = st?.kind === 'live';
  const n = playlist.length;

  // Fetch the session's channel list once per session/playlist size.
  useEffect(() => {
    if (!st?.active) {
      setPlaylist([]);
      return;
    }
    if (st.kind !== 'live' || playlist.length === st.total) return;
    api.invoke('player:playlist').then((p) => setPlaylist(p || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st?.active, st?.kind, st?.total, st?.profileId]);

  useEffect(
    () => () => {
      clearTimeout(surfT.current);
      clearTimeout(guideT.current);
    },
    []
  );

  const nowNext = (ch) => (ch?.epg ? cache.current.get(ch.epg)?.v : null);
  const needEpg = (channels) => {
    const ids = channels.map((c) => c?.epg).filter((id) => id && !(Date.now() - (cache.current.get(id)?.at || 0) < 60000));
    if (!ids.length || !st?.profileId) return;
    ids.forEach((id) => cache.current.set(id, { at: Date.now(), v: cache.current.get(id)?.v ?? null }));
    api
      .invoke('epg:nowNext', { profileId: st.profileId, ids })
      .then((r) => {
        ids.forEach((id) => cache.current.set(id, { at: Date.now(), v: r[id] || null }));
        bump((x) => x + 1);
      })
      .catch(() => {});
  };

  const tune = (i) => {
    clearTimeout(surfT.current);
    clearTimeout(guideT.current);
    setSurf(null);
    setGuide(null);
    if (i != null && i !== st.index) cmd({ type: 'jump', index: i });
  };
  const startSurf = (delta) => {
    const i = ((surf ?? st.index) + delta + n) % n;
    setSurf(i);
    clearTimeout(surfT.current);
    surfT.current = setTimeout(() => tune(i), SURF_DELAY);
  };
  const touchGuide = () => {
    clearTimeout(guideT.current);
    guideT.current = setTimeout(() => setGuide(null), GUIDE_IDLE);
  };

  /** Returns true if the key was handled here. */
  const handle = (action, e) => {
    if (!live || !n) return false;
    if (guide != null) {
      touchGuide();
      switch (action) {
        case 'up':
          setGuide((g) => (g - 1 + n) % n);
          return true;
        case 'down':
          setGuide((g) => (g + 1) % n);
          return true;
        case 'chUp':
          setGuide((g) => Math.max(0, g - GUIDE_ROWS));
          return true;
        case 'chDown':
          setGuide((g) => Math.min(n - 1, g + GUIDE_ROWS));
          return true;
        case 'enter':
          tune(guide);
          return true;
        case 'right':
        case 'back':
          if (!e?.repeat) setGuide(null);
          return true;
        case 'left':
          return true;
        default:
          return false;
      }
    }
    if (surf != null) {
      switch (action) {
        case 'up':
          startSurf(1);
          return true;
        case 'down':
          startSurf(-1);
          return true;
        case 'enter':
          tune(surf);
          return true;
        case 'back':
          clearTimeout(surfT.current);
          setSurf(null);
          return true;
        default:
          return false;
      }
    }
    switch (action) {
      case 'up':
        startSurf(1);
        return true;
      case 'down':
        startSurf(-1);
        return true;
      case 'left':
        setGuide(st.index);
        touchGuide();
        return true;
      default:
        return false;
    }
  };

  return { playlist, surf, guide, nowNext, needEpg, handle, active: surf != null || guide != null };
}

function Logo({ ch, size = 240 }) {
  return ch.icon ? <img src={imgUrl(ch.icon, size)} alt="" /> : <Icon name="live" size="2.4rem" />;
}

export function SurfBanner({ nav, current }) {
  const ch = nav.playlist[nav.surf];
  useEffect(() => {
    if (ch) nav.needEpg([ch]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch]);
  if (!ch) return null;
  const nn = nav.nowNext(ch);
  const n = nn?.now;
  return (
    <div className="surf">
      <div className="surf-logo">
        <Logo ch={ch} />
      </div>
      <div className="surf-main">
        <div className="surf-ch">
          <span className="surf-num">{ch.num || nav.surf + 1}</span>
          {ch.name}
          <span className="muted surf-pos">
            {nav.surf + 1}/{nav.playlist.length}
          </span>
        </div>
        {n ? (
          <>
            <div className="surf-now">
              <span className="tag tag-live">LIVE</span> {n.title}
              <span className="muted">· {humanDuration((n.stop - Date.now()) / 1000) || '<1m'} left</span>
            </div>
            <div className="progress">
              <div style={{ width: `${progressPct(n.start, n.stop)}%` }} />
            </div>
          </>
        ) : (
          <div className="surf-now muted">{nn === undefined ? 'Loading guide…' : 'No programme information'}</div>
        )}
        {nn?.next && (
          <div className="surf-next muted">
            Next {clock(nn.next.start)} · {nn.next.title}
          </div>
        )}
      </div>
      <div className="surf-side">
        <span className="muted">Now watching {current?.num ? `${current.num} ` : ''}{current?.name}</span>
        <span>OK watch now · Back cancel</span>
        <div className="surf-timer" key={nav.surf}>
          <div />
        </div>
      </div>
    </div>
  );
}

export function GlassGuide({ nav, currentIndex }) {
  const n = nav.playlist.length;
  const sel = nav.guide;
  const start = Math.max(0, Math.min(n - GUIDE_ROWS, sel - Math.floor(GUIDE_ROWS / 2)));
  const rows = nav.playlist.slice(start, start + GUIDE_ROWS);
  useEffect(() => {
    nav.needEpg(rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, n]);
  return (
    <div className="glass-guide">
      <div className="gg-head">
        <span>Channels</span>
        <span className="muted">
          {sel + 1}/{n}
        </span>
      </div>
      <div className="gg-list">
        {rows.map((ch, i) => {
          const idx = start + i;
          const now = nav.nowNext(ch)?.now;
          return (
            <div key={ch.id} className={`gg-row ${idx === sel ? 'is-sel' : ''} ${idx === currentIndex ? 'is-playing' : ''}`}>
              <span className="gg-num">{ch.num || idx + 1}</span>
              <div className="gg-logo">
                <Logo ch={ch} size={160} />
              </div>
              <div className="gg-text">
                <span className="gg-name">
                  {ch.name}
                  {idx === currentIndex && <span className="gg-badge">Playing</span>}
                </span>
                <small>{now ? now.title : ' '}</small>
                {now && (
                  <div className="mini-progress">
                    <div style={{ width: `${progressPct(now.start, now.stop)}%` }} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="gg-foot muted">▲▼ browse · OK watch · ▶ / Back close</div>
    </div>
  );
}
