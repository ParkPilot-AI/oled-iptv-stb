// Settings → General: "Adult channels: Hidden / Shown" and the optional 4-digit PIN.
import { useState } from 'react';
import { api } from '../lib/api.js';
import { setState, toast, refreshView } from '../lib/store.js';
import { Focusable } from './Focusable.jsx';
import { Modal } from './Modal.jsx';
import { VirtualKeyboard } from './VirtualKeyboard.jsx';

/** Number-pad dialog that resolves with a 4-digit PIN (or nothing when closed). */
export function PinDialog({ title, onDone, onClose }) {
  const [pin, setPin] = useState('');
  return (
    <Modal onClose={onClose} className="vkb-modal pin-modal">
      <h2>{title}</h2>
      <VirtualKeyboard value={pin} onChange={setPin} mask digits maxLength={4} placeholder="••••" doneLabel="OK" onDone={() => onDone(pin)} />
    </Modal>
  );
}

export function AdultRows({ settings }) {
  // dialog: null | 'unlock' | 'current' (before changing the PIN) | 'new'
  const [dialog, setDialog] = useState(null);
  const [current, setCurrent] = useState('');
  const apply = (s) => {
    setState({ settings: s });
    refreshView();
  };

  const toggle = async () => {
    if (settings.showAdult) {
      apply(await api.invoke('adult:show', { show: false }));
      return toast('Adult channels hidden');
    }
    if (settings.adultPinSet) return setDialog('unlock');
    apply(await api.invoke('adult:show', { show: true }));
    toast('Adult channels shown');
  };

  const onPin = async (pin) => {
    try {
      if (dialog === 'unlock') {
        apply(await api.invoke('adult:show', { show: true, pin }));
        toast('Adult channels shown');
        setDialog(null);
      } else if (dialog === 'current') {
        setCurrent(pin);
        setDialog('new');
      } else {
        apply(await api.invoke('adult:pin', { pin, current }));
        toast(pin ? 'PIN saved' : 'PIN removed');
        setCurrent('');
        setDialog(null);
      }
    } catch (e) {
      toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 4000);
      setCurrent('');
      setDialog(null);
    }
  };

  return (
    <>
      <Focusable className="setting-row" onSelect={toggle}>
        <span>Adult channels</span>
        <span className="setting-value">
          {settings.showAdult ? 'Shown' : 'Hidden'} <span className="muted">›</span>
        </span>
      </Focusable>
      <Focusable className="setting-row" onSelect={() => setDialog(settings.adultPinSet ? 'current' : 'new')}>
        <span>Adult channels PIN</span>
        <span className="setting-value muted">{settings.adultPinSet ? 'Set · OK to change' : 'Not set'}</span>
      </Focusable>
      {dialog && (
        <PinDialog
          key={dialog}
          title={
            dialog === 'unlock'
              ? 'Enter PIN to show adult channels'
              : dialog === 'current'
                ? 'Enter current PIN'
                : 'New 4-digit PIN (OK with none to remove it)'
          }
          onDone={onPin}
          onClose={() => {
            setCurrent('');
            setDialog(null);
          }}
        />
      )}
    </>
  );
}
