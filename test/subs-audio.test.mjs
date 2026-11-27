import test from 'node:test';
import assert from 'node:assert/strict';
import { pickSubtitle, subStyleProps } from '../electron/subs.js';
import { outputsFromCards, outputsFromMpvHelp } from '../electron/audio.js';

const tracks = [
  { id: 1, type: 'video' },
  { id: 1, type: 'audio', lang: 'eng' },
  { id: 1, type: 'sub', lang: 'fre' },
  { id: 2, type: 'sub', lang: 'eng', title: 'English (Forced)', forced: true },
  { id: 3, type: 'sub', lang: 'eng', title: 'English SDH' },
  { id: 4, type: 'sub', lang: 'spa', default: true },
];

test('subtitle choice follows mode and language', () => {
  assert.equal(pickSubtitle(tracks, { mode: 'off' }), 'no');
  assert.equal(pickSubtitle(tracks, { mode: 'on', lang: 'en' }), 3);
  assert.equal(pickSubtitle(tracks, { mode: 'on', lang: 'es' }), 4);
  assert.equal(pickSubtitle(tracks, { mode: 'on', lang: 'de' }), 4); // stream default
  assert.equal(pickSubtitle(tracks.filter((t) => !t.default), { mode: 'on', lang: 'de' }), 1); // first
  assert.equal(pickSubtitle(tracks, { mode: 'forced', lang: 'en' }), 2);
  assert.equal(pickSubtitle(tracks.filter((t) => !t.forced), { mode: 'forced' }), 'no');
  assert.equal(pickSubtitle([{ id: 1, type: 'audio' }], { mode: 'on' }), 'no');
  assert.equal(pickSubtitle([{ id: 7, type: 'sub', title: 'English' }], { mode: 'on', lang: 'en' }), 7);
});

test('subtitle style', () => {
  assert.equal(subStyleProps({ subSize: 'large' })['sub-scale'], 1.3);
  assert.equal(subStyleProps({ subBackground: 'outline' })['sub-border-style'], 'outline-and-shadow');
});

test('PipeWire card profiles become friendly outputs', () => {
  const cards = [
    {
      name: 'alsa_card.pci-0000_00_1f.3',
      active_profile: 'output:hdmi-stereo',
      properties: { 'device.description': 'Built-in Audio' },
      profiles: {
        off: { description: 'Off', available: true },
        'output:analog-stereo+input:analog-stereo': { description: 'Analog Stereo Duplex', available: true, priority: 6565 },
        'output:analog-stereo': { description: 'Analog Stereo Output', available: true, priority: 6500 },
        'output:hdmi-stereo': { description: 'Digital Stereo (HDMI) Output', available: true, priority: 5900 },
        'output:hdmi-stereo-extra1': { description: 'Digital Stereo (HDMI 2) Output', available: false, priority: 5700 },
        'output:hdmi-surround': { description: 'Digital Surround 5.1 (HDMI) Output', available: true, priority: 800 },
        'input:analog-stereo': { description: 'Analog Stereo Input', available: true },
      },
    },
  ];
  const o = outputsFromCards(cards);
  assert.deepEqual(o.map((x) => [x.profile, x.label, x.active]), [
    ['output:analog-stereo', 'Headphone jack / speakers', false],
    ['output:hdmi-stereo', 'TV (HDMI)', true],
    ['output:hdmi-surround', 'TV (HDMI) · surround', false],
  ]);
  assert.equal(o[1].id, 'pa:alsa_card.pci-0000_00_1f.3|output:hdmi-stereo');
});

test('mpv device list parsing', () => {
  const help = `List of detected audio devices:
  'auto' (Autoselect device)
  'wasapi/{abc}' (LG TV SSCR2 (Intel(R) Display Audio))
  'wasapi/{def}' (Speakers (Realtek(R) Audio))
`;
  assert.deepEqual(outputsFromMpvHelp(help).map((x) => x.label), ['LG TV SSCR2 (Intel(R) Display Audio)', 'Speakers (Realtek(R) Audio)']);
});
