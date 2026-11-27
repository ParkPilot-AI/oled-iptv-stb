import { useEffect, useState } from 'react';
import { clock } from '../lib/format.js';
import { imgUrl } from '../lib/api.js';

const spot = () => ({ x: 4 + Math.random() * 62, y: 6 + Math.random() * 74 });

/**
 * OLED screensaver: fades to pure black; a dim clock (plus optional
 * now-playing artwork and title) drifts continuously across the screen, so no
 * pixel is lit in the same place for long.
 */
export function Screensaver({ title, subtitle, art }) {
  const [pos, setPos] = useState(spot);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    // Start drifting right away, then pick a new target every 19 s (= transition time).
    const first = setTimeout(() => setPos(spot()), 50);
    const t = setInterval(() => {
      setNow(Date.now());
      setPos(spot());
    }, 19000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  return (
    <div className="screensaver">
      <div className="saver-block" style={{ transform: `translate(${pos.x}vw, ${pos.y}vh)` }}>
        {art && <img className="saver-art" src={imgUrl(art, 240)} alt="" />}
        <span className="saver-clock">{clock(now)}</span>
        {title && (
          <span className="saver-info">
            <b>{title}</b>
            {subtitle && <span>{subtitle}</span>}
          </span>
        )}
      </div>
    </div>
  );
}

/** Returns true after `ms` without any keydown; first key after that is swallowed by caller. */
export function useIdle(ms, enabled = true) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!enabled) return setIdle(false);
    let t = setTimeout(() => setIdle(true), ms);
    const reset = () => {
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), ms);
    };
    window.addEventListener('keydown', reset, true);
    window.addEventListener('iptv-activity', reset);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', reset, true);
      window.removeEventListener('iptv-activity', reset);
    };
  }, [ms, enabled]);
  return [idle, setIdle];
}
