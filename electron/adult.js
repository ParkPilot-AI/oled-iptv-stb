// Adult channels: Hidden by default; an optional 4-digit PIN guards switching to Shown.
// Only a salted hash of the PIN is stored, and the renderer never sees it.
import crypto from 'node:crypto';

export const hashPin = (pin) => crypto.createHash('sha256').update(`onyx-adult-pin:${pin}`).digest('hex');
export const validPin = (pin) => /^\d{4}$/.test(String(pin || ''));

/** Settings as sent to the renderer: the hash is replaced by a flag. */
export function publicSettings(s) {
  const { adultPinHash, ...rest } = s;
  return { ...rest, adultPinSet: !!adultPinHash };
}

/** Keys the renderer may not change through settings:update (they go through PIN checks). */
export const PROTECTED_KEYS = ['showAdult', 'adultPinHash', 'adultPinSet'];

/** Turn adult channels on/off. Showing them needs the PIN when one is set. */
export function showAdultPatch(s, { show, pin }) {
  if (show && s.adultPinHash && hashPin(pin) !== s.adultPinHash) throw new Error('Wrong PIN');
  return { showAdult: !!show };
}

/** Set, change or remove the PIN (current PIN required when one exists). */
export function pinPatch(s, { pin, current }) {
  if (s.adultPinHash && hashPin(current) !== s.adultPinHash) throw new Error('Wrong PIN');
  if (!pin) return { adultPinHash: '' };
  if (!validPin(pin)) throw new Error('The PIN must be 4 digits');
  return { adultPinHash: hashPin(pin) };
}
