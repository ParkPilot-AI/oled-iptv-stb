// Streaming XMLTV parser. XMLTV files from Xtream panels are routinely 50–300 MB,
// so we never build a DOM: text chunks are scanned for <programme> blocks and each
// block is parsed with small regexes. Memory stays bounded by the largest block.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .trim();
}

/** Parse XMLTV time "20261126200000 +0100" (offset optional, defaults to UTC). */
export function parseXmltvTime(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\s*([+-]\d{2}):?(\d{2})?)?/.exec(String(s || '').trim());
  if (!m) return NaN;
  const [, y, mo, d, h, mi, se = '00', oh = '+00', om = '00'] = m;
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  const sign = oh[0] === '-' ? -1 : 1;
  const offsetMin = sign * (Math.abs(parseInt(oh, 10)) * 60 + parseInt(om, 10));
  return utc - offsetMin * 60000;
}

const ATTR_RE = /([\w:-]+)\s*=\s*"([^"]*)"|([\w:-]+)\s*=\s*'([^']*)'/g;
function parseAttrs(s) {
  const out = {};
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(s))) out[m[1] ?? m[3]] = m[2] ?? m[4];
  return out;
}

const TITLE_RE = /<title\b[^>]*>([\s\S]*?)<\/title>/i;
const DESC_RE = /<desc\b[^>]*>([\s\S]*?)<\/desc>/i;

/**
 * @param {(p:{channel:string,start:number,stop:number,title:string,desc:string})=>void} onProgramme
 */
export function createXmltvParser(onProgramme) {
  let buf = '';
  let count = 0;

  function drain(final) {
    let pos = 0;
    for (;;) {
      const open = buf.indexOf('<programme', pos);
      if (open === -1) {
        // Keep a small tail in case "<programme" is split across chunks.
        pos = Math.max(pos, buf.length - 16);
        break;
      }
      const close = buf.indexOf('</programme>', open);
      if (close === -1) {
        pos = open;
        break;
      }
      const block = buf.slice(open, close);
      const headEnd = block.indexOf('>');
      const attrs = parseAttrs(block.slice(10, headEnd));
      const body = block.slice(headEnd + 1);
      const start = parseXmltvTime(attrs.start);
      const stop = parseXmltvTime(attrs.stop);
      if (attrs.channel && Number.isFinite(start)) {
        const t = TITLE_RE.exec(body);
        const d = DESC_RE.exec(body);
        count++;
        onProgramme({
          channel: attrs.channel,
          start,
          stop: Number.isFinite(stop) ? stop : start + 3600000,
          title: decodeEntities(t?.[1] || ''),
          desc: decodeEntities(d?.[1] || ''),
        });
      }
      pos = close + 12;
    }
    buf = final ? '' : buf.slice(pos);
  }

  return {
    push(text) {
      buf += text;
      if (buf.length > 64 * 1024) drain(false);
    },
    end() {
      drain(true);
      return count;
    },
  };
}

/**
 * Build a compact EPG index: { [channelIdLower]: [[start, stop, title, desc], ...] }
 * keeping only programmes in [from, to] for wanted channels (if a set is given).
 */
export function createEpgCollector({ from, to, wanted, maxDesc = 400 }) {
  const index = Object.create(null);
  let kept = 0;
  const onProgramme = (p) => {
    if (p.stop < from || p.start > to) return;
    const key = p.channel.toLowerCase();
    if (wanted && !wanted.has(key)) return;
    (index[key] ||= []).push([p.start, p.stop, p.title, p.desc.length > maxDesc ? p.desc.slice(0, maxDesc) + '…' : p.desc]);
    kept++;
  };
  return {
    onProgramme,
    finish() {
      for (const k in index) {
        const list = index[k].sort((a, b) => a[0] - b[0]);
        // Drop duplicates/overlaps that some providers emit.
        const out = [];
        for (const p of list) if (!out.length || p[0] >= out[out.length - 1][0] + 1) out.push(p);
        index[k] = out;
      }
      return { index, kept };
    },
  };
}

/** Binary search helpers over a sorted programme list. */
export function nowNext(list, at = Date.now()) {
  if (!list?.length) return { now: null, next: null };
  let lo = 0;
  let hi = list.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid][0] <= at) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const toObj = (p) => (p ? { start: p[0], stop: p[1], title: p[2], desc: p[3] } : null);
  const cur = idx >= 0 && list[idx][1] > at ? list[idx] : null;
  return { now: toObj(cur), next: toObj(list[idx + 1]) };
}

export function range(list, from, limit = 12) {
  if (!list?.length) return [];
  const out = [];
  for (const p of list) {
    if (p[1] <= from) continue;
    out.push({ start: p[0], stop: p[1], title: p[2], desc: p[3] });
    if (out.length >= limit) break;
  }
  return out;
}
