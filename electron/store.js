// Local persistence: profiles (password encrypted with the OS keystore via
// Electron safeStorage — DPAPI on Windows, libsecret/kwallet on Linux),
// app settings, and per-profile JSON documents (favorites, progress, caches).
import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const dataDir = () => app.getPath('userData');
export const profileDir = (profileId) => {
  if (!/^[a-z0-9-]+$/i.test(profileId)) throw new Error('Bad profile id');
  return path.join(dataDir(), 'profiles', profileId);
};

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Atomic write: temp file + rename, so a power cut never corrupts state. */
export async function writeJson(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data));
  await fsp.rename(tmp, file);
}

export function writeJsonSync(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

// ---------- secrets ----------
// Electron >= 40 prefers the async safeStorage API; fall back to the sync one on older versions.
const hasAsync = typeof safeStorage.encryptStringAsync === 'function';
async function secureAvailable() {
  try {
    return hasAsync ? await safeStorage.isAsyncEncryptionAvailable() : safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}
async function encryptSecret(plain) {
  if (await secureAvailable()) {
    const buf = hasAsync ? await safeStorage.encryptStringAsync(plain) : safeStorage.encryptString(plain);
    return { enc: 'safe', v: buf.toString('base64') };
  }
  // No OS keystore (e.g. headless Linux): obfuscate only. Shown in Settings.
  return { enc: 'b64', v: Buffer.from(plain, 'utf8').toString('base64') };
}
async function decryptSecret(s) {
  if (!s) return '';
  if (s.enc !== 'safe') return Buffer.from(s.v, 'base64').toString('utf8');
  const buf = Buffer.from(s.v, 'base64');
  return hasAsync ? (await safeStorage.decryptStringAsync(buf)).result : safeStorage.decryptString(buf);
}

// ---------- profiles ----------
const profilesFile = () => path.join(dataDir(), 'profiles.json');
let profilesCache = null;

async function loadProfiles() {
  profilesCache ??= await readJson(profilesFile(), { activeId: null, list: [] });
  return profilesCache;
}

const publicProfile = (p) => ({
  id: p.id,
  name: p.name,
  server: p.server,
  username: p.username,
  createdAt: p.createdAt,
});

export async function listProfiles() {
  const db = await loadProfiles();
  return {
    activeId: db.activeId,
    list: db.list.map(publicProfile),
    secureStorage: await secureAvailable(),
  };
}

export async function getCredentials(profileId) {
  const db = await loadProfiles();
  const p = db.list.find((x) => x.id === profileId);
  if (!p) throw new Error('Profile not found');
  return { server: p.server, username: p.username, password: await decryptSecret(p.password) };
}

export async function saveProfile({ id, name, server, username, password }) {
  const db = await loadProfiles();
  let p = id && db.list.find((x) => x.id === id);
  if (!p) {
    p = { id: crypto.randomUUID(), createdAt: Date.now() };
    db.list.push(p);
  }
  p.name = name || username;
  p.server = server;
  p.username = username;
  if (password) p.password = await encryptSecret(password); // blank = keep existing
  await writeJson(profilesFile(), db);
  return publicProfile(p);
}

export async function deleteProfile(id) {
  const db = await loadProfiles();
  db.list = db.list.filter((p) => p.id !== id);
  if (db.activeId === id) db.activeId = db.list[0]?.id ?? null;
  await writeJson(profilesFile(), db);
  await fsp.rm(profileDir(id), { recursive: true, force: true });
}

export async function setActiveProfile(id) {
  const db = await loadProfiles();
  db.activeId = id;
  await writeJson(profilesFile(), db);
}

// ---------- settings ----------
export const DEFAULT_SETTINGS = {
  liveFormat: 'ts', // ts | m3u8
  hwdec: 'auto-safe', // auto-safe | d3d11va | vaapi | nvdec | no
  deinterlace: false,
  mpvPath: '', // custom mpv binary; empty = bundled, then PATH
  catalogTtlHours: 12,
  epgTtlHours: 6,
  osdTimeoutSec: 4,
  screensaverMin: 3,
  startFullscreen: true,
  accent: '#3B82F6',
  overscan: 0, // per-edge safe margin for TVs that crop the picture
  tmdbKey: '', // free key from themoviedb.org (v3 key or v4 read token)
  artSource: 'prefer', // movies/series artwork: prefer (TMDB first) | missing (provider first) | off
  logoSource: 'missing', // channel logos from iptv-org: missing | prefer | off
  audioDevice: 'auto', // auto | pa:<card>|<profile> (PipeWire) | mpv:<device>
  subMode: 'off', // off | on
  // Picture (mpv video equalizer etc.)
  brightness: 0,
  contrast: 0,
  saturation: 0,
  gamma: 0,
  aspect: 'auto', // auto | 16:9 | 4:3 | 21:9 | zoom | stretch
  upscaling: 'standard', // fast | standard | high
  deband: false,
  toneMapping: 'auto', // auto | natural | bright (HDR → SDR)
  // Sound
  audioLang: 'auto',
  audioDelayMs: 0,
  nightMode: 'off', // off | night | level
  passthrough: false, // Dolby/DTS bitstream to a soundbar/AV receiver
  speakers: 'auto', // auto | stereo
  subLang: 'en',
  subSize: 'medium', // small | medium | large | xlarge
  subBackground: 'box', // box | outline
};
const settingsFile = () => path.join(dataDir(), 'settings.json');
let settingsCache = null;

export async function getSettings() {
  if (!settingsCache) {
    const saved = await readJson(settingsFile(), {});
    // v2 defaults: TMDB artwork first, subtitles off (earlier builds defaulted otherwise).
    if (!saved.v2) {
      if (saved.artSource === 'missing') delete saved.artSource;
      if (saved.subMode && saved.subMode !== 'on') delete saved.subMode;
      saved.v2 = true;
    }
    settingsCache = { ...DEFAULT_SETTINGS, ...saved };
  }
  return settingsCache;
}
export async function updateSettings(patch) {
  const s = await getSettings();
  for (const k of Object.keys(patch)) if (k in DEFAULT_SETTINGS) s[k] = patch[k];
  await writeJson(settingsFile(), s);
  return s;
}

// ---------- per-profile documents (favorites, progress) ----------
const DOCS = new Set(['favorites', 'progress', 'ui']);
const docCache = new Map(); // key -> {data, timer}

export async function getDoc(profileId, name) {
  if (!DOCS.has(name)) throw new Error('Unknown document');
  const key = `${profileId}/${name}`;
  if (!docCache.has(key)) {
    docCache.set(key, { data: await readJson(path.join(profileDir(profileId), `${name}.json`), {}), timer: null });
  }
  return docCache.get(key).data;
}

/** The in-memory copy of a document, if loaded (synchronous). */
export function peekDoc(profileId, name) {
  return docCache.get(`${profileId}/${name}`)?.data ?? null;
}

/** Replace a document in memory and persist it (debounced). */
export async function setDoc(profileId, name, data) {
  const key = `${profileId}/${name}`;
  if (!docCache.has(key)) await getDoc(profileId, name); // already loaded → update synchronously
  const entry = docCache.get(key);
  entry.data = data;
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    writeJson(path.join(profileDir(profileId), `${name}.json`), entry.data).catch(console.error);
  }, 500);
  return data;
}

/** Flush pending debounced writes synchronously (called on quit). */
export function flushDocs() {
  for (const [key, entry] of docCache) {
    if (!entry.timer) continue;
    clearTimeout(entry.timer);
    const [pid, name] = key.split('/');
    writeJsonSync(path.join(profileDir(pid), `${name}.json`), entry.data);
  }
}
