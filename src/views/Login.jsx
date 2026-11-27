import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore, activateProfile, refreshProfiles, confirmDialog, getState, setState } from '../lib/store.js';
import { Focusable } from '../components/Focusable.jsx';
import { TextField } from '../components/VirtualKeyboard.jsx';
import { Icon } from '../components/Icons.jsx';
import { focusFirst } from '../nav/spatial.js';
import { useBack } from '../nav/keys.js';

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
    confirmDialog({ title: 'Exit OLED IPTV?', confirmLabel: 'Exit', danger: true }).then((ok) => ok && api.invoke('app:quit'));
    return true;
  });

  return (
    <div className="login" ref={ref}>
      <header className="login-head">
        <span className="rail-dot" />
        <h1>OLED IPTV</h1>
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
          <h2 className="login-sub">Who’s watching?</h2>
          <div className="profile-grid" data-focus-group="profiles">
            {profiles.list.map((p, i) => (
              <div key={p.id} className="profile-tile-wrap">
                <Focusable className="profile-tile" autoFocus={p.id === profiles.activeId || (!profiles.activeId && i === 0)} onSelect={() => activateProfile(p.id)}>
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
    const ok = await confirmDialog({ title: `Delete “${initial.name}”?`, message: 'Favorites and watch progress for this playlist will be removed.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await api.invoke('profiles:delete', initial.id);
    await refreshProfiles();
    onCancel();
  }

  return (
    <div className="form" data-focus-group="form" data-focus-trap="up,down">
      <h2>{f.id ? 'Edit playlist' : 'Add Xtream Codes playlist'}</h2>
      <TextField label="Name" value={f.name} onChange={set('name')} placeholder="e.g. Living room" autoFocus />
      <TextField label="Server URL" value={f.server} onChange={set('server')} placeholder="http://provider.tv:8080" urlKeys />
      <TextField label="Username" value={f.username} onChange={set('username')} />
      <TextField label="Password" value={f.password} onChange={set('password')} mask placeholder={f.id ? 'Unchanged' : 'Required'} />
      {error && <p className="error-text">{error}</p>}
      <div className="row-buttons">
        <Focusable className="btn btn-primary" onSelect={busy ? undefined : save}>
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
    </div>
  );
}
