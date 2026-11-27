import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  normalizeServer,
  apiUrl,
  streamUrl,
  authenticate,
  normLive,
  normVod,
  normSeriesInfo,
  normVodInfo,
  normShortEpg,
} from '../electron/xtream.js';

test('normalizeServer', () => {
  assert.equal(normalizeServer('example.com:8080/'), 'http://example.com:8080');
  assert.equal(normalizeServer('https://x.tv/player_api.php?username=a'), 'https://x.tv');
  assert.equal(normalizeServer(' http://x.tv/path// '), 'http://x.tv/path');
});

test('apiUrl + streamUrl encode credentials', () => {
  const creds = { server: 'x.tv:80', username: 'u s', password: 'p/w' };
  const u = new URL(apiUrl(creds, 'get_live_streams'));
  assert.equal(u.searchParams.get('username'), 'u s');
  assert.equal(u.searchParams.get('action'), 'get_live_streams');
  assert.equal(streamUrl(creds, { kind: 'live', id: 5 }), 'http://x.tv:80/live/u%20s/p%2Fw/5.ts');
  assert.equal(streamUrl(creds, { kind: 'live', id: 5 }, { liveFormat: 'm3u8' }), 'http://x.tv:80/live/u%20s/p%2Fw/5.m3u8');
  assert.equal(streamUrl(creds, { kind: 'movie', id: 9, ext: 'mkv' }), 'http://x.tv:80/movie/u%20s/p%2Fw/9.mkv');
  assert.equal(streamUrl(creds, { kind: 'episode', id: 3, ext: 'mp4' }), 'http://x.tv:80/series/u%20s/p%2Fw/3.mp4');
});

test('normalisers tolerate panel quirks', () => {
  const live = normLive([{ stream_id: '12', name: ' BBC ', num: '3', category_id: 7, epg_channel_id: null }, { name: 'bad' }]);
  assert.deepEqual(live, [{ kind: 'live', id: 12, name: 'BBC', num: 3, cat: '7', icon: '', epg: '', archive: false }]);
  const vod = normVod({ a: { stream_id: 1, name: 'M', rating: '8', container_extension: 'mkv', category_ids: [4] } });
  assert.equal(vod[0].rating, 4);
  assert.equal(vod[0].cat, '4');

  const si = normSeriesInfo(
    {
      info: { name: 'Show' },
      seasons: [{ season_number: 1, name: 'S1' }],
      episodes: { 2: [{ id: '22', episode_num: 1, title: 'B', container_extension: 'mkv', info: { duration: '00:42:10' } }], 1: [{ id: '12', episode_num: 2 }, { id: '11', episode_num: 1 }] },
    },
    { id: 5 }
  );
  assert.deepEqual(si.seasons.map((s) => s.season), [1, 2]);
  assert.deepEqual(si.seasons[0].episodes.map((e) => e.id), [11, 12]);
  assert.equal(si.seasons[1].episodes[0].duration, 2530);

  const vi = normVodInfo({ info: { plot: 'P', duration_secs: 100 }, movie_data: { stream_id: 3, container_extension: 'avi' } }, {});
  assert.equal(vi.ext, 'avi');
  assert.equal(vi.duration, 100);

  const epg = normShortEpg({
    epg_listings: [{ title: Buffer.from('Nëws').toString('base64'), description: '', start_timestamp: '100', stop_timestamp: '200' }],
  });
  assert.equal(epg[0].title, 'Nëws');
  assert.equal(epg[0].start, 100000);
});

test('authenticate against a mock Xtream server', async () => {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const ok = u.searchParams.get('password') === 'good';
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ user_info: { auth: ok ? 1 : 0, status: 'Active', exp_date: '1900000000', max_connections: '2' }, server_info: { timezone: 'UTC' } }));
  });
  await new Promise((r) => server.listen(0, r));
  const base = `127.0.0.1:${server.address().port}`;
  const a = await authenticate({ server: base, username: 'u', password: 'good' });
  assert.equal(a.user.maxConnections, 2);
  await assert.rejects(authenticate({ server: base, username: 'u', password: 'bad' }), /Login failed/);
  server.close();
});
