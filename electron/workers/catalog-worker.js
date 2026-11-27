// Worker thread: all heavy network + JSON/XMLTV parsing happens here so neither
// the Electron main loop nor the renderer UI thread ever stalls.
import { parentPort } from 'node:worker_threads';
import {
  apiUrl,
  xmltvUrl,
  fetchJson,
  fetchWithTimeout,
  normCategories,
  normLive,
  normVod,
  normSeries,
} from '../xtream.js';
import { createXmltvParser, createEpgCollector } from '../xmltv.js';
import { buildLogoMatcher } from '../artmatch.js';

const IPTV_ORG = process.env.IPTV_ORG_API || 'https://iptv-org.github.io/api';

/** Match provider channels to iptv-org logos. items: [{id, name, epg}] → { [id]: url } */
async function matchLogos(items, post) {
  post({ stage: 'logos' });
  const [channels, logos] = await Promise.all([
    fetchJson(`${IPTV_ORG}/channels.json`, { timeoutMs: 120000 }),
    fetchJson(`${IPTV_ORG}/logos.json`, { timeoutMs: 120000 }),
  ]);
  const match = buildLogoMatcher(channels, logos);
  const map = {};
  let hits = 0;
  for (const it of items) {
    const url = match(it);
    if (url) {
      map[it.id] = url;
      hits++;
    }
  }
  return { map, hits, total: items.length, fetchedAt: Date.now() };
}

async function loadCatalog(creds, post) {
  const get = (action) => fetchJson(apiUrl(creds, action), { timeoutMs: 120000 });
  post({ stage: 'categories' });
  const [liveCats, vodCats, seriesCats] = await Promise.all([
    get('get_live_categories'),
    get('get_vod_categories'),
    get('get_series_categories'),
  ]);
  post({ stage: 'streams' });
  // Fetch big lists sequentially-ish to avoid hammering weak panels; live first.
  const live = normLive(await get('get_live_streams'));
  post({ stage: 'movies', live: live.length });
  const [vod, series] = await Promise.all([get('get_vod_streams'), get('get_series')]);
  return {
    live: { categories: normCategories(liveCats), items: live },
    vod: { categories: normCategories(vodCats), items: normVod(vod) },
    series: { categories: normCategories(seriesCats), items: normSeries(series) },
    fetchedAt: Date.now(),
  };
}

async function loadEpg(creds, { wanted, pastHours = 3, futureHours = 36 }, post) {
  const now = Date.now();
  const collector = createEpgCollector({
    from: now - pastHours * 3600e3,
    to: now + futureHours * 3600e3,
    wanted: wanted?.length ? new Set(wanted.map((w) => w.toLowerCase())) : null,
  });
  const parser = createXmltvParser(collector.onProgramme);
  const res = await fetchWithTimeout(xmltvUrl(creds), { timeoutMs: 300000 });

  // Some panels serve a raw .gz file without Content-Encoding; sniff magic bytes.
  const reader = res.body.getReader();
  const first = await reader.read();
  let stream = new ReadableStream({
    start(c) {
      if (!first.done) c.enqueue(first.value);
    },
    async pull(c) {
      const { done, value } = await reader.read();
      if (done) c.close();
      else c.enqueue(value);
    },
    cancel: (r) => reader.cancel(r),
  });
  if (!first.done && first.value[0] === 0x1f && first.value[1] === 0x8b) {
    stream = stream.pipeThrough(new DecompressionStream('gzip'));
  }

  const decoder = new TextDecoder('utf-8');
  let bytes = 0;
  let lastPost = 0;
  for await (const chunk of stream) {
    bytes += chunk.byteLength;
    parser.push(decoder.decode(chunk, { stream: true }));
    if (bytes - lastPost > 8 * 1024 * 1024) {
      lastPost = bytes;
      post({ stage: 'epg', mb: Math.round(bytes / 1048576) });
    }
  }
  parser.push(decoder.decode());
  const parsed = parser.end();
  const { index, kept } = collector.finish();
  return { index, parsed, kept, fetchedAt: Date.now() };
}

parentPort.on('message', async (msg) => {
  const post = (progress) => parentPort.postMessage({ id: msg.id, progress });
  try {
    let result;
    if (msg.type === 'catalog') result = await loadCatalog(msg.creds, post);
    else if (msg.type === 'epg') result = await loadEpg(msg.creds, msg.options || {}, post);
    else if (msg.type === 'logos') result = await matchLogos(msg.items || [], post);
    else throw new Error(`Unknown job ${msg.type}`);
    parentPort.postMessage({ id: msg.id, ok: true, result });
  } catch (err) {
    parentPort.postMessage({ id: msg.id, ok: false, error: String(err?.message || err) });
  }
});
