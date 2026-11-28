import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore, activateProfile, refreshProfiles, confirmDialog, getState, setState, powerOff, toast } from '../lib/store.js';
import { Focusable } from '../components/Focusable.jsx';
import { TextField } from '../components/VirtualKeyboard.jsx';
import { Icon } from '../components/Icons.jsx';
import { focusFirst } from '../nav/spatial.js';
import { useBack } from '../nav/keys.js';
import { Wordmark } from '../components/Logo.jsx';
import { NetworkRow } from '../components/NetworkSettings.jsx';
import { UpdateRow } from '../components/SystemUpdate.jsx';
import { encodeQr, qrPath } from '../lib/qr.js';

/** Profile picker + add/edit playlist form. */
export function Login() {
  const profiles = useStore((s) => s.profiles);
  const [editing, setEditing] = useState(profiles.list.length ? null : {});
  const ref = useRef(null);

  useEffect(() => {
    requestAnimationFrame(() => focusFirst(ref.current));
  }, [editing]);

  // Back from the form returns to the picker (if there is anything to pick).
  useBack(() => {
    if (editing && profiles.list.length) {
      setEditing(null);
      return true;
    }
    if (getState().profileId && getState().catalog) {
      setState({ boot: 'ready' });
      return true;
    }
    powerOff();
    return true;
  });

  return (
    <div className="login" ref={ref}>
      <header className="login-head">
        <h1 className="sr-only">ONYX</h1>
        <Wordmark height="3.6rem" />
      </header>
      {editing ? (
        <ProfileForm
          key={editing.id || 'new'}
          initial={editing}
          canCancel={profiles.list.length > 0}
          onCancel={() => setEditing(null)}
          onSaved={async (p) => {
            await refreshProfiles();
            activateProfile(p.id, { force: !editing.id });
          }}
        />
      ) : (
        <>
          <h2 className="login-sub">Choose a playlist</h2>
          <div className="profile-grid" data-focus-group="profiles">
            {profiles.list.map((p, i) => (
              <div key={p.id} className="profile-tile-wrap">
                <Focusable
                  className="profile-tile"
                  autoFocus={p.id === profiles.activeId || (!profiles.activeId && i === 0)}
                  onSelect={() => activateProfile(p.id)}
                >
                  <Icon name="user" size="3rem" />
                  <span className="profile-name">{p.name}</span>
                  <small>{p.server.replace(/^https?:\/\//, '')}</small>
                </Focusable>
                <Focusable className="btn btn-small" onSelect={() => setEditing(p)}>
                  Edit
                </Focusable>
              </div>
            ))}
            <div className="profile-tile-wrap">
              <Focusable className="profile-tile profile-add" onSelect={() => setEditing({})}>
                <Icon name="plus" size="3rem" />
                <span className="profile-name">Add playlist</span>
              </Focusable>
            </div>
          </div>
          {!profiles.secureStorage && <p className="hint">No OS keystore detected: passwords are stored obfuscated, not encrypted.</p>}
        </>
      )}
    </div>
  );
}

function ProfileForm({ initial, onSaved, onCancel, canCancel }) {
  const [f, setF] = useState({
    id: initial.id,
    name: initial.name || '',
    server: initial.server || '',
    username: initial.username || '',
    password: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  // Details typed on a phone (QR code) fill the form; Save & connect is still pressed on the TV.
  useEffect(
    () =>
      api.on('phonelogin:submit', (p) => {
        setF((x) => ({ ...x, name: p.name || x.name, server: p.server, username: p.username, password: p.password }));
        setError('');
        toast('Details received from your phone — check them and press Save & connect', 5000);
        requestAnimationFrame(() => document.querySelector('.form [data-save]')?.focus());
      }),
    []
  );

  async function save() {
    if (!f.server || !f.username || (!f.id && !f.password)) {
      setError('Server URL, username and password are required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { profile } = await api.invoke('profiles:save', f);
      await onSaved(profile);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await confirmDialog({
      title: `Delete “${initial.name}”?`,
      message: 'Favourites and watch progress for this playlist will be removed.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await api.invoke('profiles:delete', initial.id);
    await refreshProfiles();
    onCancel();
  }

  return (
    <div className="form-with-qr">
      <div className="form" data-focus-group="form" data-focus-trap="up,down">
        <h2>{f.id ? 'Edit playlist' : 'Add Xtream Codes playlist'}</h2>
        <TextField label="Name" value={f.name} onChange={set('name')} placeholder="e.g. Living room" autoFocus />
        <TextField label="Server URL" value={f.server} onChange={set('server')} placeholder="http://provider.tv:8080" urlKeys />
        <TextField label="Username" value={f.username} onChange={set('username')} />
        <TextField label="Password" value={f.password} onChange={set('password')} mask placeholder={f.id ? 'Unchanged' : 'Required'} />
        {error && <p className="error-text">{error}</p>}
        <div className="row-buttons">
          <Focusable className="btn btn-primary" data-save="" onSelect={busy ? undefined : save}>
            {busy ? 'Connecting…' : 'Save & connect'}
          </Focusable>
          {canCancel && (
            <Focusable className="btn" onSelect={onCancel}>
              Cancel
            </Focusable>
          )}
          {f.id && (
            <Focusable className="btn btn-danger" onSelect={remove}>
              Delete
            </Focusable>
          )}
        </div>
        <SystemRows />
      </div>
      <PhoneQr />
    </div>
  );
}

/** QR code for typing the playlist details on a phone (served on the home network). */
function PhoneQr() {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let live = true;
    api
      .invoke('phonelogin:start')
      .then((r) => live && setUrl(r?.url || null))
      .catch(() => {});
    // A new code after each send (the old one is single-use).
    const off = api.on('phonelogin:submit', () => api.invoke('phonelogin:start').then((r) => live && setUrl(r?.url || null)));
    return () => {
      live = false;
      off();
      api.invoke('phonelogin:stop').catch(() => {});
    };
  }, []);
  if (!url) return null;
  const qr = encodeQr(url);
  const n = qr.size + 8;
  return (
    <aside className="phone-qr">
      <svg viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label="QR code">
        <rect width={n} height={n} fill="#fff" />
        <path d={qrPath(qr)} fill="#000" />
      </svg>
      <h3>Type it on your phone</h3>
      <p>Scan with your phone’s camera (same Wi-Fi), fill in the details there, and they appear here.</p>
      <small>{url.replace(/\/[0-9a-f]+$/, '/…')}</small>
    </aside>
  );
}

/** On the set-top box: Wi-Fi and updates are reachable before any playlist exists. */
function SystemRows() {
  const [updater, setUpdater] = useState(false);
  useEffect(() => {
    api
      .invoke('app:info')
      .then((i) => setUpdater(!!i?.updater))
      .catch(() => {});
  }, []);
  if (!updater) return null;
  return (
    <div className="login-system">
      <NetworkRow />
      <UpdateRow />
    </div>
  );
}
