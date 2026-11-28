// Transparent overlay rendered above the mpv video window. Holds keyboard
// focus during playback, so it owns all player key bindings.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { favTarget } from '../lib/fav.js';
import { keyAction } from '../nav/keys.js';
import { clock, epLabel, bitrate } from '../lib/format.js';
import { Icon } from '../components/Icons.jsx';
import { Screensaver } from '../components/Screensaver.jsx';
import { VolumeHud, changeVolume } from '../components/VolumeHud.jsx';
import { applyTheme } from '../lib/theme.js';
import { usePixelShift } from '../components/Modal.jsx';
import { useLiveNav, SurfBanner, GlassGuide } from './LiveNav.jsx';
import { LiveBanner, VodBar } from './Bars.jsx';
import { startGamepadNav } from '../lib/gamepad.js';
import './osd.css';

const cmd = (c) => api.invoke('player:command', c).catch(() => {});
const DIGIT_TUNE_MS = 1200; // typed channel number tunes after this pause

/** Playlist index for a typed number: the provider's channel number first, else position. */
export function channelForNumber(playlist, num) {
  const i = playlist.findIndex((c) => c.num === num);
  const j = i >= 0 ? i : num - 1;
  return j >= 0 && j < playlist.length ? playlist[j] : null;
}

/** "104 — BBC One HD" while typing a channel number. */
function ChannelBadge({ digits, playlist }) {
  const ch = channelForNumber(playlist || [], Number(digits));
  return (
    <div className={`osd-digits ${ch ? '' : 'is-unknown'}`}>
      <span className="osd-digits-num">{digits}</span>
      {ch && <span className="osd-digits-name">— {ch.name}</span>}
    </div>
  );
}

export default function OsdApp() {
  const [st, setSt] = useState(null);
  useEffect(() => applyTheme(st?.theme), [st?.theme]);
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
    const target = favTarget(it);
    if (!target) return;
    const favs = { live: [], movie: [], series: [], ...(await api.invoke('doc:get', { profileId: s.profileId, name: 'favorites' })) };
    const { k, item } = target;
    const on = favs[k].some((f) => f.id === item.id);
    favs[k] = on ? favs[k].filter((f) => f.id !== item.id) : [item, ...favs[k]];
    await api.invoke('doc:set', { profileId: s.profileId, name: 'favorites', data: favs });
    const what = k === 'series' ? ` “${item.name}”` : '';
    flash(on ? `Removed${what} from Favourites` : `Added${what} to Favourites`);
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
      // Trailers: no favourites, channel numbers or zapping.
      if (s.kind === 'trailer' && ['fav', 'digit', 'chUp', 'chDown', 'next', 'prev'].includes(action)) {
        e.preventDefault?.();
        return;
      }

      if (action === 'digit' && live) {
        const d = (digits + e.key).slice(-4);
        setDigits(d);
        clearTimeout(digitT.current);
        digitT.current = setTimeout(() => {
          setDigits('');
          cmd({ type: 'jump-num', num: Number(d) });
        }, DIGIT_TUNE_MS);
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
          } else if (vod) {
            // Films and episodes: OK pauses/resumes and shows the bar.
            cmd({ type: 'toggle-pause' });
            poke();
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
          } else if (s.pipOnBack && (live || s.kind === 'trailer')) {
            // Keep watching in a corner while browsing (mini-player).
            cmd({ type: 'dock' });
          } else cmd({ type: 'stop' });
          break;
        case 'stop':
          cmd({ type: 'stop' });
          break;
        case 'info':
          setShowInfo((v) => !v);
          break;
        case 'audio':
          cmd({ type: 'cycle-audio' }).then((r) => flash(r?.message || 'Audio track changed'));
          break;
        case 'subs':
          cmd({ type: 'cycle-sub' }).then((r) => flash(r?.message || 'Subtitles changed'));
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

  // Controller buttons arrive as key events (A = OK, B = Back, D-pad = arrows).
  useEffect(() => startGamepadNav(), []);

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
      {st.freeze && <img className="osd-freeze" src={st.freeze} alt="" />}
      {st.buffering && !st.error && !st.freeze && <div className="osd-spinner" />}
      {st.freeze && !st.error && (
        <div className="osd-tuning">
          <div className="osd-spinner-sm" />
          Tuning to {st.item.num ? `${st.item.num} · ` : ''}
          {st.item.name}
        </div>
      )}
      {st.error && (
        <div className="osd-error">
          <h2>{st.error}</h2>
          <p>{st.kind === 'live' ? 'Channel Up/Down to switch · Back to exit' : 'Back to exit'}</p>
        </div>
      )}
      <VolumeHud />
      {digits && <ChannelBadge digits={digits} playlist={liveNav.playlist} />}
      {note && <div className="osd-note">{note}</div>}
      {showInfo && <StreamInfo st={st} />}
      {visible && <div className="osd-clock">{clock(now)}</div>}
      {liveNav.surf != null && <SurfBanner nav={liveNav} current={it} />}
      {liveNav.guide != null && <GlassGuide nav={liveNav} currentIndex={st.index} />}
      {showBar && !liveNav.active && (st.kind === 'live' ? <LiveBanner st={st} epg={epg} now={now} /> : <VodBar st={st} />)}
      {st.paused && !visible && (
        <div className="osd-paused">
          <Icon name="pause" size="3rem" />
        </div>
      )}
    </div>
  );
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
