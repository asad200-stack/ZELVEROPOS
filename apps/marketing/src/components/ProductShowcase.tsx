import { useState } from 'react';
import { FEATURES, type FeatureId } from '../content/features';
import { playSound } from '../sound/engine';
import { PosInterface } from './PosInterface';

const TABS: { id: FeatureId; scene: 'pos' | 'inventory' | 'customers' | 'suppliers' | 'reports' | 'drawer' }[] = [
  { id: 'pos', scene: 'pos' },
  { id: 'inventory', scene: 'inventory' },
  { id: 'customers', scene: 'customers' },
  { id: 'suppliers', scene: 'suppliers' },
  { id: 'reports', scene: 'reports' },
  { id: 'drawer', scene: 'drawer' },
];

const POS_CALLOUTS = ['Fast products', 'Cart', 'Customer', 'Full payment / Credit sale', 'Previous balance', 'USD / LBP', 'Checkout'];

export function ProductShowcase() {
  const [tab, setTab] = useState<(typeof TABS)[number]>(TABS[0]);
  const feature = FEATURES.find((f) => f.id === tab.id)!;
  return (
    <div className="zw-showcase">
      <div className="zw-tabs" role="tablist" aria-label="Product areas">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab.id === item.id}
            className={tab.id === item.id ? 'is-on' : ''}
            onClick={() => {
              setTab(item);
              playSound('demo');
            }}
          >
            {FEATURES.find((f) => f.id === item.id)?.name}
          </button>
        ))}
      </div>
      <div className="zw-showcase__body">
        <div key={tab.scene} className="zw-showcase__scene">
          <PosInterface scene={tab.scene} />
        </div>
        {tab.id === 'pos' ? (
          <ul className="zw-callouts">
            {POS_CALLOUTS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="zw-lead">{feature.summary}</p>
        )}
      </div>
    </div>
  );
}
