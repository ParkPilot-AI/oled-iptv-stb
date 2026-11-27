// Demo backend for browser-only development and automated UI tests.
// Generates a large catalog (10k channels) to exercise virtualisation.

const WORDS = 'Alpha Bravo Nova Prime Star Sky Ocean Metro City World Sport News Kids Cinema Gold Max Plus One Two Arena Planet Wild Royal Urban Retro Pulse Echo Vision Fusion'.split(' ');
const rnd = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function makeCatalog() {
  const r = rnd(42);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const liveCats = ['UK | Entertainment', 'UK | Sports', 'UK | News', 'US | Entertainment', 'US | Sports', 'DE | Allgemein', 'FR | Général', 'Kids', 'Documentary', 'Music', '4K UHD', 'PPV Events']
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
  return {
    live: { categories: liveCats, items: live },
    vod: { categories: vodCats, items: vod },
    series: { categories: seriesCats, items: series },
    fetchedAt: Date.now(),
  };
}

const SHOWS = ['News at Ten', 'Premier Football Live', 'The Great Bake', 'Planet Wild', 'Late Show', 'Weather', 'Motor Racing', 'Antiques Hunt', 'Crime Files', 'Quiz Night', 'Documentary: Oceans', 'Cooking Live', 'Film: The Long Road', 'Kids Club', 'Music Hour'];
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
    if (t + d > from) out.push({ start: t, stop: t + d, title, desc: `${title}: a demo programme description from the mock guide, long enough to check wrapping and readability on a large TV.` });
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
  let settings = { liveFormat: 'ts', hwdec: 'auto-safe', deinterlace: false, mpvPath: '', catalogTtlHours: 12, epgTtlHours: 6, osdTimeoutSec: 4, screensaverMin: 3, startFullscreen: true, accent: '#3B82F6', ...ls.get('settings', {}) };
  const profiles = ls.get('profiles', { activeId: null, list: [] });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const handlers = {
    'app:info': () => ({ version: '1.0.0-web', platform: 'web', mpvPath: null, dataDir: '(browser)' }),
    'app:quit': () => emit('mock:quit'),
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
    'settings:get': () => settings,
    'settings:update': (patch) => {
      settings = { ...settings, ...patch };
      ls.set('settings', settings);
      return settings;
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
      return { ...item, plot: 'A gripping demo synopsis that runs for a couple of lines to check wrapping and readability from ten feet away on a large OLED panel.', cast: 'Ada Lovelace, Alan Turing, Grace Hopper', director: 'Demo Director', genre: 'Drama, Thriller', year: '2024', duration: 6420, backdrop: '' };
    },
    'series:info': async ({ item }) => {
      await wait(150);
      return {
        ...item,
        plot: 'A demo series synopsis.',
        cast: 'Demo Cast',
        genre: 'Drama',
        seasons: [1, 2, 3].map((s) => ({
          season: s,
          name: `Season ${s}`,
          episodes: Array.from({ length: 10 }, (_, e) => ({ kind: 'episode', id: item.id * 100 + s * 20 + e, season: s, episode: e + 1, name: `Episode ${e + 1}`, ext: 'mkv', duration: 2700, plot: 'Episode synopsis.' })),
        })),
      };
    },
    'cache:clear': () => (catalog = null),
    'doc:get': ({ profileId, name }) => ls.get(`${profileId}:${name}`, {}),
    'doc:set': ({ profileId, name, data }) => ls.set(`${profileId}:${name}`, data),
    'player:play': async (args) => {
      // Browser mode cannot launch mpv: simulate a short session.
      console.info('[mock] play', args.items[args.index]);
      await wait(300);
      setTimeout(() => emit('player:closed', { reason: 'mock', item: args.items[args.index] }), 50);
    },
    'player:command': (cmd) => console.info('[mock] cmd', cmd),
  };

  // OSD demo mode (#osd in a browser): emit fake playback state.
  if (typeof location !== 'undefined' && location.hash.startsWith('#osd')) {
    const kind = location.hash.includes('vod') ? 'movie' : 'live';
    const item = kind === 'live'
      ? { kind, id: 1001, num: 101, name: 'Nova Sport HD', epg: 'ch1', icon: '' }
      : { kind: 'episode', id: 9, name: 'Episode 3', seriesName: 'Metro Chronicles', season: 1, episode: 3, icon: '' };
    let pos = 1234;
    const st = () => ({ active: true, profileId: 'demo', kind: item.kind, index: 0, total: 50, item, pos, dur: kind === 'live' ? 0 : 2700, paused: false, buffering: false, cacheSecs: 12, info: { width: 3840, height: 2160, vcodec: 'hevc (Main 10)', acodec: 'eac3', channels: '5.1', fps: 50, vbitrate: 18500000, abitrate: 640000, hwdec: 'd3d11va' }, tracks: { audio: [], sub: [] } });
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
