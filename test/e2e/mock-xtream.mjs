// Minimal Xtream Codes server for end-to-end testing.
import http from 'node:http';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

const MEDIA = path.join(path.dirname(new URL(import.meta.url).pathname), 'media');
const now = Math.floor(Date.now() / 1000);
const live = Array.from({ length: 300 }, (_, i) => ({ num: i + 1, name: `Test Channel ${i + 1}`, stream_id: 100 + i, stream_icon: '', epg_channel_id: `test${i + 1}.tv`, category_id: String((i % 3) + 1), tv_archive: 0 }));
const vod = [{ stream_id: 500, name: 'Test Movie', container_extension: 'mp4', category_id: '10', added: String(now), rating: '7.4' }];
const series = [{ series_id: 900, name: 'Test Show', cover: '', category_id: '20', last_modified: String(now) }];
const fmt = (t) => new Date(t * 1000).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
let xml = '<?xml version="1.0"?><tv>';
for (let c = 1; c <= 300; c++) for (let h = -2; h < 6; h++) xml += `<programme start="${fmt(now + h * 3600)}" stop="${fmt(now + (h + 1) * 3600)}" channel="test${c}.tv"><title>Show ${c}/${h}</title><desc>Desc &amp; more</desc></programme>`;
xml += '</tv>';
const xmlGz = zlib.gzipSync(xml);

const routes = {
  get_live_categories: [{ category_id: '1', category_name: 'News' }, { category_id: '2', category_name: 'Sport' }, { category_id: '3', category_name: 'Movies TV' }],
  get_live_streams: live,
  get_vod_categories: [{ category_id: '10', category_name: 'Action' }],
  get_vod_streams: vod,
  get_series_categories: [{ category_id: '20', category_name: 'Drama' }],
  get_series: series,
  get_vod_info: { info: { plot: 'Plot', duration_secs: 6 }, movie_data: { stream_id: 500, container_extension: 'mp4', name: 'Test Movie' } },
  get_series_info: { info: { name: 'Test Show' }, seasons: [], episodes: { 1: [{ id: '901', episode_num: 1, title: 'Pilot', container_extension: 'mp4' }, { id: '902', episode_num: 2, title: 'Second', container_extension: 'mp4' }] } },
  get_short_epg: { epg_listings: [] },
};

const log = [];
http
  .createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    log.push(u.pathname + (u.searchParams.get('action') ? `?${u.searchParams.get('action')}` : ''));
    if (u.pathname === '/__log') return res.end(JSON.stringify(log));
    if (u.pathname === '/player_api.php') {
      if (u.searchParams.get('password') !== 'pw') return res.end(JSON.stringify({ user_info: { auth: 0 } }));
      const a = u.searchParams.get('action');
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(a ? routes[a] ?? [] : { user_info: { auth: 1, status: 'Active', exp_date: String(now + 86400 * 30), max_connections: '1' }, server_info: { timezone: 'UTC' } }));
    }
    if (u.pathname === '/xmltv.php') return res.end(xmlGz); // raw gzip without Content-Encoding (panel quirk)
    if (u.pathname === '/icon.png' && fs.existsSync(path.join(MEDIA, 'icon.png'))) {
      res.setHeader('content-type', 'image/png');
      return fs.createReadStream(path.join(MEDIA, 'icon.png')).pipe(res);
    }
    let m;
    if ((m = /^\/live\/u\/pw\/(\d+)\.ts$/.exec(u.pathname))) return fs.createReadStream(path.join(MEDIA, 'live.ts')).pipe(res);
    if (/^\/(movie|series)\/u\/pw\/\d+\.mp4$/.test(u.pathname)) {
      res.setHeader('content-type', 'video/mp4');
      return fs.createReadStream(path.join(MEDIA, 'ep.mp4')).pipe(res);
    }
    res.statusCode = 404;
    res.end();
  })
  .listen(8099, () => console.log('mock xtream on 8099'));
