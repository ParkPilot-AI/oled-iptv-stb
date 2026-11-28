import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncTracker } from '../electron/sync.js';

test('background updates are listed while they run, and removed even on failure', async () => {
  const sent = [];
  const t = createSyncTracker((ch, d) => sent.push([ch, d.tasks.join(',')]));
  let finish;
  const a = t.track('Loading TV guide', new Promise((r) => (finish = r)));
  const b = t.track('Matching channel logos', Promise.reject(new Error('x'))).catch(() => 'failed');
  assert.deepEqual(t.list(), ['Loading TV guide', 'Matching channel logos']);
  assert.equal(await b, 'failed');
  finish(42);
  assert.equal(await a, 42);
  assert.deepEqual(t.list(), []);
  assert.deepEqual(sent.at(-1), ['sync:status', '']);
});
