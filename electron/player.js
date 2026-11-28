// Playback session: owns the mpv process for the duration of a viewing session,
// the playlist (channel list for zapping / episode list for auto-advance),
// progress persistence and state broadcasting to the transparent OSD window.
import path from 'node:path';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { Mpv, buildMpvArgs, makeIpcPath, resolveMpvBinary, resolveTool, INPUT_CONF } from './mpv.js';
import { streamUrl } from './xtream.js';
import { pickSubtitle, subStyleProps } from './subs.js';
import { videoProps, audioProps } from './mpvprops.js';
import { describeTrack } from './tracks.js';
import { channelIndexForNumber } from './channels.js';
import { mpvStartArgs } from './trailers.js';
import { getCredentials, getSettings, getDoc, setDoc, peekDoc, dataDir } from './store.js';

const PROGRESS_EVERY_MS = 10000;
const WATCHED_RATIO = 0.92;
const FREEZE_GRAB_MS = 700; // give up on the freeze frame rather than delay the zap

/** Resolve within ms or give null (never throws). */
const within = (p, ms) => Promise.race([p.catch(() => null), new Promise((r) => setTimeout(() => r(null), ms))]);

export class Player {
  /**
   * @param {{ showOsd:()=>void, hideOsd:()=>void, toOsd:(ch:string,data:any)=>void,
   *           onClosed:(summary:any)=>void, resourcesPath:string }} ui
   */
  constructor(ui) {
    this.ui = ui;
    this.mpv = null;
    this.session = null;
    this.state = null;
    this.sendTimer = null;
    this.lastProgressSave = 0;
    this.retries = 0;
    this.starting = null;
    this.windowMode = 'full'; // 'full' | 'dock' (mini-player) | 'peek' (trailer preview)
  }

  get active() {
    return !!this.session;
  }

  async _ensureMpv() {
    if (this.mpv?.alive) return this.mpv;
    const settings = await getSettings();
    const binary = resolveMpvBinary({ customPath: settings.mpvPath, resourcesPath: this.ui.resourcesPath });
    if (!binary) {
      throw new Error('mpv was not found. Install mpv (or place mpv.exe in resources/mpv) or set its path in Settings.');
    }
    const inputConf = path.join(dataDir(), 'mpv-input.conf');
    await fsp.writeFile(inputConf, INPUT_CONF);
    const ipcPath = makeIpcPath();
    const mpv = new Mpv({
      binary,
      ipcPath,
      args: buildMpvArgs({
        ipcPath,
        inputConf,
        hwdec: settings.hwdec,
        deinterlace: settings.deinterlace,
        // Trailers fall back to mpv's ytdl hook; point it at the same yt-dlp.
        extra: mpvStartArgs(resolveTool('yt-dlp', { customPath: settings.ytdlpPath, resourcesPath: this.ui.resourcesPath })),
      }),
    });
    mpv.on('property', (n, v) => this._onProperty(n, v));
    mpv.on('event', (e) => this._onEvent(e));
    mpv.on('client-message', (args) => {
      if (args[0] === 'iptv-key' && args[1] !== 'ignore') {
        // mpv window stole focus: forward key and take focus back.
        this.ui.toOsd('player:key', args[1] === 'Space' ? ' ' : args[1]);
        this.ui.showOsd();
      }
    });
    mpv.on('exit', () => {
      if (this.mpv === mpv) this.mpv = null;
      if (this.session) this.stop({ reason: 'mpv-exit' });
    });
    await mpv.start();
    this.mpv = mpv;
    await this._applyOutputAndStyle(mpv, settings);
    // Freeze frames for channel changes: small, fast JPEGs.
    await mpv.set('screenshot-format', 'jpg').catch(() => {});
    await mpv.set('screenshot-jpeg-quality', 70).catch(() => {});
    return mpv;
  }

