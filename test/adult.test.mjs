import test from 'node:test';
import assert from 'node:assert/strict';
import { filterAdult, filterFavs } from '../src/lib/adult.js';
import { hashPin, publicSettings, showAdultPatch, pinPatch } from '../electron/adult.js';

const raw = {
  live: {
    categories: [{ id: '1', name: 'UK | Entertainment' }, { id: '2', name: 'Adult 18+' }],
    items: [
      { kind: 'live', id: 1, name: 'UK: BBC One', cat: '1', genre: 'entertainment' },
      { kind: 'live', id: 2, name: 'Night Channel', cat: '1', genre: 'adult' },
      { kind: 'live', id: 3, name: 'Something', cat: '2', genre: 'entertainment' },
    ],
  },
  vod: { categories: [{ id: '10', name: 'Action' }, { id: '11', name: 'XXX Movies' }], items: [{ kind: 'movie', id: 5, cat: '10' }, { kind: 'movie', id: 6, cat: '11' }] },
  series: { categories: [], items: [] },
};

test('hidden: adult channels, adult categories and adult VOD are removed everywhere', () => {
  const { raw: r, hidden } = filterAdult(raw, false);
  assert.deepEqual(r.live.items.map((i) => i.id), [1]);
  assert.deepEqual(r.live.categories.map((c) => c.id), ['1']);
  assert.deepEqual(r.vod.items.map((i) => i.id), [5]);
  assert.deepEqual([...hidden].sort(), [2, 3]);
  const favs = filterFavs({ live: [{ id: 1 }, { id: 2 }, { id: 9, genre: 'adult' }], movie: [], series: [] }, hidden, false);
  assert.deepEqual(favs.live.map((c) => c.id), [1]);
});

test('shown: nothing is filtered', () => {
  const { raw: r, hidden } = filterAdult(raw, true);
  assert.equal(r, raw);
  assert.equal(hidden.size, 0);
});

test('PIN: hashed, required to show, required to change', () => {
  const s = { showAdult: false, adultPinHash: hashPin('1234') };
  assert.deepEqual(publicSettings(s), { showAdult: false, adultPinSet: true });
  assert.throws(() => showAdultPatch(s, { show: true, pin: '0000' }), /Wrong PIN/);
  assert.deepEqual(showAdultPatch(s, { show: true, pin: '1234' }), { showAdult: true });
  assert.deepEqual(showAdultPatch(s, { show: false }), { showAdult: false });
  assert.throws(() => pinPatch(s, { pin: '5678', current: '1111' }), /Wrong PIN/);
  assert.deepEqual(pinPatch(s, { pin: '', current: '1234' }), { adultPinHash: '' });
  assert.throws(() => pinPatch({}, { pin: '12a4' }), /4 digits/);
  assert.equal(pinPatch({}, { pin: '4321' }).adultPinHash, hashPin('4321'));
  assert.notEqual(hashPin('4321'), '4321');
});
