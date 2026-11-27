import { useEffect, useRef } from 'react';
import { Focusable } from './Focusable.jsx';
import { useKeyHandler } from '../nav/keys.js';
import { getState } from '../lib/store.js';

/**
 * Horizontal hub/filter pills. Focusing a pill selects it after a short pause
 * (so sweeping across pills doesn't reload content on every step); OK selects
 * immediately. Up is trapped so focus never escapes above the tabs.
 */
export function PillTabs({ tabs, active, onChange, group, className = '', onSelected }) {
  const timer = useRef(null);
  const box = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    box.current?.querySelector('.pill.is-active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [active]);
  return (
    <div ref={box} className={`pill-tabs ${className}`} data-focus-group={group} data-focus-trap="up">
      {tabs.map((t) => (
        <Focusable
          key={t.id}
          className={`pill ${t.id === active ? 'is-active' : ''}`}
          data-focus-default={t.id === active ? '' : undefined}
          onFocus={() => {
            clearTimeout(timer.current);
            if (t.id !== active) timer.current = setTimeout(() => onChange(t.id), 250);
          }}
          onSelect={() => {
            clearTimeout(timer.current);
            onChange(t.id);
            onSelected?.(t.id);
          }}
        >
          {t.label}
          {t.count != null && <span className="pill-count">{t.count}</span>}
        </Focusable>
      ))}
    </div>
  );
}

/** PageUp/PageDown (ChannelUp/Down, shoulder buttons) cycle through tabs. */
export function useTabCycle(tabs, active, onChange, onCycled) {
  useKeyHandler(
    (action) => {
      if (action !== 'chUp' && action !== 'chDown') return false;
      const s = getState();
      if (s.detail || s.confirm || !tabs.length) return false;
      const i = Math.max(0, tabs.findIndex((t) => t.id === active));
      const next = tabs[(i + (action === 'chDown' ? 1 : -1) + tabs.length) % tabs.length];
      onChange(next.id);
      onCycled?.(next.id);
      return true;
    },
    { priority: 20 }
  );
}
