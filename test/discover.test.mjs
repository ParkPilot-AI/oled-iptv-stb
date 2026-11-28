import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMatcher, matchList } from '../src/lib/discover.js';

const items = [
  { kind: 'movie', id: 1, name: 'EN - The Matrix (1999)' },
  { kind: 'movie', id: 2, name: 'EN - The Matrix (1999) 4K' },
  { kind: 'movie', id: 3, name: 'The Matrix Resurrections (2021)' },
  { kind: 'movie', id: 4, name: 'Dune (1984)' },
  { kind: 'movie', id: 5, name: 'Dune: Part Two', tmdbId: 693134 },
  { kind: 'movie', id: 6, name: 'Amélie (2001)' },
];
const m = buildMatcher(items);

test('TMDB results map to playable provider items', () => {
  const r = matchList(
    [
      { id: 603, title: 'The Matrix', year: '1999' },
      { id: 438631, title: 'Dune', year: '2021' }, // provider only has the 1984 film
      { id: 693134, title: 'Dune: Part Two', year: '2024' }, // matched by provider TMDB id
      { id: 194, title: 'Amelie', original: 'Le Fabuleux Destin d’Amélie Poulain', year: '2001' },
      { id: 9999, title: 'Not On Provider', year: '2020' },
    ],
    m
  );
  assert.deepEqual(r.map((x) => [x.id, x.tmdbId]), [[1, 603], [5, 693134], [6, 194]]);
});

test('exclude and limit', () => {
  const r = matchList([{ id: 603, title: 'The Matrix', year: '1999' }, { id: 624860, title: 'The Matrix Resurrections', year: '2021' }], m, { exclude: new Set([1]), limit: 5 });
  assert.deepEqual(r.map((x) => x.id), [3]);
});

test('never pairs a TMDB title with a different same-named film', async () => {
  const { buildMatcher: bm, matchList: ml, rejectMatch } = await import('../src/lib/discover.js');
  const cat = [
    { kind: 'movie', id: 10, name: 'Dune', tmdbId: 841 }, // provider says: the 1984 film
    { kind: 'movie', id: 11, name: 'Total Recall (1990)' },
    { kind: 'movie', id: 12, name: 'Total Recall' },
    { kind: 'movie', id: 13, name: 'Heat' },
  ];
  const m2 = bm(cat);
  // TMDB "Dune" (2021) must not take the provider's 1984 copy.
  assert.deepEqual(ml([{ id: 438631, title: 'Dune', year: '2021' }], m2), []);
  // One dated + one undated copy: only the dated one can be trusted.
  assert.deepEqual(ml([{ id: 64635, title: 'Total Recall', year: '2012' }], m2), []);
  assert.deepEqual(ml([{ id: 861, title: 'Total Recall', year: '1990' }], m2).map((x) => x.id), [11]);
  // Undated single copy matches, until the provider's details prove otherwise.
  assert.deepEqual(ml([{ id: 949, title: 'Heat', year: '1995' }], m2).map((x) => x.id), [13]);
  rejectMatch({ id: 13, tmdbId: 949 });
  assert.deepEqual(ml([{ id: 949, title: 'Heat', year: '1995' }], m2), []);
});
