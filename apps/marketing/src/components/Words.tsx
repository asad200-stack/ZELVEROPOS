import { Fragment } from 'react';

/** Splits text into masked words that rise into place (driven by CSS on an ancestor). */
export function Words({ text, offset = 0, className }: { text: string; offset?: number; className?: string }) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <>
      {words.map((w, i) => (
        <Fragment key={`${w}-${i}`}>
          <span className="zw-w" aria-hidden>
            <span className={className} style={{ ['--i' as string]: i + offset }}>
              {w}
            </span>
          </span>
          {i < words.length - 1 ? ' ' : null}
        </Fragment>
      ))}
      <span className="zw-sr">{text}</span>
    </>
  );
}
