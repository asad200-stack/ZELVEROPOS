import type { KeyboardEvent } from 'react';

/** Props for a table row that opens something on click, Enter or Space. */
export function clickableRow(onActivate: () => void) {
  return {
    className: 'clickable',
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
  };
}
