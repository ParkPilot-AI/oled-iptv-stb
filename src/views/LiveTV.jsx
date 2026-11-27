// Live TV: timeline grid guide.
//   ┌ hero: selected programme (title, time, progress, synopsis) ────────────┐
//   ├ category chips ─────────────────────────────────────────────────────────┤
//   ├ timeline 19:00 · 19:30 · 20:00 · 20:30            │ now line           │
//   ├ 101 BBC One   │ News ▓▓▓▓│ The Show          │ Film …                   │
//   └ 102 …                                                                  ┘
// Navigation uses a time cursor (like a set-top box): ◀▶ step programme by
// programme and scroll the time window; ▲▼ change channel at the same time.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore, openItem, isFavorite } from '../lib/store.js';
import { useSchedules, SLOT, floorSlot } from '../lib/epg.js';
import { Focusable } from '../components/Focusable.jsx';
import { LazyImg } from '../components/Cards.jsx';
import { Icon } from '../components/Icons.jsx';
import { useKeyHandler, useBack } from '../nav/keys.js';
import { focusEl, focusGroup } from '../nav/spatial.js';
import { clock, progressPct, humanDuration } from '../lib/format.js';

const WINDOW = 2 * 3600e3; // visible time span
const MAX_AHEAD = 34 * 3600e3; // how far right the window may scroll
const ROW_REM = 5.4;

const memory = { cat: '__all', row: 0 };

const dayLabel = (t) => {
  const d = new Date(t);
  if (d.toDateString() === new Date().toDateString()) return 'Today';
  if (d.toDateString() === new Date(Date.now() + 864e5).toDateString()) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'short' });
};

