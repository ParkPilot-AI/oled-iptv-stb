// Electron main process: windows, IPC surface, lifecycle.
//
// Window model:
//   mainWin – opaque #000 UI (menus, guide, library). Hidden during playback.
//   mpv     – separate native fullscreen window rendering video (hardware decoded).
//   osdWin  – transparent, always-on-top, focus-holding overlay drawn above mpv
//             that receives every key press during playback.
import { app, BrowserWindow, ipcMain, Menu, screen, powerSaveBlocker, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';
import * as catalog from './catalog.js';
import { authenticate, normalizeServer } from './xtream.js';
import { registerImageScheme, handleImageProtocol, pruneImageCache, clearImageCache } from './imageCache.js';
import { Player } from './player.js';
import { getArtwork, testTmdbKey, clearArtworkCache, tmdb, artCacheGet, artCachePut } from './artwork.js';
import { createTrailers, trailerLoad } from './trailers.js';
import { resolveMpvBinary, resolveTool } from './mpv.js';
import * as audio from './audio.js';
import { userDataDir } from './paths.js';
import * as adult from './adult.js';
import * as discover from './discover.js';
import { PICTURE_DEFAULTS } from './mpvprops.js';

// Settings that change what's playing right now.
const LIVE_KEYS = new Set([
  'audioDevice', 'subMode', 'subLang', 'subSize', 'subBackground',
  ...Object.keys(PICTURE_DEFAULTS),
  'audioDelayMs', 'nightMode', 'passthrough', 'speakers', 'audioLang',
]);

const here = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

// Optional override (portable installs, tests): keep all data in a given folder.
// Keep the pre-ONYX data folder (profiles, settings, favourites) — see electron/paths.js.
app.setPath('userData', userDataDir(app.getPath('appData'), process.env.IPTV_USER_DATA));
if (!app.requestSingleInstanceLock()) app.quit();
registerImageScheme();
// Keep animations smooth on integrated GPUs; never throttle the overlay.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('enable-gpu-rasterization');

let mainWin = null;
let osdWin = null;
let psbId = null;

function loadRenderer(win, hash = '') {
  if (DEV_URL) return win.loadURL(`${DEV_URL}${hash ? `#${hash}` : ''}`);
  return win.loadFile(path.join(here, '..', 'dist', 'index.html'), { hash });
}

const webPreferences = {
  preload: path.join(here, 'preload.cjs'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: false,
  backgroundThrottling: false,
};

function lockDown(win) {
  // No navigation, no popups: this is an appliance UI.
  win.webContents.on('will-navigate', (e, url) => {
    if (!DEV_URL || !url.startsWith(DEV_URL)) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

async function createMainWindow() {
  const settings = await store.getSettings();
  mainWin = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    backgroundColor: '#000000',
    fullscreen: settings.startFullscreen,
    autoHideMenuBar: true,
    title: 'ONYX',
    webPreferences,
  });
  lockDown(mainWin);
  mainWin.once('ready-to-show', () => {
    mainWin.show();
    mainWin.focus();
  });
  mainWin.on('closed', () => {
    mainWin = null;
    app.quit();
  });
  await loadRenderer(mainWin);
}

function createOsdWindow() {
  osdWin = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    webPreferences,
  });
  osdWin.setIgnoreMouseEvents(true);
  lockDown(osdWin);
  osdWin.on('closed', () => (osdWin = null));
  loadRenderer(osdWin, 'osd');
}

// ---------- one-button system updates (set-top box image only) ----------
const UPDATER = '/usr/local/sbin/stb-update';
const hasUpdater = () => process.platform === 'linux' && fs.existsSync(UPDATER);
let updateProc = null;

function checkUpdates() {
  return new Promise((resolve) => {
    if (!hasUpdater()) return resolve({ available: false });
    execFile('sudo', ['-n', UPDATER, 'check'], { timeout: 90000 }, (err, out, errOut) => {
      if (err) return resolve({ available: true, error: String(errOut || err.message).trim().split('\n').pop() });
      try {
        resolve({ available: true, ...JSON.parse(String(out).trim().split('\n').pop()) });
      } catch {
        resolve({ available: true, error: 'Unexpected response from the updater' });
      }
    });
  });
}

function runUpdate() {
  if (!hasUpdater()) throw new Error('Updates are only available on the set-top box image');
  if (updateProc) return { started: false, running: true };
  const p = spawn('sudo', ['-n', UPDATER, 'run'], { stdio: ['ignore', 'pipe', 'pipe'] });
  updateProc = p;
  let buf = '';
  const emit = (ev) => sendMain('system:update:progress', ev);
  const onData = (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      // eslint-disable-next-line no-control-regex -- strip ANSI colour codes
      const line = buf.slice(0, i).replace(/\x1b\[[0-9;]*m/g, '');
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const m = /^@@ (\w+)\s*(.*)$/.exec(line);
      if (!m) emit({ type: 'line', text: line.slice(0, 300) });
      else if (m[1] === 'STEP') emit({ type: 'step', text: m[2] });
      else if (m[1] === 'APP_UPDATED') emit({ type: 'app', text: m[2] });
      else if (m[1] === 'REBOOT_REQUIRED') emit({ type: 'reboot' });
      else if (m[1] === 'ERROR') emit({ type: 'error', text: m[2] });
      else if (m[1] === 'DONE') emit({ type: 'done' });
    }
  };
  p.stdout.on('data', onData);
  p.stderr.on('data', onData);
  p.on('close', (code) => {
    updateProc = null;
    emit({ type: 'exit', code });
  });
  return { started: true };
}

/** Run the root helper with args (and optional stdin), parse its last JSON line. */
function helperJson(args, input = '') {
  return new Promise((resolve, reject) => {
    if (!hasUpdater()) return reject(new Error('Only available on the set-top box image'));
    const p = spawn('sudo', ['-n', UPDATER, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const t = setTimeout(() => p.kill(), 60000);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', () => {
      clearTimeout(t);
      const last = out.trim().split('\n').pop();
      try {
        const j = JSON.parse(last);
        if (j.error) reject(new Error(j.error));
        else resolve(j);
      } catch {
        reject(new Error((err || out || 'No response from helper').trim().split('\n').pop()));
      }
    });
    p.stdin.end(input);
  });
}

function sendMain(channel, data) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, data);
}

