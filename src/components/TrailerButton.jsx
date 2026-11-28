// "Trailer" on film / series pages. Asks main whether there is one (which also
// starts resolving the streams, so playback starts in a second or two) and only
// shows the button when there is.
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore, toast, getState } from '../lib/store.js';
import { Focusable } from './Focusable.jsx';
import { Icon } from './Icons.jsx';

export function useTrailer(item, tmdbId) {
  const on = useStore((s) => !!s.settings?.tmdbKey && s.settings?.trailers !== false);
  const [t, setT] = useState(null);
  const key = item ? `${item.kind}:${item.id}:${tmdbId || ''}` : '';
  useEffect(() => {
    setT(null);
    if (!on || !item) return;
    let alive = true;
    api
      .invoke('trailer:get', { item: { kind: item.kind, id: item.id, name: item.name, year: item.year, tmdbId: tmdbId || item.tmdbId } })
      .then((r) => alive && setT(r?.available ? r : null))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, on]);
  return t;
}

export function TrailerButton({ item, tmdbId, title, ...rest }) {
  const t = useTrailer(item, tmdbId);
  const [busy, setBusy] = useState(false);
  if (!t) return null;
  const play = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.invoke('trailer:play', {
        profileId: getState().profileId,
        item: { kind: item.kind, id: item.id, name: item.name, year: item.year, tmdbId: tmdbId || item.tmdbId },
        title: title || item.name,
      });
    } catch (e) {
      toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 5000);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Focusable className="btn" data-trailer="" onSelect={play} {...rest}>
      <Icon name="movie" /> {busy ? 'Loading trailer…' : 'Trailer'}
    </Focusable>
  );
}
