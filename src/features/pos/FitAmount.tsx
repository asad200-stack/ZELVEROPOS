import type { CSSProperties } from 'react';

/** One-line money. The font scales with the container and the number of characters so a large amount stays fully visible. */
export function FitAmount({ value, className }: { value: string; className?: string }) {
  const style = { '--chars': Math.max(value.length, 1) } as CSSProperties;
  return (
    <span className="fit-slot">
      <span className={['fit-amount', className].filter(Boolean).join(' ')} style={style}>
        {value}
      </span>
    </span>
  );
}
