import { useState } from 'react';
import { haptic } from '../haptics';
import { playSound } from '../sound/engine';
import { GlassCard } from './GlassCard';

export function CreditStory() {
  const [added, setAdded] = useState(false);
  const collect = added ? 600 : 500;
  return (
    <GlassCard className="zw-credit">
      <dl className="zw-credit__steps">
        <div>
          <dt>Previous balance</dt>
          <dd>$100</dd>
        </div>
        <div>
          <dt>New purchase</dt>
          <dd>$500</dd>
        </div>
        <div>
          <dt>Total to collect</dt>
          <dd key={collect} className="zw-credit__anim">
            ${collect}
          </dd>
        </div>
      </dl>
      <button
        type="button"
        className="zw-btn zw-btn--secondary zw-btn--sm"
        onClick={() => {
          setAdded((v) => !v);
          playSound('demo');
          haptic(12);
        }}
      >
        {added ? 'Remove Previous' : 'Add Previous'}
      </button>
      <p className="zw-note">ZELVERO records the new sale and old debt collection separately.</p>
    </GlassCard>
  );
}
