// Mini-player and trailer-preview placement (Electron-free, unit-tested).
// mpv's X11/Windows geometry is in physical pixels: "WxH+X+Y".

/**
 * mode 'dock': small 16:9 player in the bottom-right corner (above the hint bar).
 * mode 'peek': larger floating preview on the right-hand side.
 * display: { bounds: {x,y,width,height}, scaleFactor }.
 */
export function pipRect(mode, display) {
  const s = display.scaleFactor || 1;
  const W = Math.round(display.bounds.width * s);
  const H = Math.round(display.bounds.height * s);
  const ox = Math.round(display.bounds.x * s);
  const oy = Math.round(display.bounds.y * s);
  const m = Math.round(W * 0.025);
  const frac = mode === 'peek' ? 0.46 : 0.3;
  const w = Math.round(W * frac);
  const h = Math.round((w * 9) / 16);
  const x = ox + W - w - m;
  const y = mode === 'peek' ? oy + Math.round((H - h) / 2) : oy + H - h - m * 2.4;
  return { x, y, width: w, height: h };
}

export const mpvGeometry = (r) => `${r.width}x${r.height}+${r.x}+${r.y}`;
