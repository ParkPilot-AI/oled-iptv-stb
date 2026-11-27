import { forwardRef } from 'react';
import { favRegistry, favKey } from '../lib/store.js';

/**
 * A D-pad focus target. Enter triggers onSelect (via click()).
 * `favItem` registers the item so the global F key can toggle it.
 */
export const Focusable = forwardRef(function Focusable(
  { as: Tag = 'div', onSelect, onFocus, className = '', focusKey, autoFocus, disabled, favItem, children, ...rest },
  ref
) {
  let fav;
  if (favItem) {
    fav = favKey(favItem);
    favRegistry.set(fav, favItem);
  }
  return (
    <Tag
      ref={ref}
      tabIndex={-1}
      data-focusable=""
      data-focus-key={focusKey}
      data-autofocus={autoFocus ? '' : undefined}
      data-disabled={disabled ? '' : undefined}
      data-fav={fav}
      className={`focusable ${className}`}
      onClick={disabled ? undefined : onSelect}
      onFocus={onFocus}
      {...rest}
    >
      {children}
    </Tag>
  );
});
