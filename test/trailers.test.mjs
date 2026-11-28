import test from 'node:test';
import assert from 'node:assert/strict';
import { pickTrailer, ytdlpArgs, parseYtdlp, trailerLoad, mpvStartArgs, createTrailers, YTDL_FORMAT } from '../electron/trailers.js';
import { resolveTool } from '../electron/mpv.js';

const videos = [
  { site: 'YouTube', type: 'Featurette', key: 'feat', official: true, size: 2160 },
  { site: 'Vimeo', type: 'Trailer', key: 'vimeo', official: true, size: 1080 },
  { site: 'YouTube', type: 'Teaser', key: 'teaser', official: true, size: 2160 },
  { site: 'YouTube', type: 'Trailer', key: 'fan', official: false, size: 2160, published_at: '2025-01-01' },
  { site: 'YouTube', type: 'Trailer', key: 'old', official: true, size: 1080, published_at: '2023-01-01T00:00:00.000Z', name: 'Trailer 1' },
  { site: 'YouTube', type: 'Trailer', key: 'new', official: true, size: 1080, published_at: '2024-06-01T00:00:00.000Z', name: 'Official Trailer' },
  { site: 'YouTube', type: 'Trailer', key: 'small', official: true, size: 720, published_at: '2025-01-01T00:00:00.000Z' },
];

test('trailer choice: YouTube, Trailer > Teaser, official, size, newest', () => {
  assert.deepEqual(pickTrailer(videos), { key: 'new', name: 'Official Trailer', type: 'Trailer', official: true });
  assert.equal(pickTrailer(videos.filter((v) => v.type !== 'Trailer')).key, 'teaser');
  assert.equal(pickTrailer([{ site: 'YouTube', type: 'Clip', key: 'x' }]), null);
  assert.equal(pickTrailer(undefined), null);
});

test('yt-dlp arguments and output', () => {
  assert.deepEqual(ytdlpArgs('abc'), ['-g', '--no-playlist', '--no-warnings', '-f', YTDL_FORMAT, 'https://www.youtube.com/watch?v=abc']);
  assert.match(YTDL_FORMAT, /vcodec\^=avc1/);
  assert.match(YTDL_FORMAT, /height<=1080/);
  assert.deepEqual(parseYtdlp('https://v.example/v\nhttps://v.example/a\n'), { video: 'https://v.example/v', audio: 'https://v.example/a' });
  assert.deepEqual(parseYtdlp('WARNING: x\nhttps://v.example/muxed\n'), { video: 'https://v.example/muxed', audio: null });
  assert.equal(parseYtdlp(''), null);
});

test('mpv load plan: direct streams, or the ytdl hook as a fallback', () => {
  assert.deepEqual(trailerLoad({ key: 'k', streams: { video: 'V', audio: 'A' } }), { url: 'V', audio: 'A', props: [] });
  assert.deepEqual(trailerLoad({ key: 'k', streams: null }), { url: 'https://www.youtube.com/watch?v=k', audio: null, props: [['ytdl-format', YTDL_FORMAT]] });
  assert.deepEqual(mpvStartArgs('/usr/bin/yt-dlp'), ['--script-opts=ytdl_hook-ytdl_path=/usr/bin/yt-dlp']);
  assert.deepEqual(mpvStartArgs(null), []);
});

function service(over = {}) {
  const calls = { tmdb: 0, run: 0 };
  const cache = new Map();
  let t = 0;
  const svc = createTrailers({
    findTmdbId: async (it) => it.tmdbId || null,
    tmdb: async (p) => {
      calls.tmdb++;
      calls.path = p;
      return { results: videos };
    },
    cacheGet: async (k) => (cache.has(k) ? { hit: true, value: cache.get(k) } : { hit: false }),
    cachePut: async (k, v) => cache.set(k, v),
    ytdlpPath: () => '/fake/yt-dlp',
    run: async (bin, args) => {
      calls.run++;
      calls.args = args;
      return 'https://g/v\nhttps://g/a\n';
    },
    now: () => t,
    ...over,
  });
  return { svc, calls, cache, tick: (ms) => (t += ms) };
}

test('get: TMDB once (cached), streams pre-resolved once for ~4 h', async () => {
  const { svc, calls, tick } = service();
  assert.deepEqual(await svc.get({ kind: 'series', id: 1, tmdbId: 1399 }), { available: true, name: 'Official Trailer' });
  assert.equal(calls.path, '/tv/1399/videos');
  await svc.get({ kind: 'series', id: 1, tmdbId: 1399 });
  assert.equal(calls.tmdb, 1);
  const p = await svc.prepare({ kind: 'series', id: 1, tmdbId: 1399 });
  assert.deepEqual(p.streams, { video: 'https://g/v', audio: 'https://g/a' });
  assert.equal(calls.run, 1);
  tick(5 * 3600e3);
  await svc.prepare({ kind: 'series', id: 1, tmdbId: 1399 });
  assert.equal(calls.run, 2, 'URLs re-resolved after they may have expired');
});

test('no trailer, no yt-dlp, yt-dlp failure', async () => {
  const none = service({ tmdb: async () => ({ results: [] }) });
  assert.deepEqual(await none.svc.get({ kind: 'movie', id: 1, tmdbId: 5 }), { available: false });
  assert.deepEqual([...none.cache.entries()], [['trailer:movie:5', null]], 'miss cached');
  const noBin = service({ ytdlpPath: () => null });
  assert.deepEqual(await noBin.svc.get({ kind: 'movie', id: 1, tmdbId: 5 }), { available: false, reason: 'yt-dlp not found' });
  const fails = service({ run: async () => Promise.reject(new Error('Sign in to confirm')) });
  const p = await fails.svc.prepare({ kind: 'movie', id: 1, tmdbId: 5 });
  assert.equal(p.streams, null); // → player falls back to mpv's ytdl hook
  assert.deepEqual(await service().svc.get({ kind: 'movie', id: 2 }), { available: false }); // no TMDB id
});

test('yt-dlp is found like mpv: custom → bundled → PATH', () => {
  const exists = (p) => ['/res/mpv/yt-dlp', '/usr/bin/yt-dlp', 'C:\\apps\\yt-dlp.exe'].includes(p);
  assert.equal(resolveTool('yt-dlp', { resourcesPath: '/res', platform: 'linux', env: { PATH: '/usr/bin' }, exists }), '/res/mpv/yt-dlp');
  assert.equal(resolveTool('yt-dlp', { platform: 'linux', env: { PATH: '/bin:/usr/bin' }, exists }), '/usr/bin/yt-dlp');
  assert.equal(resolveTool('yt-dlp', { platform: 'win32', env: { Path: 'C:\\apps' }, exists }), 'C:\\apps\\yt-dlp.exe');
  assert.equal(resolveTool('yt-dlp', { customPath: '/custom', platform: 'linux', env: {}, exists: () => false }), null);
});
