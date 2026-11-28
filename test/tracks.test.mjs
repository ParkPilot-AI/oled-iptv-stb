import test from 'node:test';
import assert from 'node:assert/strict';
import { describeTrack } from '../electron/tracks.js';

const tl = [
  { id: 1, type: 'video', selected: true },
  { id: 1, type: 'audio', lang: 'eng', codec: 'aac', 'demux-channel-count': 2 },
  { id: 2, type: 'audio', lang: 'eng', codec: 'ac3', 'demux-channel-count': 6, selected: true },
  { id: 3, type: 'audio', lang: 'fre', codec: 'ac3', 'demux-channel-count': 6, title: 'Commentary' },
  { id: 1, type: 'sub', lang: 'en', codec: 'subrip' },
  { id: 2, type: 'sub', lang: 'es', codec: 'hdmv_pgs_subtitle', forced: true },
];

test('audio track names', () => {
  assert.equal(describeTrack(tl, 'audio'), 'Audio: English · AC3 5.1 (2/3)');
  const fr = tl.map((t) => (t.type === 'audio' ? { ...t, selected: t.id === 3 } : t));
  assert.equal(describeTrack(fr, 'audio'), 'Audio: French (Commentary) · AC3 5.1 (3/3)');
  assert.equal(describeTrack([{ id: 1, type: 'audio', codec: 'mp2', selected: true }], 'audio'), 'Audio: Track 1 · MP2');
});

test('subtitle names and off', () => {
  assert.equal(describeTrack(tl, 'sub'), 'Subtitles: Off');
  const es = tl.map((t) => (t.type === 'sub' ? { ...t, selected: t.id === 2 } : t));
  assert.equal(describeTrack(es, 'sub'), 'Subtitles: Spanish · Forced PGS (2/2)');
  assert.equal(describeTrack([{ id: 1, type: 'video' }], 'sub'), 'Subtitles: none in this stream');
});