export function LiveTV() {
  const live = useStore((s) => s.catalog.live);
  const favs = useStore((s) => s.favorites.live);
  const [catId, setCatId] = useState(memory.cat);
  const channels = useMemo(
    () => (catId === '__all' ? live.items : catId === '__fav' ? favs : live.byCat.get(catId) || []),
    [catId, live, favs]
  );
  const cats = useMemo(() => [{ id: '__all', name: 'All channels' }, { id: '__fav', name: 'Favourites' }, ...live.cats], [live]);

  // ---- clock / time window ----
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  const minStart = floorSlot(now);
  const [winStart, setWinStart] = useState(minStart);
  const ws = Math.max(winStart, minStart);
  const winEnd = ws + WINDOW;

  // ---- rows ----
  const [row, setRow] = useState(() => Math.min(memory.row, Math.max(0, channels.length - 1)));
  const [cursor, setCursor] = useState(now);
  const [visibleRows, setVisibleRows] = useState(8);
  const [top, setTop] = useState(() => Math.max(0, row - 3));
  const gridRef = useRef(null);
  const wantFocus = useRef(true);

  useLayoutEffect(() => {
    const el = gridRef.current;
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setVisibleRows(Math.max(1, Math.floor(el.clientHeight / (ROW_REM * rem))));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const shown = useMemo(() => channels.slice(top, top + visibleRows), [channels, top, visibleRows]);
  const focusedChannel = channels[row];
  const scheduleOf = useSchedules(shown, focusedChannel);

  /** Programmes of a channel, or one placeholder block covering the window. */
  const progsOf = useCallback(
    (ch) => {
      const list = scheduleOf(ch);
      if (!list || !list.length) {
        return [{ start: ws, stop: winEnd, title: list ? 'No programme information' : '', placeholder: true }];
      }
      return list;
    },
    [scheduleOf, ws, winEnd]
  );
  const progAt = (ch, t) => {
    const list = progsOf(ch);
    return list.find((p) => p.start <= t && p.stop > t) || list.find((p) => p.start > t) || list[list.length - 1];
  };
  const focusedProg = focusedChannel ? progAt(focusedChannel, Math.max(cursor, ws)) : null;

  const goRow = (r) => {
    r = Math.max(0, Math.min(channels.length - 1, r));
    setRow(r);
    memory.row = r;
    setTop((t) => (r < t ? r : r >= t + visibleRows ? r - visibleRows + 1 : t));
  };

  // Category change resets the grid.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setRow(0);
    setTop(0);
    memory.row = 0;
    setCursor(Date.now());
    setWinStart(floorSlot(Date.now()));
  }, [catId]);

  // Move real DOM focus to the focused programme after any cursor change.
  const focusKey = focusedProg ? `${row}:${focusedProg.start}` : null;
  useLayoutEffect(() => {
    if (!wantFocus.current || !focusKey) return;
    const el = gridRef.current?.querySelector(`[data-epg-key="${focusKey}"]`);
    if (el) {
      wantFocus.current = false;
      if (document.activeElement !== el) focusEl(el, { scroll: false });
    }
  });

  const inGrid = () => gridRef.current?.contains(document.activeElement);

  useKeyHandler(
    (action) => {
      // Right from the side menu returns to the programme you were on.
      if (action === 'right' && document.activeElement?.closest('.rail') && focusKey) {
        const el = gridRef.current?.querySelector(`[data-epg-key="${focusKey}"]`);
        if (el) return focusEl(el, { scroll: false });
      }
      if (!inGrid() || !focusedChannel) return false;
      const list = progsOf(focusedChannel);
      const cur = focusedProg;
      switch (action) {
        case 'right': {
          const next = cur.placeholder ? null : list.find((p) => p.start >= cur.stop);
          const target = next ? next.start : cur.placeholder ? ws + WINDOW : cur.stop;
          if (target - now > MAX_AHEAD) return true;
          let w = ws;
          while (target >= w + WINDOW - SLOT / 2) w += SLOT;
          wantFocus.current = true;
          setWinStart(w);
          setCursor(Math.max(target, w));
          return true;
        }
        case 'left': {
          const prev = cur.placeholder ? null : [...list].reverse().find((p) => p.stop <= cur.start && p.stop > minStart);
          if (prev) {
            const t = Math.max(prev.start, minStart);
            wantFocus.current = true;
            setWinStart(t < ws ? Math.max(minStart, floorSlot(t)) : ws);
            setCursor(t);
            return true;
          }
          if (ws > minStart) {
            wantFocus.current = true;
            setWinStart(ws - SLOT);
            setCursor(Math.max(minStart, ws - SLOT));
            return true;
          }
          return focusGroup('rail'); // already at "now": go to the side menu
        }
        case 'up':
          if (row === 0) return false; // into the category chips
          wantFocus.current = true;
          goRow(row - 1);
          return true;
        case 'down':
          wantFocus.current = true;
          goRow(row + 1);
          return true;
        case 'chUp':
        case 'chDown':
          wantFocus.current = true;
          goRow(row + (action === 'chDown' ? visibleRows : -visibleRows));
          return true;
        default:
          return false;
      }
    },
    { priority: 10 }
  );

  // Back: grid → category chips → rail.
  useBack(() => (inGrid() ? focusGroup('live-cats') : false));

  const catTimer = useRef(null);
  const chooseCat = (id, immediate) => {
    clearTimeout(catTimer.current);
    if (id === catId) return;
    const apply = () => {
      memory.cat = id;
      setCatId(id);
    };
    immediate ? apply() : (catTimer.current = setTimeout(apply, 300));
  };
  useEffect(() => () => clearTimeout(catTimer.current), []);

  const slots = [0, 1, 2, 3].map((i) => ws + i * SLOT);
  const nowPct = ((now - ws) / WINDOW) * 100;

  return (
    <div className="guide">
      <Hero channel={focusedChannel} prog={focusedProg} now={now} />

      <div className="guide-chips" data-focus-group="live-cats" data-focus-trap="up">
        {cats.map((c) => (
          <Focusable
            key={c.id}
            className={`chip ${c.id === catId ? 'is-active' : ''}`}
            data-focus-default={c.id === catId ? '' : undefined}
            onFocus={() => chooseCat(c.id)}
            onSelect={() => {
              chooseCat(c.id, true);
              wantFocus.current = true;
              requestAnimationFrame(() => {
                const el = gridRef.current?.querySelector('[data-epg-key]');
                if (el) focusEl(el, { scroll: false });
              });
            }}
          >
            {c.name}
          </Focusable>
        ))}
      </div>

      <div className="guide-timeline">
        <div className="guide-day">{dayLabel(ws)}</div>
        <div className="guide-slots">
          {slots.map((t) => (
            <span key={t} style={{ left: `${((t - ws) / WINDOW) * 100}%` }}>
              {clock(t)}
            </span>
          ))}
          {nowPct >= 0 && nowPct <= 100 && <i className="guide-now-cap" style={{ left: `${nowPct}%` }} />}
        </div>
      </div>

      <div className="guide-grid" ref={gridRef} data-focus-group="live-grid">
        {channels.length === 0 && (
          <p className="empty big">{catId === '__fav' ? 'Press F on any channel to add it to Favourites.' : 'No channels'}</p>
        )}
        {shown.map((ch, i) => (
          <GuideRow
            key={ch.id}
            ch={ch}
            rowIndex={top + i}
            focusedRow={top + i === row}
            focusedStart={top + i === row ? focusedProg?.start : null}
            progs={progsOf(ch)}
            ws={ws}
            winEnd={winEnd}
            now={now}
            onFocusProg={(p) => {
              const r = top + i;
              if (r !== row) {
                setRow(r);
                memory.row = r;
              }
              setCursor((c) => (p.start <= c && p.stop > c ? c : Math.max(p.start, ws)));
            }}
            onSelect={() => openItem(ch, channels)}
          />
        ))}
        {nowPct >= 0 && nowPct <= 100 && <div className="guide-now" style={{ '--now': nowPct / 100, height: `${shown.length * ROW_REM}rem` }} />}
      </div>
    </div>
  );
}

