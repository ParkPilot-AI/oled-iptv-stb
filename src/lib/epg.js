import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { useStore } from './store.js';

/**
 * Now/next for a (small, usually visible) set of channels. Batches one IPC
 * call, refreshes every minute and whenever a new guide is loaded.
 */
export function useNowNext(items) {
  const pid = useStore((s) => s.profileId);
  const ver = useStore((s) => s.epgVersion);
  const [tick, setTick] = useState(0);
  const [data, setData] = useState({});
  const key = useMemo(() => [...new Set(items.map((i) => i.epg).filter(Boolean))].join('\n'), [items]);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!key || !pid) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await api.invoke('epg:nowNext', { profileId: pid, ids: key.split('\n') });
        if (!cancelled) setData((d) => ({ ...d, ...r }));
      } catch {
        /* guide optional */
      }
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [key, pid, ver, tick]);

  return data;
}

/** Upcoming programmes for one channel: XMLTV first, short EPG API as fallback. */
export function useChannelGuide(channel, limit = 6) {
  const pid = useStore((s) => s.profileId);
  const ver = useStore((s) => s.epgVersion);
  const [list, setList] = useState([]);
  useEffect(() => {
    setList([]);
    if (!channel) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        let r = channel.epg ? await api.invoke('epg:range', { profileId: pid, epgId: channel.epg, from: Date.now(), limit }) : [];
        if (!r.length) r = await api.invoke('epg:short', { profileId: pid, streamId: channel.id });
        if (!cancelled) setList(r.filter((p) => p.stop > Date.now()).slice(0, limit));
      } catch {
        if (!cancelled) setList([]);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [channel, pid, ver, limit]);
  return list;
}

export const SLOT = 30 * 60e3;
export const floorSlot = (t) => Math.floor(t / SLOT) * SLOT;
const GUIDE_AHEAD = 36 * 3600e3;

/**
 * Full schedules (now → +36 h) for the given channels, fetched once per
 * channel and cached until a new guide is loaded. Channels without XMLTV data
 * fall back to get_short_epg (only requested for the focused channel).
 */
export function useSchedules(channels, focused) {
  const pid = useStore((s) => s.profileId);
  const ver = useStore((s) => s.epgVersion);
  const cache = useRef({ ver: -1, map: new Map(), short: new Map(), pending: new Set() });
  const [, bump] = useState(0);
  if (cache.current.ver !== ver) cache.current = { ver, map: new Map(), short: new Map(), pending: new Set() };
  const c = cache.current;

  const key = channels.map((ch) => ch.epg).filter(Boolean).join('\n');
  useEffect(() => {
    const ids = [...new Set(key.split('\n'))].filter((id) => id && !c.map.has(id) && !c.pending.has(id));
    if (!ids.length || !pid) return;
    ids.forEach((id) => c.pending.add(id));
    const from = floorSlot(Date.now()) - SLOT;
    api
      .invoke('epg:grid', { profileId: pid, ids, from, to: from + GUIDE_AHEAD })
      .then((r) => {
        for (const id of ids) c.map.set(id, r[id] || []);
        bump((x) => x + 1);
      })
      .catch(() => ids.forEach((id) => c.map.set(id, [])))
      .finally(() => ids.forEach((id) => c.pending.delete(id)));
  }, [key, pid, c]);

  // Short-EPG fallback for the focused channel only (keeps load on the panel low).
  useEffect(() => {
    if (!focused || !pid) return;
    const list = focused.epg ? c.map.get(focused.epg) : [];
    if (!list || list.length || c.short.has(focused.id)) return;
    const t = setTimeout(() => {
      api
        .invoke('epg:short', { profileId: pid, streamId: focused.id })
        .then((r) => c.short.set(focused.id, r))
        .catch(() => c.short.set(focused.id, []))
        .finally(() => bump((x) => x + 1));
    }, 350);
    return () => clearTimeout(t);
  }, [focused, pid, c, c.map.size]);

  return (ch) => {
    const list = ch.epg ? c.map.get(ch.epg) : [];
    if (list?.length) return list;
    return c.short.get(ch.id) || (list ? [] : null); // null = still loading
  };
}
