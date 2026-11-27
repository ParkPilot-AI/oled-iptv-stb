// Movies / Series hub: pill tabs across the top (hubs first, then the
// provider's categories), full-width 2:3 poster grid below.
// PageUp/PageDown cycle the tabs; Back goes grid → tabs → side menu.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, openItem } from '../lib/store.js';
import { VirtualGrid } from '../components/VirtualGrid.jsx';
import { PosterCard } from '../components/Cards.jsx';
import { PillTabs, useTabCycle } from '../components/PillTabs.jsx';
import { useBack } from '../nav/keys.js';
import { focusEl, focusGroup, focusFirst } from '../nav/spatial.js';
import { Hub } from '../components/Hub.jsx';
import { useDiscover } from '../lib/discover.js';

const memory = { vod: { tab: null, index: 0 }, series: { tab: null, index: 0 } };
const COLS = 8;

export function Library({ section }) {
  const sec = useStore((s) => s.catalog[section]);
  const favs = useStore((s) => s.favorites[section === 'vod' ? 'movie' : 'series']);
  const progress = useStore((s) => s.progress);
  const mem = memory[section];
  const isVod = section === 'vod';
  const disc = useDiscover(isVod ? 'movie' : 'tv');
  const hasKey = useStore((s) => !!s.settings?.tmdbKey && s.settings?.artSource !== 'off');
  const [tab, setTab] = useState(mem.tab || (hasKey ? '__discover' : '__recent'));
  const gridRef = useRef(null);
  const hubRef = useRef(null);
  const discover = tab === '__discover';
  const noun = isVod ? 'Movies' : 'Shows';

  const progressById = useMemo(() => {
    const m = new Map();
    for (const p of Object.values(progress)) if (p.item.kind === 'movie' && !p.watched && p.dur) m.set(p.item.id, (p.pos / p.dur) * 100);
    return m;
  }, [progress]);

  const cw = useMemo(
    () =>
      isVod
        ? Object.values(progress)
            .filter((p) => p.item.kind === 'movie' && !p.watched && p.pos > 30)
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((p) => p.item)
        : [],
    [progress, isVod]
  );

  const tabs = useMemo(
    () =>
      [
        hasKey && { id: '__discover', label: 'Discover' },
        { id: '__recent', label: 'Recently Added' },
        cw.length && { id: '__cw', label: 'Continue Watching', count: cw.length },
        { id: '__all', label: 'All', count: sec.items.length },
        { id: '__fav', label: 'Favourites', count: favs.length },
        ...sec.cats.map((c) => ({ id: c.id, label: c.name, count: c.count })),
      ].filter(Boolean),
    [sec, favs.length, cw.length, hasKey]
  );

  const items = useMemo(() => {
    switch (tab) {
      case '__cw':
        return cw;
      case '__recent':
        return sec.recent;
      case '__all':
        return sec.items;
      case '__fav':
        return favs;
      default:
        return sec.byCat.get(tab) || [];
    }
  }, [tab, sec, favs, cw]);

  const changeTab = (id) => {
    if (id === tab) return;
    mem.tab = id;
    mem.index = 0;
    setTab(id);
  };
  const focusContent = (id = tab) =>
    requestAnimationFrame(() => (id === '__discover' ? focusFirst(hubRef.current) : gridRef.current?.focusIndex(0)));
  useTabCycle(tabs, tab, changeTab, focusContent);

  useEffect(() => {
    if (discover) return; // the hub focuses its carousel itself
    requestAnimationFrame(() => gridRef.current?.focusIndex(Math.min(mem.index, items.length - 1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hubRows = useMemo(
    () => [
      { key: 'pop', title: `Popular ${noun}`, type: 'poster', items: disc.popular || [] },
      { key: 'top', title: `Top Rated ${noun}`, type: 'poster', items: disc.top_rated || [] },
      { key: 'liked', title: `Most Liked ${noun}`, type: 'poster', items: disc.most_liked || [] },
    ],
    [disc, noun]
  );

  // Back: grid → the *active* tab (not just the last-focused one) → side menu.
  useBack(() => {
    if (!document.activeElement?.closest('.lib-grid, .home-rows, .spot-carousel')) return false;
    const pill = document.querySelector('.lib-tabs .pill.is-active');
    return pill ? focusEl(pill) : focusGroup(`${section}-tabs`);
  });

  const label = tabs.find((t) => t.id === tab)?.label;
  const pills = (
    <PillTabs
      key="tabs"
      tabs={tabs}
      active={tab}
      onChange={changeTab}
      group={`${section}-tabs`}
      className={`lib-tabs ${discover ? 'home-tabs' : ''}`}
      onSelected={focusContent}
    />
  );
  return (
    <div className={`library2 ${discover ? 'is-hub' : ''}`} ref={hubRef}>
      {discover && (
        <Hub
          key="hub"
          rows={hubRows}
          slides={(disc.trending || []).slice(0, 10)}
          rowsKey={`${section}-discover`}
          empty={<p className="empty big">Finding trending {noun.toLowerCase()} on your service…</p>}
        />
      )}
      <header key="head" className="lib-head">
        <h1>{isVod ? 'Movies' : 'TV Shows'}</h1>
        <span className="muted">
          {label}
          {!discover && ` · ${items.length.toLocaleString()} titles`}
        </span>
      </header>
      {pills}
      {!discover && (
        <VirtualGrid
          key="grid"
          ref={gridRef}
          className="lib-grid"
          group={`${section}-grid`}
          trap="down,right"
          items={items}
          columns={COLS}
          rowHeight={25}
          overscan={1}
          empty={<p className="empty big">{tab === '__fav' ? 'Press F on any title to add it here.' : 'Nothing here yet'}</p>}
          renderItem={(it, i) => (
            <PosterCard
              item={it}
              caption
              subtitle={it.year || undefined}
              progress={isVod ? progressById.get(it.id) : 0}
              onFocus={() => (mem.index = i)}
              onSelect={() => openItem(it)}
            />
          )}
        />
      )}
    </div>
  );
}
