// Where user data lives. The app was called "OLED IPTV" before it became ONYX, and
// Electron derives its userData folder from the product name — so after the rename
// it would look in ".../ONYX" and every profile, password, setting, favourite and
// watch position would seem lost. We keep using the original folder instead.
// (The set-top box's stb-audio script also reads ~/.config/OLED IPTV/settings.json.)
import path from 'node:path';

export const LEGACY_DATA_NAME = 'OLED IPTV';

/** userData path: explicit override (tests, IPTV_USER_DATA) or the legacy folder under appData. */
export function userDataDir(appData, override) {
  if (override) return override;
  return path.join(appData, LEGACY_DATA_NAME);
}
