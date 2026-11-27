import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, openItem } from '../lib/store.js';
import { VirtualList, VirtualGrid } from '../components/VirtualGrid.jsx';
import { Focusable } from '../components/Focusable.jsx';
import { PosterCard } from '../components/Cards.jsx';
import { useBack } from '../nav/keys.js';
import { focusGroup } from '../nav/spatial.js';

const memory = { vod: { cat: '__recent', index: 0 }, series: { cat: '__recent', index: 0 } };
const COLS = 6;

/** Movies / Series browser: category column + virtualised poster grid. */
export function Library({ section }) {
  const sec = useStore((s) => s.catalog[section]);
  const favs = useStore((s) => s.favorites[section === 'vod' ? 'movie' : 'series']);
  const progress = useStore((s) => s.progress);
  const mem = memory[section];
  const [catId, setCatId] = useState(mem.cat);
  const gridRef = useRef(null);
  const timer = useRef(null);

  const progressById = useMemo(() => {
    const m = new Map();
    for (const p of Object.values(progress)) {
      if (p.item.kind === 'movie' && !p.watched && p.dur) m.set(p.item.id, (p.pos / p.dur) * 100);
    }
    return m;
  }, [progress]);

  const cw = useMemo(
    () =>
      section === 'vod'
        ? Object.values(progress)
            .filter((p) => p.item.kind === 'movie' && !p.watched && p.pos > 30)
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((p) => p.item)
        : [],
    [progress, section]
  );

  const cats = useMemo(
    () =>
      [
        cw.length && { id: '__cw', name: 'Continue Watching', count: cw.length },
        { id: '__recent', name: 'Recently Added', count: Math.min(200, sec.items.length) },
        { id: '__all', name: section === 'vod' ? 'All Movies' : 'All Series', count: sec.items.length },
        { id: '__fav', name: 'Favorites', count: favs.length },
        ...sec.cats,
      ].filter(Boolean),
    [sec, favs.length, cw.length, section]
  );

  const items = useMemo(() => {
    switch (catId) {
      case '__cw':
        return cw;
      case '__recent':
        return sec.recent;
      case '__all':
        return sec.items;
      case '__fav':
        return favs;
      default:
        return sec.byCat.get(catId) || [];
    }
  }, [catId, sec, favs, cw]);

  useEffect(() => {
    requestAnimationFrame(() => gridRef.current?.focusIndex(Math.min(mem.index, items.length - 1)));
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useBack(() => (document.activeElement?.closest('.lib-grid') ? focusGroup(`${section}-cats`) : false));

  const selectCat = (id, immediate) => {
    clearTimeout(timer.current);
    if (id === catId) return;
    const apply = () => {
      mem.cat = id;
      mem.index = 0;
      setCatId(id);
    };
    immediate ? apply() : (timer.current = setTimeout(apply, 180));
  };

  return (
    <div className="library">
      <VirtualList
        className="lib-cats"
        group={`${section}-cats`}
        items={cats}
        rowHeight={4.25}
        renderItem={(c) => (
          <Focusable
            className={`list-row cat-row ${c.id === catId ? 'is-active' : ''}`}
            data-focus-default={c.id === catId ? '' : undefined}
            onFocus={() => selectCat(c.id)}
            onSelect={() => {
              selectCat(c.id, true);
              requestAnimationFrame(() => gridRef.current?.focusIndex(0));
            }}
          >
            <span className="cat-name">{c.name}</span>
            <span className="count">{c.count}</span>
          </Focusable>
        )}
      />
      <VirtualGrid
        ref={gridRef}
        className="lib-grid"
        group={`${section}-grid`}
        trap="up,down,right"
        items={items}
        columns={COLS}
        rowHeight={26}
        overscan={1}
        empty={<p className="empty">{catId === '__fav' ? 'Press F on any title to add it here.' : 'Nothing here yet'}</p>}
        renderItem={(it, i) => (
          <PosterCard
            item={it}
            subtitle={it.year || undefined}
            progress={section === 'vod' ? progressById.get(it.id) : 0}
            onFocus={() => (mem.index = i)}
            onSelect={() => openItem(it)}
          />
        )}
      />
    </div>
  );
}
