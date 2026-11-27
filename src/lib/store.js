// Tiny global store (useSyncExternalStore) + catalog indexing, favorites,
// progress and playback helpers.
import { useSyncExternalStore } from 'react';
import { api } from './api.js';

let state = {
  boot: 'loading', // loading | login | catalog | ready
  profiles: { activeId: null, list: [], secureStorage: true },
  profileId: null,
  account: null,
  settings: null,
  catalog: null, // indexed catalog (see indexCatalog)
  catalogStatus: { stage: '', error: null },
  epgVersion: 0,
  epgStatus: '',
  favorites: { live: [], movie: [], series: [] },
  progress: {},
  section: 'home',
  detail: null, // {kind:'movie'|'series', item}
  toast: null,
  confirm: null,
};
const subs = new Set();
export const getState = () => state;
export function setState(patch) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  subs.forEach((f) => f());
}
const subscribe = (f) => (subs.add(f), () => subs.delete(f));
export const useStore = (sel) => useSyncExternalStore(subscribe, () => sel(state));

// ---------- helpers ----------
export const normText = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Strip renderer-only fields before sending items over IPC / to disk. */
export const clean = ({ _s, ...it }) => it;

function indexSection(sec, sortFn) {
  const byCat = new Map();
  const items = sortFn ? [...sec.items].sort(sortFn) : sec.items;
  for (const it of items) {
    it._s = normText(it.name);
    let a = byCat.get(it.cat);
    if (!a) byCat.set(it.cat, (a = []));
    a.push(it);
  }
  const known = new Set(sec.categories.map((c) => c.id));
  const cats = sec.categories.filter((c) => byCat.has(c.id)).map((c) => ({ ...c, count: byCat.get(c.id).length }));
  const orphans = items.filter((i) => !known.has(i.cat));
  if (orphans.length) {
    byCat.set('__other', orphans);
    cats.push({ id: '__other', name: 'Other', count: orphans.length });
  }
  let recent = null;
  return {
    items,
    cats,
    byCat,
    get recent() {
      return (recent ||= [...items].sort((a, b) => b.added - a.added).slice(0, 200));
    },
  };
}

function indexCatalog(raw) {
  return {
    fetchedAt: raw.fetchedAt,
    live: indexSection(raw.live, (a, b) => (a.num || 1e9) - (b.num || 1e9)),
    vod: indexSection(raw.vod),
    series: indexSection(raw.series),
  };
}

// ---------- toasts / confirm ----------
let toastTimer;
export function toast(message, ms = 2600) {
  clearTimeout(toastTimer);
  setState({ toast: { message, id: Date.now() } });
  toastTimer = setTimeout(() => setState({ toast: null }), ms);
}
export const confirmDialog = (opts) =>
  new Promise((resolve) => setState({ confirm: { ...opts, resolve } }));

// ---------- boot / profiles ----------
export async function boot() {
  const [profiles, settings] = await Promise.all([api.invoke('profiles:list'), api.invoke('settings:get')]);
  applyAccent(settings.accent);
  applyScreenFit(settings.overscan);
  setState({ profiles, settings });
  if (profiles.activeId && profiles.list.some((p) => p.id === profiles.activeId)) {
    await activateProfile(profiles.activeId);
  } else setState({ boot: 'login' });
}

export function applyAccent(color) {
  document.documentElement.style.setProperty('--accent', color || '#3B82F6');
}

/** Overscan margin per edge (0, 0.025, 0.05, 0.075) for TVs that crop the picture. */
export function applyScreenFit(safe) {
  document.documentElement.style.setProperty('--safe', String(Number(safe) || 0));
}

export async function refreshProfiles() {
  setState({ profiles: await api.invoke('profiles:list') });
}

export async function activateProfile(id, { force = false } = {}) {
  setState({ boot: 'catalog', profileId: id, catalogStatus: { stage: 'Connecting…', error: null } });
  try {
    const account = await api.invoke('profiles:activate', id);
    const [raw, favorites, progress] = await Promise.all([
      api.invoke('catalog:load', { profileId: id, force }),
      api.invoke('doc:get', { profileId: id, name: 'favorites' }),
      api.invoke('doc:get', { profileId: id, name: 'progress' }),
    ]);
    setState({
      account,
      catalog: indexCatalog(raw),
      favorites: { live: [], movie: [], series: [], ...favorites },
      progress: progress || {},
      boot: 'ready',
      section: 'home',
      detail: null,
    });
    loadEpg(id);
  } catch (e) {
    setState({ catalogStatus: { stage: '', error: e.message } });
  }
}

export async function loadEpg(profileId, force = false) {
  setState({ epgStatus: 'Loading guide…' });
  try {
    const r = await api.invoke('epg:load', { profileId, force });
    setState((s) => ({ epgStatus: `${r.channels} channels with guide data`, epgVersion: s.epgVersion + 1 }));
  } catch (e) {
    setState({ epgStatus: `Guide unavailable: ${e.message}` });
  }
}

