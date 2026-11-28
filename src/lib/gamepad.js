// Game controllers (USB or Bluetooth) in ONYX itself, via the browser Gamepad API:
// D-pad / left stick move focus, A = OK, B = Back, plus a few shortcuts. Buttons are
// turned into the same key events a remote sends, so every screen works unchanged.
// Only the focused ONYX window listens, so nothing reaches ONYX while GeForce NOW
// (or anything else) has the screen.
import { useEffect, useState } from 'react';

// Standard Gamepad mapping (https://w3c.github.io/gamepad/#remapping).
export const BUTTON_KEYS = {
  0: 'Enter', // A
  1: 'Escape', // B
  2: ' ', // X  play/pause
  3: 'i', // Y  info / trailer preview
  4: 'PageUp', // LB  previous tab / channel
  5: 'PageDown', // RB  next tab / channel
  8: 'Escape', // View / Back / Select
  9: 'f', // Menu / Start  favourite
};
const DIRS = { 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight' };
const STICK = 0.6; // left-stick dead zone
export const REPEAT_DELAY = 420;
export const REPEAT_EVERY = 130;

const pressed = (b) => !!b && (b.pressed || b.value > 0.5);

/** Keys held right now on one pad: a Set of key names. */
export function heldKeys(gp) {
  const out = new Set();
  const b = gp.buttons || [];
  for (const [i, key] of Object.entries(BUTTON_KEYS)) if (pressed(b[i])) out.add(key);
  for (const [i, key] of Object.entries(DIRS)) if (pressed(b[i])) out.add(key);
  const [x = 0, y = 0] = gp.axes || [];
  if (Math.abs(x) > Math.abs(y)) {
    if (x < -STICK) out.add('ArrowLeft');
    if (x > STICK) out.add('ArrowRight');
  } else {
    if (y < -STICK) out.add('ArrowUp');
    if (y > STICK) out.add('ArrowDown');
  }
  return out;
}

/**
 * One poll step for one pad. `prev` maps key → { since, last } for keys held at the
 * last poll. Returns { state, events: [{ type: 'keydown'|'keyup', key, repeat }] }.
 * Arrows auto-repeat while held; other buttons send one keydown and a keyup on
 * release (so holding A still works as long-press OK).
 */
export function padStep(prev, gp, now) {
  const held = heldKeys(gp);
  const state = {};
  const events = [];
  for (const key of held) {
    const p = prev[key];
    if (!p) {
      events.push({ type: 'keydown', key, repeat: false });
      state[key] = { since: now, last: now };
    } else if (key.startsWith('Arrow') && now - p.since >= REPEAT_DELAY && now - p.last >= REPEAT_EVERY) {
      events.push({ type: 'keydown', key, repeat: true });
      state[key] = { since: p.since, last: now };
    } else state[key] = p;
  }
  for (const key of Object.keys(prev)) if (!held.has(key)) events.push({ type: 'keyup', key, repeat: false });
  return { state, events };
}

/** "Microsoft X-Box Series S|X Controller (STANDARD GAMEPAD Vendor: 045e …)" → "Xbox Series S|X Controller". */
export function padName(id = '') {
  let n = String(id)
    .replace(/\s*\((STANDARD GAMEPAD|Vendor:).*$/i, '')
    .replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '')
    .trim();
  n = n.replace(/^Microsoft\s+/i, '').replace(/X-Box/gi, 'Xbox');
  return n || 'Game controller';
}

const getPads = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : []);

/** Connected pads seen by this window: [{ index, name }]. Most pads appear after their first button press. */
export function listPads() {
  return getPads().map((g) => ({ index: g.index, name: padName(g.id) }));
}

let running = false;
/**
 * Start turning controller input into key events (once per window).
 * enabled() → false pauses it (e.g. while a game is running).
 */
export function startGamepadNav({ enabled = () => true, target = window } = {}) {
  if (running || typeof window === 'undefined' || !navigator.getGamepads) return () => {};
  running = true;
  const states = new Map(); // pad index → key state
  let raf = 0;
  let timer = 0;
  const send = ({ type, key, repeat }) => target.dispatchEvent(new KeyboardEvent(type, { key, repeat, bubbles: true, cancelable: true }));
  const tick = () => {
    const active = document.hasFocus() && enabled();
    const pads = getPads();
    const now = performance.now();
    for (const gp of pads) {
      const prev = states.get(gp.index) || {};
      const { state, events } = active ? padStep(prev, gp, now) : padStep(prev, { buttons: [], axes: [] }, now);
      // Inactive: only release keys that were down, never press new ones.
      events.filter((e) => active || e.type === 'keyup').forEach(send);
      states.set(gp.index, state);
    }
    for (const i of [...states.keys()]) if (!pads.some((g) => g.index === i)) states.delete(i);
    schedule(pads.length > 0);
  };
  // ~60 Hz while a pad is connected (requestAnimationFrame), else check twice a second.
  const schedule = (fast) => {
    if (fast) raf = requestAnimationFrame(tick);
    else timer = setTimeout(tick, 500);
  };
  const kick = () => {
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    tick();
  };
  window.addEventListener('gamepadconnected', kick);
  tick();
  return () => {
    running = false;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    window.removeEventListener('gamepadconnected', kick);
  };
}

/** Pads connected right now, updated as they come and go. */
export function useGamepads() {
  const [pads, setPads] = useState(listPads);
  useEffect(() => {
    const update = () => setPads(listPads());
    window.addEventListener('gamepadconnected', update);
    window.addEventListener('gamepaddisconnected', update);
    const t = setInterval(update, 2000);
    return () => {
      window.removeEventListener('gamepadconnected', update);
      window.removeEventListener('gamepaddisconnected', update);
      clearInterval(t);
    };
  }, []);
  return pads;
}
