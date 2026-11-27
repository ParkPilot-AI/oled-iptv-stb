// D-pad on-screen keyboard. Also accepts physical typing (printable keys,
// Backspace deletes instead of going back while the keyboard is active).
import { useState } from 'react';
import { Focusable } from './Focusable.jsx';
import { Icon } from './Icons.jsx';
import { Modal } from './Modal.jsx';
import { useKeyHandler } from '../nav/keys.js';

const LAYOUTS = {
  abc: ['abcdefghij', 'klmnopqrst', 'uvwxyz-_.@'],
  sym: ['1234567890', '!#$%&*()/:', '+=?;\'",~|\\'],
};

export function VirtualKeyboard({ value, onChange, onDone, mask = false, placeholder = '', showValue = true, doneLabel = 'Done', group = 'vkb', urlKeys = false, active = true }) {
  const [layout, setLayout] = useState('abc');
  const [shift, setShift] = useState(false);

  const insert = (ch) => onChange(value + ch);
  const backspace = () => onChange(value.slice(0, -1));

  // Physical keyboard typing.
  useKeyHandler(
    (action, e) => {
      if (e.key === 'Backspace') {
        backspace();
        return true;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Space/letters would otherwise map to play/fav/info actions.
        insert(e.key);
        return true;
      }
      return false;
    },
    { priority: 50, enabled: active }
  );

  const rows = LAYOUTS[layout].map((r) => [...r].map((c) => (shift && layout === 'abc' ? c.toUpperCase() : c)));

  return (
    <div className="vkb" data-focus-group={group}>
      {showValue && (
        <div className={`vkb-value ${value ? '' : 'is-empty'}`}>
          {value ? (mask ? '•'.repeat(value.length - 1) + value.slice(-1) : value) : placeholder}
          <span className="caret" />
        </div>
      )}
      {urlKeys && (
        <div className="vkb-row">
          {['http://', 'https://', '.com', '.net', ':8080', '/'].map((s) => (
            <Focusable key={s} className="vkb-key vkb-wide" onSelect={() => insert(s)}>
              {s}
            </Focusable>
          ))}
        </div>
      )}
      {rows.map((row, ri) => (
        <div className="vkb-row" key={ri}>
          {row.map((c, ci) => (
            <Focusable key={c} className="vkb-key" onSelect={() => insert(c)} autoFocus={ri === 0 && ci === 0}>
              {c}
            </Focusable>
          ))}
        </div>
      ))}
      <div className="vkb-row">
        <Focusable className={`vkb-key vkb-wide ${shift ? 'is-on' : ''}`} onSelect={() => setShift((s) => !s)} disabled={layout !== 'abc'}>
          <Icon name="shift" />
        </Focusable>
        <Focusable className="vkb-key vkb-wide" onSelect={() => setLayout((l) => (l === 'abc' ? 'sym' : 'abc'))}>
          {layout === 'abc' ? '123' : 'abc'}
        </Focusable>
        <Focusable className="vkb-key vkb-space" onSelect={() => insert(' ')}>
          <Icon name="space" />
        </Focusable>
        <Focusable className="vkb-key vkb-wide" onSelect={backspace}>
          <Icon name="backspace" />
        </Focusable>
        <Focusable className="vkb-key vkb-wide" onSelect={() => onChange('')}>
          Clear
        </Focusable>
        {onDone && (
          <Focusable className="vkb-key vkb-wide vkb-done" onSelect={onDone}>
            {doneLabel}
          </Focusable>
        )}
      </div>
    </div>
  );
}

/** A form field that opens the on-screen keyboard in a modal. */
export function TextField({ label, value, onChange, mask, placeholder, urlKeys, ...rest }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const open = () => {
    setDraft(value);
    setEditing(true);
  };
  return (
    <>
      <Focusable className="textfield" onSelect={open} {...rest}>
        <span className="textfield-label">{label}</span>
        <span className={`textfield-value ${value ? '' : 'is-empty'}`}>{value ? (mask ? '•'.repeat(value.length) : value) : placeholder || 'Not set'}</span>
      </Focusable>
      {editing && (
        <Modal onClose={() => setEditing(false)} className="vkb-modal">
          <h2>{label}</h2>
          <VirtualKeyboard
            value={draft}
            onChange={setDraft}
            mask={mask}
            placeholder={placeholder}
            urlKeys={urlKeys}
            onDone={() => {
              onChange(draft.trim());
              setEditing(false);
            }}
          />
        </Modal>
      )}
    </>
  );
}
