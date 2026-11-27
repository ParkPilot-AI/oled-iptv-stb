// Audio output selection.
//  • Linux with PipeWire/PulseAudio (the set-top box): outputs are sound-card
//    *profiles* (HDMI vs analog live on the same Intel card, only one active),
//    so choosing one switches the card profile and the default sink. mpv keeps
//    audio-device=auto and follows the default.
//  • Elsewhere: mpv's own device list (WASAPI, CoreAudio…), passed as --audio-device.
// Setting values: 'auto' | 'pa:<card>|<profile>' | 'mpv:<device>'.
import { execFile } from 'node:child_process';

const run = (bin, args, timeout = 8000) =>
  new Promise((resolve, reject) =>
    execFile(bin, args, { timeout, maxBuffer: 4 << 20 }, (err, stdout) => (err ? reject(err) : resolve(stdout)))
  );

const PACTL = process.env.STB_PACTL || 'pactl';

/** Friendly name for a card profile. */
export function profileLabel(profileName, profileDesc, cardDesc, multiCard) {
  const out = profileName.replace(/^output:/, '').split('+')[0];
  let label;
  const m = out.match(/^hdmi-(stereo|surround[^-]*)(?:-extra(\d+))?/);
  if (m) label = `TV (HDMI${m[2] ? ` ${Number(m[2]) + 1}` : ''})${m[1] !== 'stereo' ? ' · surround' : ''}`;
  else if (/^analog/.test(out)) label = /usb/i.test(cardDesc || '') ? `${cardDesc}` : 'Headphone jack / speakers';
  else if (/^iec958/.test(out)) label = 'Optical / S/PDIF';
  else label = (profileDesc || out).replace(/ Output$/, '');
  return multiCard && cardDesc && !label.includes(cardDesc) ? `${label} · ${cardDesc}` : label;
}

/** Parse `pactl --format=json list cards` into selectable outputs (one per output port). */
export function outputsFromCards(cards) {
  const multiCard = cards.filter((c) => Object.keys(c.profiles || {}).some((p) => p.startsWith('output:'))).length > 1;
  const out = [];
  for (const c of cards) {
    const cardDesc = c.properties?.['device.description'] || c.properties?.['alsa.card_name'] || '';
    const byOutput = new Map();
    for (const [name, p] of Object.entries(c.profiles || {})) {
      if (!name.startsWith('output:') || p.available === false) continue;
      const key = name.split('+')[0];
      const prev = byOutput.get(key);
      // Prefer the plain output profile over "output+input" duplex combos.
      if (!prev || (prev.name.includes('+') && !name.includes('+'))) byOutput.set(key, { name, p });
    }
    for (const { name, p } of byOutput.values()) {
      out.push({
        id: `pa:${c.name}|${name}`,
        card: c.name,
        profile: name,
        label: profileLabel(name, p.description, cardDesc, multiCard),
        active: c.active_profile === name,
        hdmi: /hdmi/.test(name),
        priority: p.priority || 0,
      });
    }
  }
  // Same label twice? Make them distinct with the port name.
  const seen = new Map();
  for (const o of out) seen.set(o.label, (seen.get(o.label) || 0) + 1);
  for (const o of out) if (seen.get(o.label) > 1) o.label = `${o.label} (${o.profile.replace(/^output:/, '').split('+')[0]})`;
  return out;
}

/** Parse `mpv --audio-device=help`. */
export function outputsFromMpvHelp(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(/^\s+'([^']+)'\s+\((.*)\)\s*$/);
    if (!m || m[1] === 'auto') continue;
    out.push({ id: `mpv:${m[1]}`, device: m[1], label: m[2] });
  }
  return out;
}

async function pactlJson(...args) {
  return JSON.parse(await run(PACTL, ['--format=json', ...args]));
}

async function hasPactl() {
  if (process.platform !== 'linux') return false;
  try {
    await run(PACTL, ['info'], 3000);
    return true;
  } catch {
    return false;
  }
}

/** List outputs. Always starts with Automatic. */
export async function listOutputs({ mpvBinary } = {}) {
  const auto = { id: 'auto', label: 'Automatic (TV via HDMI)' };
  if (await hasPactl()) {
    try {
      return { backend: 'pactl', outputs: [auto, ...outputsFromCards(await pactlJson('list', 'cards'))] };
    } catch {}
  }
  if (mpvBinary) {
    try {
      const help = await run(mpvBinary, ['--no-config', '--audio-device=help'], 8000);
      return { backend: 'mpv', outputs: [{ id: 'auto', label: 'Automatic (system default)' }, ...outputsFromMpvHelp(help)] };
    } catch {}
  }
  return { backend: 'none', outputs: [auto] };
}

/** Make a card profile live and route all audio to its sink. */
async function activateProfile(card, profile) {
  await run(PACTL, ['set-card-profile', card, profile]);
  const prefix = `${card.replace(/^alsa_card\./, 'alsa_output.')}.`;
  const want = `${prefix}${profile.replace(/^output:/, '').split('+')[0]}`;
  let sink = null;
  for (let i = 0; i < 10 && !sink; i++) {
    const sinks = await pactlJson('list', 'sinks').catch(() => []);
    sink = sinks.find((s) => s.name === want) || sinks.find((s) => s.name?.startsWith(prefix)) || sinks.find((s) => s.properties?.['device.name'] === card);
    if (!sink) await new Promise((r) => setTimeout(r, 300));
  }
  if (!sink) return;
  await run(PACTL, ['set-default-sink', sink.name]);
  // Move anything already playing (mpv) to the new output.
  const inputs = await pactlJson('list', 'sink-inputs').catch(() => []);
  for (const si of inputs) await run(PACTL, ['move-sink-input', String(si.index), sink.name]).catch(() => {});
}

/**
 * Apply an output choice. Returns the mpv audio-device value to use.
 * 'auto' on PipeWire picks the best HDMI port (what the box does at boot).
 */
export async function applyOutput(id = 'auto') {
  if (id.startsWith('mpv:')) return id.slice(4);
  if (!(await hasPactl())) return 'auto';
  if (id.startsWith('pa:')) {
    const [card, profile] = id.slice(3).split('|');
    await activateProfile(card, profile);
    return 'auto';
  }
  const outs = outputsFromCards(await pactlJson('list', 'cards').catch(() => []));
  const hdmi = outs.filter((o) => o.hdmi).sort((a, b) => b.priority - a.priority);
  const pick = hdmi.find((o) => /hdmi-stereo$/.test(o.profile)) || hdmi[0];
  if (pick) await activateProfile(pick.card, pick.profile);
  return 'auto';
}

// ---------- volume ----------
const STEP = 5;

/** System volume (PipeWire default output) — works in menus and during playback. */
export async function systemVolume(action) {
  if (!(await hasPactl())) return null;
  const sink = '@DEFAULT_SINK@';
  const read = async () => {
    const v = await run(PACTL, ['get-sink-volume', sink]);
    const m = await run(PACTL, ['get-sink-mute', sink]);
    return { volume: Number((/(\d+)%/.exec(v) || [])[1] ?? 0), muted: /yes/i.test(m) };
  };
  if (action === 'mute') await run(PACTL, ['set-sink-mute', sink, 'toggle']);
  else if (action === 'up' || action === 'down') {
    const cur = await read();
    const next = Math.max(0, Math.min(100, cur.volume + (action === 'up' ? STEP : -STEP)));
    await run(PACTL, ['set-sink-volume', sink, `${next}%`]);
    if (action === 'up' && cur.muted) await run(PACTL, ['set-sink-mute', sink, '0']);
  }
  return read();
}
