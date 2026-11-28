// Sign-in window: the box has no web browser, but apps such as GeForce NOW sign in
// by opening the default browser. /usr/local/bin/onyx-open-url (the box's "browser",
// see stb-files) drops the address into a folder that ONYX watches; ONYX shows it in
// a full-screen, sandboxed window above everything. When the page hands back to the
// app (a localhost address) the window closes itself. Esc closes it any time.
import fs from 'node:fs';
import path from 'node:path';

/** The address from a dropped file, if it's a plain http(s) URL; otherwise null. */
export function parseDropped(text) {
  const s = String(text || '')
    .trim()
    .split('\n')[0];
  if (s.length > 8192) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/** True for the app's own "you can close this page" callback on this box. */
export function isLoopback(url) {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
  } catch {
    return false;
  }
}

/** "…Chrome/140… Electron/45… oled-iptv-player/1.2.1" → plain Chrome UA (some sign-in pages refuse Electron). */
export const plainUserAgent = (ua) => String(ua).replace(/\s(Electron|oled-iptv-player|ONYX)\/\S+/g, '');

export function signinDir(env = process.env, uid = process.getuid?.() ?? 0) {
  return path.join(env.XDG_RUNTIME_DIR || `/tmp/onyx-${uid}`, 'onyx-open-url');
}

/**
 * Watch the drop folder and open each address. deps: { dir, open(url) }.
 * Returns stop(). Files are read once and deleted.
 */
export function watchSignin({ dir, open, fsImpl = fs }) {
  fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const take = () => {
    let names;
    try {
      names = fsImpl.readdirSync(dir).filter((n) => n.startsWith('url.'));
    } catch {
      return;
    }
    for (const n of names.sort()) {
      const f = path.join(dir, n);
      let text;
      try {
        text = fsImpl.readFileSync(f, 'utf8');
        fsImpl.unlinkSync(f);
      } catch {
        continue;
      }
      const url = parseDropped(text);
      if (url) open(url);
    }
  };
  take(); // anything dropped before ONYX started
  let w = null;
  try {
    w = fsImpl.watch(dir, () => take());
  } catch {
    /* fall back to polling below */
  }
  const t = setInterval(take, 2000);
  return () => {
    w?.close();
    clearInterval(t);
  };
}

/** Full-screen sign-in window (Electron). */
export function createSigninWindow(BrowserWindow, url, { onClosed } = {}) {
  const win = new BrowserWindow({
    fullscreen: true,
    alwaysOnTop: true,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: 'Sign in',
    webPreferences: { partition: 'signin', sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  const wc = win.webContents;
  wc.setUserAgent(plainUserAgent(wc.getUserAgent()));
  // Pop-ups open in the same window; only web pages, no file:// or app schemes.
  wc.setWindowOpenHandler(({ url: next }) => {
    if (parseDropped(next)) wc.loadURL(next);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, next) => {
    if (!parseDropped(next)) e.preventDefault();
  });
  let closing = null;
  const maybeDone = () => {
    if (isLoopback(wc.getURL()) && !closing) closing = setTimeout(() => !win.isDestroyed() && win.close(), 2500);
  };
  wc.on('did-navigate', maybeDone);
  wc.on('did-finish-load', maybeDone);
  wc.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      e.preventDefault();
      win.close();
    }
  });
  win.on('closed', () => {
    clearTimeout(closing);
    onClosed?.();
  });
  win.loadURL(url);
  win.once('ready-to-show', () => win.focus());
  win.show();
  win.focus();
  return win;
}