  async _applyOutputAndStyle(mpv, settings) {
    const dev = String(settings.audioDevice || 'auto');
    await mpv.set('audio-device', dev.startsWith('mpv:') ? dev.slice(4) : 'auto').catch(() => {});
    const props = { ...subStyleProps(settings), ...videoProps(settings), ...audioProps(settings) };
    for (const [k, v] of Object.entries(props)) await mpv.set(k, v).catch((e) => console.warn(`mpv ${k}:`, e.message));
  }

  async _applySubtitleChoice() {
    const s = this.session;
    if (!this.mpv || !s) return;
    const tracks = await this.mpv.get('track-list').catch(() => null);
    const id = pickSubtitle(tracks, { mode: s.settings.subMode, lang: s.settings.subLang });
    await this.mpv.set('sid', id).catch(() => {});
  }

  /** Settings changed while playing: apply audio output / subtitle prefs live. */
  async applySettings(settings) {
    if (this.session) this.session.settings = settings;
    if (!this.mpv) return;
    await this._applyOutputAndStyle(this.mpv, settings);
    await this._applySubtitleChoice();
  }

  async volume(action) {
    if (!this.mpv) return null;
    if (action === 'mute') await this.mpv.command('cycle', 'mute');
    else await this.mpv.command('add', 'volume', action === 'up' ? 5 : -5);
    const [volume, muted] = await Promise.all([this.mpv.get('volume'), this.mpv.get('mute')]);
    return { volume: Math.round(Math.min(100, volume)), muted: !!muted };
  }

  /** Start a session. items: [{kind,id,name,ext,...}], index: start position. */
  async play({ profileId, items, index = 0, resume = true, mode = 'full' }) {
    if (!items?.length) throw new Error('Nothing to play');
    // One stream at a time (most providers allow 1–2 connections): whatever is
    // playing — full screen, mini-player or preview — is replaced, never doubled.
    if (this.session) {
      this._saveProgress();
      this.ui.onClosed({ reason: 'replaced', profileId: this.session.profileId, item: this.state?.item, index: this.session.index });
    }
    const creds = items.every((it) => it.kind === 'trailer') ? null : await getCredentials(profileId);
    const settings = await getSettings();
    const progress = await getDoc(profileId, 'progress');
    this.session = { profileId, creds, settings, items, index, progress };
    try {
      await this._ensureMpv();
    } catch (e) {
      this.session = null;
      throw e;
    }
    await this.setWindow(mode);
    await this._loadCurrent({ resume });
  }

  /**
   * Where the video goes: 'full' (full screen with the overlay), 'dock' (mini-player
   * in the corner while browsing) or 'peek' (floating trailer preview). The same mpv
   * keeps playing, so there's never a second stream.
   */
  async setWindow(mode) {
    const mpv = this.mpv;
    this.windowMode = mode;
    if (mpv) {
      if (mode === 'full') {
        await mpv.set('ontop', false).catch(() => {});
        await mpv.set('fullscreen', true).catch(() => {});
      } else {
        await mpv.set('fullscreen', false).catch(() => {});
        await mpv.set('geometry', this.ui.pipGeometry(mode)).catch(() => {});
        await mpv.set('ontop', true).catch(() => {});
      }
    }
    if (mode === 'full') this.ui.showOsd();
    else this.ui.windowed(mode, this.state?.item || this.session?.items[this.session.index]);
    if (this.state) {
      this.state.window = mode;
      this._broadcast(true);
    }
  }

  /**
   * Live TV zapping: grab the current picture so the overlay can keep showing it
   * (dimmed, with a small spinner) while the next channel connects, instead of a
   * black screen. Returns a data: URL, or null if it isn't quick enough.
   */
  async _grabFrame() {
    const st = this.state;
    if (!this.mpv || !st || st.kind !== 'live' || st.buffering || st.error) return null;
    const file = path.join(os.tmpdir(), `onyx-freeze-${process.pid}.jpg`);
    const ok = await within(
      this.mpv.command('screenshot-to-file', file, 'video').then(() => true),
      FREEZE_GRAB_MS
    );
    if (!ok) return null;
    try {
      const buf = await fsp.readFile(file);
      fsp.rm(file, { force: true }).catch(() => {});
      return buf.length ? `data:image/jpeg;base64,${buf.toString('base64')}` : null;
    } catch {
      return null;
    }
  }