const player = new Player({
  resourcesPath: process.resourcesPath,
  showOsd() {
    if (!osdWin) createOsdWindow();
    const display = mainWin ? screen.getDisplayMatching(mainWin.getBounds()) : screen.getPrimaryDisplay();
    osdWin.setBounds(display.bounds);
    osdWin.setAlwaysOnTop(true, 'screen-saver');
    if (!osdWin.isVisible()) osdWin.show();
    osdWin.focus();
    // mpv's window appears asynchronously and may grab focus; take it back.
    for (const ms of [250, 800, 1600]) setTimeout(() => player.active && osdWin?.focus(), ms);
    if (mainWin?.isVisible()) mainWin.hide();
    if (psbId == null) psbId = powerSaveBlocker.start('prevent-display-sleep');
  },
  hideOsd() {
    osdWin?.hide();
    if (mainWin) {
      mainWin.show();
      mainWin.focus();
    }
    if (psbId != null) {
      powerSaveBlocker.stop(psbId);
      psbId = null;
    }
  },
  toOsd(channel, data) {
    if (osdWin && !osdWin.isDestroyed()) osdWin.webContents.send(channel, data);
  },
  onClosed(summary) {
    sendMain('player:closed', summary);
  },
});

// ---------- trailers ----------
const ytdlpPath = async () => resolveTool('yt-dlp', { customPath: (await store.getSettings()).ytdlpPath, resourcesPath: process.resourcesPath });
const trailers = createTrailers({
  findTmdbId: async (item) => item.tmdbId || (await getArtwork(item).catch(() => null))?.tmdbId || null,
  tmdb: async (p, params) => tmdb(p, params, ((await store.getSettings()).tmdbKey || '').trim()),
  cacheGet: artCacheGet,
  cachePut: artCachePut,
  ytdlpPath,
});
const trailersOn = async () => {
  const s = await store.getSettings();
  return !!(s.tmdbKey || '').trim() && s.trailers !== false;
};
const titleItem = (it) => ({ kind: it?.kind, id: it?.id, name: it?.name, year: it?.year, tmdbId: it?.tmdbId });

