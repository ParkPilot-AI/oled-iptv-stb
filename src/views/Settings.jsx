import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore, setState, getState, toast, confirmDialog, activateProfile, loadEpg, applyAccent, applyScreenFit, reloadCatalog, powerOff } from '../lib/store.js';
import { clearArtCache } from '../lib/art.js';
import { Focusable } from '../components/Focusable.jsx';
import { TextField } from '../components/VirtualKeyboard.jsx';
import { UpdateRow } from '../components/SystemUpdate.jsx';
import { NetworkRow } from '../components/NetworkSettings.jsx';
import { PillTabs, useTabCycle } from '../components/PillTabs.jsx';
import { useKeyHandler } from '../nav/keys.js';
import { focusFirst } from '../nav/spatial.js';

const OPTIONS = {
  liveFormat: [['ts', 'MPEG-TS (.ts) — lowest latency'], ['m3u8', 'HLS (.m3u8)']],
  hwdec: [['auto-safe', 'Auto (recommended)'], ['d3d11va', 'D3D11VA (Windows)'], ['vaapi', 'VA-API (Linux Intel)'], ['nvdec', 'NVDEC (NVIDIA)'], ['no', 'Off (software)']],
  deinterlace: [[false, 'Off'], [true, 'On (interlaced live TV)']],
  osdTimeoutSec: [[3, '3 seconds'], [4, '4 seconds'], [6, '6 seconds'], [10, '10 seconds']],
  screensaverMin: [[1, '1 minute'], [3, '3 minutes'], [5, '5 minutes'], [10, '10 minutes']],
  catalogTtlHours: [[6, 'Every 6 hours'], [12, 'Every 12 hours'], [24, 'Daily'], [168, 'Weekly']],
  epgTtlHours: [[3, 'Every 3 hours'], [6, 'Every 6 hours'], [12, 'Every 12 hours'], [24, 'Daily']],
  startFullscreen: [[true, 'On'], [false, 'Off']],
  overscan: [[0, 'Full screen'], [0.025, 'Shrink 5%'], [0.05, 'Shrink 10%'], [0.075, 'Shrink 15%']],
  accent: [['#3B82F6', 'Blue'], ['#DC143C', 'Crimson'], ['#10B981', 'Emerald'], ['#A78BFA', 'Violet'], ['#F59E0B', 'Amber']],
  artSource: [['prefer', 'TMDB first (recommended)'], ['missing', 'Provider first, TMDB for gaps'], ['off', 'Off']],
  logoSource: [['prefer', 'Official logos (recommended)'], ['missing', 'Provider first'], ['off', 'Provider logos only']],
  subMode: [['off', 'Off'], ['on', 'On']],
  aspect: [['auto', 'Original'], ['16:9', '16:9'], ['4:3', '4:3'], ['21:9', 'Cinema 21:9'], ['zoom', 'Zoom to fill'], ['stretch', 'Stretch to fill']],
  upscaling: [['standard', 'Standard'], ['high', 'High quality (more GPU)'], ['fast', 'Fast (weak PCs)']],
  deband: [[false, 'Off'], [true, 'On (smooths blocky gradients)']],
  toneMapping: [['auto', 'Automatic'], ['natural', 'Natural'], ['bright', 'Bright']],
  audioLang: [['auto', 'Stream default'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['pl', 'Polish'], ['tr', 'Turkish'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['ur', 'Urdu'], ['ro', 'Romanian'], ['el', 'Greek'], ['sv', 'Swedish']],
  speakers: [['auto', 'Automatic (surround if supported)'], ['stereo', 'Stereo (TV speakers)']],
  passthrough: [[false, 'Off'], [true, 'On (soundbar / AV receiver)']],
  nightMode: [['off', 'Off'], ['night', 'Night mode (quieter peaks)'], ['level', 'Even volume (louder dialogue)']],
  subLang: [['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['pl', 'Polish'], ['tr', 'Turkish'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['ur', 'Urdu'], ['ro', 'Romanian'], ['el', 'Greek'], ['sv', 'Swedish']],
  subSize: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['xlarge', 'Extra large']],
  subBackground: [['box', 'Dark box (easiest to read)'], ['outline', 'Outline only']],
};

/** Sound output: cycles through what this machine actually has (HDMI ports, jack, USB…). */
function AudioOutputRow({ settings, update }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.invoke('audio:outputs').then(setList).catch(() => setList({ outputs: [{ id: 'auto', label: 'Automatic' }] }));
  }, []);
  const outs = list?.outputs || [];
  const cur = settings.audioDevice || 'auto';
  const idx = Math.max(0, outs.findIndex((o) => o.id === cur));
  const next = async () => {
    if (busy || outs.length < 2) return;
    const o = outs[(idx + 1) % outs.length];
    setBusy(true);
    try {
      await update({ audioDevice: o.id });
      toast(`Sound: ${o.label}`);
    } catch (e) {
      toast(`Couldn't switch output: ${e.message}`, 5000);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Focusable className="setting-row" onSelect={next}>
      <span>Audio output</span>
      <span className="setting-value">
        {!list ? 'Checking…' : busy ? 'Switching…' : outs[idx]?.label || 'Automatic'} {outs.length > 1 && <span className="muted">›</span>}
      </span>
    </Focusable>
  );
}

function Cycle({ label, k, settings, update, autoFocus }) {
  const opts = OPTIONS[k];
  const idx = Math.max(0, opts.findIndex(([v]) => v === settings[k]));
  const next = () => update({ [k]: opts[(idx + 1) % opts.length][0] });
  return (
    <Focusable className="setting-row" onSelect={next} autoFocus={autoFocus}>
      <span>{label}</span>
      <span className="setting-value">
        {k === 'accent' && <i className="swatch" style={{ background: settings.accent }} />}
        {opts[idx][1]} <span className="muted">›</span>
      </span>
    </Focusable>
  );
}

/** ◀ ▶ adjusts a number (OK resets it to the middle). */
function Slider({ label, k, settings, update, min = -50, max = 50, step = 5, format = (v) => (v > 0 ? `+${v}` : `${v}`), zero = 0 }) {
  const ref = useRef(null);
  const v = Number(settings[k] ?? zero);
  const set = (nv) => {
    const c = Math.max(min, Math.min(max, nv));
    if (c !== v) update({ [k]: c });
  };
  useKeyHandler(
    (action) => {
      if (document.activeElement !== ref.current || (action !== 'left' && action !== 'right')) return false;
      set(v + (action === 'right' ? step : -step));
      return true;
    },
    { priority: 30 }
  );
  const pct = ((v - min) / (max - min)) * 100;
  const zpct = ((zero - min) / (max - min)) * 100;
  return (
    <Focusable ref={ref} className="setting-row slider-row" onSelect={() => set(zero)}>
      <span>{label}</span>
      <span className="setting-value slider-value">
        <span className="slider-track">
          <i className="slider-fill" style={{ left: `${Math.min(pct, zpct)}%`, width: `${Math.abs(pct - zpct)}%` }} />
          <i className="slider-knob" style={{ left: `${pct}%` }} />
        </span>
        <span className="slider-num">{format(v)}</span>
      </span>
    </Focusable>
  );
}

function Action({ label, value, onSelect, danger }) {
  return (
    <Focusable className={`setting-row ${danger ? 'is-danger' : ''}`} onSelect={onSelect}>
      <span>{label}</span>
      {value && <span className="setting-value muted">{value}</span>}
    </Focusable>
  );
}

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'picture', label: 'Picture' },
  { id: 'sound', label: 'Sound' },
  { id: 'subs', label: 'Subtitles' },
  { id: 'library', label: 'Library' },
  { id: 'system', label: 'System' },
];
const memory = { tab: 'general' };

