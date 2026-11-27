// Xtream Codes API client: URL builders, resilient JSON fetch, and payload
// normalisers that slim large server responses down to what the UI needs.
// Pure ESM with no Electron imports so it can run inside worker threads and tests.

export const USER_AGENT = 'OLED-IPTV/1.0 (mpv)';

/** Normalise a user-entered server URL: add scheme, strip trailing slash / player_api.php. */
export function normalizeServer(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  s = s.replace(/\/(player_api|xmltv|get)\.php.*$/i, '');
  return s.replace(/\/+$/, '');
}

export function apiUrl(creds, action, params = {}) {
  const u = new URL(`${normalizeServer(creds.server)}/player_api.php`);
  u.searchParams.set('username', creds.username);
  u.searchParams.set('password', creds.password);
  if (action) u.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}

export function xmltvUrl(creds) {
  const u = new URL(`${normalizeServer(creds.server)}/xmltv.php`);
  u.searchParams.set('username', creds.username);
  u.searchParams.set('password', creds.password);
  return u.toString();
}

const enc = (s) => encodeURIComponent(s);

/** Build a playable stream URL for an item. */
export function streamUrl(creds, item, opts = {}) {
  const base = normalizeServer(creds.server);
  const auth = `${enc(creds.username)}/${enc(creds.password)}`;
  switch (item.kind) {
    case 'live': {
      const ext = opts.liveFormat === 'm3u8' ? 'm3u8' : 'ts';
      return `${base}/live/${auth}/${item.id}.${ext}`;
    }
    case 'movie':
      return `${base}/movie/${auth}/${item.id}.${item.ext || 'mp4'}`;
    case 'episode':
      return `${base}/series/${auth}/${item.id}.${item.ext || 'mp4'}`;
    default:
      throw new Error(`Unknown item kind: ${item.kind}`);
  }
}

/** Turn Node's opaque "fetch failed" into something a person can act on. */
export function networkError(err, url) {
  let host = '';
  let port = '';
  try {
    const u = new URL(url);
    host = u.hostname;
    port = u.port || (u.protocol === 'https:' ? '443' : '80');
  } catch {}
  const c = err?.cause || {};
  const code = c.code || err?.code || '';
  const why = {
    ENOTFOUND: `Can't find the server "${host}". Check the server address, or the box may be offline (check Wi-Fi).`,
    EAI_AGAIN: `Can't look up "${host}": the box seems to be offline. Check Wi-Fi.`,
    ECONNREFUSED: `${host} refused the connection on port ${port}. Check the port in the server URL (for example :8080).`,
    ECONNRESET: `${host} closed the connection. Check the port, or try http:// instead of https://.`,
    ETIMEDOUT: `${host} didn't answer on port ${port}. Check the port in the server URL, or your internet connection.`,
    UND_ERR_CONNECT_TIMEOUT: `${host} didn't answer on port ${port}. Check the port in the server URL, or your internet connection.`,
    ENETUNREACH: 'No network. Connect to Wi-Fi first.',
    EHOSTUNREACH: `Can't reach ${host}. Check your internet connection.`,
    UND_ERR_SOCKET: `${host} dropped the connection. Check the port, or try http:// instead of https://.`,
  }[code];
  if (why) return new Error(why);
  if (/certificate|SSL|TLS/i.test(`${code} ${c.message || ''}`)) return new Error(`Secure connection to ${host} failed. Try http:// instead of https://.`);
  if (err?.name === 'AbortError' || /timed out/i.test(err?.message || '')) return new Error(`${host} took too long to answer. Check the server URL and your connection.`);
  const detail = c.message || code;
  return new Error(`Couldn't connect to ${host || 'the server'}${detail ? ` (${detail})` : ''}.`);
}

export async function fetchWithTimeout(url, { timeoutMs = 30000, ...init } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    let res;
    try {
      res = await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*', ...(init.headers || {}) },
      });
    } catch (e) {
      throw networkError(e, url);
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new Error(`Server refused access (HTTP ${res.status}). Check the username and password.`);
      if (res.status === 404) throw new Error('Server answered, but this isn\'t an Xtream Codes address (HTTP 404). Check the server URL and port.');
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return res;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchJson(url, opts) {
  const res = await fetchWithTimeout(url, opts);
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Server returned invalid JSON (check the server URL)');
  }
}

/** Validate credentials; returns user_info/server_info or throws a friendly error. */
export async function authenticate(creds) {
  const data = await fetchJson(apiUrl(creds), { timeoutMs: 15000 });
  const ui = data?.user_info;
  if (!ui || Number(ui.auth) !== 1) throw new Error('Login failed: wrong username or password');
  if (ui.status && String(ui.status).toLowerCase() !== 'active') {
    throw new Error(`Account status: ${ui.status}`);
  }
  return {
    user: {
      status: ui.status,
      expires: ui.exp_date ? Number(ui.exp_date) * 1000 : null,
      maxConnections: Number(ui.max_connections) || null,
      activeConnections: Number(ui.active_cons) || 0,
    },
    server: {
      timezone: data.server_info?.timezone || null,
      timeNow: data.server_info?.time_now || null,
    },
  };
}

