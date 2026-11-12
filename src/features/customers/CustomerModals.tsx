import { useCallback, useState } from 'react';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { Button } from '@/components/ui/Button';
import { FormGrid, MoneyInput, TextInput } from '@/components/ui/Form';
import { Alert, TableWrap } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import { useTenant } from '@/contexts/session';
import { DEFAULTS } from '@/constants/app';
import { centsToInput, lbpToUsdCents, parseLbpInput, parseUsdInput } from '@/domain/money';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { useForm } from '@/hooks/useForm';
import { useSettings } from '@/hooks/useTenantData';
import { useI18n, type TranslationKey } from '@/i18n/i18n';
import { adjustDebt, assertUniqueCustomer, createCustomer, listLedger, payDebt, updateCustomer } from '@/services/customerService';
import type { Customer, LedgerType } from '@/types/models';
import { formatDateTime, formatLbp, formatUsd } from '@/utils/format';
import { customerSchema } from '@/validation/schemas';

export function CustomerFormModal({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const { t } = useI18n();
  const { actor, tenantId } = useTenant();
  const { notify } = useFeedback();
  const { busy, run } = useAsyncAction('customer-save');
  const form = useForm({
    name: customer?.name ?? '',
    phone: customer?.phone ?? '',
    email: customer?.email ?? '',
    address: customer?.address ?? '',
    creditLimit: centsToInput(customer?.creditLimitUsdCents ?? DEFAULTS.creditLimitUsdCents),
    openingDebt: '',
  });

  const submit = () =>
    run(async () => {
      const data = form.validate(customerSchema);
      if (!data) return;
      const input = { name: data.name, phone: data.phone, email: data.email, address: data.address, creditLimitUsdCents: data.creditLimit ?? 0 };
      await assertUniqueCustomer(tenantId, input, customer?.id);
      if (customer) await updateCustomer(actor, customer.id, input);
      else await createCustomer(actor, input, data.openingDebt ?? 0);
      notify('success', t('common.saved'));
      onClose();
    });

  return (
    <Modal
      open
      title={customer ? t('customers.edit') : t('customers.add')}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        className="stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FormGrid>
          <TextInput label={t('customers.name')} required autoFocus {...form.bind('name')} />
          <TextInput label={t('auth.phone')} type="tel" {...form.bind('phone')} />
          <TextInput label={t('auth.email')} type="email" {...form.bind('email')} />
          <TextInput label={t('customers.address')} {...form.bind('address')} />
          <MoneyInput currency="usd" label={`${t('customers.creditLimit')} ($)`} required {...form.bind('creditLimit')} />
          {!customer && <MoneyInput currency="usd" label={`${t('customers.openingDebt')} ($)`} {...form.bind('openingDebt')} />}
        </FormGrid>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function PayDebtModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { notify } = useFeedback();
  const settings = useSettings();
  const [usd, setUsd] = useState('');
  const [lbp, setLbp] = useState('');
  const [note, setNote] = useState('');
  const { busy, run } = useAsyncAction('pay-debt');
  const usdCents = parseUsdInput(usd || '0');
  const lbpAmount = parseLbpInput(lbp || '0');
  const total = (usdCents ?? 0) + lbpToUsdCents(lbpAmount ?? 0, settings.exchangeRate);
  const over = total > customer.debtUsdCents + 1;

  const submit = () =>
    run(async () => {
      if (usdCents === null || lbpAmount === null || total <= 0 || over) return;
      await payDebt({ customerId: customer.id, usdCents, lbp: lbpAmount, rate: settings.exchangeRate, note });
      notify('success', t('customers.paymentRecorded'));
      onClose();
    });

  return (
    <Modal
      open
      size="sm"
      title={t('customers.payDebtFor', { name: customer.name })}
      onClose={onClose}
      busy={busy}
      footer={
        <Button variant="success" loading={busy} disabled={total <= 0 || over || usdCents === null || lbpAmount === null} onClick={() => void submit()}>
          {t('customers.receivePayment')}
        </Button>
      }
    >
      <div className="stack">
        <div className="summary-list">
          <div className="summary-list__row summary-list__row--strong">
            <span>{t('customers.debt')}</span>
            <span>{formatUsd(customer.debtUsdCents)}</span>
          </div>
          <div className="summary-list__row muted">
            <span>≈</span>
            <span>{formatLbp(Math.round((customer.debtUsdCents * settings.exchangeRate) / 100), lang)}</span>
          </div>
        </div>
        <FormGrid>
          <MoneyInput currency="usd" label={t('pos.paidUsd')} value={usd} onChange={(e) => setUsd(e.target.value)} autoFocus />
          <MoneyInput currency="lbp" label={t('pos.paidLbp')} value={lbp} onChange={(e) => setLbp(e.target.value)} />
        </FormGrid>
        <Button variant="ghost" size="sm" onClick={() => { setUsd(centsToInput(customer.debtUsdCents)); setLbp(''); }}>
          {t('customers.payFull')}
        </Button>
        <TextInput label={t('common.note')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        {total > 0 && (
          <div className="summary-list">
            <div className="summary-list__row">
              <span>{t('pos.paidTotal')}</span>
              <span>{formatUsd(total)}</span>
            </div>
            <div className="summary-list__row">
              <span>{t('customers.debtAfter')}</span>
              <span>{formatUsd(Math.max(0, customer.debtUsdCents - total))}</span>
            </div>
          </div>
        )}
        {over && <Alert tone="error">{t('error.paymentExceedsDebt', { debt: (customer.debtUsdCents / 100).toFixed(2) })}</Alert>}
      </div>
    </Modal>
  );
}

export function AdjustDebtModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { t } = useI18n();
  const { notify } = useFeedback();
  const [value, setValue] = useState(centsToInput(customer.debtUsdCents));
  const [note, setNote] = useState('');
  const { busy, run } = useAsyncAction('adjust-debt');
  const cents = parseUsdInput(value);
  return (
    <Modal
      open
      size="sm"
      title={t('customers.adjustDebt')}
      onClose={onClose}
      busy={busy}
      footer={
        <Button
          loading={busy}
          disabled={cents === null || !note.trim()}
          onClick={() =>
            void run(async () => {
              await adjustDebt(customer.id, cents ?? 0, note);
              notify('success', t('common.saved'));
              onClose();
            })
          }
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className="stack">
        <p className="muted small">{t('customers.adjustDebtHint')}</p>
        <MoneyInput currency="usd" label={`${t('customers.newDebt')} ($)`} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        <TextInput label={t('common.note')} required value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </div>
    </Modal>
  );
}

const LEDGER_LABEL: Record<LedgerType, TranslationKey> = {
  opening: 'ledger.opening',
  creditSale: 'ledger.creditSale',
  settlement: 'ledger.settlement',
  payment: 'ledger.payment',
  refund: 'ledger.refund',
  adjustment: 'ledger.adjustment',
};

export function CustomerHistoryModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { tenantId } = useTenant();
  const fetchPage = useCallback(
    (cursor: QueryDocumentSnapshot | null) => listLedger(tenantId, customer.id, cursor),
    [tenantId, customer.id],
  );
  const ledger = usePagedQuery(`${tenantId}|${customer.id}|${customer.lastLedgerId}`, fetchPage);

  return (
    <Modal open size="lg" title={t('customers.historyFor', { name: customer.name })} onClose={onClose}>
      <div className="stack">
        <div className="details-grid">
          <div>
            <span className="muted">{t('customers.debt')}</span>
            <strong>{formatUsd(customer.debtUsdCents)}</strong>
          </div>
          <div>
            <span className="muted">{t('customers.totalPurchases')}</span>
            <strong>{formatUsd(customer.totalPurchasesUsdCents)}</strong>
          </div>
          <div>
            <span className="muted">{t('customers.creditLimit')}</span>
            <strong>{formatUsd(customer.creditLimitUsdCents)}</strong>
          </div>
        </div>
        {ledger.loading ? (
          <Spinner />
        ) : ledger.error ? (
          <Alert tone="error" onRetry={ledger.reload} retryLabel={t('common.retry')}>
            {t('error.loadFailed')}
          </Alert>
        ) : ledger.items.length === 0 ? (
          <p className="muted">{t('common.noData')}</p>
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('common.type')}</th>
                  <th className="num">{t('common.amount')}</th>
                  <th className="num">{t('customers.balance')}</th>
                  <th>{t('common.reference')}</th>
                  <th>{t('common.user')}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.items.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDateTime(e.createdAt, lang)}</td>
                    <td>{t(LEDGER_LABEL[e.type])}</td>
                    <td className={e.amountUsdCents > 0 ? 'num text-danger' : 'num text-success'}>
                      {e.amountUsdCents > 0 ? '+' : ''}
                      {formatUsd(e.amountUsdCents)}
                      {(e.paidUsdCents > 0 || e.paidLbp > 0) && e.type === 'payment' && (
                        <div className="small muted">
                          {[e.paidUsdCents ? formatUsd(e.paidUsdCents) : '', e.paidLbp ? formatLbp(e.paidLbp, lang) : ''].filter(Boolean).join(' + ')}
                        </div>
                      )}
                    </td>
                    <td className="num">{e.balanceAfterUsdCents === null ? '—' : formatUsd(e.balanceAfterUsdCents)}</td>
                    <td>
                      {e.refNumber ?? ''} {e.note && <span className="small muted">{e.note}</span>}
                    </td>
                    <td>{e.createdByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {ledger.hasMore && (
          <Button variant="secondary" loading={ledger.loadingMore} onClick={() => void ledger.loadMore()}>
            {t('common.loadMore')}
          </Button>
        )}
      </div>
    </Modal>
  );
}
