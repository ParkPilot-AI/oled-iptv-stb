import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore, openItem, isFavorite } from '../lib/store.js';
import { useNowNext, useChannelGuide } from '../lib/epg.js';
import { VirtualList } from '../components/VirtualGrid.jsx';
import { Focusable } from '../components/Focusable.jsx';
import { LazyImg } from '../components/Cards.jsx';
import { Icon } from '../components/Icons.jsx';
import { useBack } from '../nav/keys.js';
import { focusGroup } from '../nav/spatial.js';
import { clock, progressPct } from '../lib/format.js';

// Survives view switches within a session.
const memory = { cat: '__all', channelIndex: 0 };

export function LiveTV() {
  const live = useStore((s) => s.catalog.live);
  const favs = useStore((s) => s.favorites.live);
  const [catId, setCatId] = useState(memory.cat);
  const [sel, setSel] = useState(null);
  const [range, setRange] = useState([0, 20]);
  const listRef = useRef(null);
  const catTimer = useRef(null);
  const selTimer = useRef(null);

  const cats = useMemo(
    () => [{ id: '__all', name: 'All Channels', count: live.items.length }, { id: '__fav', name: 'Favorites', count: favs.length }, ...live.cats],
    [live, favs.length]
  );
  const channels = useMemo(
    () => (catId === '__all' ? live.items : catId === '__fav' ? favs : live.byCat.get(catId) || []),
    [catId, live, favs]
  );
  const visible = useMemo(() => channels.slice(range[0], range[1] + 1), [channels, range]);
  const epg = useNowNext(visible);
  const onRange = useCallback((a, b) => setRange((r) => (r[0] === a && r[1] === b ? r : [a, b])), []);

  // Initial focus: last channel position (or first channel).
  useEffect(() => {
    requestAnimationFrame(() => listRef.current?.focusIndex(Math.min(memory.channelIndex, channels.length - 1)));
    return () => {
      clearTimeout(catTimer.current);
      clearTimeout(selTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back from channels/guide → categories, then falls through to the shell (rail).
  useBack(() => {
    const a = document.activeElement;
    if (a?.closest('.live-channels')) return focusGroup('live-cats');
    return false;
  });

  const focusCat = (c) => {
    clearTimeout(catTimer.current);
    if (c.id === catId) return;
    catTimer.current = setTimeout(() => {
      memory.cat = c.id;
      memory.channelIndex = 0;
      setCatId(c.id);
    }, 180);
  };
  const focusChannel = (c, i) => {
    memory.channelIndex = i;
    clearTimeout(selTimer.current);
    selTimer.current = setTimeout(() => setSel(c), 120);
  };

  return (
    <div className="live">
      <VirtualList
        className="live-cats"
        group="live-cats"
        items={cats}
        rowHeight={4.25}
        renderItem={(c) => (
          <Focusable
            className={`list-row cat-row ${c.id === catId ? 'is-active' : ''}`}
            data-focus-default={c.id === catId ? '' : undefined}
            onFocus={() => focusCat(c)}
            onSelect={() => {
              clearTimeout(catTimer.current);
              memory.cat = c.id;
              setCatId(c.id);
              requestAnimationFrame(() => listRef.current?.focusIndex(0));
            }}
          >
            <span className="cat-name">{c.name}</span>
            <span className="count">{c.count}</span>
          </Focusable>
        )}
      />
      <VirtualList
        ref={listRef}
        className="live-channels"
        group="live-channels"
        items={channels}
        rowHeight={5.75}
        onRangeChange={onRange}
        empty={<p className="empty">{catId === '__fav' ? 'Press F on any channel to add it here.' : 'No channels'}</p>}
        renderItem={(c, i) => <ChannelRow c={c} nn={epg[c.epg]} onFocus={() => focusChannel(c, i)} onSelect={() => openItem(c, channels)} />}
      />
      <Preview channel={sel || channels[0]} />
    </div>
  );
}

const ChannelRow = memo(function ChannelRow({ c, nn, onFocus, onSelect }) {
  const fav = useStore((s) => isFavorite(s.favorites, c));
  const now = nn?.now;
  return (
    <Focusable className="list-row ch-row" onFocus={onFocus} onSelect={onSelect} favItem={c}>
      <span className="ch-num">{c.num || ''}</span>
      <LazyImg src={c.icon} width={160} className="ch-logo" fallback={<Icon name="live" />} />
      <div className="ch-text">
        <span className="ch-name">{c.name}</span>
        <small className="ch-now">{now ? now.title : ' '}</small>
        {now && (
          <div className="mini-progress">
            <div style={{ width: `${progressPct(now.start, now.stop)}%` }} />
          </div>
        )}
      </div>
      {fav && <Icon name="star" size="1.25rem" className="fav-star" />}
    </Focusable>
  );
});

function Preview({ channel }) {
  const guide = useChannelGuide(channel, 7);
  if (!channel) return <aside className="live-preview" />;
  const [now, ...later] = guide;
  const isNow = now && now.start <= Date.now();
  return (
    <aside className="live-preview">
      <div className="preview-head">
        <LazyImg src={channel.icon} width={320} className="preview-logo" fallback={<Icon name="live" size="3rem" />} />
        <div>
          <h2>{channel.name}</h2>
          <small className="muted">{channel.num ? `Channel ${channel.num}` : ''}</small>
        </div>
      </div>
      {now ? (
        <div className="preview-now">
          <span className="tag">{isNow ? 'NOW' : 'NEXT'}</span>
          <h3>{now.title}</h3>
          <small className="muted">
            {clock(now.start)} – {clock(now.stop)}
          </small>
          {isNow && (
            <div className="progress">
              <div style={{ width: `${progressPct(now.start, now.stop)}%` }} />
            </div>
          )}
          {now.desc && <p className="desc">{now.desc}</p>}
        </div>
      ) : (
        <p className="muted">No programme information</p>
      )}
      {later.length > 0 && (
        <ul className="preview-later">
          {later.map((p) => (
            <li key={p.start}>
              <span className="time">{clock(p.start)}</span>
              <span>{p.title}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">OK to watch · F favorite · PgUp/PgDn page</p>
    </aside>
  );
}
