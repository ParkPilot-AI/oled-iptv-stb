import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as V from '../electron/viewers.js';

test('profiles: add, colours, kids, PIN lock, remove', () => {
  const db = V.defaultViewers();
  const kid = V.saveViewer(db, { name: '  Sam  ', kids: true });
  assert.equal(kid.name, 'Sam');
  assert.notEqual(kid.colour, db.list[0].colour);
  assert.throws(() => V.saveViewer(db, { name: '   ' }), /name/);
  const mum = V.saveViewer(db, { name: 'Mum' });
  V.setViewerPin(db, mum.id, { pin: '1234' });
  assert.equal(V.publicViewers(db).list.find((v) => v.id === mum.id).locked, true);
  assert.ok(!('pinHash' in V.publicViewers(db).list[0]));
  assert.throws(() => V.checkViewerPin(db, mum.id, '0000'), /Wrong PIN/);
  assert.equal(V.checkViewerPin(db, mum.id, '1234').id, mum.id);
  assert.throws(() => V.setViewerPin(db, mum.id, { pin: '', current: '9' }), /Wrong PIN/);
  assert.throws(() => V.removeViewer(db, V.MAIN), /not be deleted|can be renamed/);
  db.activeId = kid.id;
  V.removeViewer(db, kid.id);
  assert.equal(db.activeId, V.MAIN);
});

test('who may manage: never from a Kids profile; other locked profiles need their PIN', () => {
  const db = V.defaultViewers();
  const kid = V.saveViewer(db, { name: 'Sam', kids: true });
  const mum = V.saveViewer(db, { name: 'Mum' });
  V.setViewerPin(db, mum.id, { pin: '4321' });
  db.activeId = kid.id;
  assert.throws(() => V.assertCanManage(db, kid.id), /Kids/);
  db.activeId = V.MAIN;
  assert.throws(() => V.assertCanManage(db, mum.id, '1111'), /Wrong PIN/);
  assert.doesNotThrow(() => V.assertCanManage(db, mum.id, '4321'));
  db.activeId = mum.id;
  assert.doesNotThrow(() => V.assertCanManage(db, mum.id)); // your own profile, already unlocked
});

test('documents: the first profile keeps the existing files, others get their own folder', () => {
  assert.equal(V.viewerDocDir('/d/p1', V.MAIN), '/d/p1');
  assert.equal(V.viewerDocDir('/d/p1', 'a1b2c3d4'), path.join('/d/p1', 'viewers', 'a1b2c3d4'));
  assert.throws(() => V.viewerDocDir('/d/p1', '../x'), /Bad profile/);
});
