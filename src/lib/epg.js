import { useEffect, useMemo, useState } from 'react';
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
