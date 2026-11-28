// Settings → Controllers: pair, connect and forget Bluetooth game controllers with
// the remote, and list every controller (USB too) the app can read. Modelled on NetworkSettings.jsx (stb-update bt … through main).
// Without a Bluetooth adapter every row is greyed out and skipped by focus; the
// page keeps polling, so plugging in a USB dongle turns it on within ~5 s.
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { toast, confirmDialog } from '../lib/store.js';
import { useControllers, refreshControllers, bluetoothState } from '../lib/controllers.js';
import { useGamepads } from '../lib/gamepad.js';
import { Focusable } from './Focusable.jsx';
import { Modal } from './Modal.jsx';
import { focusFirst } from '../nav/spatial.js';

const SCAN_SECONDS = 15;
const msg = (e) => String(e?.message || e || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function deviceState(d) {
  if (!d.connected) return 'Not connected';
  return `Connected${d.battery != null ? ` · ${d.battery}%` : ''}`;
}

export function ControllerSettings() {
  const st = useControllers(true); // poll every 5 s while this tab is open
  const bt = bluetoothState(st);
  const [pairing, setPairing] = useState(false);
  const [device, setDevice] = useState(null);
  const paired = (st?.devices || []).filter((d) => d.paired);
  const off = !bt.enabled;
  const pads = useGamepads(); // USB and Bluetooth pads the app can read

  return (
    <>
      <div className="settings-col" data-focus-group="settings-a" data-focus-trap="down">
        <h2>Bluetooth</h2>
        {bt.reason && <p className="settings-reason">{bt.reason}</p>}
        <div className="setting-row is-static">
          <span>Bluetooth</span>
          <span className="setting-value muted">{bt.text}</span>
        </div>
        {bt.windows ? (
          <Focusable className="setting-row" onSelect={() => api.invoke('bt:openSystemSettings')}>
            <span>Open Windows Bluetooth settings</span>
            <span className="setting-value muted">›</span>
          </Focusable>
        ) : (
          <Focusable className={`setting-row ${off ? 'is-disabled' : ''}`} disabled={off} onSelect={() => setPairing(true)}>
            <span>Pair a controller</span>
            <span className="setting-value muted">Xbox, PlayStation, 8BitDo… ›</span>
          </Focusable>
        )}
        <h2>Connected now</h2>
        {pads.length === 0 && <p className="settings-reason">Plug a controller in by USB or switch on a paired one, then press any button on it.</p>}
        {pads.map((p) => (
          <div key={p.index} className="setting-row is-static">
            <span>{p.name}</span>
            <span className="setting-value muted">Ready</span>
          </div>
        ))}
        <p className="settings-reason">
          A = OK · B = Back · D-pad or left stick = move · LB / RB = previous / next tab · X = play/pause · Y = favourite · Menu = info
        </p>
      </div>
      {!bt.windows && (
        <div className="settings-col" data-focus-group="settings-b" data-focus-trap="down">
          <h2>Your controllers</h2>
          {paired.length === 0 && <p className={`settings-reason ${off ? 'is-disabled' : ''}`}>No controllers paired yet.</p>}
          {paired.map((d) => (
            <Focusable key={d.mac} className={`setting-row ${off ? 'is-disabled' : ''}`} disabled={off} onSelect={() => setDevice(d)}>
              <span>
                {d.name}
                {!d.gamepad && <span className="muted"> · other device</span>}
              </span>
              <span className="setting-value muted">{deviceState(d)}</span>
            </Focusable>
          ))}
        </div>
      )}
      {pairing && <PairModal onClose={() => setPairing(false)} />}
      {device && <DeviceModal device={device} onClose={() => setDevice(null)} />}
    </>
  );
}

/** Connect / Disconnect and Forget for one paired device. */
function DeviceModal({ device, onClose }) {
  const [busy, setBusy] = useState('');
  const act = async (what) => {
    if (busy) return;
    if (what === 'forget') {
      const ok = await confirmDialog({
        title: `Forget “${device.name}”?`,
        message: 'You’ll need to pair it again to use it.',
        confirmLabel: 'Forget',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(what);
    try {
      await api.invoke(`bt:${what}`, { mac: device.mac });
      toast(what === 'forget' ? `Forgot ${device.name}` : what === 'connect' ? `${device.name} connected` : `${device.name} disconnected`);
      await refreshControllers();
      onClose();
    } catch (e) {
      toast(msg(e), 5000);
      setBusy('');
    }
  };
  return (
    <Modal onClose={busy ? () => {} : onClose} className="bt-modal">
      <h2>{device.name}</h2>
      <p className="muted">
        {deviceState(device)} · {device.mac}
      </p>
      <div className="row-buttons">
        {device.connected ? (
          <Focusable className="btn btn-primary" autoFocus onSelect={() => act('disconnect')}>
            {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
          </Focusable>
        ) : (
          <Focusable className="btn btn-primary" autoFocus onSelect={() => act('connect')}>
            {busy === 'connect' ? 'Connecting…' : 'Connect'}
          </Focusable>
        )}
        <Focusable className="btn btn-danger" onSelect={() => act('forget')}>
          Forget
        </Focusable>
        <Focusable className="btn" onSelect={onClose}>
          Close
        </Focusable>
      </div>
    </Modal>
  );
}

/** Hint → scan with a countdown → list (controllers first) → pairing → done. */
function PairModal({ onClose }) {
  const [phase, setPhase] = useState('intro'); // intro | scan | list | pairing
  const [left, setLeft] = useState(SCAN_SECONDS);
  const [found, setFound] = useState([]);
  const [error, setError] = useState('');
  const [target, setTarget] = useState(null);
  const box = useRef(null);
  useEffect(() => {
    requestAnimationFrame(() => box.current && focusFirst(box.current));
  }, [phase]);

  const scan = async () => {
    setPhase('scan');
    setError('');
    setLeft(SCAN_SECONDS);
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    try {
      const r = await api.invoke('bt:scan', { seconds: SCAN_SECONDS });
      setFound((r.devices || []).filter((d) => !d.paired));
    } catch (e) {
      setError(msg(e));
    } finally {
      clearInterval(t);
      setPhase('list');
    }
  };

  const pair = async (d) => {
    setTarget(d);
    setPhase('pairing');
    setError('');
    try {
      const r = await api.invoke('bt:pair', { mac: d.mac });
      toast(r.warning ? `${d.name}: ${r.warning}` : `${d.name} paired and connected`, 5000);
      await refreshControllers();
      onClose();
    } catch (e) {
      setError(msg(e));
      setPhase('list');
    }
  };

  const pads = found.filter((d) => d.gamepad);
  const others = found.filter((d) => !d.gamepad);
  const row = (d, i) => (
    <Focusable key={d.mac} className="setting-row" autoFocus={i === 0} onSelect={() => pair(d)}>
      <span>{d.name}</span>
      <span className="setting-value muted">Pair ›</span>
    </Focusable>
  );

  return (
    <Modal onClose={phase === 'pairing' ? () => {} : onClose} className="bt-modal">
      <div ref={box}>
        <h2>Pair a controller</h2>
        {error && <p className="error-text">{error}</p>}
        {phase === 'intro' && (
          <>
            <ol className="bt-steps">
              <li>Turn the controller on (press the Xbox button).</li>
              <li>Hold the small pair button on top until the Xbox button flashes quickly.</li>
              <li>Then press Search below. For other controllers, put them in pairing mode the same way.</li>
            </ol>
            <div className="row-buttons">
              <Focusable className="btn btn-primary" autoFocus onSelect={scan}>
                Search
              </Focusable>
              <Focusable className="btn" onSelect={onClose}>
                Cancel
              </Focusable>
            </div>
          </>
        )}
        {(phase === 'scan' || phase === 'pairing') && (
          <div className="update-step">
            <div className="spinner small" />
            <span>{phase === 'scan' ? `Searching… ${left}s` : `Pairing with ${target?.name}…`}</span>
            <Focusable className="btn btn-small" autoFocus onSelect={() => {}}>
              Please wait
            </Focusable>
          </div>
        )}
        {phase === 'list' && (
          <>
            <div className="net-list" data-focus-group="bt-found" data-focus-trap="up,down">
              {found.length === 0 && <p className="muted">Nothing found. Make sure the Xbox button is flashing quickly, then search again.</p>}
              {pads.map(row)}
              {others.length > 0 && <h3 className="bt-sub">Other devices</h3>}
              {others.map((d, i) => row(d, pads.length + i))}
            </div>
            <div className="row-buttons">
              <Focusable className="btn" onSelect={scan}>
                Search again
              </Focusable>
              <Focusable className="btn" onSelect={onClose}>
                Close
              </Focusable>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