export function signOut() {
  setState({ boot: 'login', profileId: null, catalog: null, detail: null });
}

// Background events from main
api.on('catalog:progress', (p) => {
  const label = { categories: 'Loading categories…', streams: 'Loading channels…', movies: `Loading movies & series… (${p.live ?? ''} channels)` }[p.stage];
  if (label) setState({ catalogStatus: { stage: label, error: null } });
});
api.on('catalog:updated', ({ profileId, catalog, silent }) => {
  if (profileId === state.profileId) {
    setState({ catalog: indexCatalog(catalog) });
    if (!silent) toast('Playlist updated');
  }
});

/** Re-read the (cached) catalog, e.g. after changing the channel-logo setting. */
export async function reloadCatalog() {
  const raw = await api.invoke('catalog:load', { profileId: state.profileId });
  setState({ catalog: indexCatalog(raw) });
}
api.on('epg:progress', (p) => p.mb && setState({ epgStatus: `Loading guide… ${p.mb} MB` }));
api.on('epg:updated', () => setState((s) => ({ epgVersion: s.epgVersion + 1 })));
api.on('player:closed', async () => {
  const pid = state.profileId;
  if (!pid) return;
  const [progress, favorites] = await Promise.all([
    api.invoke('doc:get', { profileId: pid, name: 'progress' }),
    api.invoke('doc:get', { profileId: pid, name: 'favorites' }),
  ]);
  setState({ progress: progress || {}, favorites: { live: [], movie: [], series: [], ...favorites } });
});

// ---------- favorites ----------
export const favKind = (item) => (item.kind === 'live' ? 'live' : item.kind === 'series' ? 'series' : 'movie');
export const isFavorite = (favs, item) => !!item && favs[favKind(item)]?.some((f) => f.id === item.id);

export function toggleFavorite(item) {
  if (!item || !['live', 'movie', 'series'].includes(item.kind)) return;
  const k = favKind(item);
  const favs = state.favorites;
  const on = isFavorite(favs, item);
  const next = { ...favs, [k]: on ? favs[k].filter((f) => f.id !== item.id) : [clean(item), ...favs[k]] };
  setState({ favorites: next });
  api.invoke('doc:set', { profileId: state.profileId, name: 'favorites', data: next });
  toast(on ? `Removed “${item.name}” from Favorites` : `Added “${item.name}” to Favorites`);
}

/** Registry so the global F key can find the item behind the focused element. */
export const favRegistry = new Map();
export const favKey = (item) => `${item.kind}:${item.id}`;

// ---------- progress / continue watching ----------
export function continueWatching(progress) {
  const list = Object.values(progress)
    .filter((p) => p.item && !p.watched && (p.pos > 30 || p.upNext))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const seen = new Set();
  return list.filter((p) => {
    const k = p.item.kind === 'episode' ? `s${p.item.seriesId}` : `m${p.item.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------- playback ----------
export async function play(items, index = 0) {
  try {
    await api.invoke('player:play', { profileId: state.profileId, items: items.map(clean), index });
  } catch (e) {
    toast(e.message, 6000);
  }
}

export function openItem(item, list) {
  if (item.kind === 'live') {
    const items = list?.length ? list : [item];
    const idx = Math.max(0, items.findIndex((i) => i.id === item.id));
    return play(items, idx);
  }
  if (item.kind === 'movie' || item.kind === 'series') return setState({ detail: { kind: item.kind, item } });
}

/** Build a flat playlist of episodes for auto-advance. */
export function episodePlaylist(info, series) {
  return info.seasons.flatMap((s) =>
    s.episodes.map((e) => ({
      ...e,
      seriesId: series.id,
      seriesName: series.name,
      seriesIcon: series.icon || info.icon,
    }))
  );
}

export async function resumeEntry(entry) {
  const it = entry.item;
  if (it.kind === 'movie') return play([it]);
  try {
    const series = { id: it.seriesId, name: it.seriesName, icon: it.seriesIcon };
    const info = await api.invoke('series:info', { profileId: state.profileId, item: series });
    const list = episodePlaylist(info, series);
    const idx = list.findIndex((e) => e.id === it.id);
    return play(idx >= 0 ? list : [it], Math.max(0, idx));
  } catch {
    return play([it]);
  }
}

// ---------- power ----------
/** "Power Off": shuts the set-top box down (closes the app on a normal PC). */
export async function powerOff() {
  const info = await api.invoke('app:info').catch(() => ({}));
  const box = !!info?.updater;
  const ok = await confirmDialog({
    title: 'Power off?',
    message: box ? 'The box will shut down. Press its power button to turn it back on.' : 'ONYX will close.',
    confirmLabel: 'Power Off',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.invoke('system:poweroff');
  } catch (e) {
    toast(`Couldn't power off: ${e.message}`, 6000);
  }
}
