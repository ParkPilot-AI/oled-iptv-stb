// Household profiles ("Who's watching?"): each person has their own favourites,
// Continue Watching and theme; a Kids profile never shows adult content; any
// profile can be locked with a 4-digit PIN. Pure functions over the stored
// list (persisted by store.js); the renderer only ever sees publicViewer().
import crypto from 'node:crypto';
import path from 'node:path';

export const MAIN = 'main'; // the original profile: its data lives where it always did
export const COLOURS = ['#E50914', '#0A5CFF', '#76B900', '#9146FF', '#FF5A00', '#06B6D4', '#F59E0B', '#EC4899'];
export const MAX_VIEWERS = 8;

export const defaultViewers = () => ({
  activeId: MAIN,
  askOnStart: true,
  list: [{ id: MAIN, name: 'Me', colour: COLOURS[0], kids: false, pinHash: '', theme: null }],
});

export const hashViewerPin = (id, pin) => crypto.createHash('sha256').update(`onyx-viewer-pin:${id}:${pin}`).digest('hex');
const validPin = (pin) => /^\d{4}$/.test(String(pin || ''));
const cleanName = (n) =>
  String(n || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 20);

export const publicViewer = (v) => ({ id: v.id, name: v.name, colour: v.colour, kids: !!v.kids, locked: !!v.pinHash, theme: v.theme || null });
export const publicViewers = (db) => ({ activeId: db.activeId, askOnStart: db.askOnStart !== false, list: db.list.map(publicViewer) });

const find = (db, id) => {
  const v = db.list.find((x) => x.id === id);
  if (!v) throw new Error('Profile not found');
  return v;
};

/** Switching to a profile: its PIN is needed when it has one. */
export function checkViewerPin(db, id, pin) {
  const v = find(db, id);
  if (v.pinHash && hashViewerPin(id, pin) !== v.pinHash) throw new Error('Wrong PIN');
  return v;
}

/**
 * Who may change profiles: not a Kids profile; and a locked profile other than the
 * one in use needs its PIN.
 */
export function assertCanManage(db, targetId, pin) {
  const active = db.list.find((x) => x.id === db.activeId);
  if (active?.kids) throw new Error('Profiles can’t be changed from a Kids profile');
  if (targetId && targetId !== db.activeId) {
    const t = find(db, targetId);
    if (t.pinHash && hashViewerPin(t.id, pin) !== t.pinHash) throw new Error('Wrong PIN');
  }
}

/** Add (no id) or edit a profile's name / Kids flag / theme. Returns the profile. */
export function saveViewer(db, { id, name, kids, theme }) {
  if (!id) {
    if (db.list.length >= MAX_VIEWERS) throw new Error(`Up to ${MAX_VIEWERS} profiles`);
    const n = cleanName(name);
    if (!n) throw new Error('Give the profile a name');
    const used = new Set(db.list.map((v) => v.colour));
    const v = {
      id: crypto.randomBytes(4).toString('hex'),
      name: n,
      colour: COLOURS.find((c) => !used.has(c)) || COLOURS[db.list.length % COLOURS.length],
      kids: !!kids,
      pinHash: '',
      theme: theme || null,
    };
    db.list.push(v);
    return v;
  }
  const v = find(db, id);
  if (name !== undefined) {
    const n = cleanName(name);
    if (!n) throw new Error('Give the profile a name');
    v.name = n;
  }
  if (kids !== undefined) v.kids = !!kids;
  if (theme !== undefined) v.theme = theme || null;
  return v;
}

/** Set or remove a profile's PIN (current PIN needed when one is set). */
export function setViewerPin(db, id, { pin, current }) {
  const v = find(db, id);
  if (v.pinHash && hashViewerPin(id, current) !== v.pinHash) throw new Error('Wrong PIN');
  if (!pin) v.pinHash = '';
  else if (!validPin(pin)) throw new Error('The PIN must be 4 digits');
  else v.pinHash = hashViewerPin(id, pin);
  return v;
}

export function removeViewer(db, id) {
  if (id === MAIN) throw new Error('The first profile can be renamed but not deleted');
  find(db, id);
  db.list = db.list.filter((v) => v.id !== id);
  if (db.activeId === id) db.activeId = MAIN;
}

/** Folder for a profile's documents inside a playlist's folder. */
export function viewerDocDir(playlistDir, viewerId) {
  if (!viewerId || viewerId === MAIN) return playlistDir;
  if (!/^[0-9a-f]{8}$/.test(viewerId)) throw new Error('Bad profile id');
  return path.join(playlistDir, 'viewers', viewerId);
}
