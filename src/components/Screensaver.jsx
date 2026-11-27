import { useEffect, useState } from 'react';
import { clock } from '../lib/format.js';

/**
 * Pure-black OLED screensaver: everything off except a tiny dim clock that
 * jumps to a new random position every 20 s (pixel-shift), so no pixel is lit
 * for long.
 */
export function Screensaver() {
  const [pos, setPos] = useState({ x: 40, y: 40 });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      setPos({ x: 5 + Math.random() * 80, y: 5 + Math.random() * 85 });
    }, 20000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="screensaver">
      <span style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>{clock(now)}</span>
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
