// Ad-free trailers: TMDB says which YouTube video is the official trailer, yt-dlp
// turns it into direct stream URLs, mpv plays them full screen — no YouTube page,
// no ads, no tracking UI.
//
//   'trailer:get'  → { available, name }  (and starts resolving streams in the background)
//   'trailer:play' → plays it (player.js item kind 'trailer')
import { execFile } from 'node:child_process';

/** H.264 so the box's Intel VA-API always decodes it; ≤1080p; m4a audio. */
export const YTDL_FORMAT = 'bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/b[height<=1080]';
const RESOLVE_TIMEOUT = 15000;
const URL_TTL = 4 * 3600e3; // googlevideo URLs expire after ~6 h

export const youtubeUrl = (key) => `https://www.youtube.com/watch?v=${encodeURIComponent(key)}`;

/**
 * Best trailer from /videos results: YouTube only; Trailer before Teaser; official
 * first; then the largest size; then the newest.
 */
export function pickTrailer(results) {
  const rank = { Trailer: 2, Teaser: 1 };
  const list = (results || []).filter((v) => v?.site === 'YouTube' && v.key && rank[v.type]);
  list.sort(
    (a, b) =>
      rank[b.type] - rank[a.type] ||
      (b.official === true) - (a.official === true) ||
      (b.size || 0) - (a.size || 0) ||
      String(b.published_at || '').localeCompare(String(a.published_at || ''))
  );
  const v = list[0];
  return v ? { key: v.key, name: v.name || v.type, type: v.type, official: !!v.official } : null;
}

/** yt-dlp arguments that print the direct URL(s) for a video. */
export function ytdlpArgs(key) {
  return ['-g', '--no-playlist', '--no-warnings', '-f', YTDL_FORMAT, youtubeUrl(key)];
}

/** `yt-dlp -g` prints one URL (muxed) or two (video, then audio). */
export function parseYtdlp(stdout) {
  const urls = String(stdout || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^https?:\/\//.test(l));
  if (!urls.length) return null;
  return { video: urls[0], audio: urls[1] || null };
}

/**
 * How mpv should load a trailer: the direct streams when yt-dlp resolved them
 * (audio attached with audio-files), otherwise the YouTube page URL through mpv's
 * built-in ytdl hook with the same format (the hook is pointed at our yt-dlp by
 * mpvStartArgs()). Returns { url, audio, props: [[property, value]] }.
 */
export function trailerLoad(trailer) {
  if (trailer.streams?.video) return { url: trailer.streams.video, audio: trailer.streams.audio || null, props: [] };
  return { url: youtubeUrl(trailer.key), audio: null, props: [['ytdl-format', YTDL_FORMAT]] };
}

/** Extra mpv start-up arguments so its ytdl hook uses our yt-dlp (fallback path). */
export function mpvStartArgs(ytdlpPath) {
  return ytdlpPath ? [`--script-opts=ytdl_hook-ytdl_path=${ytdlpPath}`] : [];
}

const runYtdlp = (bin, args, timeout) =>
  new Promise((resolve, reject) =>
    execFile(bin, args, { timeout, maxBuffer: 1 << 20, windowsHide: true }, (err, stdout, stderr) =>
      err ? reject(new Error(String(stderr || err.message).trim().split('\n').pop() || 'yt-dlp failed')) : resolve(stdout)
    )
  );

/**
 * deps: { findTmdbId(item) → id|null, tmdb(path, params) → json, cacheGet(key), cachePut(key, value),
 *         ytdlpPath() → path|null (may be async), run(bin, args, timeout) (defaults to execFile), now() }
 */
export function createTrailers(deps) {
  const run = deps.run || runYtdlp;
  const now = deps.now || Date.now;
  const streams = new Map(); // key → { at, promise }

  async function find(item) {
    const kind = item.kind === 'series' ? 'tv' : 'movie';
    const tid = await deps.findTmdbId(item);
    if (!tid) return null;
    const cacheKey = `trailer:${kind}:${tid}`;
    const c = await deps.cacheGet(cacheKey);
    if (c.hit) return c.value;
    const r = await deps.tmdb(`/${kind}/${tid}/videos`, { include_video_language: 'en,null' });
    const t = pickTrailer(r?.results);
    await deps.cachePut(cacheKey, t);
    return t;
  }

  /** Resolve direct stream URLs (cached ~4 h; a failure isn't cached). */
  function resolve(key) {
    const hit = streams.get(key);
    if (hit && now() - hit.at < URL_TTL) return hit.promise;
    const promise = Promise.resolve(deps.ytdlpPath())
      .then((bin) => (bin ? run(bin, ytdlpArgs(key), RESOLVE_TIMEOUT) : null))
      .then(parseYtdlp)
      .catch((e) => {
        console.warn('[trailers] yt-dlp:', e.message);
        streams.delete(key);
        return null;
      });
    streams.set(key, { at: now(), promise });
    return promise;
  }

  return {
    /** { available, name } — and warm up the stream URLs so Play starts in ~1–2 s. */
    async get(item) {
      if (!(await deps.ytdlpPath())) return { available: false, reason: 'yt-dlp not found' };
      const t = await find(item).catch(() => null);
      if (!t) return { available: false };
      resolve(t.key);
      return { available: true, name: t.name };
    },
    /** Everything the player needs, or null. */
    async prepare(item) {
      const t = await find(item);
      if (!t) return null;
      return { ...t, streams: await resolve(t.key) };
    },
  };
}
