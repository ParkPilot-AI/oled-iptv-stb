export const pad = (n) => String(n).padStart(2, '0');

export function clock(ts = Date.now()) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function duration(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function humanDuration(sec) {
  const m = Math.round((sec || 0) / 60);
  if (!m) return '';
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export const progressPct = (start, stop, at = Date.now()) =>
  stop > start ? Math.min(100, Math.max(0, ((at - start) / (stop - start)) * 100)) : 0;

export const epLabel = (e) => `S${pad(e.season)}E${pad(e.episode)}`;

export function bitrate(bps) {
  if (!bps) return '—';
  return bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} Mb/s` : `${Math.round(bps / 1e3)} kb/s`;
}
