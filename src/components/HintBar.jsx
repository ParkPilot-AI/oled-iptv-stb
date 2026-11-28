// Bottom-right button hints (like a console's or a streaming app's): what OK, Back,
// Info… do on the focused item, named for the device in use — "OK / Back" on a
// remote or keyboard, "A / B" on a game controller. It fades out a few seconds
// after the last key press, so nothing static stays on the OLED panel.
import { useEffect, useState } from 'react';
import { useInputMode } from '../lib/feedback.js';
import { useStore } from '../lib/store.js';
import { GLYPHS, PAD_COLOURS, hintsFor } from '../lib/hints.js';

export function HintBar() {
  const mode = useInputMode();
  const enabled = useStore((s) => s.settings?.showHints !== false);
  const docked = useStore((s) => s.docked?.mode || null);
  const [el, setEl] = useState(null);
  const [shown, setShown] = useState(true);
  useEffect(() => {
    let t = null;
    const wake = () => {
      setShown(true);
      clearTimeout(t);
      t = setTimeout(() => setShown(false), 5000);
    };
    const onFocus = () => setEl(document.activeElement);
    window.addEventListener('keydown', wake, true);
    document.addEventListener('focusin', onFocus);
    wake();
    onFocus();
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', wake, true);
      document.removeEventListener('focusin', onFocus);
    };
  }, []);
  if (!enabled) return null;
  const g = GLYPHS[mode] || GLYPHS.remote;
  const hints = hintsFor(el, { docked });
  return (
    <div className={`hint-bar ${shown ? '' : 'is-hidden'}`} aria-hidden="true">
      {hints.map((h) => {
        const glyph = g[h.key];
        const colour = mode === 'gamepad' ? PAD_COLOURS[glyph] : undefined;
        return (
          <span key={h.key} className="hint">
            <kbd className={colour ? 'is-pad' : ''} style={colour ? { '--pad': colour } : undefined}>
              {glyph}
            </kbd>
            {h.label}
          </span>
        );
      })}
    </div>
  );
}
