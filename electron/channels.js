// Small, Electron-free helpers for live channel lists (unit-tested).

/** Playlist index for a typed channel number (provider number first, else position), or -1. */
export function channelIndexForNumber(items, num) {
  const idx = items.findIndex((it) => it.num === num);
  const target = idx >= 0 ? idx : num - 1;
  return target >= 0 && target < items.length ? target : -1;
}
