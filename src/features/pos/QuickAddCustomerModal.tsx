import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Form';
import { Alert } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { useFeedback } from '@/contexts/feedback';
import { useTenant } from '@/contexts/session';
import { DEFAULTS } from '@/constants/app';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useForm } from '@/hooks/useForm';
import { useI18n } from '@/i18n/i18n';
import { createCustomer, findCustomerDuplicate, getCustomer, type CustomerDuplicate } from '@/services/customerService';
import { toCustomer } from '@/services/db';
import type { Customer } from '@/types/models';
import { quickCustomerSchema } from '@/validation/schemas';
import { quickCustomerSeed } from './quickCustomer';

interface Props {
  /** Text the cashier had typed in the customer search; prefills name or phone. */
  seed: string;
  onClose: () => void;
  /** Called only after the customer is saved (or an existing one is chosen). */
  onSelected: (customer: Customer) => void;
}

/**
 * Compact "add a customer without leaving the POS" dialog.
 * Reuses the normal customer service, validation, duplicate check and Firestore rules;
 * it creates master data only — no sale, no debt, no ledger entry.
 */
export function QuickAddCustomerModal({ seed, onClose, onSelected }: Props) {
  const { t } = useI18n();
  const { actor, tenantId } = useTenant();
  const { notify } = useFeedback();
  const { busy, run } = useAsyncAction('pos-quick-customer');
  const start = quickCustomerSeed(seed);
  const form = useForm({ name: start.name, phone: start.phone, address: '' });
  const [duplicate, setDuplicate] = useState<CustomerDuplicate | null>(null);

  const save = () =>
    run(async () => {
      setDuplicate(null);
      const data = form.validate(quickCustomerSchema);
      if (!data) return;
      const input = { name: data.name, phone: data.phone, email: '', address: data.address, creditLimitUsdCents: DEFAULTS.creditLimitUsdCents };
      const found = await findCustomerDuplicate(tenantId, input);
      if (found) {
        setDuplicate(found);
        return;
      }
      // createCustomer resolves after the write is accepted (online); only then is it selected.
      const id = await createCustomer(actor, input);
      const created = toCustomer(id, { ...input, debtUsdCents: 0, totalPurchasesUsdCents: 0, lastLedgerId: null, createdAtMs: Date.now() });
      notify('success', t('pos.quickCustomer.saved', { name: created.name }));
      onSelected(created);
    });

  const pickExisting = () =>
    run(async () => {
      if (!duplicate) return;
      const existing = await getCustomer(tenantId, duplicate.id);
      if (!existing) {
        setDuplicate(null);
        return;
      }
      onSelected(existing);
    });

  return (
    <Modal
      open
      size="sm"
      title={t('pos.quickCustomer.title')}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} disabled={busy} onClick={() => void save()}>
            {t('pos.quickCustomer.saveSelect')}
          </Button>
        </>
      }
    >
      <form
        className="stack quick-customer"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="muted quick-customer__hint">{t('pos.quickCustomer.hint')}</p>
        <TextInput label={t('customers.name')} required autoFocus={!start.phone} maxLength={100} autoComplete="off" {...form.bind('name')} />
        <TextInput label={t('auth.phone')} type="tel" inputMode="tel" autoFocus={Boolean(start.phone)} autoComplete="off" {...form.bind('phone')} />
        <TextInput label={t('customers.address')} maxLength={200} autoComplete="off" {...form.bind('address')} />
        {duplicate && (
          <Alert tone="warning">
            <span className="quick-customer__dup">
              {t(duplicate.match === 'phone' ? 'pos.quickCustomer.dupPhone' : 'pos.quickCustomer.dupName', { name: duplicate.name })}
            </span>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void pickExisting()}>
              {t('pos.quickCustomer.useExisting', { name: duplicate.name })}
            </Button>
          </Alert>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
