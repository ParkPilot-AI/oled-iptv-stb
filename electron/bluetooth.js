// Bluetooth controllers from the app. On the set-top box everything goes through
// the root helper (sudo -n stb-update bt …), like Wi-Fi. Windows has its own
// Bluetooth settings, so the app only links there; other systems have no backend.

export const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;

/**
 * deps: { platform, hasUpdater() → bool, helper(args) → Promise<json> (rejects on .error),
 *         openExternal(url) }
 */
export function createBluetooth({ platform = process.platform, hasUpdater, helper, openExternal }) {
  const box = () => platform === 'linux' && hasUpdater();
  const mac = (m) => {
    if (!MAC_RE.test(String(m || ''))) throw new Error('Invalid controller address');
    return String(m).toUpperCase();
  };
  const needBox = () => {
    if (!box()) throw new Error(platform === 'win32' ? 'Use Windows Bluetooth settings to pair controllers' : 'Bluetooth pairing is only available on the set-top box');
  };
  return {
    async status() {
      if (platform === 'win32') return { adapter: false, reason: 'windows', devices: [] };
      if (!box()) return { adapter: false, reason: 'unsupported', devices: [] };
      try {
        return await helper(['bt', 'status']);
      } catch (e) {
        return { adapter: false, reason: 'error', error: e.message, devices: [] };
      }
    },
    async scan(seconds = 12) {
      needBox();
      const s = Math.max(3, Math.min(30, Math.round(Number(seconds) || 12)));
      return helper(['bt', 'scan', String(s)]);
    },
    async pair(m) {
      needBox();
      return helper(['bt', 'pair', mac(m)]);
    },
    async connect(m) {
      needBox();
      return helper(['bt', 'connect', mac(m)]);
    },
    async disconnect(m) {
      needBox();
      return helper(['bt', 'disconnect', mac(m)]);
    },
    async forget(m) {
      needBox();
      return helper(['bt', 'forget', mac(m)]);
    },
    /** Windows: open Settings → Bluetooth & devices. */
    openSystemSettings() {
      if (platform !== 'win32') throw new Error('Only on Windows');
      return openExternal('ms-settings:bluetooth');
    },
  };
}
