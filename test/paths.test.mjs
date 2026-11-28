// The ONYX rename must not move user data (profiles, settings, favourites, progress).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { userDataDir, LEGACY_DATA_NAME } from '../electron/paths.js';

test('userData stays in the pre-rename "OLED IPTV" folder', () => {
  assert.equal(userDataDir('/home/tv/.config'), path.join('/home/tv/.config', 'OLED IPTV'));
  assert.equal(userDataDir('C:\\Users\\a\\AppData\\Roaming').endsWith(LEGACY_DATA_NAME), true);
  assert.equal(userDataDir('/x', '/tmp/override'), '/tmp/override');
});

test('main.js sets userData from paths.js before anything else runs', () => {
  const main = fs.readFileSync('electron/main.js', 'utf8');
  assert.match(main, /app\.setPath\('userData', userDataDir\(app\.getPath\('appData'\)/);
});

test('box paths the updater relies on are unchanged', () => {
  const yml = fs.readFileSync('electron-builder.yml', 'utf8');
  assert.match(yml, /executableName: oled-iptv-player/);
  const audio = fs.readFileSync('stb/overlay/airootfs/root/stb-files/stb-audio.sh', 'utf8');
  assert.match(audio, /\.config\/OLED IPTV\/settings\.json/);
});