  async _zapTo(index) {
    const freeze = await this._grabFrame();
    this.session.index = index;
    return this._loadCurrent({ resume: true, freeze });
  }

  async _loadCurrent({ resume = true, autoNext = false, freeze = null } = {}) {
    const s = this.session;
    const item = s.items[s.index];
    const url = this._urlFor(item);
    const saved = item.kind === 'trailer' ? null : s.progress[`${item.kind}:${item.id}`];
    const start = resume && item.kind !== 'live' && saved && !saved.watched && saved.pos > 15 ? saved.pos - 5 : null;
    this.retries = 0;
    this.state = {
      active: true,
      profileId: s.profileId,
      osdTimeoutSec: s.settings.osdTimeoutSec,
      theme: s.settings.theme,
      screensaverMin: s.settings.screensaverMin,
      overscan: s.settings.overscan || 0,
      kind: item.kind,
      index: s.index,
      total: s.items.length,
      item,
      pos: start || 0,
      dur: item.duration || 0,
      paused: false,
      buffering: true,
      cacheSecs: 0,
      info: {},
      tracks: { audio: [], sub: [], aid: null, sid: null },
      error: null,
      autoNext,
      window: this.windowMode,
      pipOnBack: s.settings.pipOnBack !== false,
      freeze, // last picture of the previous channel, shown until this one starts
      next: item.kind === 'episode' && s.items[s.index + 1] ? s.items[s.index + 1] : null,
      loadedAt: Date.now(),
    };
    this._broadcast(true);
    await this.mpv.set('pause', false).catch(() => {});
    await this.mpv.set('sid', 'no').catch(() => {}); // chosen on file-loaded from the user's prefs
    await this._prepareTrailer(item);
    await this.mpv.load(url, { start });
  }

  _urlFor(item) {
    if (item.kind === 'trailer') return item.load.url;
    return streamUrl(this.session.creds, item, { liveFormat: this.session.settings.liveFormat });
  }

  /**
   * Trailers come as separate video + audio streams: the audio is attached through
   * the audio-files option before loadfile (works the same on mpv < 0.38 and ≥ 0.38,
   * whose loadfile gained an index argument before the per-file options).
   */
  async _prepareTrailer(item) {
    const t = item.kind === 'trailer' ? item.load : null;
    if (t?.audio) await this.mpv.command('change-list', 'audio-files', 'set', t.audio).catch(() => {});
    else await this.mpv.command('change-list', 'audio-files', 'clr', '').catch(() => {});
    for (const [k, v] of t?.props || []) await this.mpv.set(k, v).catch(() => {});
  }

  _onProperty(name, v) {
    const st = this.state;
    if (!st) return;
    const info = st.info;
    switch (name) {
      case 'time-pos':
        if (typeof v === 'number') {
          st.pos = v;
          if (v > 5) this.retries = 0;
          this._maybeSaveProgress();
        }
        break;
      case 'duration':
        if (typeof v === 'number') st.dur = v;
        break;
      case 'pause':
        st.paused = !!v;
        return this._broadcast(true);
      case 'paused-for-cache':
        st.buffering = !!v;
        return this._broadcast(true);
      case 'demuxer-cache-duration':
        st.cacheSecs = typeof v === 'number' ? v : 0;
        break;
      case 'video-params':
        if (v) Object.assign(info, { width: v.w, height: v.h, pixfmt: v.pixelformat || v['hw-pixelformat'], colormatrix: v.colormatrix, gamma: v.gamma });
        break;
      case 'video-codec':
        info.vcodec = v;
        break;
      case 'audio-codec-name':
        info.acodec = v;
        break;
      case 'audio-params':
        if (v) info.channels = v['hr-channels'] || v.channels;
        break;
      case 'estimated-vf-fps':
        if (v) info.fps = v;
        break;
      case 'container-fps':
        if (v && !info.fps) info.fps = v;
        break;
      case 'video-bitrate':
        info.vbitrate = v;
        break;
      case 'audio-bitrate':
        info.abitrate = v;
        break;
      case 'hwdec-current':
        info.hwdec = v || 'no';
        break;
      case 'track-list':
        if (Array.isArray(v)) {
          const map = (t) => ({ id: t.id, lang: t.lang || '', title: t.title || '', codec: t.codec || '', selected: !!t.selected });
          st.tracks.audio = v.filter((t) => t.type === 'audio').map(map);
          st.tracks.sub = v.filter((t) => t.type === 'sub').map(map);
        }
        break;
      default:
        return;
    }
    this._broadcast(false);
  }

