import test from 'node:test';
import assert from 'node:assert/strict';
import { upNextShown, UP_NEXT_AT } from '../src/lib/upnext.js';

const ep = (pos, extra = {}) => ({ kind: 'episode', item: { kind: 'episode', id: 7 }, next: { id: 8 }, dur: 2700, pos, ...extra });

test('Up next card: last 30 s of an episode that has a next one, unless dismissed', () => {
  assert.equal(UP_NEXT_AT, 30);
  assert.equal(upNextShown(ep(2600)), false);
  assert.equal(upNextShown(ep(2671)), true);
  assert.equal(upNextShown(ep(2671), 'episode:7'), false); // Back dismissed it
  assert.equal(upNextShown(ep(2671, { next: null })), false); // last episode
  assert.equal(upNextShown(ep(2671, { kind: 'movie' })), false);
  assert.equal(upNextShown(ep(50, { dur: 60 })), false); // nonsense short duration
  assert.equal(upNextShown(ep(2671, { error: 'x' })), false);
});
