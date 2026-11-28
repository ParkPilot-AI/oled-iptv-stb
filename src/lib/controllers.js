// Bluetooth controller status shared by Settings → Controllers, the Games page and
// the "Controller connected" toasts. Polls bt:status off the UI thread (an IPC call):
// every 5 s while a screen that shows controllers is open, otherwise every 30 s.
import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api.js';
import { toast } from './store.js';

const FAST_MS = 5000;
const SLOW_MS = 30000;
let status = null;
let fast = 0;
let timer = null;
let inflight = null;
let started = false;
let lastBtConnect = 0; // when the Bluetooth watch last announced a controller
const subs = new Set();
const emit = () => subs.forEach((f) => f());

const gamepads = (st) => (st?.devices || []).filter((d) => d.gamepad && d.connected);
const label = (d) => `${d.name}${d.battery != null ? ` (${d.battery}%)` : ''}`;

/** Toasts for gamepads that connected or disconnected since the last check. */
export function diffGamepads(prev, next) {
  if (!prev) return [];
  const before = new Map(gamepads(prev).map((d) => [d.mac, d]));
  const after = new Map(gamepads(next).map((d) => [d.mac, d]));
  const out = [];
  for (const [mac, d] of after) if (!before.has(mac)) out.push(`Controller connected · ${label(d)}`);
  for (const [mac, d] of before) if (!after.has(mac)) out.push(`Controller disconnected · ${d.name}`);
  return out;
}

export async function refreshControllers() {
  if (inflight) return inflight;
  inflight = api
    .invoke('bt:status')
    .catch((e) => ({ adapter: false, reason: 'error', error: e.message, devices: [] }))
    .then((next) => {
      for (const msg of diffGamepads(status, next)) {
        if (msg.startsWith('Controller connected')) lastBtConnect = Date.now();
        toast(msg, 4000);
      }
      status = next;
      emit();
      return next;
    })
    .finally(() => (inflight = null));
  return inflight;
}

function schedule() {
  clearTimeout(timer);
  // Nothing to watch on Windows / non-box systems: no polling there.
  if (status && (status.reason === 'windows' || status.reason === 'unsupported')) return;
  timer = setTimeout(
    async () => {
      await refreshControllers();
      schedule();
    },
    fast > 0 ? FAST_MS : SLOW_MS
  );
}

/** Start background watching (once, after start-up). */
export function startControllerWatch() {
  if (started) return;
  started = true;
  refreshControllers().then(schedule);
}

const subscribe = (f) => (subs.add(f), () => subs.delete(f));

/** Current status; `watchFast` polls every 5 s while the calling screen is mounted. */
export function useControllers(watchFast = false) {
  const st = useSyncExternalStore(subscribe, () => status);
  useEffect(() => {
    if (!watchFast) return;
    fast++;
    refreshControllers().then(schedule);
    return () => {
      fast--;
      schedule();
    };
  }, [watchFast]);
  return st;
}

/** One-line state for status rows: On / Off / Blocked / No adapter. */
export function bluetoothState(st) {
  if (!st) return { enabled: false, text: 'Checking…', reason: '' };
  if (st.reason === 'windows') return { enabled: false, windows: true, text: 'Managed by Windows', reason: 'Pair controllers in Windows Bluetooth settings.' };
  if (!st.adapter) {
    if (st.reason === 'unsupported') return { enabled: false, text: 'Not available', reason: 'Bluetooth pairing works on the ONYX set-top box.' };
    return {
      enabled: false,
      text: 'No Bluetooth adapter found',
      reason: 'Plug in a USB Bluetooth adapter — this page turns on by itself within a few seconds.',
    };
  }
  if (st.blocked) return { enabled: false, text: 'Blocked', reason: 'Bluetooth is switched off by a hardware switch or BIOS setting.' };
  if (!st.powered) return { enabled: true, text: 'Off', reason: 'Bluetooth is off; it will be switched on when you pair.' };
  return { enabled: true, text: 'On', reason: '' };
}

/** "Xbox Wireless Controller connected · 80%" or null. `pads` (Gamepad API, USB too) is the fallback. */
export function connectedPadText(st, pads = []) {
  const d = gamepads(st)[0];
  if (d) return `${d.name} connected${d.battery != null ? ` · ${d.battery}%` : ''}`;
  return pads[0] ? `${pads[0].name} connected` : null;
}

/** True if a Bluetooth "Controller connected" toast was shown in the last `ms`. */
export const btJustConnected = (ms = 8000) => Date.now() - lastBtConnect < ms;
