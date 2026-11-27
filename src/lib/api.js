// Bridge to the Electron main process. In a plain browser (npm run dev:web) a
// mock backend with generated demo data is used so the UI can be developed and
// tested without Electron, mpv, or a real Xtream server.
import { createMockApi } from './mockApi.js';

export const isDesktop = typeof window !== 'undefined' && !!window.iptv;
export const api = isDesktop ? window.iptv : createMockApi();

/** Map a remote image URL to the disk-caching, downscaling imgcache:// protocol. */
export function imgUrl(src, width = 480) {
  if (!src || !/^https?:\/\//i.test(src)) return '';
  if (!isDesktop) return src;
  return `imgcache://img/?w=${width}&u=${encodeURIComponent(src)}`;
}
