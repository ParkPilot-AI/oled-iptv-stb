// Navigation feedback: which input device was used last (remote/keyboard or game
// controller — the hint bar shows matching button names), short UI sounds made
// with the Web Audio API, and gentle controller rumble. All optional (Settings).
import { useSyncExternalStore } from 'react';

let mode = 'remote'; // 'remote' | 'gamepad'
const subs = new Set();
const subscribe = (f) => (subs.add(f), () => subs.delete(f));

/** Call for every key event: controller buttons arrive as synthetic (untrusted) events. */
export function noteInput(e) {
  const next = e && e.isTrusted === false ? 'gamepad' : 'remote';
  if (next !== mode) {
    mode = next;
    subs.forEach((f) => f());
  }
}
export const inputMode = () => mode;
export const useInputMode = () => useSyncExternalStore(subscribe, () => mode);

let opts = { sounds: true, rumble: true };
export function configureFeedback({ uiSounds, rumble } = {}) {
  opts = { sounds: uiSounds !== false, rumble: rumble !== false };
}

// name → [startHz, endHz, ms, gain, wave]
export const SOUNDS = {
  move: [1100, 1100, 22, 0.035, 'sine'],
  select: [700, 1050, 60, 0.05, 'sine'],
  back: [620, 420, 60, 0.045, 'sine'],
  bump: [170, 140, 70, 0.06, 'triangle'],
  open: [520, 880, 90, 0.04, 'sine'],
};

let ctx = null;
function audio() {
  if (ctx) return ctx;
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  try {
    ctx = new AC({ latencyHint: 'interactive' });
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Play a short UI sound (no-op when sounds are off or Web Audio is missing). */
export function sfx(name) {
  if (!opts.sounds) return;
  const spec = SOUNDS[name];
  const ac = spec && audio();
  if (!ac) return;
  try {
    if (ac.state === 'suspended') ac.resume();
    const [f0, f1, ms, gain, type] = spec;
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.linearRampToValueAtTime(f1, t + ms / 1000);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.connect(g).connect(ac.destination);
    osc.start(t);
    osc.stop(t + ms / 1000 + 0.02);
  } catch {
    /* never let a sound break navigation */
  }
}

// name → [ms, strong, weak]
export const RUMBLES = { bump: [70, 0.35, 0.2], open: [45, 0.0, 0.25], select: [25, 0.0, 0.15] };

/** A short pulse on the controller that was used last (only when it's in use). */
export function rumble(name) {
  if (!opts.rumble || mode !== 'gamepad' || typeof navigator === 'undefined' || !navigator.getGamepads) return;
  const spec = RUMBLES[name];
  if (!spec) return;
  for (const gp of navigator.getGamepads()) {
    const act = gp?.vibrationActuator;
    if (!act?.playEffect) continue;
    act.playEffect('dual-rumble', { duration: spec[0], strongMagnitude: spec[1], weakMagnitude: spec[2] }).catch(() => {});
  }
}

/** Sound + rumble together (the usual call). */
export function feedback(name) {
  sfx(name);
  rumble(name);
}