// ---------- normalisers ----------
const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
const str = (x) => (x == null ? '' : String(x));
const num = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};
const cat = (it) => str(it.category_id ?? (Array.isArray(it.category_ids) ? it.category_ids[0] : ''));

export function normCategories(list) {
  return arr(list).map((c) => ({ id: str(c.category_id), name: str(c.category_name).trim() || 'Untitled' }));
}

export function normLive(list) {
  return arr(list)
    .filter((s) => s && s.stream_id != null)
    .map((s) => ({
      kind: 'live',
      id: num(s.stream_id),
      name: str(s.name).trim(),
      num: num(s.num),
      cat: cat(s),
      icon: str(s.stream_icon),
      epg: str(s.epg_channel_id).trim(),
      archive: num(s.tv_archive) === 1,
    }));
}

const yearOf = (s) => {
  const y = str(s.year || s.releaseDate || s.release_date || s.releasedate).slice(0, 4);
  return /^(19|20)\d\d$/.test(y) ? y : '';
};

export function normVod(list) {
  return arr(list)
    .filter((s) => s && s.stream_id != null)
    .map((s) => ({
      kind: 'movie',
      id: num(s.stream_id),
      name: str(s.name).trim(),
      cat: cat(s),
      icon: str(s.stream_icon),
      rating: num(s.rating_5based) || num(s.rating) / 2 || 0,
      added: num(s.added),
      ext: str(s.container_extension) || 'mp4',
      year: yearOf(s),
      ...(num(s.tmdb || s.tmdb_id) ? { tmdbId: num(s.tmdb || s.tmdb_id) } : {}),
    }));
}

export function normSeries(list) {
  return arr(list)
    .filter((s) => s && s.series_id != null)
    .map((s) => ({
      kind: 'series',
      id: num(s.series_id),
      name: str(s.name).trim(),
      cat: cat(s),
      icon: str(s.cover),
      rating: num(s.rating_5based) || num(s.rating) / 2 || 0,
      added: num(s.last_modified),
      year: yearOf(s),
      ...(num(s.tmdb || s.tmdb_id) ? { tmdbId: num(s.tmdb || s.tmdb_id) } : {}),
    }));
}

const durationSecs = (info) => {
  if (info?.duration_secs) return num(info.duration_secs);
  const m = /^(\d+):(\d+):(\d+)$/.exec(str(info?.duration));
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
};

export function normVodInfo(data, fallback = {}) {
  const info = data?.info || {};
  const md = data?.movie_data || {};
  return {
    kind: 'movie',
    id: num(md.stream_id) || fallback.id,
    name: str(md.name || info.name || fallback.name),
    ext: str(md.container_extension) || fallback.ext || 'mp4',
    plot: str(info.plot || info.description),
    cast: str(info.cast || info.actors),
    director: str(info.director),
    genre: str(info.genre),
    year: str(info.releasedate || info.release_date).slice(0, 4),
    rating: num(info.rating),
    duration: durationSecs(info),
    icon: str(info.movie_image || info.cover_big || fallback.icon),
    backdrop: str(arr(info.backdrop_path)[0] || ''),
    tmdbId: num(info.tmdb_id || info.tmdb) || null,
  };
}

export function normSeriesInfo(data, fallback = {}) {
  const info = data?.info || {};
  const seasonsMeta = new Map(arr(data?.seasons).map((s) => [num(s.season_number), s]));
  const episodesBySeason = data?.episodes || {};
  const seasons = Object.keys(episodesBySeason)
    .map(Number)
    .sort((a, b) => a - b)
    .map((sn) => ({
      season: sn,
      name: str(seasonsMeta.get(sn)?.name) || `Season ${sn}`,
      episodes: arr(episodesBySeason[sn])
        .map((e) => ({
          kind: 'episode',
          id: num(e.id),
          season: sn,
          episode: num(e.episode_num),
          name: str(e.title).trim(),
          ext: str(e.container_extension) || 'mp4',
          plot: str(e.info?.plot),
          duration: durationSecs(e.info),
          icon: str(e.info?.movie_image),
        }))
        .sort((a, b) => a.episode - b.episode),
    }));
  return {
    kind: 'series',
    id: fallback.id,
    name: str(info.name || fallback.name),
    plot: str(info.plot),
    cast: str(info.cast),
    genre: str(info.genre),
    year: str(info.releaseDate || info.release_date).slice(0, 4),
    rating: num(info.rating),
    icon: str(info.cover || fallback.icon),
    backdrop: str(arr(info.backdrop_path)[0] || ''),
    tmdbId: num(info.tmdb_id || info.tmdb) || null,
    seasons,
  };
}

const b64 = (s) => {
  try {
    return Buffer.from(str(s), 'base64').toString('utf8');
  } catch {
    return str(s);
  }
};

/** get_short_epg returns base64 encoded title/description. */
export function normShortEpg(data) {
  return arr(data?.epg_listings)
    .map((p) => ({
      start: num(p.start_timestamp) * 1000 || Date.parse(p.start),
      stop: num(p.stop_timestamp) * 1000 || Date.parse(p.end),
      title: b64(p.title),
      desc: b64(p.description),
    }))
    .filter((p) => p.start && p.stop)
    .sort((a, b) => a.start - b.start);
}
