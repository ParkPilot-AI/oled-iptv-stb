// Settings → General → Profiles: switch, add, rename, Kids, PIN, delete, and whether
// to ask "Who's watching?" at start. Not available from a Kids profile.
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useStore, setState, refreshViewers, toast, confirmDialog } from '../lib/store.js';
import { Focusable } from './Focusable.jsx';
import { Modal } from './Modal.jsx';
import { TextField } from './VirtualKeyboard.jsx';
import { PinDialog } from './AdultSettings.jsx';

const errText = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function ProfileRows() {
  const viewers = useStore((s) => s.viewers);
  const viewer = useStore((s) => s.viewer);
  const [editing, setEditing] = useState(null); // viewer | {} (new) | null
  const kids = !!viewer?.kids;
  return (
    <>
      <Focusable className="setting-row" onSelect={() => setState({ boot: 'viewer' })}>
        <span>Switch profile</span>
        <span className="setting-value muted">{viewer?.name || '—'} ›</span>
      </Focusable>
      {kids ? (
        <p className="settings-reason">Profiles can be changed from a grown-up’s profile.</p>
      ) : (
        <>
          {viewers.list.map((v) => (
            <Focusable key={v.id} className="setting-row" onSelect={() => setEditing(v)}>
              <span>
                {v.name}
                {v.id === viewers.activeId && <span className="muted"> · in use</span>}
              </span>
              <span className="setting-value muted">{[v.kids && 'Kids', v.locked && 'PIN'].filter(Boolean).join(' · ') || 'Edit'} ›</span>
            </Focusable>
          ))}
          {viewers.list.length < 8 && (
            <Focusable className="setting-row" onSelect={() => setEditing({})}>
              <span>Add profile</span>
              <span className="setting-value muted">+</span>
            </Focusable>
          )}
          <Focusable
            className="setting-row"
            onSelect={async () => {
              try {
                setState({ viewers: await api.invoke('viewers:askOnStart', { on: !viewers.askOnStart }) });
              } catch (e) {
                toast(errText(e));
              }
            }}
          >
            <span>Ask “Who’s watching?” at start</span>
            <span className={`switch ${viewers.askOnStart ? 'is-on' : ''}`} role="switch" aria-checked={viewers.askOnStart}>
              <i />
            </span>
          </Focusable>
        </>
      )}
      {editing && <ProfileEditor viewer={editing.id ? editing : null} onClose={() => setEditing(null)} />}
    </>
  );
}

/** Add or edit one profile: name, Kids, PIN, delete. */
export function ProfileEditor({ viewer, onClose }) {
  const active = useStore((s) => s.viewers.activeId);
  const [name, setName] = useState(viewer?.name || '');
  const [kids, setKids] = useState(!!viewer?.kids);
  const [pinStep, setPinStep] = useState(null); // 'unlock' | 'current' | 'new' | null
  const [unlock, setUnlock] = useState(''); // PIN of another locked profile, to edit it
  const [current, setCurrent] = useState('');
  const needUnlock = viewer?.locked && viewer.id !== active && !unlock;

  const run = async (fn, ok) => {
    try {
      await fn();
      await refreshViewers();
      if (ok) toast(ok);
      return true;
    } catch (e) {
      toast(errText(e), 3500);
      return false;
    }
  };
  const save = () =>
    run(() => api.invoke('viewers:save', { id: viewer?.id, name, kids, pin: unlock }), viewer ? 'Profile saved' : `Added ${name.trim()}`).then(
      (ok) => ok && onClose()
    );
  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete “${viewer.name}”?`,
      message: 'Their favourites and Continue Watching are removed from this TV.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok && (await run(() => api.invoke('viewers:remove', { id: viewer.id, pin: unlock }), 'Profile deleted'))) onClose();
  };
  const onPin = async (pin) => {
    const step = pinStep;
    setPinStep(null);
    if (step === 'unlock') return setUnlock(pin);
    if (step === 'current') {
      setCurrent(pin);
      return setPinStep('new');
    }
    await run(() => api.invoke('viewers:pin', { id: viewer.id, pin, current: current || unlock }), pin ? 'PIN saved' : 'PIN removed');
    setCurrent('');
  };

  return (
    <Modal onClose={onClose} className="profile-editor">
      <h2>{viewer ? `Edit ${viewer.name}` : 'Add profile'}</h2>
      {needUnlock ? (
        <>
          <p className="muted">This profile is locked.</p>
          <div className="row-buttons">
            <Focusable className="btn btn-primary" autoFocus onSelect={() => setPinStep('unlock')}>
              Enter its PIN
            </Focusable>
            <Focusable className="btn" onSelect={onClose}>
              Cancel
            </Focusable>
          </div>
        </>
      ) : (
        <>
          <TextField label="Name" value={name} onChange={setName} placeholder="e.g. Sam" autoFocus />
          <Focusable className="setting-row" onSelect={() => setKids(!kids)}>
            <span>Kids profile (no adult content)</span>
            <span className={`switch ${kids ? 'is-on' : ''}`} role="switch" aria-checked={kids}>
              <i />
            </span>
          </Focusable>
          {viewer && (
            <Focusable className="setting-row" onSelect={() => setPinStep(viewer.locked && viewer.id === active ? 'current' : 'new')}>
              <span>{viewer.locked ? 'Change or remove PIN' : 'Lock with a PIN'}</span>
              <span className="setting-value muted">{viewer.locked ? 'On' : 'Off'} ›</span>
            </Focusable>
          )}
          <div className="row-buttons">
            <Focusable className="btn btn-primary" onSelect={save}>
              {viewer ? 'Save' : 'Add'}
            </Focusable>
            <Focusable className="btn" onSelect={onClose}>
              Cancel
            </Focusable>
            {viewer && viewer.id !== 'main' && (
              <Focusable className="btn btn-danger" onSelect={remove}>
                Delete
              </Focusable>
            )}
          </div>
        </>
      )}
      {pinStep && (
        <PinDialog
          title={{ unlock: `PIN for ${viewer?.name}`, current: 'Current PIN', new: 'New PIN (leave empty to remove)' }[pinStep]}
          onClose={() => setPinStep(null)}
          onDone={onPin}
        />
      )}
    </Modal>
  );
}
