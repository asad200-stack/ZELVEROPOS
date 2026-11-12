import { useMemo, useState, type FormEvent } from 'react';
import { haptic } from '../haptics';
import { readReferral } from '../referral';
import { callSales, clearOperation, formStartedAt, operationId } from '../sales/client';
import { recoverSalesForm } from '../sales/formError';
import { readSalesContext } from '../sales/context';
import { playSound } from '../sound/engine';
import { Button } from './Button';

export function LeadCapture({
  source,
  title,
  submitLabel,
}: {
  source: 'demo_request' | 'contact' | 'partner_referral' | 'AI';
  title?: string;
  submitLabel: string;
}) {
  const ctx = useMemo(() => readSalesContext(), []);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const data = Object.fromEntries(form.entries()) as Record<string, string>;
    setBusy(true);
    setError('');
    try {
      await callSales('submitWebsiteLead', {
        source,
        name: data.name,
        businessName: data.business || data.name,
        email: data.email,
        phone: data.phone || 'n/a',
        businessType: data.type || ctx.businessType || 'general-retail',
        note: data.note || '',
        preferredContact: data.contact || 'email',
        interestedFeatures: ctx.interestedFeatures || [],
        referralCode: readReferral() || '',
        clientOperationId: operationId(source),
        formStartedAt: formStartedAt(),
      });
      clearOperation(source);
      playSound('success');
      haptic(16);
      setSent(true);
    } catch (err) {
      const recovered = recoverSalesForm({ values: data, error: '', busy: true, completed: false }, err);
      setError(recovered.error);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return <p>{title || 'Thanks. A ZELVERO specialist will follow up.'}</p>;
  }

  return (
    <form className="zw-form" onSubmit={(e) => void submit(e)}>
      <label className="zw-field">
        Name
        <input required name="name" />
      </label>
      <label className="zw-field">
        Business
        <input required name="business" defaultValue="" />
      </label>
      <label className="zw-field">
        Email
        <input required type="email" name="email" />
      </label>
      <label className="zw-field">
        Phone
        <input required name="phone" />
      </label>
      {source === 'demo_request' ? (
        <label className="zw-field">
          Preferred contact
          <select name="contact" defaultValue="phone">
            <option value="phone">Phone</option>
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </label>
      ) : null}
      <label className="zw-field">
        Note
        <textarea name="note" rows={3} />
      </label>
      <label className="zw-hp" aria-hidden>
        Website
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      {error ? <p className="zw-error">{error}</p> : null}
      <Button type="submit" sound disabled={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}
