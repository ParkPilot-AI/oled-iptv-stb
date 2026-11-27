// Playback session: owns the mpv process for the duration of a viewing session,
// the playlist (channel list for zapping / episode list for auto-advance),
// progress persistence and state broadcasting to the transparent OSD window.
import path from 'node:path';
import fsp from 'node:fs/promises';
import { Mpv, buildMpvArgs, makeIpcPath, resolveMpvBinary, INPUT_CONF } from './mpv.js';
import { streamUrl } from './xtream.js';
import { getCredentials, getSettings, getDoc, setDoc, dataDir } from './store.js';

const PROGRESS_EVERY_MS = 10000;
const WATCHED_RATIO = 0.92;

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
  }

  get active() {
    return !!this.session;
  }

  async _ensureMpv() {
    if (this.mpv?.alive) return this.mpv;
    const settings = await getSettings();
    const binary = resolveMpvBinary({ customPath: settings.mpvPath, resourcesPath: this.ui.resourcesPath });
    if (!binary) {
      throw new Error(
        'mpv was not found. Install mpv (or place mpv.exe in resources/mpv) or set its path in Settings.'
      );
    }
    const inputConf = path.join(dataDir(), 'mpv-input.conf');
    await fsp.writeFile(inputConf, INPUT_CONF);
    const ipcPath = makeIpcPath();
    const mpv = new Mpv({
      binary,
      ipcPath,
      args: buildMpvArgs({ ipcPath, inputConf, hwdec: settings.hwdec, deinterlace: settings.deinterlace }),
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
    return mpv;
  }

  /** Start a session. items: [{kind,id,name,ext,...}], index: start position. */
  async play({ profileId, items, index = 0, resume = true }) {
    if (!items?.length) throw new Error('Nothing to play');
    const creds = await getCredentials(profileId);
    const settings = await getSettings();
    const progress = await getDoc(profileId, 'progress');
    this.session = { profileId, creds, settings, items, index, progress };
    try {
      await this._ensureMpv();
    } catch (e) {
      this.session = null;
      throw e;
    }
    this.ui.showOsd();
    await this._loadCurrent({ resume });
  }

  async _loadCurrent({ resume = true, autoNext = false } = {}) {
    const s = this.session;
    const item = s.items[s.index];
    const url = streamUrl(s.creds, item, { liveFormat: s.settings.liveFormat });
    const saved = s.progress[`${item.kind}:${item.id}`];
    const start = resume && item.kind !== 'live' && saved && !saved.watched && saved.pos > 15 ? saved.pos - 5 : null;
    this.retries = 0;
    this.state = {
      active: true,
      profileId: s.profileId,
      osdTimeoutSec: s.settings.osdTimeoutSec,
      screensaverMin: s.settings.screensaverMin,
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
      loadedAt: Date.now(),
    };
    this._broadcast(true);
    await this.mpv.set('pause', false).catch(() => {});
    await this.mpv.load(url, { start });
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
    if (e.event === 'file-loaded') {
      st.buffering = false;
      st.error = null;
      this._broadcast(true);
    } else if (e.event === 'end-file') {
      if (e.reason === 'eof') this._onEof();
      else if (e.reason === 'error') this._onError(e.file_error || 'playback error');
    }
  }

  async _onEof() {
    const s = this.session;
    const item = s.items[s.index];
    if (item.kind === 'live') return this._onError('stream ended');
    this._saveProgress({ watched: true });
    if (item.kind === 'episode' && s.index + 1 < s.items.length) {
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
          const url = streamUrl(this.session.creds, st.item, { liveFormat: this.session.settings.liveFormat });
          this.mpv?.load(url, { start: st.kind === 'live' ? null : st.pos }).catch(() => {});
        }
      }, 1500 * this.retries);
      return;
    }
    st.error = `Stream unavailable (${msg})`;
    st.buffering = false;
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
    if (!s || !st || st.kind === 'live' || !st.pos) return;
    this.lastProgressSave = Date.now();
    const dur = st.dur || 0;
    const key = `${st.kind}:${st.item.id}`;
    s.progress[key] = {
      key,
      pos: Math.floor(st.pos),
      dur: Math.floor(dur),
      watched: watched || (dur > 0 && st.pos / dur >= WATCHED_RATIO),
      updatedAt: Date.now(),
      item: st.item,
    };
    setDoc(s.profileId, 'progress', s.progress);
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
        s.index = cmd.type === 'zap' ? (s.index + cmd.delta + n) % n : Math.max(0, Math.min(n - 1, cmd.index));
        return this._loadCurrent({ resume: true });
      }
      case 'jump-num': {
        const idx = s.items.findIndex((it) => it.num === cmd.num);
        const target = idx >= 0 ? idx : cmd.num - 1;
        if (target < 0 || target >= s.items.length || target === s.index) return;
        s.index = target;
        return this._loadCurrent({ resume: true });
      }
      case 'cycle-audio':
        return mpv.command('cycle', 'aid');
      case 'cycle-sub':
        return mpv.command('cycle', 'sid');
      case 'volume':
        return mpv.command('add', 'volume', cmd.delta);
      case 'stop':
        return this.stop({ reason: 'user' });
    }
  }

  async stop({ reason = 'user' } = {}) {
    if (!this.session) return;
    this._saveProgress();
    const summary = { reason, profileId: this.session.profileId, item: this.state?.item, index: this.session.index };
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