// ---------- IPC ----------
const handlers = {
  'app:info': async () => {
    const s = await store.getSettings();
    return {
      version: app.getVersion(),
      platform: process.platform,
      mpvPath: resolveMpvBinary({ customPath: s.mpvPath, resourcesPath: process.resourcesPath }),
      ytdlpPath: resolveTool('yt-dlp', { customPath: s.ytdlpPath, resourcesPath: process.resourcesPath }),
      build: (() => {
        try {
          return fs.readFileSync(path.join(path.dirname(process.execPath), 'stb-version.txt'), 'utf8').trim();
        } catch {
          return null;
        }
      })(),
      updater: hasUpdater(),
      dataDir: store.dataDir(),
    };
  },
  'app:quit': () => app.quit(),
  'system:poweroff': async () => {
    if (!hasUpdater()) return app.quit();
    player.dispose();
    store.flushDocs();
    // Newer helpers have "poweroff"; otherwise logind lets the logged-in TV user shut down.
    const viaHelper = await new Promise((res) =>
      execFile('sudo', ['-n', UPDATER, 'poweroff'], { timeout: 10000 }, (err) => res(!err))
    );
    if (viaHelper) return;
    await new Promise((res, rej) =>
      execFile('systemctl', ['poweroff'], { timeout: 10000 }, (err, _o, stderr) => (err ? rej(new Error(String(stderr || err.message).trim())) : res()))
    );
  },
  'app:restart': () => {
    // On the set-top box an autostart loop relaunches the app; elsewhere relaunch ourselves.
    if (!hasUpdater()) app.relaunch();
    setTimeout(() => app.quit(), 200);
  },
  'system:update:check': () => checkUpdates(),
  'net:status': () => helperJson(['wifi', 'status']),
  'net:scan': () => helperJson(['wifi', 'scan']),
  'net:connect': ({ ssid, password }) => helperJson(['wifi', 'connect', String(ssid)], `${password || ''}\n`),
  'net:forget': ({ ssid }) => helperJson(['wifi', 'forget', String(ssid)]),
  'system:update:run': () => runUpdate(),
  'system:reboot': () => {
    if (!hasUpdater()) throw new Error('Not available on this system');
    store.flushDocs();
    spawn('sudo', ['-n', UPDATER, 'reboot'], { detached: true, stdio: 'ignore' }).unref();
  },
  'app:toggleFullscreen': () => mainWin?.setFullScreen(!mainWin.isFullScreen()),

  'profiles:list': () => store.listProfiles(),
  'profiles:save': async (p) => {
    const server = normalizeServer(p.server);
    let password = p.password;
    if (!password && p.id) password = (await store.getCredentials(p.id)).password;
    const auth = await authenticate({ server, username: p.username, password });
    const saved = await store.saveProfile({ ...p, server });
    return { profile: saved, auth };
  },
  'profiles:delete': (id) => store.deleteProfile(id),
  'profiles:activate': async (id) => {
    await store.setActiveProfile(id);
    return authenticate(await store.getCredentials(id)).catch((e) => ({ error: e.message }));
  },

  'settings:get': async () => adult.publicSettings(await store.getSettings()),
  'settings:update': async (patch) => {
    patch = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => !adult.PROTECTED_KEYS.includes(k)));
    if ('audioDevice' in patch) await audio.applyOutput(patch.audioDevice);
    const s = await store.updateSettings(patch);
    if (Object.keys(patch).some((k) => LIVE_KEYS.has(k))) await player.applySettings(s);
    return adult.publicSettings(s);
  },
  'adult:show': async (arg) => adult.publicSettings(await store.updateSettings(adult.showAdultPatch(await store.getSettings(), arg || {}))),
  'adult:pin': async (arg) => adult.publicSettings(await store.updateSettings(adult.pinPatch(await store.getSettings(), arg || {}))),
  'volume:change': async ({ action }) => {
    let r = await audio.systemVolume(action).catch(() => null);
    if (!r && player.mpv) r = await player.volume(action); // Windows/macOS: mpv's own volume
    if (r) {
      sendMain('volume:changed', r);
      if (osdWin && !osdWin.isDestroyed()) osdWin.webContents.send('volume:changed', r);
    }
    return r;
  },
  'audio:outputs': async () => {
    const s = await store.getSettings();
    const mpvBinary = resolveMpvBinary({ customPath: s.mpvPath, resourcesPath: process.resourcesPath });
    const r = await audio.listOutputs({ mpvBinary });
    return { ...r, current: s.audioDevice || 'auto' };
  },

  'catalog:load': ({ profileId, force }) => catalog.loadCatalog(profileId, { force }, sendMain),
  'epg:load': ({ profileId, force }) => catalog.loadEpg(profileId, { force }, sendMain),
  'epg:nowNext': ({ profileId, ids, at }) => catalog.epgNowNext(profileId, ids, at),
  'epg:range': ({ profileId, epgId, from, limit }) => catalog.epgRange(profileId, epgId, from, limit),
  'epg:grid': ({ profileId, ids, from, to }) => catalog.epgGrid(profileId, ids, from, to),
  'epg:short': ({ profileId, streamId }) => catalog.shortEpg(profileId, streamId),
  'vod:info': ({ profileId, item }) => catalog.vodInfo(profileId, item),
  'series:info': ({ profileId, item }) => catalog.seriesInfo(profileId, item),
  'cache:clear': async ({ profileId }) => {
    await catalog.clearCaches(profileId);
    await clearImageCache();
    await clearArtworkCache();
  },

  'art:get': (q) => getArtwork(q),
  'art:testKey': (key) => testTmdbKey(key),
  'discover:lists': ({ kind, names }) => discover.getLists(kind, names),
  'trailer:get': async ({ item }) => ((await trailersOn()) ? trailers.get(titleItem(item)) : { available: false }),
  'trailer:play': async ({ profileId, item, title }) => {
    const t = await trailers.prepare(titleItem(item));
    if (!t) throw new Error('No trailer found');
    const trailer = { kind: 'trailer', id: `yt:${t.key}`, name: title || item.name, load: trailerLoad(t), from: { kind: item.kind, id: item.id } };
    await player.play({ profileId, items: [trailer], index: 0, resume: false });
  },
  'discover:recs': ({ item }) => discover.getRecommendations(item),
  'art:refreshLogos': async ({ profileId }) => {
    if ((await store.getSettings()).logoSource === 'off') throw new Error('Channel logos are set to "Provider logos only"');
    return catalog.refreshLogos(profileId, sendMain, { force: true });
  },
  'doc:get': ({ profileId, name }) => store.getDoc(profileId, name),
  'doc:set': ({ profileId, name, data }) => store.setDoc(profileId, name, data),

  'player:play': (args) => player.play(args),
  'player:command': (cmd) => player.command(cmd),
  'player:playlist': () => player.session?.items ?? [],
};

for (const [channel, fn] of Object.entries(handlers)) {
  ipcMain.handle(channel, async (_e, arg) => {
    try {
      return { ok: true, data: await fn(arg) };
    } catch (err) {
      console.error(`[ipc] ${channel}:`, err);
      return { ok: false, error: String(err?.message || err) };
    }
  });
}

// ---------- lifecycle ----------
app.on('second-instance', () => {
  if (mainWin) {
    if (!player.active) mainWin.show();
    mainWin.focus();
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  handleImageProtocol();
  await createMainWindow();
  createOsdWindow(); // pre-warm so the first playback overlay appears instantly
  setTimeout(() => pruneImageCache().catch(() => {}), 15000);
  // Re-apply a chosen sound output after login (the box's boot script picks HDMI).
  const applySavedAudio = async () => {
    const s = await store.getSettings();
    if (String(s.audioDevice || '').startsWith('pa:')) await audio.applyOutput(s.audioDevice).catch(() => {});
  };
  setTimeout(applySavedAudio, 4000);
  setTimeout(applySavedAudio, 25000);
});

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => app.quit());

app.on('before-quit', () => {
  player.dispose();
  store.flushDocs();
  catalog.shutdownWorker();
});

app.on('window-all-closed', () => app.quit());
