// Button hints: what each button does on the focused item, and its name on the
// device in use (remote/keyboard or game controller). Rendered by HintBar.jsx.
export const GLYPHS = {
  remote: { enter: 'OK', back: 'Back', info: 'Info', hold: 'Hold OK', tabs: 'CH +/−', play: '⏯', fav: 'F' },
  gamepad: { enter: 'A', back: 'B', info: 'Y', hold: 'Hold A', tabs: 'LB / RB', play: 'X', fav: 'Menu' },
};
export const PAD_COLOURS = { A: '#3fbf4f', B: '#e5484d', X: '#3b82f6', Y: '#f5c518' };

/**
 * Hints for what's focused: [{ key: 'enter'|'back'|…, label }].
 * el: the focused element; ctx: { docked, section }.
 */
export function hintsFor(el, { docked = false } = {}) {
  const out = [];
  if (el?.dataset?.fav) {
    out.push({ key: 'enter', label: 'Open' }, { key: 'hold', label: 'Favourite' });
    if (/^(movie|series):/.test(el.dataset.fav)) out.push({ key: 'info', label: docked === 'peek' ? 'Close preview' : 'Trailer' });
  } else if (el?.closest?.('.settings')) {
    out.push({ key: 'enter', label: 'Change' }, { key: 'tabs', label: 'Tabs' });
  } else if (el) {
    out.push({ key: 'enter', label: 'Select' });
  }
  if (docked === 'dock') out.push({ key: 'play', label: 'Full screen' });
  out.push({ key: 'back', label: docked === 'peek' ? 'Close preview' : docked ? 'Back / close player' : 'Back' });
  return out;
}
