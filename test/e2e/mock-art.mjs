import http from 'node:http';
const log = [];
const json = (res, o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  log.push(u.pathname + u.search);
  if (u.pathname === '/__log') return json(res, log);
  if (u.pathname.startsWith('/3/') && u.searchParams.get('api_key') !== 'goodkey1234567890abcdef') { res.statusCode = 401; return json(res, { status_message: 'Invalid API key' }); }
  if (u.pathname === '/3/configuration') return json(res, { images: {} });
  if (u.pathname === '/3/search/movie') return json(res, { results: u.searchParams.get('query') === 'Test Movie' ? [{ id: 603, title: 'Test Movie', release_date: '2024-05-01' }] : [] });
  if (u.pathname === '/3/search/tv') return json(res, { results: [{ id: 77, name: 'Test Show', first_air_date: '2020-01-01' }] });
  if (u.pathname === '/3/movie/603') return json(res, { poster_path: '/p603.jpg', backdrop_path: '/b603.jpg', overview: 'TMDB overview', images: { logos: [{ file_path: '/l603.png', iso_639_1: 'en', vote_average: 5 }] } });
  if (u.pathname === '/3/tv/77') return json(res, { poster_path: '/p77.jpg', backdrop_path: '/b77.jpg', images: { logos: [] } });
  if (u.pathname === '/api/channels.json') return json(res, [{ id: 'test1.tv', name: 'Something Else', country: 'GB' }, { id: 'Chan2.uk', name: 'Test Channel 2', country: 'GB' }]);
  if (u.pathname === '/api/logos.json') return json(res, [{ channel: 'test1.tv', feed: null, in_use: true, format: 'PNG', width: 400, url: 'http://127.0.0.1:8099/icon.png' }, { channel: 'Chan2.uk', feed: null, in_use: true, format: 'PNG', width: 400, url: 'http://127.0.0.1:8099/icon.png?c=2' }]);
  res.statusCode = 404; res.end();
}).listen(8098, () => console.log('mock art on 8098'));
