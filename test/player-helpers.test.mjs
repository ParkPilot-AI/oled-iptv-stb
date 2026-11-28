import test from 'node:test';
import assert from 'node:assert/strict';
import { channelIndexForNumber } from '../electron/channels.js';

test('typed channel numbers: provider number first, then list position', () => {
  const items = [{ num: 101 }, { num: 104 }, { num: 2 }];
  assert.equal(channelIndexForNumber(items, 104), 1);
  assert.equal(channelIndexForNumber(items, 2), 2); // provider number wins over position 2
  assert.equal(channelIndexForNumber(items, 1), 0); // no channel "1": first in the list
  assert.equal(channelIndexForNumber(items, 999), -1);
  assert.equal(channelIndexForNumber(items, 0), -1);
});
