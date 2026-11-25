import { useState, type CSSProperties } from 'react';

interface Props {
  topUrl: string;
  bottomUrl: string;
  /** Where the top ends, % of the photo's height from the top. */
  hem: number;
  className?: string;
  alt: string;
}

const BOX: CSSProperties = { display: 'block', overflow: 'visible' };
const PHOTO: CSSProperties = { position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', height: '100%' };

/** Soft edge where the top meets the bottom, in % of the photo height. */
const FEATHER = 1.4;

/**
 * The model wearing two pieces: the top's photo down to its hem, the bottom's photo below it.
 * Both photos are taken on the same mannequin in the same spot, so they line up; the cut is
 * measured on the photo itself (the box takes the photo's shape), not on the space around it.
 */
export default function OutfitModel({ topUrl, bottomUrl, hem, className, alt }: Props) {
  const [ratio, setRatio] = useState(3 / 4);
  const fill: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill' };
  const mask = `linear-gradient(to bottom, #000 ${hem - FEATHER}%, transparent ${hem + FEATHER}%)`;
  return (
    <span className={className} role="img" aria-label={alt} style={BOX}>
      <span style={{ ...PHOTO, aspectRatio: String(ratio) }}>
        <img src={bottomUrl} alt="" draggable={false} decoding="async" style={{ ...fill, clipPath: `inset(${hem - FEATHER}% 0 0 0)` }} />
        <img
          src={topUrl}
          alt=""
          draggable={false}
          decoding="async"
          onLoad={(e) => {
            const i = e.currentTarget;
            if (i.naturalWidth > 0 && i.naturalHeight > 0) setRatio(i.naturalWidth / i.naturalHeight);
          }}
          style={{ ...fill, maskImage: mask, WebkitMaskImage: mask }}
        />
      </span>
    </span>
  );
}