  _onEvent(e) {
    const st = this.state;
    if (!this.session || !st) return;
    if (e.event === 'playback-restart' && st.freeze) {
      // First picture of the new channel is up: drop the freeze frame.
      st.freeze = null;
      this._broadcast(true);
    } else if (e.event === 'file-loaded') {
      st.buffering = false;
      st.error = null;
      this._broadcast(true);
      this._applySubtitleChoice();
    } else if (e.event === 'end-file') {
      if (e.reason === 'eof') this._onEof();
      else if (e.reason === 'error') this._onError(e.file_error || 'playback error');
    }
  }

  async _onEof() {
    const s = this.session;
    const item = s.items[s.index];
    if (item.kind === 'live') return this._onError('stream ended');
    if (item.kind === 'trailer') return this.stop({ reason: 'ended' }); // back to the detail page
    // Providers often just close the connection mid-film, which mpv reports as
    // end-of-file. Only treat it as finished near the real end; otherwise reconnect.
    const st = this.state;
    const nearEnd = st.dur > 0 ? st.pos >= st.dur * WATCHED_RATIO || st.dur - st.pos < 90 : false;
    if (!nearEnd) return this._onError('connection dropped');
    this._saveProgress({ watched: true });
    if (item.kind === 'episode' && s.index + 1 < s.items.length) {
      this._markUpNext(s.items[s.index + 1]);
      s.index++;
      await this._loadCurrent({ resume: false, autoNext: true });
    } else {
      this.stop({ reason: 'ended' });
    }
  }

  async _onError(msg) {
    const st = this.state;
    if (this.retries < 3) {
      this.retries++;
      st.buffering = true;
      st.error = null;
      this._broadcast(true);
      setTimeout(() => {
        if (this.state === st) {
          this.mpv?.load(this._urlFor(st.item), { start: st.kind === 'live' ? null : st.pos }).catch(() => {});
        }
      }, 1500 * this.retries);
      return;
    }
    st.error = `Stream unavailable (${msg})`;
    st.buffering = false;
    st.freeze = null;
    this._broadcast(true);
  }

  _broadcast(immediate) {
    if (immediate) {
      clearTimeout(this.sendTimer);
      this.sendTimer = null;
      this.ui.toOsd('player:state', this.state);
      return;
    }
    if (this.sendTimer) return;
    this.sendTimer = setTimeout(() => {
      this.sendTimer = null;
      if (this.state) this.ui.toOsd('player:state', this.state);
    }, 250);
  }

  _maybeSaveProgress() {
    if (Date.now() - this.lastProgressSave > PROGRESS_EVERY_MS) this._saveProgress();
  }