const PICTURE_RESET = { brightness: 0, contrast: 0, saturation: 0, gamma: 0, aspect: 'auto', upscaling: 'standard', deband: false, toneMapping: 'auto', deinterlace: false };

export function Settings() {
  const settings = useStore((s) => s.settings);
  const pid = useStore((s) => s.profileId);
  const epgStatus = useStore((s) => s.epgStatus);
  const catalog = useStore((s) => s.catalog);
  const profiles = useStore((s) => s.profiles);
  const [info, setInfo] = useState(null);
  const [tab, setTab] = useState(memory.tab);
  const body = useRef(null);
  useEffect(() => {
    api.invoke('app:info').then(setInfo);
  }, []);
  const changeTab = (id) => {
    memory.tab = id;
    setTab(id);
  };
  useTabCycle(TABS, tab, changeTab, () => requestAnimationFrame(() => focusFirst(body.current)));

  const update = async (patch) => {
    const s = await api.invoke('settings:update', patch);
    if (patch.accent) applyAccent(patch.accent);
    if ('overscan' in patch) applyScreenFit(patch.overscan);
    setState({ settings: s });
    if ('artSource' in patch || 'tmdbKey' in patch) clearArtCache();
    if ('logoSource' in patch) reloadCatalog().catch(() => {});
  };
  const saveTmdbKey = async (key) => {
    if (!key) return update({ tmdbKey: '' });
    try {
      await api.invoke('art:testKey', key);
      await update({ tmdbKey: key });
      toast('TMDB key saved — artwork will appear as you browse');
    } catch (e) {
      toast(e.message || 'That key did not work', 5000);
    }
  };
  const profile = profiles.list.find((p) => p.id === pid);
  const C = (label, k) => <Cycle label={label} k={k} settings={settings} update={update} />;
  const ms = (v) => (v === 0 ? 'In sync' : `${v > 0 ? '+' : ''}${v} ms`);

  const pages = {
    general: (
      <>
        <div className="settings-col" data-focus-group="settings-a" data-focus-trap="down">
          <h2>Playback</h2>
          {C('Live stream format', 'liveFormat')}
          {C('Hide on-screen controls after', 'osdTimeoutSec')}
          {C('Screensaver when paused', 'screensaverMin')}
          <TextField label="Custom mpv path" value={settings.mpvPath} onChange={(v) => update({ mpvPath: v })} placeholder={info?.mpvPath ? `Using ${info.mpvPath}` : 'mpv not found'} />
        </div>
        <div className="settings-col" data-focus-group="settings-b" data-focus-trap="down">
          <h2>Screen</h2>
          {C('Screen fit (if edges are cut off)', 'overscan')}
          {C('Accent colour', 'accent')}
          {C('Start in fullscreen', 'startFullscreen')}
          <Action label="Toggle fullscreen now" onSelect={() => api.invoke('app:toggleFullscreen')} />
        </div>
      </>
    ),
    picture: (
      <>
        <div className="settings-col" data-focus-group="settings-a" data-focus-trap="down">
          <h2>Adjustments</h2>
          <Slider label="Brightness" k="brightness" settings={settings} update={update} />
          <Slider label="Contrast" k="contrast" settings={settings} update={update} />
          <Slider label="Colour" k="saturation" settings={settings} update={update} />
          <Slider label="Gamma" k="gamma" settings={settings} update={update} />
          <Action label="Reset picture settings" onSelect={() => update(PICTURE_RESET).then(() => toast('Picture settings reset'))} />
        </div>
        <div className="settings-col" data-focus-group="settings-b" data-focus-trap="down">
          <h2>Image</h2>
          {C('Aspect ratio', 'aspect')}
          {C('Upscaling', 'upscaling')}
          {C('Debanding', 'deband')}
          {C('HDR to SDR', 'toneMapping')}
          {C('Deinterlacing', 'deinterlace')}
          {C('Hardware decoding', 'hwdec')}
        </div>
      </>
    ),
    sound: (
      <>
        <div className="settings-col" data-focus-group="settings-a" data-focus-trap="down">
          <h2>Output</h2>
          <AudioOutputRow settings={settings} update={update} />
          {C('Speakers', 'speakers')}
          {C('Dolby / DTS passthrough', 'passthrough')}
        </div>
        <div className="settings-col" data-focus-group="settings-b" data-focus-trap="down">
          <h2>Listening</h2>
          {C('Audio language', 'audioLang')}
          {C('Volume levelling', 'nightMode')}
          <Slider label="Lip-sync delay" k="audioDelayMs" settings={settings} update={update} min={-500} max={500} step={25} format={ms} />
        </div>
      </>
    ),
    subs: (
      <>
        <div className="settings-col" data-focus-group="settings-a" data-focus-trap="down">
          <h2>Subtitles</h2>
          <Toggle label="Subtitles" on={settings.subMode === 'on'} onChange={(on) => update({ subMode: on ? 'on' : 'off' })} />
          {C('Preferred language', 'subLang')}
        </div>
        <div className="settings-col" data-focus-group="settings-b" data-focus-trap="down">
          <h2>Appearance</h2>
          {C('Size', 'subSize')}
          {C('Background', 'subBackground')}
        </div>
      </>
    ),
    library: (
      <>
        <div className="settings-col" data-focus-group="settings-a" data-focus-trap="down">
          <h2>Playlist · {profile?.name}</h2>
          <Action label="Switch or edit playlists" onSelect={() => setState({ boot: 'login' })} />
          <Action
            label="Refresh channels & library now"
            value={catalog ? `Updated ${new Date(catalog.fetchedAt).toLocaleString()}` : ''}
            onSelect={() => activateProfile(pid, { force: true })}
          />
          <Action label="Refresh TV guide now" value={epgStatus} onSelect={() => loadEpg(pid, true).then(() => toast('Guide refreshed'))} />
          {C('Auto-refresh library', 'catalogTtlHours')}
          {C('Auto-refresh guide', 'epgTtlHours')}
          <Action
            label="Clear cached data & images"
            onSelect={async () => {
              if (!(await confirmDialog({ title: 'Clear caches?', message: 'Channel lists, guide data and posters will be downloaded again.', confirmLabel: 'Clear', danger: true }))) return;
              await api.invoke('cache:clear', { profileId: pid });
              activateProfile(getState().profileId, { force: true });
            }}
          />
        </div>
        <div className="settings-col" data-focus-group="settings-b" data-focus-trap="down">
          <h2>Artwork</h2>
          <TextField label="TMDB API key" value={settings.tmdbKey || ''} mask onChange={saveTmdbKey} placeholder="Free at themoviedb.org → Settings → API" />
          {C('Movie & series artwork', 'artSource')}
          {C('Channel logos', 'logoSource')}
          <Action
            label="Re-match channel logos now"
            onSelect={() => {
              toast('Matching channel logos…');
              api.invoke('art:refreshLogos', { profileId: pid }).then(() => toast('Channel logos updated'));
            }}
          />
          <p className="credits-note">
            Movie and TV artwork from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB. Channel logos from tv-logo/tv-logos (github.com/tv-logo/tv-logos, for personal use) and the iptv-org open database.
          </p>
        </div>
      </>
    ),
    system: (
      <>
        <div className="settings-col" data-focus-group="settings-a" data-focus-trap="down">
          {info?.updater && (
            <>
              <h2>Box</h2>
              <NetworkRow />
              <UpdateRow />
            </>
          )}
          <h2>Power</h2>
          <Action label="Power Off" danger onSelect={() => powerOff()} />
        </div>
        <div className="settings-col" data-focus-group="settings-b" data-focus-trap="down">
          <h2>About ONYX</h2>
          <Action label="Version" value={info ? `${info.version}${info.build ? ` · build ${info.build}` : ''} · ${info.platform}` : ''} onSelect={() => {}} />
          <Action label="mpv" value={info?.mpvPath || 'Not found — see README'} onSelect={() => {}} />
          <Action label="Credential storage" value={profiles.secureStorage ? 'OS keystore (encrypted)' : 'Obfuscated (no keystore)'} onSelect={() => {}} />
        </div>
      </>
    ),
  };

  return (
    <div className="settings">
      <header className="page-head">
        <h1>Settings</h1>
      </header>
      <PillTabs tabs={TABS} active={tab} onChange={changeTab} group="settings-tabs" onSelected={() => requestAnimationFrame(() => focusFirst(body.current))} />
      <div className="settings-cols" ref={body} key={tab}>
        {pages[tab]}
      </div>
    </div>
  );
}

/** On/Off switch row. */
function Toggle({ label, on, onChange }) {
  return (
    <Focusable className="setting-row" onSelect={() => onChange(!on)}>
      <span>{label}</span>
      <span className={`switch ${on ? 'is-on' : ''}`} role="switch" aria-checked={on}>
        <i />
      </span>
    </Focusable>
  );
}
