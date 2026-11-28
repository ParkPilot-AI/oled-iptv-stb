// "Who's watching?": household profiles, each with their own favourites, Continue
// Watching and theme. Locked profiles ask for their PIN; Kids profiles never see
// adult content. Shown at start (Settings → General → Profiles can turn that off)
// and from Settings → General → Switch profile.
import { useEffect, useRef, useState } from 'react';
import { useStore, chooseViewer, setState, getState, powerOff, toast } from '../lib/store.js';
import { useBack } from '../nav/keys.js';
import { focusFirst } from '../nav/spatial.js';
import { Focusable } from '../components/Focusable.jsx';
import { Icon } from '../components/Icons.jsx';
import { Wordmark } from '../components/Logo.jsx';
import { PinDialog } from '../components/AdultSettings.jsx';
import { ProfileEditor } from '../components/ProfileSettings.jsx';

export const errText = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function Avatar({ viewer, size = '6rem' }) {
  return (
    <span className="avatar" style={{ '--avatar': viewer.colour, width: size, height: size, fontSize: `calc(${size} * 0.45)` }}>
      {(viewer.name || '?').slice(0, 1).toUpperCase()}
    </span>
  );
}

export function WhoIsWatching() {
  const viewers = useStore((s) => s.viewers);
  const ref = useRef(null);
  const [pinFor, setPinFor] = useState(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => focusFirst(ref.current));
  }, []);

  // Back: return to the menus when switching from Settings; at start, the power menu.
  useBack(() => {
    if (getState().catalogRaw && getState().profileId) setState({ boot: 'ready' });
    else powerOff();
    return true;
  });

  const pick = async (v, pin) => {
    try {
      await chooseViewer(v.id, pin);
    } catch (e) {
      toast(errText(e), 3500);
    }
  };

  return (
    <div className="login who" ref={ref}>
      <header className="login-head">
        <Wordmark height="3.6rem" />
      </header>
      <h2 className="login-sub">Who’s watching?</h2>
      <div className="profile-grid" data-focus-group="viewers">
        {viewers.list.map((v) => (
          <div key={v.id} className="profile-tile-wrap">
            <Focusable className="profile-tile viewer-tile" autoFocus={v.id === viewers.activeId} onSelect={() => (v.locked ? setPinFor(v) : pick(v))}>
              <Avatar viewer={v} />
              <span className="profile-name">{v.name}</span>
              <small>
                {v.kids && <span className="kids-badge">Kids</span>}
                {v.locked && <Icon name="lock" size="1rem" />}
              </small>
            </Focusable>
          </div>
        ))}
        {viewers.list.length < 8 && (
          <div className="profile-tile-wrap">
            <Focusable className="profile-tile profile-add" onSelect={() => setAdding(true)}>
              <Icon name="plus" size="3rem" />
              <span className="profile-name">Add profile</span>
            </Focusable>
          </div>
        )}
      </div>
      {pinFor && (
        <PinDialog
          title={`PIN for ${pinFor.name}`}
          onClose={() => setPinFor(null)}
          onDone={(pin) => {
            const v = pinFor;
            setPinFor(null);
            pick(v, pin);
          }}
        />
      )}
      {adding && <ProfileEditor onClose={() => setAdding(false)} />}
    </div>
  );
}
