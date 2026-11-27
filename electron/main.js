// Electron main process: windows, IPC surface, lifecycle.
//
// Window model:
//   mainWin – opaque #000 UI (menus, guide, library). Hidden during playback.
//   mpv     – separate native fullscreen window rendering video (hardware decoded).
//   osdWin  – transparent, always-on-top, focus-holding overlay drawn above mpv
//             that receives every key press during playback.
import { app, BrowserWindow, ipcMain, Menu, screen, powerSaveBlocker, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';
import * as catalog from './catalog.js';
import { authenticate, normalizeServer } from './xtream.js';
import { registerImageScheme, handleImageProtocol, pruneImageCache, clearImageCache } from './imageCache.js';
import { Player } from './player.js';
import { getArtwork, testTmdbKey, clearArtworkCache } from './artwork.js';
import { resolveMpvBinary } from './mpv.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

// Optional override (portable installs, tests): keep all data in a given folder.
if (process.env.IPTV_USER_DATA) app.setPath('userData', process.env.IPTV_USER_DATA);
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
    title: 'OLED IPTV',
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

// ---------- IPC ----------
const handlers = {
  'app:info': async () => {
    const s = await store.getSettings();
    return {
      version: app.getVersion(),
      platform: process.platform,
      mpvPath: resolveMpvBinary({ customPath: s.mpvPath, resourcesPath: process.resourcesPath }),
      dataDir: store.dataDir(),
    };
  },
  'app:quit': () => app.quit(),
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

  'settings:get': () => store.getSettings(),
  'settings:update': (patch) => store.updateSettings(patch),

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
  'art:refreshLogos': ({ profileId }) => catalog.refreshLogos(profileId, sendMain, { force: true }),
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
});

app.on('before-quit', () => {
  player.dispose();
  store.flushDocs();
  catalog.shutdownWorker();
});

app.on('window-all-closed', () => app.quit());
