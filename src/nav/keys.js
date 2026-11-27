// Key normalisation + priority-ordered handler stacks for keys and "back".
import { useEffect, useRef } from 'react';
import { move } from './spatial.js';

export function keyAction(e) {
  switch (e.key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'Enter':
    case 'Select':
    case 'Accept':
      return 'enter';
    case 'Escape':
    case 'Backspace':
    case 'BrowserBack':
    case 'GoBack':
      return 'back';
    case 'PageUp':
    case 'ChannelUp':
      return 'chUp';
    case 'PageDown':
    case 'ChannelDown':
      return 'chDown';
    case ' ':
    case 'MediaPlayPause':
    case 'MediaPlay':
    case 'MediaPause':
      return 'playPause';
    case 'MediaTrackNext':
    case 'MediaFastForward':
      return 'next';
    case 'MediaTrackPrevious':
    case 'MediaRewind':
      return 'prev';
    case 'MediaStop':
      return 'stop';
    case 'AudioVolumeUp':
    case 'VolumeUp':
      return 'volUp';
    case 'AudioVolumeDown':
    case 'VolumeDown':
      return 'volDown';
    case 'AudioVolumeMute':
    case 'VolumeMute':
      return 'mute';
    case 'f':
    case 'F':
      return 'fav';
    case 'i':
    case 'I':
      return 'info';
    case 'a':
    case 'A':
      return 'audio';
    case 's':
    case 'S':
      return 'subs';
    default:
      return /^[0-9]$/.test(e.key) ? 'digit' : null;
  }
}

// ----- stacks: higher priority first, then most recently registered -----
let seq = 0;
const keyHandlers = [];
const backHandlers = [];

function add(list, entry) {
  list.push(entry);
  list.sort((a, b) => b.priority - a.priority || b.seq - a.seq);
  return () => {
    const i = list.indexOf(entry);
    if (i !== -1) list.splice(i, 1);
  };
}

/** handler(action, event) → return true to consume. */
export function useKeyHandler(handler, { enabled = true, priority = 0 } = {}) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    return add(keyHandlers, { fn: (a, e) => ref.current(a, e), priority, seq: ++seq });
  }, [enabled, priority]);
}

/** handler() → return true if it handled "back". */
export function useBack(handler, { enabled = true, priority = 0 } = {}) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    return add(backHandlers, { fn: () => ref.current(), priority, seq: ++seq });
  }, [enabled, priority]);
}

export function runBack() {
  for (const h of [...backHandlers]) if (h.fn()) return true;
  return false;
}

/** Global dispatcher; install once at the app root. */
export function dispatchKey(e, { onAnyKey } = {}) {
  if (e.ctrlKey || e.metaKey || (e.altKey && e.key !== 'Alt')) return;
  onAnyKey?.(e);
  const action = keyAction(e);
  for (const h of [...keyHandlers]) {
    if (h.fn(action, e)) {
      e.preventDefault();
      return;
    }
  }
  if (!action) return;
  e.preventDefault();
  switch (action) {
    case 'up':
    case 'down':
    case 'left':
    case 'right':
      move(action);
      break;
    case 'enter':
      if (!e.repeat) document.activeElement?.click?.();
      break;
    case 'back':
      if (!e.repeat) runBack();
      break;
  }
}
