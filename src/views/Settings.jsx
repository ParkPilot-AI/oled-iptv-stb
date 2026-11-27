import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore, setState, getState, toast, confirmDialog, activateProfile, loadEpg, applyAccent } from '../lib/store.js';
import { Focusable } from '../components/Focusable.jsx';
import { TextField } from '../components/VirtualKeyboard.jsx';

const OPTIONS = {
  liveFormat: [['ts', 'MPEG-TS (.ts) — lowest latency'], ['m3u8', 'HLS (.m3u8)']],
  hwdec: [['auto-safe', 'Auto (recommended)'], ['d3d11va', 'D3D11VA (Windows)'], ['vaapi', 'VA-API (Linux Intel)'], ['nvdec', 'NVDEC (NVIDIA)'], ['no', 'Off (software)']],
  deinterlace: [[false, 'Off'], [true, 'On (interlaced live TV)']],
  osdTimeoutSec: [[3, '3 seconds'], [4, '4 seconds'], [6, '6 seconds'], [10, '10 seconds']],
  screensaverMin: [[1, '1 minute'], [3, '3 minutes'], [5, '5 minutes'], [10, '10 minutes']],
  catalogTtlHours: [[6, 'Every 6 hours'], [12, 'Every 12 hours'], [24, 'Daily'], [168, 'Weekly']],
  epgTtlHours: [[3, 'Every 3 hours'], [6, 'Every 6 hours'], [12, 'Every 12 hours'], [24, 'Daily']],
  startFullscreen: [[true, 'On'], [false, 'Off']],
  accent: [['#3B82F6', 'Blue'], ['#10B981', 'Emerald'], ['#A78BFA', 'Violet'], ['#F59E0B', 'Amber']],
};

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

function Action({ label, value, onSelect, danger }) {
  return (
    <Focusable className={`setting-row ${danger ? 'is-danger' : ''}`} onSelect={onSelect}>
      <span>{label}</span>
      {value && <span className="setting-value muted">{value}</span>}
    </Focusable>
  );
}

export function Settings() {
  const settings = useStore((s) => s.settings);
  const pid = useStore((s) => s.profileId);
  const epgStatus = useStore((s) => s.epgStatus);
  const catalog = useStore((s) => s.catalog);
  const profiles = useStore((s) => s.profiles);
  const [info, setInfo] = useState(null);
  useEffect(() => {
    api.invoke('app:info').then(setInfo);
  }, []);

  const update = async (patch) => {
    const s = await api.invoke('settings:update', patch);
    if (patch.accent) applyAccent(patch.accent);
    setState({ settings: s });
  };
  const profile = profiles.list.find((p) => p.id === pid);

  return (
    <div className="settings">
      <header className="page-head">
        <h1>Settings</h1>
      </header>
      <div className="settings-cols">
        <div className="settings-col" data-focus-group="settings-a" data-focus-trap="up,down">
          <h2>Playback</h2>
          <Cycle label="Live stream format" k="liveFormat" settings={settings} update={update} autoFocus />
          <Cycle label="Hardware decoding" k="hwdec" settings={settings} update={update} />
          <Cycle label="Deinterlacing" k="deinterlace" settings={settings} update={update} />
          <Cycle label="Hide on-screen controls after" k="osdTimeoutSec" settings={settings} update={update} />
          <Cycle label="Screensaver when paused" k="screensaverMin" settings={settings} update={update} />
          <TextField label="Custom mpv path" value={settings.mpvPath} onChange={(v) => update({ mpvPath: v })} placeholder={info?.mpvPath ? `Using ${info.mpvPath}` : 'mpv not found'} />
          <h2>Display</h2>
          <Cycle label="Accent colour" k="accent" settings={settings} update={update} />
          <Cycle label="Start in fullscreen" k="startFullscreen" settings={settings} update={update} />
          <Action label="Toggle fullscreen now" onSelect={() => api.invoke('app:toggleFullscreen')} />
        </div>
        <div className="settings-col" data-focus-group="settings-b" data-focus-trap="up,down">
          <h2>Playlist · {profile?.name}</h2>
          <Action label="Switch or edit playlists" onSelect={() => setState({ boot: 'login' })} />
          <Action
            label="Refresh channels & library now"
            value={catalog ? `Updated ${new Date(catalog.fetchedAt).toLocaleString()}` : ''}
            onSelect={() => activateProfile(pid, { force: true })}
          />
          <Action label="Refresh TV guide now" value={epgStatus} onSelect={() => loadEpg(pid, true).then(() => toast('Guide refreshed'))} />
          <Cycle label="Auto-refresh library" k="catalogTtlHours" settings={settings} update={update} />
          <Cycle label="Auto-refresh guide" k="epgTtlHours" settings={settings} update={update} />
          <Action
            label="Clear cached data & images"
            onSelect={async () => {
              if (!(await confirmDialog({ title: 'Clear caches?', message: 'Channel lists, guide data and posters will be downloaded again.', confirmLabel: 'Clear', danger: true }))) return;
              await api.invoke('cache:clear', { profileId: pid });
              activateProfile(getState().profileId, { force: true });
            }}
          />
          <h2>About</h2>
          <Action label="Version" value={info ? `${info.version} · ${info.platform}` : ''} onSelect={() => {}} />
          <Action label="mpv" value={info?.mpvPath || 'Not found — see README'} onSelect={() => {}} />
          <Action label="Credential storage" value={profiles.secureStorage ? 'OS keystore (encrypted)' : 'Obfuscated (no keystore)'} onSelect={() => {}} />
          <Action
            label="Exit app"
            danger
            onSelect={() => confirmDialog({ title: 'Exit OLED IPTV?', confirmLabel: 'Exit', danger: true }).then((ok) => ok && api.invoke('app:quit'))}
          />
        </div>
      </div>
    </div>
  );
}
