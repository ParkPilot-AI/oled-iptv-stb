import test from 'node:test';
import assert from 'node:assert/strict';
import { sportsChannels, uhdMovies, recentlyAdded, addRecent } from '../src/lib/searchChips.js';

test('quick filters: sport channels, 4K films, newest first', () => {
  const live = {
    cats: [
      { id: 1, name: 'UK | SPORTS' },
      { id: 2, name: 'UK | NEWS' },
    ],
    items: [
      { name: 'BBC News', cat: 2 },
      { name: 'Sky Sports Main Event', cat: 1 },
      { name: 'TNT Sports 1', cat: 2 },
      { name: 'Sportsman Gold', cat: 2 },
    ],
  };
  assert.deepEqual(
    sportsChannels(live).map((c) => c.name),
    ['Sky Sports Main Event', 'TNT Sports 1']
  );
  const vod = {
    cats: [{ id: 9, name: '4K UHD Movies' }],
    items: [
      { name: 'Dune 4K', cat: 1 },
      { name: 'Heat', cat: 9 },
      { name: 'Up', cat: 1 },
    ],
    recent: [{ name: 'B', added: 5 }],
  };
  assert.deepEqual(
    uhdMovies(vod).map((m) => m.name),
    ['Dune 4K', 'Heat']
  );
  assert.deepEqual(
    recentlyAdded(vod, { recent: [{ name: 'S', added: 9 }] }).map((m) => m.name),
    ['S', 'B']
  );
});

test('recent searches: newest first, no duplicates, short terms ignored, capped', () => {
  let r = addRecent([], 'bbc');
  r = addRecent(r, 'Dune');
  r = addRecent(r, 'BBC');
  r = addRecent(r, 'x');
  assert.deepEqual(r, ['BBC', 'Dune']);
  for (let i = 0; i < 12; i++) r = addRecent(r, `term ${i}`);
  assert.equal(r.length, 8);
});
