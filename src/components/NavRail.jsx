import { Mark, Wordmark } from './Logo.jsx';
import { useRef, useState } from 'react';
import { Focusable } from './Focusable.jsx';
import { Icon } from './Icons.jsx';
import { focusFirst } from '../nav/spatial.js';

export const SECTIONS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'live', label: 'Live TV', icon: 'live' },
  { id: 'movies', label: 'Movies', icon: 'movie' },
  { id: 'series', label: 'TV Shows', icon: 'series' },
  { id: 'favorites', label: 'Favourites', icon: 'star' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

/** Floating pill rail: 72 px icon column, expands to a 240 px glass panel with labels while focused. */
export function NavRail({ section, onSelect }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  return (
    <nav
      ref={ref}
      className={`rail ${open ? 'is-open' : ''}`}
      data-focus-group="rail"
      data-focus-side=""
      data-focus-trap="up,down"
      onFocus={() => setOpen(true)}
      onBlur={(e) => !ref.current.contains(e.relatedTarget) && setOpen(false)}
    >
      <div className="rail-brand">
        <Mark className="rail-mark" height="1.5rem" />
        <Wordmark className="rail-label" height="1.5rem" />
      </div>
      {SECTIONS.map((s) => (
        <Focusable
          key={s.id}
          focusKey={`rail-${s.id}`}
          className={`rail-item ${section === s.id ? 'is-active' : ''}`}
          data-focus-default={section === s.id ? '' : undefined}
          onSelect={() => {
            onSelect(s.id);
            // Move into the newly rendered content.
            requestAnimationFrame(() => {
              const main = document.querySelector('.content');
              if (main) focusFirst(main);
            });
          }}
        >
          <Icon name={s.icon} size="1.75rem" />
          <span className="rail-label">{s.label}</span>
        </Focusable>
      ))}
    </nav>
  );
}
