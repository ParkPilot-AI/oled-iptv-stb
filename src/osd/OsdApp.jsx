// Transparent overlay rendered above the mpv video window. Holds keyboard
// focus during playback, so it owns all player key bindings.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, imgUrl } from '../lib/api.js';
import { keyAction } from '../nav/keys.js';
import { clock, duration, progressPct, epLabel, bitrate } from '../lib/format.js';
import { Icon } from '../components/Icons.jsx';
import { Screensaver } from '../components/Screensaver.jsx';
import { VolumeHud, changeVolume } from '../components/VolumeHud.jsx';
import { usePixelShift } from '../components/Modal.jsx';
import { useLiveNav, SurfBanner, GlassGuide } from './LiveNav.jsx';
import './osd.css';

const cmd = (c) => api.invoke('player:command', c).catch(() => {});

export default function OsdApp() {
  const [st, setSt] = useState(null);
  const [visible, setVisible] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [digits, setDigits] = useState('');
  const [note, setNote] = useState(null);
  const [saver, setSaver] = useState(false);
  const [epg, setEpg] = useState(null);
  const [now, setNow] = useState(Date.now());
  const rootRef = useRef(null);
  const stRef = useRef(null);
  const hideT = useRef(null);
  const digitT = useRef(null);
  const noteT = useRef(null);
  const infoT = useRef(null);
  stRef.current = st;
  usePixelShift(rootRef, 60000);
  const liveNav = useLiveNav(st, cmd);
  const navRef = useRef(liveNav);
  navRef.current = liveNav;

  useEffect(() => {
    document.body.classList.add('osd-body');
    return api.on('player:state', (s) => {
      if (s?.active) document.documentElement.style.setProperty('--safe', String(Number(s.overscan) || 0));
      setSt(s?.active ? s : null);
    });
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  const poke = useCallback(() => {
    setVisible(true);
    clearTimeout(hideT.current);
    hideT.current = setTimeout(() => setVisible(false), (stRef.current?.osdTimeoutSec || 4) * 1000);
  }, []);

  const flash = useCallback((msg, ms = 2500) => {
    setNote(msg);
    clearTimeout(noteT.current);
    noteT.current = setTimeout(() => setNote(null), ms);
  }, []);

  // New item → show banner, fetch EPG.
  const itemKey = st ? `${st.item.kind}:${st.item.id}` : '';
  useEffect(() => {
    if (!st) return;
    poke();
    setEpg(null);
    if (st.autoNext) flash(`Up next: ${epLabel(st.item)} ${st.item.name || ''}`, 4000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey]);

  useEffect(() => {
    if (!st || st.kind !== 'live' || !st.item.epg) return;
    let cancelled = false;
    api
      .invoke('epg:nowNext', { profileId: st.profileId, ids: [st.item.epg] })
      .then((r) => !cancelled && setEpg(r[st.item.epg] || null))
      .catch(() => {});
    return () => (cancelled = true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey, Math.floor(now / 60000)]);

  // Paused for N minutes → OLED screensaver.
  useEffect(() => {
    if (!st?.paused) return setSaver(false);
    const t = setTimeout(() => setSaver(true), (st.screensaverMin || 3) * 60000);
    return () => clearTimeout(t);
  }, [st?.paused, st?.screensaverMin]);

  useEffect(() => {
    if (!showInfo) return;
    clearTimeout(infoT.current);
    infoT.current = setTimeout(() => setShowInfo(false), 30000);
  }, [showInfo]);

  const toggleFav = useCallback(async () => {
    const s = stRef.current;
    const it = s.item;
    if (it.kind === 'episode') return flash('Add the series to Favorites from its page');
    const k = it.kind === 'live' ? 'live' : 'movie';
    const favs = { live: [], movie: [], series: [], ...(await api.invoke('doc:get', { profileId: s.profileId, name: 'favorites' })) };
    const on = favs[k].some((f) => f.id === it.id);
    favs[k] = on ? favs[k].filter((f) => f.id !== it.id) : [it, ...favs[k]];
    await api.invoke('doc:set', { profileId: s.profileId, name: 'favorites', data: favs });
    flash(on ? 'Removed from Favorites' : 'Added to Favorites');
  }, [flash]);

  const handle = useCallback(
    (e) => {
      const s = stRef.current;
      if (!s) return;
      const action = keyAction(e);
      if (action === 'volUp' || action === 'volDown' || action === 'mute') {
        e.preventDefault?.();
        changeVolume(action);
        return;
      }
      if (saver) {
        setSaver(false);
        return;
      }
      // Channel surf / glass guide take ▲▼◀ (and OK/Back while open).
      if (!digits && navRef.current.handle(action, e)) {
        clearTimeout(hideT.current);
        setVisible(false);
        e.preventDefault?.();
        return;
      }
      const live = s.kind === 'live';
      const vod = !live;

      if (action === 'digit' && live) {
        const d = (digits + e.key).slice(-4);
        setDigits(d);
        clearTimeout(digitT.current);
        digitT.current = setTimeout(() => {
          setDigits('');
          cmd({ type: 'jump-num', num: Number(d) });
        }, 1500);
        return;
      }

      switch (action) {
        case 'chUp':
        case 'up':
          if (live) cmd({ type: 'zap', delta: 1 });
          else if (action === 'up') cmd({ type: 'seek', seconds: 60 });
          else cmd({ type: 'zap', delta: 1 });
          poke();
          break;
        case 'chDown':
        case 'down':
          if (live) cmd({ type: 'zap', delta: -1 });
          else if (action === 'down') cmd({ type: 'seek', seconds: -60 });
          else cmd({ type: 'zap', delta: -1 });
          poke();
          break;
        case 'right':
          if (vod) cmd({ type: 'seek', seconds: e.repeat ? 30 : 10 });
          poke();
          break;
        case 'left':
          if (vod) cmd({ type: 'seek', seconds: e.repeat ? -30 : -10 });
          poke();
          break;
        case 'next':
          if (s.kind === 'episode' || live) cmd({ type: 'zap', delta: 1 });
          break;
        case 'prev':
          if (s.kind === 'episode' || live) cmd({ type: 'zap', delta: -1 });
          break;
        case 'enter':
          if (digits) {
            clearTimeout(digitT.current);
            setDigits('');
            cmd({ type: 'jump-num', num: Number(digits) });
          } else if (visible) {
            clearTimeout(hideT.current);
            setVisible(false);
          } else poke();
          break;
        case 'playPause':
          cmd({ type: 'toggle-pause' });
          poke();
          break;
        case 'back':
          if (e.repeat) break;
          if (showInfo) setShowInfo(false);
          else if (visible) {
            clearTimeout(hideT.current);
            setVisible(false);
          } else cmd({ type: 'stop' });
          break;
        case 'stop':
          cmd({ type: 'stop' });
          break;
        case 'info':
          setShowInfo((v) => !v);
          break;
        case 'audio':
          cmd({ type: 'cycle-audio' }).then(() => flash('Audio track changed'));
          break;
        case 'subs':
          cmd({ type: 'cycle-sub' }).then(() => flash('Subtitles changed'));
          break;
        case 'fav':
          toggleFav();
          break;
        default:
          return;
      }
      e.preventDefault?.();
    },
    [saver, digits, visible, showInfo, poke, flash, toggleFav]
  );

  useEffect(() => {
    const onKey = (e) => handle(e);
    window.addEventListener('keydown', onKey);
    // Keys pressed while the mpv window had focus arrive via IPC.
    const off = api.on('player:key', (key) => handle({ key, repeat: false }));
    return () => {
      window.removeEventListener('keydown', onKey);
      off();
    };
  }, [handle]);

  if (!st) return <div className="osd" ref={rootRef} />;
  if (saver) {
    const it0 = st.item;
    return (
      <Screensaver
        title={it0.seriesName || it0.name}
        subtitle={it0.kind === 'episode' ? `${epLabel(it0)} · Paused` : 'Paused'}
        art={it0.seriesIcon || it0.icon}
      />
    );
  }

  const it = st.item;
  const showBar = visible || st.paused;
  return (
    <div className="osd" ref={rootRef}>
      {st.buffering && !st.error && <div className="osd-spinner" />}
      {st.error && (
        <div className="osd-error">
          <h2>{st.error}</h2>
          <p>{st.kind === 'live' ? 'Channel Up/Down to switch · Back to exit' : 'Back to exit'}</p>
        </div>
      )}
      <VolumeHud />
      {digits && <div className="osd-digits">{digits}</div>}
      {note && <div className="osd-note">{note}</div>}
      {showInfo && <StreamInfo st={st} />}
      {visible && <div className="osd-clock">{clock(now)}</div>}
      {liveNav.surf != null && <SurfBanner nav={liveNav} current={it} />}
      {liveNav.guide != null && <GlassGuide nav={liveNav} currentIndex={st.index} />}
      {showBar && !liveNav.active && (st.kind === 'live' ? LiveBanner({ st, epg }) : VodBar({ st }))}
      {st.paused && !visible && (
        <div className="osd-paused">
          <Icon name="pause" size="3rem" />
        </div>
      )}
    </div>
  );

  function LiveBanner({ st, epg }) {
    const n = epg?.now;
    const nx = epg?.next;
    return (
      <div className="osd-banner">
        <div className="osd-logo">{it.icon ? <img src={imgUrl(it.icon, 240)} alt="" /> : <Icon name="live" size="3rem" />}</div>
        <div className="osd-main">
          <div className="osd-title">
            {it.num ? <span className="osd-num">{it.num}</span> : null}
            {it.name}
            <span className="osd-pos muted">
              {st.index + 1}/{st.total}
            </span>
          </div>
          {n ? (
            <>
              <div className="osd-now">
                <span className="tag">NOW</span> {n.title}
                <span className="muted">
                  {clock(n.start)} – {clock(n.stop)}
                </span>
              </div>
              <div className="progress">
                <div style={{ width: `${progressPct(n.start, n.stop, now)}%` }} />
              </div>
            </>
          ) : (
            <div className="osd-now muted">No programme information</div>
          )}
          {nx && (
            <div className="osd-next muted">
              Next {clock(nx.start)} · {nx.title}
            </div>
          )}
        </div>
      </div>
    );
  }

  function VodBar({ st }) {
    const pct = st.dur ? (st.pos / st.dur) * 100 : 0;
    const title = it.kind === 'episode' ? it.seriesName || it.name : it.name;
    const sub = it.kind === 'episode' ? `${epLabel(it)}${it.name ? ` · ${it.name}` : ''}` : '';
    return (
      <div className="osd-banner osd-vod">
        <div className="osd-main">
          <div className="osd-title">
            <Icon name={st.paused ? 'pause' : 'play'} size="1.8rem" /> {title}
          </div>
          {sub && <div className="osd-now muted">{sub}</div>}
          <div className="progress big">
            <div style={{ width: `${pct}%` }} />
          </div>
          <div className="osd-times">
            <span>{duration(st.pos)}</span>
            <span className="muted">
              {st.dur ? `-${duration(st.dur - st.pos)} · ends ${clock(Date.now() + (st.dur - st.pos) * 1000)}` : ''}
            </span>
            <span>{duration(st.dur)}</span>
          </div>
        </div>
      </div>
    );
  }
}

function StreamInfo({ st }) {
  const i = st.info || {};
  const rows = [
    ['Resolution', i.width ? `${i.width}×${i.height}` : '—'],
    ['Video', i.vcodec || '—'],
    ['Frame rate', i.fps ? `${Number(i.fps).toFixed(2)} fps` : '—'],
    ['Video bitrate', bitrate(i.vbitrate)],
    ['Audio', `${i.acodec || '—'}${i.channels ? ` · ${i.channels}` : ''}`],
    ['Audio bitrate', bitrate(i.abitrate)],
    ['HW decoding', i.hwdec || '—'],
    ['Pixel format', [i.pixfmt, i.gamma].filter(Boolean).join(' · ') || '—'],
    ['Buffer', `${(st.cacheSecs || 0).toFixed(1)} s`],
  ];
  return (
    <div className="osd-info">
      <h3>Stream info</h3>
      {rows.map(([k, v]) => (
        <div key={k} className="osd-info-row">
          <span className="muted">{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}