  _saveProgress({ watched = false } = {}) {
    const s = this.session;
    const st = this.state;
    if (!s || !st || st.kind === 'live' || st.kind === 'trailer' || !st.pos) return; // trailers never count
    this.lastProgressSave = Date.now();
    const dur = st.dur > st.pos ? st.dur : 0; // ignore nonsense durations from some streams
    const key = `${st.kind}:${st.item.id}`;
    const entry = {
      key,
      pos: Math.floor(st.pos),
      dur: Math.floor(dur),
      watched: watched || (dur > 120 && st.pos / dur >= WATCHED_RATIO),
      updatedAt: Date.now(),
      item: st.item,
    };
    // Always update the *current* document (the UI may have replaced it, e.g. "Play from start").
    const doc = peekDoc(s.profileId, 'progress') || s.progress;
    if (doc[key]?.upNext && !entry.watched && entry.pos <= 30) entry.upNext = true; // still "up next"
    // Stopping right after the end must not un-finish it.
    if (doc[key]?.watched && !entry.watched && Math.abs(doc[key].pos - entry.pos) < 10) entry.watched = true;
    const next = { ...doc, [key]: entry };
    s.progress = next;
    setDoc(s.profileId, 'progress', next).catch((e) => console.error('progress save failed', e));
  }

  /** Finished an episode: the next one shows in Continue Watching even before it's started. */
  _markUpNext(next) {
    const s = this.session;
    const key = `${next.kind}:${next.id}`;
    const doc = peekDoc(s.profileId, 'progress') || s.progress;
    if (doc[key] && (doc[key].pos > 0 || doc[key].watched)) return;
    const updated = { ...doc, [key]: { key, pos: 0, dur: 0, watched: false, upNext: true, updatedAt: Date.now() + 1, item: next } };
    s.progress = updated;
    setDoc(s.profileId, 'progress', updated).catch(() => {});
  }

  async command(cmd) {
    const mpv = this.mpv;
    const s = this.session;
    if (!mpv || !s) return;
    switch (cmd.type) {
      case 'toggle-pause':
        return mpv.command('cycle', 'pause');
      case 'seek':
        if (this.state.kind !== 'live') return mpv.command('seek', cmd.seconds, 'relative+exact');
        return;
      case 'seek-abs':
        return mpv.command('seek', cmd.seconds, 'absolute');
      case 'zap':
      case 'jump': {
        if (s.items.length < 2 && cmd.type === 'zap') return;
        this._saveProgress();
        const n = s.items.length;
        return this._zapTo(cmd.type === 'zap' ? (s.index + cmd.delta + n) % n : Math.max(0, Math.min(n - 1, cmd.index)));
      }
      case 'jump-num': {
        const target = channelIndexForNumber(s.items, cmd.num);
        if (target < 0 || target === s.index) return;
        return this._zapTo(target);
      }
      case 'cycle-audio':
      case 'cycle-sub': {
        // Returns e.g. { message: 'Audio: English · AC3 5.1 (2/3)' } for the OSD to show.
        const type = cmd.type === 'cycle-audio' ? 'audio' : 'sub';
        if (type === 'audio') {
          // Step through the audio tracks only — never to "no audio".
          const before = (await mpv.get('track-list').catch(() => [])).filter((t) => t.type === 'audio');
          const i = before.findIndex((t) => t.selected);
          if (before.length) await mpv.set('aid', before[(i + 1) % before.length].id);
        } else {
          await mpv.command('cycle', 'sid'); // includes "off"
        }
        const tracks = await mpv.get('track-list').catch(() => []);
        return { message: describeTrack(tracks, type) };
      }
      case 'volume':
        return mpv.command('add', 'volume', cmd.delta);
      case 'stop':
        return this.stop({ reason: 'user' });
      case 'dock':
        return this.setWindow('dock');
      case 'undock':
        return this.setWindow('full');
    }
  }

  async stop({ reason = 'user' } = {}) {
    if (!this.session) return;
    this._saveProgress();
    const summary = { reason, profileId: this.session.profileId, item: this.state?.item, index: this.session.index, window: this.windowMode };
    this.windowMode = 'full';
    this.session = null;
    this.state = null;
    clearTimeout(this.sendTimer);
    this.sendTimer = null;
    this.ui.toOsd('player:state', { active: false });
    const mpv = this.mpv;
    this.mpv = null;
    this.ui.hideOsd();
    this.ui.onClosed(summary);
    await mpv?.quit().catch(() => mpv.kill());
  }

  dispose() {
    this._saveProgress();
    this.mpv?.kill();
  }
}
