// Windowed list/grid with fixed row height. Renders only visible rows (+overscan)
// so 10,000+ channels scroll at full frame rate on an i3 iGPU.
// PageUp/PageDown jump a page while focus is inside; `initialIndex` focuses/scrolls on mount.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useKeyHandler } from '../nav/keys.js';
import { focusEl } from '../nav/spatial.js';

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

export const VirtualGrid = forwardRef(function VirtualGrid(
  { items, columns = 1, rowHeight, renderItem, overscan = 3, className = '', group, trap = 'up,down', empty = null, onRangeChange, ...rest },
  ref
) {
  const box = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(800);
  const [rem, setRem] = useState(16);
  const pending = useRef(null);
  const rowPx = rowHeight * rem;
  const rows = Math.ceil(items.length / columns);

  useLayoutEffect(() => {
    const el = box.current;
    const ro = new ResizeObserver(() => {
      setViewH(el.clientHeight);
      setRem(remPx());
    });
    ro.observe(el);
    setRem(remPx());
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    const top = box.current.scrollTop;
    requestAnimationFrame(() => setScrollTop(top));
  }, []);

  const focusIndex = useCallback(
    (i, { scroll = true } = {}) => {
      if (!items.length) return;
      i = Math.max(0, Math.min(items.length - 1, i));
      const row = Math.floor(i / columns);
      const el = box.current;
      if (scroll) {
        const top = row * rowPx;
        if (top < el.scrollTop || top + rowPx > el.scrollTop + el.clientHeight) {
          el.scrollTop = Math.max(0, top - el.clientHeight / 2 + rowPx / 2);
          setScrollTop(el.scrollTop);
        }
      }
      const target = el.querySelector(`[data-index="${i}"] [data-focusable], [data-index="${i}"][data-focusable]`);
      if (target) focusEl(target);
      else pending.current = i;
    },
    [items.length, columns, rowPx]
  );

  useImperativeHandle(ref, () => ({ focusIndex, element: box.current }), [focusIndex]);

  useEffect(() => {
    if (pending.current == null) return;
    const i = pending.current;
    const t = box.current.querySelector(`[data-index="${i}"] [data-focusable], [data-index="${i}"][data-focusable]`);
    if (t) {
      pending.current = null;
      focusEl(t);
    }
  });

  // Reset scroll when the data set changes (e.g. switching category).
  useEffect(() => {
    if (box.current) box.current.scrollTop = 0;
    setScrollTop(0);
  }, [items]);

  useKeyHandler((action) => {
    if (action !== 'chUp' && action !== 'chDown') return false;
    const active = document.activeElement;
    if (!box.current?.contains(active)) return false;
    const holder = active.closest('[data-index]');
    const cur = holder ? Number(holder.dataset.index) : 0;
    const pageRows = Math.max(1, Math.floor(viewH / rowPx) - 1);
    focusIndex(cur + (action === 'chDown' ? 1 : -1) * pageRows * columns);
    return true;
  });

  const first = Math.max(0, Math.floor(scrollTop / rowPx) - overscan);
  const last = Math.min(rows - 1, Math.ceil((scrollTop + viewH) / rowPx) + overscan);
  useEffect(() => {
    onRangeChange?.(first * columns, Math.min(items.length - 1, (last + 1) * columns - 1));
  }, [first, last, columns, items, onRangeChange]);
  const cells = [];
  for (let r = first; r <= last; r++) {
    for (let c = 0; c < columns; c++) {
      const i = r * columns + c;
      if (i >= items.length) break;
      cells.push(
        <div
          key={i}
          data-index={i}
          className="vcell"
          style={{ top: r * rowPx, left: `${(c / columns) * 100}%`, width: `${100 / columns}%`, height: rowPx }}
        >
          {renderItem(items[i], i)}
        </div>
      );
    }
  }

  return (
    <div ref={box} className={`vgrid ${className}`} onScroll={onScroll} data-focus-group={group} data-focus-trap={trap} {...rest}>
      {items.length === 0 ? empty : <div style={{ height: rows * rowPx, position: 'relative' }}>{cells}</div>}
    </div>
  );
});

export const VirtualList = forwardRef(function VirtualList(props, ref) {
  return <VirtualGrid ref={ref} columns={1} {...props} />;
});
