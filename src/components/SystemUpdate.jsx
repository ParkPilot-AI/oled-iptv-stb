// Settings → "Update system": one button that updates Arch packages and the
// app (via the set-top box's root helper), with live progress, then restarts
// the app or offers a reboot when the kernel changed.
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Focusable } from './Focusable.jsx';
import { Modal } from './Modal.jsx';
import { focusFirst } from '../nav/spatial.js';

let lastCheck = null; // { at, result } — shared for the session

export function useUpdateStatus() {
  const [st, setSt] = useState(lastCheck?.result || null);
  const [checking, setChecking] = useState(false);
  const check = async (force = false) => {
    if (!force && lastCheck && Date.now() - lastCheck.at < 30 * 60e3) return setSt(lastCheck.result);
    setChecking(true);
    try {
      const r = await api.invoke('system:update:check');
      lastCheck = { at: Date.now(), result: r };
      setSt(r);
    } catch (e) {
      setSt({ available: true, error: e.message });
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    check(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { st, checking, check };
}

export function updateSummary(st, checking) {
  if (checking && !st) return 'Checking…';
  if (!st) return '';
  if (!st.available) return 'Not available on this system';
  if (st.error) return `Couldn’t check: ${st.error}`;
  const parts = [];
  if (st.system > 0) parts.push(`${st.system} system update${st.system === 1 ? '' : 's'}`);
  if (st.appLatest && st.appLatest !== st.appInstalled) parts.push('new app version');
  if (!st.appLatest && st.repo && !st.hasToken) parts.push('app updates need a GitHub token');
  return parts.length ? parts.join(' · ') : 'Up to date';
}

export function UpdateRow() {
  const { st, checking, check } = useUpdateStatus();
  const [open, setOpen] = useState(false);
  const summary = checking ? 'Checking…' : updateSummary(st, checking);
  return (
    <>
      <Focusable
        className={`setting-row ${st && (st.system > 0 || (st.appLatest && st.appLatest !== st.appInstalled)) ? 'has-update' : ''}`}
        onSelect={() => (st?.available ? setOpen(true) : check(true))}
      >
        <span>Update system</span>
        <span className="setting-value muted">{summary}</span>
      </Focusable>
      {open && <UpdateModal st={st} onClose={() => setOpen(false)} onFinished={() => check(true)} />}
    </>
  );
}

function UpdateModal({ st, onClose, onFinished }) {
  const [phase, setPhase] = useState('confirm'); // confirm | running | done
  const [step, setStep] = useState('Starting…');
  const [log, setLog] = useState([]);
  const [result, setResult] = useState({ error: null, app: null, reboot: false });
  const [countdown, setCountdown] = useState(null);
  const box = useRef(null);
  const res = useRef(result);
  res.current = result;

  useEffect(() => {
    return api.on('system:update:progress', (ev) => {
      if (ev.type === 'step') setStep(ev.text);
      else if (ev.type === 'line') setLog((l) => [...l.slice(-7), ev.text]);
      else if (ev.type === 'app') setResult((r) => ({ ...r, app: ev.text }));
      else if (ev.type === 'reboot') setResult((r) => ({ ...r, reboot: true }));
      else if (ev.type === 'error') setResult((r) => ({ ...r, error: ev.text }));
      else if (ev.type === 'exit') {
        if (ev.code !== 0) setResult((r) => ({ ...r, error: r.error || `Updater exited with code ${ev.code}` }));
        setPhase('done');
        onFinished?.();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refocus the new buttons when the phase changes.
  useEffect(() => {
    requestAnimationFrame(() => box.current && focusFirst(box.current));
  }, [phase]);

  // App replaced (and no reboot needed) → restart the app automatically.
  useEffect(() => {
    if (phase !== 'done' || result.error || !result.app || result.reboot) return;
    setCountdown(5);
    const t = setInterval(() => setCountdown((c) => (c > 1 ? c - 1 : 0)), 1000);
    const go = setTimeout(() => api.invoke('app:restart'), 5000);
    return () => {
      clearInterval(t);
      clearTimeout(go);
    };
  }, [phase, result]);

  const start = async () => {
    setPhase('running');
    try {
      const r = await api.invoke('system:update:run');
      if (r && r.started === false) setStep('An update is already running…');
    } catch (e) {
      setResult((x) => ({ ...x, error: e.message }));
      setPhase('done');
    }
  };

  const appNew = st?.appLatest && st.appLatest !== st.appInstalled;
  return (
    <Modal onClose={phase === 'running' ? () => {} : onClose} className="update-modal">
      <div ref={box}>
        {phase === 'confirm' && (
          <>
            <h2>Update system</h2>
            <ul className="update-list">
              <li>
                <b>System packages:</b> {st?.system > 0 ? `${st.system} update${st.system === 1 ? '' : 's'} available` : 'up to date'}
              </li>
              <li>
                <b>ONYX app:</b>{' '}
                {appNew ? `${st.appInstalled} → ${st.appLatest}` : st?.appLatest ? `${st.appInstalled} (latest)` : st?.repo ? 'version check unavailable (token?)' : 'no update source set'}
              </li>
            </ul>
            <p className="muted">Takes a few minutes. Keep the box powered on. The app restarts when it’s done; a reboot is offered if the system kernel changed.</p>
            <div className="row-buttons">
              <Focusable className="btn btn-primary" autoFocus onSelect={start}>
                Update now
              </Focusable>
              <Focusable className="btn" onSelect={onClose}>
                Cancel
              </Focusable>
            </div>
          </>
        )}
        {phase === 'running' && (
          <>
            <h2>Updating…</h2>
            <div className="update-step">
              <div className="spinner small" />
              <span>{step}</span>
            </div>
            <pre className="update-log">{log.join('\n') || ' '}</pre>
            <p className="muted">Please don’t turn the box off.</p>
            {/* Keep one focusable so the remote has somewhere to rest. */}
            <Focusable className="btn btn-small" autoFocus onSelect={() => {}}>
              Working…
            </Focusable>
          </>
        )}
        {phase === 'done' && (
          <>
            <h2>{result.error ? 'Update didn’t finish' : 'Update complete'}</h2>
            {result.error ? (
              <p className="error-text">{result.error}</p>
            ) : (
              <ul className="update-list">
                <li>System packages updated.</li>
                <li>{result.app ? `App updated to ${result.app}.` : 'App already up to date.'}</li>
                {result.reboot && <li>A restart is needed to finish (new system kernel).</li>}
              </ul>
            )}
            {result.error && <p className="muted">Details: /var/log/stb-update.log (Ctrl+Alt+F2, user tv).</p>}
            <div className="row-buttons">
              {!result.error && result.reboot && (
                <Focusable className="btn btn-primary" autoFocus onSelect={() => api.invoke('system:reboot')}>
                  Restart box now
                </Focusable>
              )}
              {!result.error && result.app && !result.reboot && (
                <Focusable className="btn btn-primary" autoFocus onSelect={() => api.invoke('app:restart')}>
                  Restart app now{countdown != null ? ` (${countdown})` : ''}
                </Focusable>
              )}
              <Focusable className="btn" autoFocus={!!result.error || (!result.app && !result.reboot)} onSelect={onClose}>
                {result.reboot ? 'Later' : 'Close'}
              </Focusable>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
