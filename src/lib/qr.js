// Minimal QR Code encoder (ISO/IEC 18004), no dependencies: byte mode,
// error-correction level M or L, versions 1–10 (up to ~213 bytes at M), automatic
// mask choice. Used for the "scan with your phone" sign-in on the playlist screen.
// Returns a square boolean matrix (true = dark module), without the quiet zone.

const ECC_PER_BLOCK = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
};
const NUM_BLOCKS = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
};
const FORMAT_BITS = { L: 1, M: 0 };
const MAX_VERSION = 10;

/** Number of data+ECC bits available in a symbol of this version. */
export function rawDataModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

/** Data codewords (bytes) for a version and level. */
export function dataCodewords(ver, ecl) {
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver] * NUM_BLOCKS[ecl][ver];
}

// ---- Reed–Solomon over GF(256), polynomial 0x11D ----
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}

/** ECC bytes for a block of data (exported for tests). */
export function rsRemainder(data, degree) {
  const div = rsDivisor(degree);
  const r = new Array(degree).fill(0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    for (let i = 0; i < degree; i++) r[i] ^= gfMul(div[i], f);
  }
  return r;
}

// ---- codewords ----
function utf8(text) {
  return Array.from(new TextEncoder().encode(text));
}

function buildCodewords(bytes, ver, ecl) {
  const cap = dataCodewords(ver, ecl);
  const bits = [];
  const put = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(0b0100, 4); // byte mode
  put(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap * 8 - bits.length)); // terminator
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; data.length < cap; pad ^= 0xec ^ 0x11) data.push(pad);

  // Split into blocks, add ECC, interleave.
  const numBlocks = NUM_BLOCKS[ecl][ver];
  const eccLen = ECC_PER_BLOCK[ecl][ver];
  const total = Math.floor(rawDataModules(ver) / 8);
  const shortBlocks = numBlocks - (total % numBlocks);
  const shortLen = Math.floor(total / numBlocks);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const len = shortLen - eccLen + (i < shortBlocks ? 0 : 1);
    const d = data.slice(k, k + len);
    k += len;
    const ecc = rsRemainder(d, eccLen);
    if (i < shortBlocks) d.push(0); // placeholder so all blocks line up
    blocks.push(d.concat(ecc));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => {
      if (i !== shortLen - eccLen || j >= shortBlocks) out.push(b[i]);
    });
  }
  return out;
}

// ---- matrix ----
function alignmentPositions(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const out = [6];
  for (let pos = ver * 4 + 10; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

function makeMatrix(ver) {
  const size = ver * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => {
    m[y][x] = dark;
    fn[y][x] = true;
  };
  // Timing patterns.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  // Finder patterns + separators.
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  // Alignment patterns.
  const al = alignmentPositions(ver);
  for (let i = 0; i < al.length; i++)
    for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  // Reserve format areas (filled later) and the dark module.
  for (let i = 0; i < 9; i++) {
    fn[8][i] = fn[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    fn[8][size - 1 - i] = fn[size - 1 - i][8] = true;
  }
  set(8, size - 8, true);
  // Version information (v7+).
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }
  return { m, fn, size };
}

function placeData(m, fn, size, codewords) {
  let i = 0;
  const bits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y][x] && i < bits) {
          m[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
  }
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(m, fn, size, mask) {
  const f = MASKS[mask];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && f(x, y)) m[y][x] = !m[y][x];
}

/** 15-bit format information for a level and mask (exported for tests). */
export function formatBits(ecl, mask) {
  const data = (FORMAT_BITS[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormat(m, size, ecl, mask) {
  const bits = formatBits(ecl, mask);
  const bit = (i) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) m[i][8] = bit(i);
  m[7][8] = bit(6);
  m[8][8] = bit(7);
  m[8][7] = bit(8);
  for (let i = 9; i < 15; i++) m[8][14 - i] = bit(i);
  for (let i = 0; i < 8; i++) m[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) m[size - 15 + i][8] = bit(i);
  m[size - 8][8] = true;
}

/** Penalty score (lower is better) used to pick the mask. */
function penalty(m, size) {
  let p = 0;
  const line = (get) => {
    let run = 1;
    for (let i = 1; i < size; i++) {
      if (get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) p += run - 2;
        run = 1;
      }
    }
    if (run >= 5) p += run - 2;
  };
  for (let y = 0; y < size; y++) line((x) => m[y][x]);
  for (let x = 0; x < size; x++) line((y) => m[y][x]);
  for (let y = 0; y < size - 1; y++)
    for (let x = 0; x < size - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
    }
  const pat = [true, false, true, true, true, false, true];
  const finderLike = (get) => {
    for (let i = 0; i + 11 <= size; i++) {
      let a = true;
      let b = true;
      for (let k = 0; k < 7; k++) {
        if (get(i + k) !== pat[k]) a = false;
        if (get(i + 4 + k) !== pat[k]) b = false;
      }
      if (a && !get(i + 7) && !get(i + 8) && !get(i + 9) && !get(i + 10)) p += 40;
      if (b && !get(i) && !get(i + 1) && !get(i + 2) && !get(i + 3)) p += 40;
    }
  };
  for (let y = 0; y < size; y++) finderLike((x) => m[y][x]);
  for (let x = 0; x < size; x++) finderLike((y) => m[y][x]);
  let dark = 0;
  for (const row of m) for (const c of row) if (c) dark++;
  const total = size * size;
  p += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return p;
}

/**
 * Encode text as a QR code. Options: { ecl: 'M' | 'L', mask: 0–7 (default: best) }.
 * Returns { size, version, mask, modules: boolean[][] }.
 */
export function encodeQr(text, { ecl = 'M', mask = null } = {}) {
  const bytes = utf8(text);
  let ver = 1;
  for (; ver <= MAX_VERSION; ver++) {
    const lenBits = ver < 10 ? 8 : 16;
    if (4 + lenBits + bytes.length * 8 <= dataCodewords(ver, ecl) * 8) break;
  }
  if (ver > MAX_VERSION) throw new Error('Text too long for a QR code');
  const codewords = buildCodewords(bytes, ver, ecl);
  const candidates = mask == null ? [0, 1, 2, 3, 4, 5, 6, 7] : [mask];
  let best = null;
  for (const k of candidates) {
    const { m, fn, size } = makeMatrix(ver);
    placeData(m, fn, size, codewords);
    applyMask(m, fn, size, k);
    drawFormat(m, size, ecl, k);
    const score = candidates.length > 1 ? penalty(m, size) : 0;
    if (!best || score < best.score) best = { score, size, version: ver, mask: k, modules: m };
  }
  const { size, version, modules } = best;
  return { size, version, mask: best.mask, modules };
}

/** SVG path data for the dark modules, offset by a quiet zone of `quiet` modules. */
export function qrPath(qr, quiet = 4) {
  let d = '';
  qr.modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    })
  );
  return d;
}
