import { useState, type FormEvent } from 'react';
import { track } from '../analytics';
import { haptic } from '../haptics';
import {
  EMPTY_QUOTE,
  QUOTE_STEPS,
  businessLabel,
  canAdvance,
  recommendedSetup,
  type QuoteDraft,
  type QuoteStep,
} from '../quote/model';
import { playSound } from '../sound/engine';
import { Link } from 'react-router';
import { readReferral } from '../referral';
import { callSales, clearOperation, formStartedAt, operationId } from '../sales/client';
import { recoverSalesForm } from '../sales/formError';
import { Button } from './Button';
import { GlassCard } from './GlassCard';

function SetupPanel({ draft }: { draft: QuoteDraft }) {
  return (
    <aside className="zw-quote-live" aria-live="polite">
      <p className="zw-eyebrow">Your ZELVERO setup</p>
      <p>
        Business: {businessLabel(draft.businessType)}
        <br />
        Branches: {draft.branches}
        <br />
        Users: {draft.users}
        <br />
        POS devices: {draft.posDevices}
      </p>
      <p className="zw-note">Recommended</p>
      <ul className="zw-bullets">
        {recommendedSetup(draft).map((item) => (
          <li key={item}>✓ {item}</li>
        ))}
      </ul>
    </aside>
  );
}

export function QuoteWizard() {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<QuoteDraft>(EMPTY_QUOTE);
  const [sent, setSent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const label = QUOTE_STEPS[step];
  const last = label === 'Your recommended ZELVERO setup';
  const patch = (p: Partial<QuoteDraft>) => setDraft((d) => ({ ...d, ...p }));

  const go = (next: number) => {
    setError('');
    setStep(next);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!last) {
      if (!canAdvance(label, draft)) {
        setError('Please complete the required fields.');
        return;
      }
      if (step === 0) track('quote_start');
      playSound('nav');
      go(Math.min(step + 1, QUOTE_STEPS.length - 1));
      return;
    }
    setBusy(true);
    void (async () => {
      try {
        const result = await callSales<{ reference: string }>('submitWebsiteLead', {
          source: 'quote',
          name: draft.name,
          businessName: draft.company,
          email: draft.email,
          phone: draft.phone,
          businessType: draft.businessType,
          branches: draft.branches,
          users: draft.users,
          posDevices: draft.posDevices,
          features: recommendedSetup(draft),
          specialRequirements: draft.specialRequirements,
          referralCode: readReferral() || '',
          clientOperationId: operationId('quote'),
          formStartedAt: formStartedAt(),
        });
        clearOperation('quote');
        playSound('success');
        haptic(16);
        track('quote_complete');
        setSent(result.reference);
      } catch (err) {
        const recovered = recoverSalesForm({ values: draft, error: '', busy: true, completed: false }, err);
        setDraft(recovered.values);
        setError(recovered.error);
      } finally {
        setBusy(false);
      }
    })();
  };

  if (sent) {
    return (
      <GlassCard className="zw-quote">
        <h2>Your ZELVERO quote request has been received.</h2>
        <p>
          Reference number: <strong dir="ltr">{sent}</strong>
        </p>
        <div className="zw-hero__cta">
          <Link className="zw-btn zw-btn--primary" to="/trial">
            Start Free Trial
          </Link>
          <Link className="zw-btn zw-btn--secondary" to="/">
            Back to Home
          </Link>
        </div>
      </GlassCard>
    );
  }

  return (
    <div className="zw-quote-grid">
      <GlassCard className="zw-quote">
        <ol className="zw-steps" aria-label="Quote steps">
          {QUOTE_STEPS.map((s, i) => (
            <li key={s} className={i === step ? 'is-on' : i < step ? 'is-done' : ''}>
              {i + 1}
            </li>
          ))}
        </ol>
        <h3 className="zw-quote__title">{label}</h3>
        <form onSubmit={submit}>
          {label === 'Tell us about your business' && (
            <label className="zw-field">
              What do you sell?
              <select value={draft.businessType} onChange={(e) => patch({ businessType: e.target.value })}>
                <option value="mobile-electronics">Mobile & Electronics</option>
                <option value="supermarkets">Supermarkets</option>
                <option value="fashion-retail">Fashion & Retail</option>
                <option value="wholesale">Wholesale</option>
                <option value="beauty">Beauty</option>
                <option value="general-retail">General Retail</option>
              </select>
            </label>
          )}
          {label === 'How do you work?' && (
            <>
              <label className="zw-field">
                Branches
                <input type="number" min={1} max={20} value={draft.branches} onChange={(e) => patch({ branches: Number(e.target.value) || 1 })} />
              </label>
              <label className="zw-field">
                How many people will use ZELVERO?
                <input type="number" min={1} max={99} value={draft.users} onChange={(e) => patch({ users: Number(e.target.value) || 1 })} />
              </label>
              <label className="zw-field">
                POS devices
                <input type="number" min={1} max={99} value={draft.posDevices} onChange={(e) => patch({ posDevices: Number(e.target.value) || 1 })} />
              </label>
            </>
          )}
          {label === 'What do you need?' && (
            <fieldset className="zw-checks">
              <legend>What matters for your store?</legend>
              <label>
                <input type="checkbox" checked={draft.customerCredit} onChange={(e) => patch({ customerCredit: e.target.checked })} />
                Customer credit / debt
              </label>
              <label>
                <input type="checkbox" checked={draft.imei} onChange={(e) => patch({ imei: e.target.checked })} />
                Phone IMEI / serial tracking
              </label>
              <label>
                <input type="checkbox" checked={draft.offline} onChange={(e) => patch({ offline: e.target.checked })} />
                Keep selling if internet drops
              </label>
            </fieldset>
          )}
          {label === 'Your contact details' && (
            <>
              <label className="zw-field">
                Your name
                <input required value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
              </label>
              <label className="zw-field">
                Business name
                <input required value={draft.company} onChange={(e) => patch({ company: e.target.value })} />
              </label>
              <label className="zw-field">
                Email
                <input required type="email" value={draft.email} onChange={(e) => patch({ email: e.target.value })} />
              </label>
              <label className="zw-field">
                Phone
                <input required value={draft.phone} onChange={(e) => patch({ phone: e.target.value })} />
              </label>
              <label className="zw-field">
                Special requirements
                <textarea value={draft.specialRequirements} onChange={(e) => patch({ specialRequirements: e.target.value })} rows={3} />
              </label>
            </>
          )}
          {last && (
            <p className="zw-note">
              {draft.company || 'Your business'} · {draft.branches} branches · {draft.users} users
            </p>
          )}
          {error ? <p className="zw-error">{error}</p> : null}
          <div className="zw-hero__cta">
            {step > 0 && (
              <Button type="button" variant="ghost" onClick={() => go(step - 1)}>
                Back
              </Button>
            )}
            <Button type="submit" disabled={busy}>
              {last ? 'Request My Quote' : 'Continue'}
            </Button>
          </div>
        </form>
      </GlassCard>
      <SetupPanel draft={draft} />
    </div>
  );
}

export function stepIndex(step: QuoteStep): number {
  return QUOTE_STEPS.indexOf(step);
}
