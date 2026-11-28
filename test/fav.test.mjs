import test from 'node:test';
import assert from 'node:assert/strict';
import { favTarget } from '../src/lib/fav.js';

test('F on an episode favourites its series', () => {
  const ep = { kind: 'episode', id: 901, name: 'Pilot', seriesId: 900, seriesName: 'Test Show', seriesIcon: 'http://x/s.jpg', season: 1, episode: 1 };
  assert.deepEqual(favTarget(ep), { k: 'series', item: { kind: 'series', id: 900, name: 'Test Show', icon: 'http://x/s.jpg' } });
  assert.equal(favTarget({ kind: 'movie', id: 1 }).k, 'movie');
  assert.equal(favTarget({ kind: 'live', id: 2 }).k, 'live');
  assert.equal(favTarget({ kind: 'trailer', id: 3 }), null);
  assert.equal(favTarget({ kind: 'episode', id: 4 }), null); // no series info
});
