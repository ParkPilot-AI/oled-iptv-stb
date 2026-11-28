// Deterministic 2D spatial focus engine.
//
// - Any element with [data-focusable] is a focus target (tabIndex=-1, real DOM focus).
// - Focus moves to the geometrically best candidate in the pressed direction
//   inside the current *scope* (modals push a scope; nothing outside is reachable).
// - [data-focus-group="name"] remembers its last focused child, so leaving and
//   re-entering a column/row/rail restores your position.
// - [data-focus-trap="up,down"] on a group keeps those directions inside it
//   (lists don't "fall out" sideways when you hit the end).
// - [data-nav-<dir>="none"|"<css selector>"] on an element overrides a direction.
// - If the focused element disappears (virtualised list, view change), the
//   element nearest to the last focused rectangle is recovered.

// Disabled controls (Focusable disabled → data-disabled) are never focus targets.
export const SEL = '[data-focusable]:not([data-disabled])';
const scopes = [];
const memory = new Map();
let lastRect = null;

export const currentScope = () => (scopes.length ? scopes[scopes.length - 1].el : document.body);

export function pushScope(el) {
  const entry = { el, restore: document.activeElement };
  scopes.push(entry);
  return () => {
    const i = scopes.indexOf(entry);
    if (i === -1) return;
    scopes.splice(i, 1);
    if (i === scopes.length && entry.restore?.isConnected) focusEl(entry.restore);
  };
}

const isVisible = (el) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

export const focusables = (scope = currentScope()) => [...scope.querySelectorAll(SEL)].filter(isVisible);
const groupEl = (el) => el.closest('[data-focus-group]');
const groupName = (el) => groupEl(el)?.getAttribute('data-focus-group') || null;

export function focusEl(el, { scroll = true } = {}) {
  if (!el) return false;
  el.focus({ preventScroll: true });
  const g = groupName(el);
  if (g) memory.set(g, el);
  if (scroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  lastRect = el.getBoundingClientRect();
  return true;
}

export function rememberedIn(group) {
  const el = memory.get(group);
  return el?.isConnected ? el : null;
}

export function focusFirst(root = currentScope()) {
  const auto = [...root.querySelectorAll(`${SEL}[data-autofocus]`)].find(isVisible);
  return focusEl(auto || focusables(root)[0]);
}

export function focusGroup(group, root = currentScope()) {
  const mem = rememberedIn(group);
  if (mem && root.contains(mem) && isVisible(mem)) return focusEl(mem);
  const g = root.querySelector(`[data-focus-group="${CSS.escape(group)}"]`);
  if (!g) return false;
  const def = g.querySelector(`${SEL}[data-focus-default]`);
  return def && isVisible(def) ? focusEl(def) : focusFirst(g);
}

export function focusByKey(key, root = currentScope()) {
  const el = root.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
  return el ? focusEl(el) : false;
}

function nearestTo(rect, list) {
  if (!rect) return null;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let best = null;
  let bd = Infinity;
  for (const el of list) {
    const r = el.getBoundingClientRect();
    const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
    if (d < bd) {
      bd = d;
      best = el;
    }
  }
  return best;
}

/** Lower is better; Infinity = not in that direction. */
export function score(a, b, dir) {
  const acx = a.left + a.width / 2;
  const acy = a.top + a.height / 2;
  const bcx = b.left + b.width / 2;
  const bcy = b.top + b.height / 2;
  let primary;
  let orthoGap;
  let orthoCenter;
  switch (dir) {
    case 'right':
      if (!(bcx > acx + 1 && b.left >= a.right - a.width * 0.3)) return Infinity;
      primary = Math.max(0, b.left - a.right);
      orthoGap = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
      orthoCenter = Math.abs(bcy - acy);
      break;
    case 'left':
      if (!(bcx < acx - 1 && b.right <= a.left + a.width * 0.3)) return Infinity;
      primary = Math.max(0, a.left - b.right);
      orthoGap = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
      orthoCenter = Math.abs(bcy - acy);
      break;
    case 'down':
      if (!(bcy > acy + 1 && b.top >= a.bottom - a.height * 0.3)) return Infinity;
      primary = Math.max(0, b.top - a.bottom);
      orthoGap = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
      orthoCenter = Math.abs(bcx - acx);
      break;
    case 'up':
      if (!(bcy < acy - 1 && b.bottom <= a.top + a.height * 0.3)) return Infinity;
      primary = Math.max(0, a.top - b.bottom);
      orthoGap = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
      orthoCenter = Math.abs(bcx - acx);
      break;
    default:
      return Infinity;
  }
  return primary + orthoGap * 6 + orthoCenter * 0.15;
}

export function move(dir) {
  const scope = currentScope();
  const cur = document.activeElement;
  if (!cur || !cur.matches?.(SEL) || !scope.contains(cur) || !isVisible(cur)) {
    const list = focusables(scope);
    return focusEl(nearestTo(lastRect, list) || list[0]);
  }

  const override = cur.getAttribute(`data-nav-${dir}`);
  if (override === 'none') return false;
  if (override) {
    const t = scope.querySelector(override);
    if (t) return focusEl(t);
  }

  const curGroup = groupEl(cur);
  const trapped = curGroup?.getAttribute('data-focus-trap')?.split(',').includes(dir);
  const pool = trapped ? focusables(curGroup) : focusables(scope);

  const r = cur.getBoundingClientRect();
  let best = null;
  let bestScore = Infinity;
  const fromSide = !!cur.closest('[data-focus-side]');
  for (const el of pool) {
    if (el === cur) continue;
    // The side menu is entered with Left only, never by moving up/down the page.
    if (!fromSide && dir !== 'left' && el.closest('[data-focus-side]')) continue;
    const s = score(r, el.getBoundingClientRect(), dir);
    if (s < bestScore) {
      bestScore = s;
      best = el;
    }
  }
  if (!best) return false;

  // Entering a different group restores that group's remembered element
  // (or its [data-focus-default] child the first time).
  const bg = groupName(best);
  if (bg && bg !== groupName(cur)) {
    const mem = rememberedIn(bg) || groupEl(best).querySelector('[data-focus-default]');
    if (mem && mem !== best && scope.contains(mem) && isVisible(mem) && score(r, mem.getBoundingClientRect(), dir) < Infinity) {
      best = mem;
    }
  }
  return focusEl(best);
}

/** Track focus changes made by clicks/programmatic focus too. */
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el?.matches?.(SEL)) {
      const g = groupName(el);
      if (g) memory.set(g, el);
      lastRect = el.getBoundingClientRect();
    }
  });
}