const GuideRow = memo(function GuideRow({ ch, rowIndex, focusedRow, focusedStart, progs, ws, winEnd, now, onFocusProg, onSelect }) {
  const fav = useStore((s) => isFavorite(s.favorites, ch));
  const span = winEnd - ws;
  return (
    <div className={`guide-row ${focusedRow ? 'is-focused' : ''}`}>
      <div className="guide-ch">
        <span className="guide-num">{ch.num || ''}</span>
        <LazyImg src={ch.icon} width={160} className="guide-logo" fallback={<span>{(ch.name || '?').slice(0, 3)}</span>} />
        <span className="guide-name">{ch.name}</span>
        {fav && <Icon name="star" size="1rem" className="fav-star" />}
      </div>
      <div className="guide-track">
        {progs
          .filter((p) => p.stop > ws && p.start < winEnd)
          .map((p) => {
            const a = Math.max(p.start, ws);
            const b = Math.min(p.stop, winEnd);
            const live = p.start <= now && p.stop > now;
            return (
              <Focusable
                key={p.start}
                data-epg-key={`${rowIndex}:${p.start}`}
                className={`prog ${live ? 'is-live' : ''} ${p.start < ws ? 'cut-left' : ''} ${p.placeholder ? 'is-empty' : ''}`}
                style={{ left: `${((a - ws) / span) * 100}%`, width: `${((b - a) / span) * 100}%` }}
                favItem={ch}
                autoFocus={p.start === focusedStart}
                onFocus={() => onFocusProg(p)}
                onSelect={onSelect}
              >
                <span className="prog-title">{p.title}</span>
                {!p.placeholder && (
                  <span className="prog-time">
                    {clock(p.start)} – {clock(p.stop)}
                    {live && <span className="prog-left"> · {humanDuration((p.stop - now) / 1000) || '<1m'} left</span>}
                  </span>
                )}
                {live && !p.placeholder && <span className="prog-progress" style={{ width: `${progressPct(a, b, now)}%` }} />}
              </Focusable>
            );
          })}
      </div>
    </div>
  );
});

function Hero({ channel, prog, now }) {
  if (!channel) return <section className="guide-hero" />;
  const real = prog && !prog.placeholder;
  const live = real && prog.start <= now && prog.stop > now;
  const mins = real ? Math.round((prog.start - now) / 60000) : 0;
  const when = !real ? '' : live ? 'LIVE' : mins < 60 ? `In ${mins} min` : `${dayLabel(prog.start)} ${clock(prog.start)}`;
  return (
    <section className="guide-hero">
      <LazyImg src={channel.icon} width={320} className="hero-logo" fallback={<Icon name="live" size="3rem" />} />
      <div className="hero-text">
        <div className="hero-meta">
          {when && <span className={`tag ${live ? 'tag-live' : 'tag-muted'}`}>{when}</span>}
          <span>
            {channel.num ? `${channel.num} · ` : ''}
            {channel.name}
          </span>
          {real && (
            <span className="muted">
              {clock(prog.start)} – {clock(prog.stop)} · {humanDuration((prog.stop - prog.start) / 1000)}
            </span>
          )}
        </div>
        <h1 className="hero-title">{real ? prog.title : prog?.title || channel.name}</h1>
        {live && (
          <div className="progress hero-progress">
            <div style={{ width: `${progressPct(prog.start, prog.stop, now)}%` }} />
          </div>
        )}
        {real && prog.desc && <p className="hero-desc">{prog.desc}</p>}
      </div>
      <div className="hero-hint muted">
        OK watch · F favourite
        <br />◀ ▶ time · ▲ ▼ channel · PgUp/PgDn page
      </div>
    </section>
  );
}
