// Small volume indicator shown for a moment after Volume Up/Down/Mute.
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Icon } from './Icons.jsx';
import './volume.css';

export function changeVolume(action) {
  const a = action === 'volUp' ? 'up' : action === 'volDown' ? 'down' : 'mute';
  return api.invoke('volume:change', { action: a }).catch(() => null);
}

export function VolumeHud() {
  const [v, setV] = useState(null);
  const t = useRef(null);
  useEffect(
    () =>
      api.on('volume:changed', (r) => {
        setV(r);
        clearTimeout(t.current);
        t.current = setTimeout(() => setV(null), 1800);
      }),
    []
  );
  if (!v) return null;
  const pct = v.muted ? 0 : v.volume;
  return (
    <div className="volume-hud" role="status" aria-live="polite">
      <Icon name={v.muted || pct === 0 ? 'mute' : pct < 50 ? 'volumeLow' : 'volume'} size="1.8rem" />
      <div className="volume-bar">
        <div style={{ width: `${pct}%` }} />
      </div>
      <span className="volume-num">{v.muted ? 'Muted' : pct}</span>
    </div>
  );
}
