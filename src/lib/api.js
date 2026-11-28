// Bridge to the Electron main process. In a plain browser (npm run dev:web, or a
// `npm run build:demo` bundle) a mock backend with generated demo data is loaded on
// demand, so the UI can be developed without Electron, mpv or an Xtream server.
// The Electron build is made with __DEMO__ = false, so the mock isn't bundled at all.

export const isDesktop = typeof window !== 'undefined' && !!window.iptv;

/* global __DEMO__ */
const demo = typeof __DEMO__ !== 'undefined' && __DEMO__; // undefined outside Vite (unit tests)
const mock = !isDesktop && demo ? import('./mockApi.js').then((m) => m.createMockApi()) : null;

/** Same shape as window.iptv, usable synchronously; calls wait for the mock to load. */
function deferred(promise) {
  return {
    invoke: async (channel, arg) => (await promise).invoke(channel, arg),
    on(channel, cb) {
      let off = null;
      let gone = false;
      promise.then((m) => {
        if (!gone) off = m.on(channel, cb);
      });
      return () => {
        gone = true;
        off?.();
      };
    },
  };
}

const unavailable = {
  invoke: async () => {
    throw new Error('ONYX must run inside its desktop app');
  },
  on: () => () => {},
};

export const api = isDesktop ? window.iptv : mock ? deferred(mock) : unavailable;

/** Map a remote image URL to the disk-caching, downscaling imgcache:// protocol. */
export function imgUrl(src, width = 480) {
  if (!src) return '';
  if (!isDesktop) return /^(https?:|data:)/i.test(src) ? src : ''; // browser demo uses data: art
  if (!/^https?:\/\//i.test(src)) return '';
  return `imgcache://img/?w=${width}&u=${encodeURIComponent(src)}`;
}
