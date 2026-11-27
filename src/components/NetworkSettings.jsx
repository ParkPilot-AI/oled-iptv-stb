// Settings → Network: Wi-Fi status, scan, connect (on-screen keyboard for the
// password) and forget — all with the remote. Talks to the set-top box's root
// helper (stb-update wifi …) through the main process.
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { toast } from '../lib/store.js';
import { Focusable } from './Focusable.jsx';
import { Modal } from './Modal.jsx';
import { VirtualKeyboard } from './VirtualKeyboard.jsx';
import { focusFirst } from '../nav/spatial.js';

// NetworkManager reports signal as 0–100 %.
const bars = (sig) => (sig == null ? 0 : sig >= 75 ? 4 : sig >= 55 ? 3 : sig >= 35 ? 2 : 1);
const quality = (sig) => ['', 'Weak', 'Fair', 'Good', 'Excellent'][bars(sig)];

function Signal({ signal }) {
  const b = bars(signal);
  return (
    <span className="wifi-bars" aria-label={quality(signal)}>
      {[1, 2, 3, 4].map((i) => (
        <i key={i} className={i <= b ? 'on' : ''} style={{ height: `${0.35 + i * 0.25}rem` }} />
      ))}
    </span>
  );
}

export function statusText(st) {
  if (!st) return 'Checking…';
  if (st.error) return st.error;
  if (st.state === 'connected') return `${st.ssid} · ${quality(st.signal) || 'Connected'}${st.ip ? ` · ${st.ip}` : ''}`;
  if (st.state === 'connecting') return 'Connecting…';
  return 'Not connected';
}

export function NetworkRow() {
  const [st, setSt] = useState(null);
  const [open, setOpen] = useState(false);
  const refresh = () =>
    api
      .invoke('net:status')
      .then(setSt)
      .catch((e) => setSt({ error: e.message }));
  useEffect(() => {
    refresh();
  }, []);
  return (
    <>
      <Focusable className={`setting-row ${st && st.state !== 'connected' ? 'has-update' : ''}`} onSelect={() => setOpen(true)}>
        <span>Wi-Fi</span>
        <span className="setting-value muted">{statusText(st)}</span>
      </Focusable>
      {open && (
        <NetworkModal
          onClose={() => {
            setOpen(false);
            refresh();
          }}
        />
      )}
    </>
  );
}

function NetworkModal({ onClose }) {
  const [phase, setPhase] = useState('scan'); // scan | list | password | connecting
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [target, setTarget] = useState(null);
  const [pw, setPw] = useState('');
  const box = useRef(null);

  const scan = async () => {
    setPhase('scan');
    setError('');
    try {
      setData(await api.invoke('net:scan'));
    } catch (e) {
      setError(e.message);
    }
    setPhase('list');
  };
  useEffect(() => {
    scan();
  }, []);
  useEffect(() => {
    requestAnimationFrame(() => box.current && focusFirst(box.current));
  }, [phase]);

  const connect = async (net, password) => {
    setPhase('connecting');
    setError('');
    try {
      const st = await api.invoke('net:connect', { ssid: net.ssid, password });
      toast(`Connected to ${st.ssid}`);
      await scan();
    } catch (e) {
      setError(`Couldn’t connect to “${net.ssid}”: ${e.message}. Check the password and try again.`);
      setPw('');
      setPhase(net.security === 'open' ? 'list' : 'password');
    }
  };

  const choose = (net) => {
    setTarget(net);
    setPw('');
    if (net.connected) return; // the Forget button is shown instead
    if (net.security === 'open') connect(net, '');
    else setPhase('password');
  };

  const forget = async (net) => {
    try {
      await api.invoke('net:forget', { ssid: net.ssid });
      toast(`Forgot “${net.ssid}”`);
    } catch (e) {
      toast(e.message);
    }
    scan();
  };

  const back = () => {
    if (phase === 'password') {
      setError('');
      setPhase('list');
    } else if (phase !== 'connecting') onClose();
  };

  const nets = data?.networks || [];
  return (
    <Modal onClose={back} className="net-modal">
      <div ref={box}>
        <h2>Wi-Fi</h2>
        <p className="muted net-status">
          {data ? statusText(data) : 'Checking…'}
          {data?.driver ? ` · adapter ${data.device} (${data.driver})` : ''}
        </p>
        {error && <p className="error-text">{error}</p>}

        {(phase === 'scan' || phase === 'connecting') && (
          <div className="update-step">
            <div className="spinner small" />
            <span>{phase === 'scan' ? 'Scanning for networks… (USB adapters can take ~20 s)' : `Connecting to ${target?.ssid}…`}</span>
            <Focusable className="btn btn-small" autoFocus onSelect={() => {}}>
              Please wait
            </Focusable>
          </div>
        )}

        {phase === 'list' && (
          <>
            <div className="net-list" data-focus-group="net-list" data-focus-trap="up,down">
              {nets.length === 0 && <p className="muted">No networks found. Move the box closer to the router, or scan again.</p>}
              {nets.map((n, i) => (
                <div key={n.ssid} className="net-item">
                  <Focusable className={`setting-row net-row ${n.connected ? 'is-connected' : ''}`} autoFocus={i === 0} onSelect={() => choose(n)}>
                    <span className="net-name">
                      {n.ssid}
                      {n.connected && <span className="net-tag">Connected</span>}
                    </span>
                    <span className="setting-value muted">
                      {n.security === 'open' ? 'Open' : 'Secured'} <Signal signal={n.signal} />
                    </span>
                  </Focusable>
                  {n.connected && (
                    <Focusable className="btn btn-small" onSelect={() => forget(n)}>
                      Forget
                    </Focusable>
                  )}
                </div>
              ))}
            </div>
            <div className="row-buttons">
              <Focusable className="btn" onSelect={scan}>
                Scan again
              </Focusable>
              <Focusable className="btn" onSelect={onClose}>
                Close
              </Focusable>
            </div>
          </>
        )}

        {phase === 'password' && target && (
          <>
            <p>
              Password for <b>{target.ssid}</b>
            </p>
            <VirtualKeyboard value={pw} onChange={setPw} mask placeholder="Wi-Fi password" doneLabel="Connect" onDone={() => pw && connect(target, pw)} />
          </>
        )}
      </div>
    </Modal>
  );
}
