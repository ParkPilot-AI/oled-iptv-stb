import { classifyChannel } from '../../electron/artmatch.js';
// Demo backend for browser-only development and automated UI tests.
// Generates a large catalog (10k channels) to exercise virtualisation.

const WORDS =
  'Alpha Bravo Nova Prime Star Sky Ocean Metro City World Sport News Kids Cinema Gold Max Plus One Two Arena Planet Wild Royal Urban Retro Pulse Echo Vision Fusion'.split(
    ' '
  );
const rnd = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

// Generated abstract artwork (original, data: URLs) so the demo looks like a real library.
const PALETTES = [
  ['#1e3a8a', '#0ea5e9'],
  ['#7c2d12', '#f59e0b'],
  ['#064e3b', '#10b981'],
  ['#4c1d95', '#ec4899'],
  ['#111827', '#6366f1'],
  ['#3f1d0b', '#ef4444'],
  ['#0f172a', '#14b8a6'],
  ['#312e81', '#a78bfa'],
];
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function art(seed, w, h, title) {
  const [a, b] = PALETTES[seed % PALETTES.length];
  const cx = 20 + ((seed * 37) % 60);
  const cy = 15 + ((seed * 53) % 50);
  const words = title ? esc(title.replace(/\s*\(\d{4}\)$/, '')).split(' ') : [];
  const text = title
    ? `<text x="${w * 0.08}" y="${h * 0.82}" font-family="Georgia,serif" font-weight="700" font-size="${w * 0.11}" fill="#fff" opacity=".92">${words.slice(0, 2).join(' ')}</text>` +
      (words.length > 2
        ? `<text x="${w * 0.08}" y="${h * 0.82 + w * 0.13}" font-family="Georgia,serif" font-weight="700" font-size="${w * 0.11}" fill="#fff" opacity=".92">${words.slice(2).join(' ')}</text>`
        : '')
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="#000"/></linearGradient><radialGradient id="r" cx="${cx}%" cy="${cy}%" r="55%"><stop offset="0" stop-color="${b}" stop-opacity=".9"/><stop offset="1" stop-color="${b}" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#r)"/><circle cx="${(cx / 100) * w}" cy="${(cy / 100) * h}" r="${Math.min(w, h) * 0.12}" fill="#fff" opacity=".12"/>${text}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
const posterArt = (seed, title) => art(seed, 300, 450, title);
// Stand-ins for TMDB title logos and iptv-org channel logos (demo only).
function titleLogo(title) {
  const t = esc(
    String(title)
      .replace(/\s*\(\d{4}\)$/, '')
      .toUpperCase()
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="260" viewBox="0 0 900 260"><text x="0" y="170" font-family="Georgia,serif" font-weight="700" font-size="120" letter-spacing="6" fill="#f5f5f5"${t.length > 11 ? ' textLength="890" lengthAdjust="spacingAndGlyphs"' : ''}>${t}</text><rect x="4" y="205" width="300" height="10" fill="#f59e0b"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
const LOGO_COLORS = ['#e11d48', '#2563eb', '#059669', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#4f46e5'];
function channelLogo(i, name) {
  const words = String(name).split(' ');
  const mark = esc(
    words
      .map((w) => w[0])
      .join('')
      .slice(0, 3)
  );
  const c = LOGO_COLORS[i % LOGO_COLORS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect x="20" y="30" width="120" height="120" rx="26" fill="${c}"/><text x="80" y="110" text-anchor="middle" font-family="Arial,sans-serif" font-weight="800" font-size="52" fill="#fff">${mark}</text><text x="156" y="84" font-family="Arial,sans-serif" font-weight="800" font-size="38" fill="#f5f5f5">${esc(words[0] || '')}</text><text x="156" y="126" font-family="Arial,sans-serif" font-weight="600" font-size="30" fill="#a3a3a3">${esc(words.slice(1).join(' '))}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
const backdropArt = (seed) => art(seed + 3, 1600, 900, '');

function makeCatalog() {
  const r = rnd(42);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const liveCats = [
    'UK | Entertainment',
    'UK | Sports',
    'UK | News',
    'US | Entertainment',
    'US | Sports',
    'DE | Allgemein',
    'FR | Général',
    'Kids',
    'Documentary',
    'Music',
    '4K UHD',
    'PPV Events',
    'Adult 18+',
  ]
    .concat(Array.from({ length: 28 }, (_, i) => `Region ${i + 1}`))
    .map((name, i) => ({ id: String(i + 1), name }));
  const live = Array.from({ length: 10000 }, (_, i) => ({
    kind: 'live',
    id: 1000 + i,
    num: i + 1,
    name: `${pick(WORDS)} ${pick(WORDS)} ${i % 7 === 0 ? 'HD' : i % 11 === 0 ? '4K' : ''}`.trim(),
    cat: String((i % liveCats.length) + 1),
    icon: '',
    epg: `ch${i}`,
    archive: false,
  }));
  live.forEach((c) => (c.genre = classifyChannel({ name: c.name, catName: liveCats[Number(c.cat) - 1].name, home: 'GB' })));
  const vodCats = ['Action', 'Comedy', 'Drama', 'Sci-Fi', 'Horror', 'Family', 'Documentary', '4K Movies'].map((name, i) => ({ id: String(100 + i), name }));
  const vod = Array.from({ length: 3000 }, (_, i) => ({
    kind: 'movie',
    id: 50000 + i,
    name: `The ${pick(WORDS)} ${pick(['Protocol', 'Horizon', 'Legacy', 'Code', 'Run', 'Escape', 'Rising'])} (${1990 + (i % 35)})`,
    cat: String(100 + (i % vodCats.length)),
    icon: '',
    rating: Math.round(r() * 50) / 10,
    added: 1700000000 + i * 3600,
    ext: 'mkv',
  }));
  const seriesCats = ['Drama Series', 'Crime', 'Comedy Series', 'Anime', 'Reality'].map((name, i) => ({ id: String(200 + i), name }));
  const series = Array.from({ length: 600 }, (_, i) => ({
    kind: 'series',
    id: 80000 + i,
    name: `${pick(WORDS)} ${pick(['Chronicles', 'Files', 'Street', 'Station', 'Kingdom'])}`,
    cat: String(200 + (i % seriesCats.length)),
    icon: '',
    rating: Math.round(r() * 50) / 10,
    added: 1700000000 + i * 7200,
    year: String(2000 + (i % 26)),
  }));
  vod.forEach((m, i) => (m.icon = posterArt(i, m.name)));
  live.forEach((c, i) => i < 2000 && (c.icon = channelLogo(i, c.name)));
  series.forEach((m, i) => (m.icon = posterArt(i + 11, m.name)));
  return {
    live: { categories: liveCats, items: live },
    vod: { categories: vodCats, items: vod },
    series: { categories: seriesCats, items: series },
    fetchedAt: Date.now(),
  };
}

const SHOWS = [
  'News at Ten',
  'Premier Football Live',
  'The Great Bake',
  'Planet Wild',
  'Late Show',
  'Weather',
  'Motor Racing',
  'Antiques Hunt',
  'Crime Files',
  'Quiz Night',
  'Documentary: Oceans',
  'Cooking Live',
  'Film: The Long Road',
  'Kids Club',
  'Music Hour',
];
const DURS = [30, 30, 30, 60, 60, 60, 90, 120];
/** Deterministic per-channel schedule with varied programme lengths. */
function schedule(id, from, to) {
  const seed = [...String(id)].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
  const r = rnd(seed);
  const day = 864e5;
  let t = Math.floor(from / day) * day - 6 * 3600e3;
  const out = [];
  while (t < to) {
    const d = DURS[Math.floor(r() * DURS.length)] * 60e3;
    const title = SHOWS[Math.floor(r() * SHOWS.length)];
    if (t + d > from)
      out.push({
        start: t,
        stop: t + d,
        title,
        desc: `${title}: a demo programme description from the mock guide, long enough to check wrapping and readability on a large TV.`,
      });
    t += d;
  }
  return out;
}
const epgFor = (id, from = Date.now(), count = 8) => schedule(id, from, from + 48 * 3600e3).slice(0, count);

const ls = {
  get(k, d) {
    try {
      return JSON.parse(localStorage.getItem(`mock:${k}`)) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`mock:${k}`, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  },
};

export function createMockApi() {
  const listeners = new Map();
  const emit = (ch, data) => listeners.get(ch)?.forEach((cb) => cb(data));
  let catalog = null;
  let vol = { volume: 60, muted: false };
  let settings = {
    overscan: 0,
    tmdbKey: '',
    logoSource: 'missing',
    liveFormat: 'ts',
    hwdec: 'auto-safe',
    deinterlace: false,
    mpvPath: '',
    catalogTtlHours: 12,
    epgTtlHours: 6,
    osdTimeoutSec: 4,
    screensaverMin: 3,
    startFullscreen: true,
    theme: 'amber',
    trailers: true,
    audioDevice: 'auto',
    subMode: 'off',
    brightness: 0,
    contrast: 0,
    saturation: 0,
    gamma: 0,
    aspect: 'auto',
    upscaling: 'standard',
    deband: false,
    toneMapping: 'auto',
    audioLang: 'auto',
    audioDelayMs: 0,
    nightMode: 'off',
    passthrough: false,
    speakers: 'auto',
    artSource: 'prefer',
    subLang: 'en',
    subSize: 'medium',
    subBackground: 'box',
    ...ls.get('settings', {}),
  };
  const profiles = ls.get('profiles', { activeId: null, list: [] });
  const viewersDb = ls.get('viewers', { activeId: 'main', askOnStart: true, list: [{ id: 'main', name: 'Me', colour: '#E50914', kids: false, pin: '' }] });
  const saveViewersDb = () => ls.set('viewers', viewersDb);
  const docKey = (profileId, name) => (viewersDb.activeId === 'main' ? `${profileId}:${name}` : `${profileId}:${viewersDb.activeId}:${name}`);
  const pubViewer = (v) => ({ id: v.id, name: v.name, colour: v.colour, kids: !!v.kids, locked: !!v.pin, theme: v.theme || null });
  const viewersPublic = () => ({ activeId: viewersDb.activeId, askOnStart: viewersDb.askOnStart, list: viewersDb.list.map(pubViewer) });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const bt = {
    adapter: localStorage.getItem('mock:bt') !== 'none',
    found: [],
    devices: [{ mac: '98:7A:14:00:00:01', name: 'Xbox Wireless Controller', paired: true, connected: true, trusted: true, battery: 80, gamepad: true }],
  };
  const btStatus = () =>
    bt.adapter
      ? { adapter: true, powered: true, blocked: false, discovering: false, devices: bt.devices }
      : { adapter: false, powered: false, blocked: false, discovering: false, devices: [] };
  if (typeof window !== 'undefined') {
    window.mockBluetooth = (mode) => {
      bt.adapter = mode !== 'none';
      localStorage.setItem('mock:bt', bt.adapter ? 'on' : 'none');
      return btStatus();
    };
  }
  const wifi = {
    status: { state: 'disconnected', ssid: '', ip: '', signal: null },
    networks: [
      { ssid: 'Zyxel_D41A', security: 'WPA2', signal: 74 },
      { ssid: 'PLUSNET-S9C923', security: 'WPA1 WPA2', signal: 52 },
      { ssid: 'Cafe Free WiFi', security: 'open', signal: 31 },
    ],
  };

  const handlers = {
    'app:info': () => ({
      version: '1.0.0-web',
      platform: 'web',
      mpvPath: null,
      ytdlpPath: '/usr/bin/yt-dlp',
      dataDir: '(browser)',
      build: '2026.11.27-a0acc2f',
      updater: true,
    }),
    'app:quit': () => emit('mock:quit'),
    'system:poweroff': () => emit('mock:quit'),
    'volume:change': ({ action }) => {
      vol = action === 'mute' ? { ...vol, muted: !vol.muted } : { volume: Math.max(0, Math.min(100, vol.volume + (action === 'up' ? 5 : -5))), muted: false };
      emit('volume:changed', vol);
      return vol;
    },
    'app:toggleFullscreen': () => document.documentElement.requestFullscreen?.(),
    'profiles:list': () => ({ ...profiles, secureStorage: false }),
    'profiles:save': async (p) => {
      await wait(300);
      if (!p.server || !p.username) throw new Error('Login failed: wrong username or password');
      let prof = profiles.list.find((x) => x.id === p.id);
      if (!prof) profiles.list.push((prof = { id: `demo-${Date.now()}`, createdAt: Date.now() }));
      Object.assign(prof, { name: p.name || p.username, server: p.server, username: p.username });
      ls.set('profiles', profiles);
      return { profile: prof, auth: { user: { status: 'Active', expires: Date.now() + 90 * 864e5, maxConnections: 2 } } };
    },
    'profiles:delete': (id) => {
      profiles.list = profiles.list.filter((p) => p.id !== id);
      if (profiles.activeId === id) profiles.activeId = null;
      ls.set('profiles', profiles);
    },
    'profiles:activate': (id) => {
      profiles.activeId = id;
      ls.set('profiles', profiles);
      return { user: { status: 'Active', expires: Date.now() + 90 * 864e5, maxConnections: 2 } };
    },
    'settings:get': () => ({ ...settings, adultPinSet: !!settings.adultPin }),
    'adult:show': ({ show, pin }) => {
      if (show && settings.adultPin && pin !== settings.adultPin) throw new Error('Wrong PIN');
      settings = { ...settings, showAdult: !!show };
      ls.set('settings', settings);
      return { ...settings, adultPinSet: !!settings.adultPin };
    },
    'adult:pin': ({ pin, current }) => {
      if (settings.adultPin && current !== settings.adultPin) throw new Error('Wrong PIN');
      if (pin && !/^\d{4}$/.test(pin)) throw new Error('The PIN must be 4 digits');
      settings = { ...settings, adultPin: pin || '' };
      ls.set('settings', settings);
      return { ...settings, adultPinSet: !!settings.adultPin };
    },
    'audio:outputs': async () => {
      await wait(300);
      return {
        backend: 'pactl',
        current: settings.audioDevice || 'auto',
        outputs: [
          { id: 'auto', label: 'Automatic (TV via HDMI)' },
          { id: 'pa:alsa_card.pci-0000_00_1f.3|output:hdmi-stereo', label: 'TV (HDMI)' },
          { id: 'pa:alsa_card.pci-0000_00_1f.3|output:hdmi-stereo-extra1', label: 'TV (HDMI 2)' },
          { id: 'pa:alsa_card.pci-0000_00_1f.3|output:analog-stereo', label: 'Headphone jack / speakers' },
        ],
      };
    },
    'settings:update': (patch) => {
      const { showAdult: _a, adultPin: _p, ...safe } = patch || {};
      settings = { ...settings, ...safe };
      ls.set('settings', settings);
      return { ...settings, adultPinSet: !!settings.adultPin };
    },
    'catalog:load': async () => {
      emit('catalog:progress', { stage: 'categories' });
      await wait(200);
      emit('catalog:progress', { stage: 'streams' });
      await wait(200);
      catalog ||= makeCatalog();
      return catalog;
    },
    'epg:load': async () => ({ channels: 10000, fetchedAt: Date.now() }),
    'epg:nowNext': ({ ids, at = Date.now() }) => {
      const out = {};
      for (const id of ids) {
        const list = epgFor(id, at, 3);
        const now = list.find((p) => p.start <= at && p.stop > at) || null;
        out[id] = { now, next: list.find((p) => p.start >= (now?.stop ?? at)) || null };
      }
      return out;
    },
    'epg:range': ({ epgId, from, limit }) => epgFor(epgId, from, limit),
    'epg:grid': ({ ids, from, to }) => Object.fromEntries(ids.map((id) => [id, Number(id.replace(/\D/g, '')) % 9 === 8 ? [] : schedule(id, from, to)])),
    'epg:short': () => [],
    'vod:info': async ({ item }) => {
      await wait(150);
      return {
        ...item,
        plot: 'A gripping demo synopsis that runs for a couple of lines to check wrapping and readability from ten feet away on a large OLED panel.',
        cast: 'Ada Lovelace, Alan Turing, Grace Hopper',
        director: 'Demo Director',
        genre: 'Drama, Thriller',
        year: '2024',
        duration: 6420,
        backdrop: '',
      };
    },
    'series:info': async ({ item }) => {
      await wait(150);
      return {
        ...item,
        backdrop: item.icon ? backdropArt(item.id) : '',
        plot: 'A demo series synopsis: an ensemble drama following a city over one long, strange year, with the tone shifting from comedy to thriller.',
        cast: 'Demo Cast',
        genre: 'Drama',
        seasons: [1, 2, 3].map((s) => ({
          season: s,
          name: `Season ${s}`,
          episodes: Array.from({ length: 10 }, (_, e) => ({
            kind: 'episode',
            id: item.id * 100 + s * 20 + e,
            season: s,
            episode: e + 1,
            name: `Episode ${e + 1}`,
            ext: 'mkv',
            duration: 2700,
            plot: 'Episode synopsis.',
          })),
        })),
      };
    },
    'cache:clear': () => (catalog = null),
    'app:restart': () => setTimeout(() => location.reload(), 300),
    'net:status': async () => ({ device: 'wlan0', driver: 'rtl8xxxu', ...wifi.status }),
    'net:scan': async () => {
      await wait(1500);
      return { device: 'wlan0', driver: 'rtl8xxxu', ...wifi.status, networks: wifi.networks.map((n) => ({ ...n, connected: n.ssid === wifi.status.ssid })) };
    },
    'net:connect': async ({ ssid, password }) => {
      await wait(1800);
      const n = wifi.networks.find((x) => x.ssid === ssid);
      if (n?.security !== 'open' && password !== 'password123') throw new Error('Operation failed');
      wifi.status = { state: 'connected', ssid, ip: '192.168.1.42', signal: n?.signal ?? 60 };
      return { device: 'wlan0', ...wifi.status };
    },
    'net:forget': async () => {
      wifi.status = { state: 'disconnected', ssid: '', ip: '', signal: null };
      return { device: 'wlan0', ...wifi.status };
    },
    'system:update:check': async () => {
      await wait(700);
      return {
        available: true,
        system: 42,
        appInstalled: '2026.11.27-a0acc2f',
        appLatest: '2026.11.27-c4e91b2',
        repo: 'ParkPilot-AI/oled-iptv-stb',
        hasToken: true,
      };
    },
    'system:update:run': () => {
      const steps = [
        [300, { type: 'step', text: 'Refreshing package signing keys' }],
        [900, { type: 'line', text: ':: Synchronizing package databases...' }],
        [1300, { type: 'line', text: ' core downloading...' }],
        [1700, { type: 'step', text: 'Updating system packages' }],
        [2200, { type: 'line', text: ':: Starting full system upgrade...' }],
        [2700, { type: 'line', text: '(1/42) upgrading linux                        [####################] 100%' }],
        [3300, { type: 'line', text: '(17/42) upgrading mesa                        [####################] 100%' }],
        [3900, { type: 'line', text: '(42/42) upgrading mpv                         [####################] 100%' }],
        [4400, { type: 'step', text: 'Downloading app 2026.11.27-c4e91b2' }],
        [5200, { type: 'step', text: 'Installing app 2026.11.27-c4e91b2' }],
        [5600, { type: 'app', text: '2026.11.27-c4e91b2' }],
        [5700, { type: 'reboot' }],
        [5800, { type: 'done' }],
        [5900, { type: 'exit', code: 0 }],
      ];
      for (const [ms, ev] of steps) setTimeout(() => emit('system:update:progress', ev), ms);
      return { started: true };
    },
    'system:reboot': () => setTimeout(() => location.reload(), 500),
    // Household profiles (dev console: localStorage 'mock:viewers').
    'viewers:list': () => viewersPublic(),
    'viewers:activate': ({ id, pin }) => {
      const v = viewersDb.list.find((x) => x.id === id);
      if (v.pin && v.pin !== pin) throw new Error('Wrong PIN');
      viewersDb.activeId = id;
      if (v.theme) settings.theme = v.theme;
      saveViewersDb();
      return { viewer: pubViewer(v), settings: { ...settings } };
    },
    'viewers:save': ({ id, name, kids }) => {
      let v = viewersDb.list.find((x) => x.id === id);
      if (!v)
        viewersDb.list.push(
          (v = { id: Math.random().toString(16).slice(2, 10), colour: ['#0A5CFF', '#76B900', '#9146FF', '#FF5A00'][viewersDb.list.length % 4] })
        );
      Object.assign(v, { name: String(name || '').trim() || 'Profile', kids: !!kids });
      saveViewersDb();
      return pubViewer(v);
    },
    'viewers:pin': ({ id, pin }) => {
      viewersDb.list.find((x) => x.id === id).pin = pin || '';
      saveViewersDb();
      return viewersPublic();
    },
    'viewers:remove': ({ id }) => {
      viewersDb.list = viewersDb.list.filter((x) => x.id !== id);
      if (viewersDb.activeId === id) viewersDb.activeId = 'main';
      saveViewersDb();
      return viewersPublic();
    },
    'viewers:askOnStart': ({ on }) => {
      viewersDb.askOnStart = !!on;
      saveViewersDb();
      return viewersPublic();
    },
    // Phone sign-in (dev console: mockPhoneLogin({ server, username, password })).
    'phonelogin:start': () => {
      window.mockPhoneLogin = (f) => emit('phonelogin:submit', { name: '', ...f });
      return { url: 'http://192.168.1.23:41837/3f9a1c7e5b2d4a60aa11bb22' };
    },
    'phonelogin:stop': () => null,
    // Games (dev console: localStorage 'mock:gfn'='1' → installed).
    'games:status': () => ({
      platform: 'linux',
      installed: localStorage.getItem('mock:gfn') === '1',
      version: localStorage.getItem('mock:gfn') === '1' ? '2.0.80' : null,
      flatpak: true,
      running: false,
    }),
    'games:install': () => {
      const steps = [
        [300, { type: 'step', text: "Adding NVIDIA's GeForce NOW repository" }],
        [1200, { type: 'step', text: 'Downloading and installing GeForce NOW (this can take a few minutes)' }],
        [1600, { type: 'line', text: 'Installing 1/2… org.freedesktop.Platform' }],
        [2600, { type: 'line', text: 'Installing 2/2… com.nvidia.geforcenow' }],
        [3400, { type: 'step', text: 'Installed GeForce NOW 2.0.80' }],
        [3500, { type: 'done' }],
        [3600, { type: 'exit', code: 0 }],
      ];
      setTimeout(() => localStorage.setItem('mock:gfn', '1'), 3300);
      for (const [ms, ev] of steps) setTimeout(() => emit('system:update:progress', ev), ms);
      return { started: true };
    },
    'games:launch': () => {
      if (localStorage.getItem('mock:gfn') !== '1') throw new Error('Install GeForce NOW first');
      emit('games:state', { running: true });
      setTimeout(() => emit('games:state', { running: false, code: 0 }), 4000);
      return { running: true };
    },
    // Bluetooth (dev console: mockBluetooth('none') for "no adapter", mockBluetooth('on') to plug one in).
    'bt:status': () => btStatus(),
    'bt:scan': async ({ seconds = 12 } = {}) => {
      if (!bt.adapter) throw new Error('No Bluetooth adapter found');
      await wait(Math.min(seconds, 4) * 1000);
      bt.found = [
        { mac: '98:7A:14:00:00:02', name: 'Xbox Wireless Controller', paired: false, connected: false, trusted: false, battery: null, gamepad: true },
        { mac: 'E4:17:D8:00:00:03', name: '8BitDo Pro 2', paired: false, connected: false, trusted: false, battery: null, gamepad: true },
        { mac: '11:22:33:44:55:66', name: 'Galaxy Buds2', paired: false, connected: false, trusted: false, battery: null, gamepad: false },
      ];
      return { adapter: true, devices: [...bt.found, ...bt.devices] };
    },
    'bt:pair': async ({ mac }) => {
      await wait(2500);
      const d = bt.found.find((x) => x.mac === mac);
      if (!d || d.name.startsWith('8BitDo')) throw new Error('Controller not in pairing mode — hold the pair button until the Xbox button flashes quickly');
      bt.devices.push({ ...d, paired: true, trusted: true, connected: true, battery: 100 });
      return { ok: true, device: d };
    },
    'bt:connect': async ({ mac }) => {
      await wait(800);
      bt.devices = bt.devices.map((d) => (d.mac === mac ? { ...d, connected: true } : d));
      return { ok: true };
    },
    'bt:disconnect': async ({ mac }) => {
      await wait(500);
      bt.devices = bt.devices.map((d) => (d.mac === mac ? { ...d, connected: false } : d));
      return { ok: true };
    },
    'bt:forget': async ({ mac }) => {
      bt.devices = bt.devices.filter((d) => d.mac !== mac);
      return { ok: true };
    },
    'bt:openSystemSettings': () => null,
    // Provisioning (dev console: localStorage.setItem('mock:provision', 'needed'), reload).
    'system:provision:status': () => ({
      available: true,
      needed: localStorage.getItem('mock:provision') === 'needed',
      missing: ['bluez-utils', 'flatpak', 'bluetooth.service'],
    }),
    'system:provision:run': () => {
      const steps = [
        [300, { type: 'step', text: 'Checking Bluetooth and Games support' }],
        [900, { type: 'step', text: 'Installing 4 new package(s): bluez bluez-utils flatpak xdg-desktop-portal-gtk' }],
        [1500, { type: 'line', text: '(1/4) installing bluez                       [####################] 100%' }],
        [2200, { type: 'line', text: '(4/4) installing xdg-desktop-portal-gtk      [####################] 100%' }],
        [2600, { type: 'step', text: 'Starting Bluetooth' }],
        [3000, { type: 'done' }],
        [3100, { type: 'exit', code: 0 }],
      ];
      setTimeout(() => localStorage.removeItem('mock:provision'), 3000);
      for (const [ms, ev] of steps) setTimeout(() => emit('system:update:progress', ev), ms);
      return { started: true };
    },
    'art:get': (q) => (settings.tmdbKey ? { poster: null, backdrop: backdropArt(q.id), logo: titleLogo(q.name), overview: null } : null),
    'discover:lists': async ({ kind, names = ['trending', 'popular', 'top_rated', 'most_liked'] }) => {
      if (!settings.tmdbKey) return {};
      await wait(250);
      catalog ||= makeCatalog();
      const items = kind === 'tv' ? catalog.series.items : catalog.vod.items;
      const fake = (it) => {
        const m = /^(.*?)\s*\((\d{4})\)$/.exec(it.name);
        return {
          id: 900000 + it.id,
          title: m ? m[1] : it.name,
          original: '',
          year: m ? m[2] : it.year || '',
          overview: `Trending pick: ${m ? m[1] : it.name}. A demo synopsis for the spotlight carousel.`,
          backdrop: backdropArt(it.id),
          poster: null,
          rating: 7.8,
        };
      };
      const list = (off, step) => Array.from({ length: 40 }, (_, i) => fake(items[(off + i * step) % items.length]));
      const hash = (n) => [...n].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 7);
      return Object.fromEntries(names.map((n) => [n, list(hash(n), 37 + (hash(n) % 50))]));
    },
    'discover:recs': async ({ item }) => {
      if (!settings.tmdbKey) return { results: [] };
      catalog ||= makeCatalog();
      const items = item.kind === 'series' ? catalog.series.items : catalog.vod.items;
      const results = Array.from({ length: 20 }, (_, i) => items[(item.id * 7 + i * 13) % items.length]).map((it) => {
        const m = /^(.*?)\s*\((\d{4})\)$/.exec(it.name);
        return {
          id: 900000 + it.id,
          title: m ? m[1] : it.name,
          original: '',
          year: m ? m[2] : it.year || '',
          overview: '',
          backdrop: backdropArt(it.id),
          poster: null,
          rating: 7,
        };
      });
      return { source: 1, results };
    },
    'art:testKey': async (key) => {
      await wait(300);
      if (!key || key.length < 20) throw new Error('TMDB rejected the API key');
      return true;
    },
    'art:refreshLogos': async () => {
      await wait(1500);
      return { hits: 8123, total: 10000 };
    },
    'doc:get': ({ profileId, name }) => ls.get(docKey(profileId, name), {}),
    'doc:set': ({ profileId, name, data }) => ls.set(docKey(profileId, name), data),
    'trailer:get': async ({ item }) => {
      await wait(200);
      return settings.tmdbKey && settings.trailers !== false && item?.id % 3 !== 0 ? { available: true, name: 'Official Trailer' } : { available: false };
    },
    'trailer:play': async ({ item, title }) => {
      // Browser demo: no mpv. Simulate a short trailer and come back to the page.
      console.info('[mock] trailer', title, item);
      await wait(400);
      setTimeout(() => emit('player:closed', { reason: 'ended', item: { kind: 'trailer', name: title } }), 1200);
    },
    'player:play': async (args) => {
      // Browser mode cannot launch mpv: simulate a short session.
      console.info('[mock] play', args.items[args.index]);
      await wait(300);
      setTimeout(() => emit('player:closed', { reason: 'mock', item: args.items[args.index] }), 50);
    },
    'player:command': (cmd) => {
      console.info('[mock] cmd', cmd);
      if (cmd.type === 'jump' && osdDemo) osdDemo.jump(cmd.index);
      if (cmd.type === 'zap' && osdDemo) osdDemo.jump(osdDemo.index + cmd.delta);
    },
    'player:playlist': () => osdDemo?.items ?? [],
  };

  // OSD demo mode (#osd in a browser): emit fake playback state.
  let osdDemo = null;
  if (typeof location !== 'undefined' && location.hash.startsWith('#osd')) {
    const kind = location.hash.includes('vod') ? 'movie' : 'live';
    const names = [
      'Nova Sport HD',
      'Metro News',
      'Planet Wild 4K',
      'Retro Gold',
      'Sky Arena',
      'Ocean One',
      'Prime Cinema HD',
      'Kids Club',
      'Echo Music',
      'Royal Docs',
    ];
    const items = Array.from({ length: 50 }, (_, i) => {
      const name = `${names[i % names.length]}${i >= 10 ? ` ${Math.floor(i / 10) + 1}` : ''}`;
      return { kind: 'live', id: 1001 + i, num: 101 + i, name, epg: `ch${i + 1}`, icon: channelLogo(i, name) };
    });
    osdDemo = {
      items,
      index: 0,
      jump(i) {
        this.index = (i + items.length) % items.length;
      },
    };
    const episode = { kind: 'episode', id: 9, name: 'Episode 3', seriesName: 'Metro Chronicles', season: 1, episode: 3, icon: '' };
    let pos = 1234;
    const st = () => ({
      active: true,
      profileId: 'demo',
      kind: kind === 'live' ? 'live' : 'episode',
      index: osdDemo.index,
      total: 50,
      item: kind === 'live' ? items[osdDemo.index] : episode,
      pos,
      dur: kind === 'live' ? 0 : 2700,
      paused: false,
      buffering: false,
      cacheSecs: 12,
      info: {
        width: 3840,
        height: 2160,
        vcodec: 'hevc (Main 10)',
        acodec: 'eac3',
        channels: '5.1',
        fps: 50,
        vbitrate: 18500000,
        abitrate: 640000,
        hwdec: 'd3d11va',
      },
      tracks: { audio: [], sub: [] },
    });
    setTimeout(() => emit('player:state', st()), 100);
    setInterval(() => {
      pos += 1;
      emit('player:state', st());
    }, 1000);
  }

  return {
    async invoke(channel, arg) {
      const fn = handlers[channel];
      if (!fn) throw new Error(`mock: no handler ${channel}`);
      return structuredClone(await fn(arg));
    },
    on(channel, cb) {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(cb);
      return () => listeners.get(channel).delete(cb);
    },
  };
}
