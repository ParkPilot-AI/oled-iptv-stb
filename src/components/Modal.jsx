import { useEffect, useLayoutEffect, useRef } from 'react';
import { pushScope, focusFirst } from '../nav/spatial.js';
import { useBack } from '../nav/keys.js';
import { Focusable } from './Focusable.jsx';
import { useStore, setState } from '../lib/store.js';
import { feedback } from '../lib/feedback.js';

/** Focus-trapping overlay. Back closes it; focus returns to the opener. */
export function Modal({ onClose, children, className = '', priority = 100 }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const pop = pushScope(ref.current);
    focusFirst(ref.current);
    feedback('open');
    return pop;
  }, []);
  useBack(() => (onClose?.(), true), { priority });
  return (
    <div className="modal-backdrop">
      <div ref={ref} className={`modal ${className}`} role="dialog">
        {children}
      </div>
    </div>
  );
}

/** Global confirm dialog driven by confirmDialog() in the store. */
export function ConfirmHost() {
  const c = useStore((s) => s.confirm);
  if (!c) return null;
  const done = (v) => {
    setState({ confirm: null });
    c.resolve(v);
  };
  return (
    <Modal onClose={() => done(false)} priority={200} className="confirm">
      <h2>{c.title}</h2>
      {c.message && <p>{c.message}</p>}
      <div className="row-buttons">
        <Focusable className="btn" onSelect={() => done(false)} autoFocus>
          {c.cancelLabel || 'Cancel'}
        </Focusable>
        <Focusable className={`btn ${c.danger ? 'btn-danger' : 'btn-primary'}`} onSelect={() => done(true)}>
          {c.confirmLabel || 'OK'}
        </Focusable>
      </div>
    </Modal>
  );
}

export function ToastHost() {
  const t = useStore((s) => s.toast);
  return t ? (
    <div className="toast" key={t.id}>
      {t.message}
    </div>
  ) : null;
}

/** Cycles the root element by a couple of pixels to spread static UI wear on OLED. */
export function usePixelShift(ref, everyMs = 120000, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const offsets = [
      [0, 0],
      [2, 1],
      [1, -2],
      [-2, -1],
      [-1, 2],
    ];
    let i = 0;
    const t = setInterval(() => {
      i = (i + 1) % offsets.length;
      if (ref.current) ref.current.style.transform = `translate(${offsets[i][0]}px, ${offsets[i][1]}px)`;
    }, everyMs);
    return () => clearInterval(t);
  }, [ref, everyMs, enabled]);
}
