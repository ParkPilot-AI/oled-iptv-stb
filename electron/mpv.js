// mpv process controller over the JSON IPC protocol
// (https://mpv.io/manual/stable/#json-ipc). No Electron imports: testable in plain Node.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

let ipcSeq = 0;
export function makeIpcPath() {
  const id = `oled-iptv-mpv-${process.pid}-${++ipcSeq}`;
  return process.platform === 'win32' ? `\\\\.\\pipe\\${id}` : path.join(os.tmpdir(), `${id}.sock`);
}

/** Resolve the mpv binary: custom setting → bundled resource → PATH. */
export function resolveMpvBinary({ customPath, resourcesPath } = {}) {
  const exe = process.platform === 'win32' ? 'mpv.exe' : 'mpv';
  const candidates = [];
  if (customPath) candidates.push(customPath);
  if (resourcesPath) candidates.push(path.join(resourcesPath, 'mpv', exe));
  // Dev mode: resources/mpv/<os>/ inside the repo.
  candidates.push(path.join(process.cwd(), 'resources', 'mpv', process.platform === 'win32' ? 'win' : 'linux', exe));
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const d of dirs) {
    const p = path.join(d, exe);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Keys pressed while the mpv window has focus are routed back to the app. */
export const INPUT_CONF = [
  ['UP', 'ArrowUp'], ['DOWN', 'ArrowDown'], ['LEFT', 'ArrowLeft'], ['RIGHT', 'ArrowRight'],
  ['ENTER', 'Enter'], ['KP_ENTER', 'Enter'], ['ESC', 'Escape'], ['BS', 'Backspace'],
  ['SPACE', ' '], ['PGUP', 'PageUp'], ['PGDWN', 'PageDown'],
  ['CHANNEL_UP', 'ChannelUp'], ['CHANNEL_DOWN', 'ChannelDown'],
  ['PLAYPAUSE', 'MediaPlayPause'], ['PLAY', 'MediaPlayPause'], ['PAUSE', 'MediaPlayPause'],
  ['NEXT', 'MediaTrackNext'], ['PREV', 'MediaTrackPrevious'], ['STOP', 'MediaStop'],
  ['f', 'f'], ['F', 'f'], ['i', 'i'], ['I', 'i'], ['a', 'a'], ['s', 's'],
  ...'0123456789'.split('').map((d) => [d, d]),
  ['VOLUME_UP', 'AudioVolumeUp'], ['VOLUME_DOWN', 'AudioVolumeDown'], ['MUTE', 'AudioVolumeMute'],
  ['CLOSE_WIN', 'Escape'],
  ['MBTN_LEFT', 'ignore'], ['MBTN_LEFT_DBL', 'ignore'], ['WHEEL_UP', 'ignore'], ['WHEEL_DOWN', 'ignore'],
]
  .map(([k, v]) => `${k} script-message iptv-key "${v === ' ' ? 'Space' : v}"`)
  .join('\n');

export function buildMpvArgs({ ipcPath, inputConf, hwdec = 'auto-safe', deinterlace = false, extra = [] }) {
  return [
    '--no-config', // deterministic: ignore any user mpv.conf/scripts
    `--input-ipc-server=${ipcPath}`,
    ...(inputConf ? [`--input-conf=${inputConf}`] : []),
    '--no-input-default-bindings',
    '--idle=yes',
    '--force-window=yes',
    '--keep-open=no',
    '--fullscreen',
    '--border=no',
    '--title=ONYX',
    `--hwdec=${hwdec}`,
    '--vo=gpu',
    '--osc=no',
    '--osd-level=0',
    '--osd-bar=no',
    '--cursor-autohide=always',
    '--input-cursor=no',
    '--terminal=no',
    '--msg-level=all=warn',
    '--cache=yes',
    '--demuxer-max-bytes=256MiB',
    '--demuxer-max-back-bytes=64MiB',
    '--demuxer-readahead-secs=20',
    '--network-timeout=20',
    `--user-agent=OLED-IPTV/1.0 (mpv)`,
    '--stream-lavf-o=reconnect=1,reconnect_streamed=1,reconnect_delay_max=5',
    `--deinterlace=${deinterlace ? 'yes' : 'no'}`,
    '--audio-channels=auto-safe', // pass-through-friendly AC3/EAC3 downmix when needed
    ...extra,
  ];
}

export const OBSERVED = [
  'time-pos', 'duration', 'pause', 'paused-for-cache', 'cache-buffering-state', 'idle-active',
  'video-params', 'video-codec', 'audio-codec-name', 'audio-params', 'estimated-vf-fps', 'container-fps',
  'video-bitrate', 'audio-bitrate', 'hwdec-current', 'track-list', 'demuxer-cache-duration',
  'media-title', 'aid', 'sid', 'volume', 'mute', 'eof-reached',
];

export class Mpv extends EventEmitter {
  constructor({ binary, args, ipcPath }) {
    super();
    this.binary = binary;
    this.args = args;
    this.ipcPath = ipcPath;
    this.proc = null;
    this.sock = null;
    this.reqId = 0;
    this.pending = new Map();
    this.buf = '';
    this.alive = false;
  }

  async start({ connectTimeoutMs = 8000 } = {}) {
    if (process.platform !== 'win32') fs.rmSync(this.ipcPath, { force: true });
    this.proc = spawn(this.binary, this.args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: false });
    this.alive = true;
    let stderr = '';
    this.proc.stderr.on('data', (d) => {
      stderr = (stderr + d).slice(-4000);
      this.emit('log', String(d));
    });
    const exited = new Promise((_, rej) =>
      this.proc.once('exit', (code) => {
        this.alive = false;
        this._failAll(new Error('mpv exited'));
        this.emit('exit', code);
        rej(new Error(`mpv exited (code ${code}) before IPC was ready: ${stderr.trim().slice(-400)}`));
      })
    );
    this.proc.once('error', (e) => this.emit('error', e));
    exited.catch(() => {});

    const deadline = Date.now() + connectTimeoutMs;
    const tryConnect = () =>
      new Promise((resolve, reject) => {
        const s = net.connect(this.ipcPath);
        s.once('connect', () => resolve(s));
        s.once('error', reject);
      });
    for (;;) {
      try {
        this.sock = await Promise.race([tryConnect(), exited]);
        break;
      } catch (e) {
        if (!this.alive || Date.now() > deadline) {
          this.kill();
          throw e.message?.startsWith('mpv exited') ? e : new Error(`Could not connect to mpv IPC: ${e.message}`);
        }
        await new Promise((r) => setTimeout(r, 60));
      }
    }
    this.sock.setEncoding('utf8');
    this.sock.on('data', (d) => this._onData(d));
    this.sock.on('close', () => this._failAll(new Error('mpv IPC closed')));
    this.sock.on('error', () => {});
    OBSERVED.forEach((name, i) => this.send(['observe_property', i + 1, name]).catch(() => {}));
    return this;
  }

  _onData(chunk) {
    this.buf += chunk;
    let nl;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.request_id != null && this.pending.has(msg.request_id)) {
        const p = this.pending.get(msg.request_id);
        this.pending.delete(msg.request_id);
        msg.error === 'success' ? p.resolve(msg.data) : p.reject(new Error(`mpv: ${msg.error}`));
      } else if (msg.event === 'property-change') {
        this.emit('property', msg.name, msg.data);
      } else if (msg.event === 'client-message') {
        this.emit('client-message', msg.args || []);
      } else if (msg.event) {
        this.emit('event', msg);
      }
    }
  }

  _failAll(err) {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  send(command) {
    if (!this.sock || this.sock.destroyed) return Promise.reject(new Error('mpv not connected'));
    const request_id = ++this.reqId;
    return new Promise((resolve, reject) => {
      this.pending.set(request_id, { resolve, reject });
      this.sock.write(JSON.stringify({ command, request_id }) + '\n');
    });
  }

  command(...args) {
    return this.send(args);
  }
  set(name, value) {
    return this.send(['set_property', name, value]);
  }
  get(name) {
    return this.send(['get_property', name]);
  }

  /** Load a URL; `start` (seconds) resumes, set via the start option before loading. */
  async load(url, { start = null } = {}) {
    await this.set('start', start != null && start > 0 ? String(Math.floor(start)) : 'none').catch(() => {});
    return this.command('loadfile', url, 'replace');
  }

  async quit() {
    if (!this.alive) return;
    const done = new Promise((r) => this.proc.once('exit', r));
    this.command('quit').catch(() => {});
    const t = setTimeout(() => this.kill(), 1500);
    await done;
    clearTimeout(t);
  }

  kill() {
    try {
      this.sock?.destroy();
    } catch {}
    if (this.alive) this.proc?.kill();
    this.alive = false;
    if (process.platform !== 'win32') fs.rmSync(this.ipcPath, { force: true });
  }
}
