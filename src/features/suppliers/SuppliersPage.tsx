import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { FormGrid, MoneyInput, SelectInput, TextInput } from '@/components/ui/Form';
import { Alert, Badge, EmptyState, PageHeader, StatCard, TableWrap } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { PageLoader, Spinner } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import { useTenant } from '@/contexts/session';
import { parseLbpInput, parseUsdInput } from '@/domain/money';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useForm } from '@/hooks/useForm';
import { useSettings, useSuppliers } from '@/hooks/useTenantData';
import { useI18n } from '@/i18n/i18n';
import {
  createSupplier,
  deleteSupplier,
  listPurchaseReturns,
  listPurchases,
  listSupplierPayments,
  paySupplier,
  updateSupplier,
} from '@/services/supplierService';
import { retryResource } from '@/stores/tenantStore';
import type { Currency, PaymentMethod, Purchase, PurchaseReturn, Supplier, SupplierPayment } from '@/types/models';
import { formatDate, formatDateTime, formatLbp, formatUsd } from '@/utils/format';
import { supplierSchema } from '@/validation/schemas';

type Dialog = { type: 'form'; supplier: Supplier | null } | { type: 'pay'; supplier: Supplier } | { type: 'history'; supplier: Supplier } | null;

export default function SuppliersPage() {
  const { t } = useI18n();
  const { tenantId, actor } = useTenant();
  const { confirm, notify } = useFeedback();
  const state = useSuppliers();
  const [dialog, setDialog] = useState<Dialog>(null);
  const del = useAsyncAction('supplier-delete');
  const totalBalance = state.data.reduce((s, x) => s + x.balanceUsdCents, 0);
  const live = (s: Supplier) => state.data.find((x) => x.id === s.id) ?? s;

  return (
    <div className="page">
      <PageHeader
        title={t('nav.suppliers')}
        actions={
          <Button icon="plus" onClick={() => setDialog({ type: 'form', supplier: null })}>
            {t('suppliers.add')}
          </Button>
        }
      />
      <div className="stats">
        <StatCard icon="truck" label={t('suppliers.count')} value={state.data.length} />
        <StatCard icon="dollar" tone="danger" label={t('suppliers.totalOwed')} value={formatUsd(totalBalance)} />
      </div>
      {state.status === 'error' ? (
        <Alert tone="error" onRetry={() => retryResource(tenantId, 'suppliers')} retryLabel={t('common.retry')}>
          {t('error.loadFailed')}
        </Alert>
      ) : state.status === 'loading' ? (
        <PageLoader />
      ) : state.data.length === 0 ? (
        <EmptyState icon="truck" title={t('suppliers.empty')} />
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>{t('suppliers.name')}</th>
                <th>{t('suppliers.contact')}</th>
                <th>{t('auth.phone')}</th>
                <th className="num">{t('suppliers.balance')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state.data.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                    {s.address && <div className="small muted">{s.address}</div>}
                  </td>
                  <td>{s.contactPerson || '—'}</td>
                  <td>{s.phone || '—'}</td>
                  <td className="num">{s.balanceUsdCents > 0 ? <Badge tone="warning">{formatUsd(s.balanceUsdCents)}</Badge> : formatUsd(0)}</td>
                  <td className="actions-cell">
                    {s.balanceUsdCents > 0 && (
                      <Button size="sm" variant="success" icon="dollar" onClick={() => setDialog({ type: 'pay', supplier: s })}>
                        {t('suppliers.pay')}
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" icon="history" onClick={() => setDialog({ type: 'history', supplier: s })} aria-label={t('customers.history')} />
                    <Button variant="ghost" size="sm" icon="edit" onClick={() => setDialog({ type: 'form', supplier: s })} aria-label={t('common.edit')} />
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="trash"
                      aria-label={t('common.delete')}
                      onClick={async () => {
                        if (await confirm({ title: t('suppliers.deleteConfirm', { name: s.name }), danger: true, confirmLabel: t('common.delete') })) {
                          void del.run(async () => {
                            await deleteSupplier(actor, s);
                            notify('success', t('common.deleted'));
                          });
                        }
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {dialog?.type === 'form' && <SupplierFormModal supplier={dialog.supplier} onClose={() => setDialog(null)} />}
      {dialog?.type === 'pay' && <PaySupplierModal supplier={live(dialog.supplier)} onClose={() => setDialog(null)} />}
      {dialog?.type === 'history' && <SupplierHistoryModal supplier={live(dialog.supplier)} onClose={() => setDialog(null)} />}
    </div>
  );
}

function SupplierFormModal({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const { t } = useI18n();
  const { actor } = useTenant();
  const { notify } = useFeedback();
  const suppliers = useSuppliers().data;
  const { busy, run } = useAsyncAction('supplier-save');
  const form = useForm({
    name: supplier?.name ?? '',
    contactPerson: supplier?.contactPerson ?? '',
    phone: supplier?.phone ?? '',
    email: supplier?.email ?? '',
    address: supplier?.address ?? '',
  });
  const submit = () =>
    run(async () => {
      const data = form.validate(supplierSchema);
      if (!data) return;
      if (supplier) await updateSupplier(actor, supplier.id, data);
      else await createSupplier(actor, data, suppliers);
      notify('success', t('common.saved'));
      onClose();
    });
  return (
    <Modal
      open
      title={supplier ? t('suppliers.edit') : t('suppliers.add')}
      onClose={onClose}
      busy={busy}
      footer={
        <Button loading={busy} onClick={() => void submit()}>
          {t('common.save')}
        </Button>
      }
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FormGrid>
          <TextInput label={t('suppliers.name')} required autoFocus {...form.bind('name')} />
          <TextInput label={t('suppliers.contact')} {...form.bind('contactPerson')} />
          <TextInput label={t('auth.phone')} type="tel" {...form.bind('phone')} />
          <TextInput label={t('auth.email')} type="email" {...form.bind('email')} />
          <TextInput label={t('customers.address')} fieldClassName="span-2" {...form.bind('address')} />
        </FormGrid>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function PaySupplierModal({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { can } = useTenant();
  const { notify } = useFeedback();
  const settings = useSettings();
  const [currency, setCurrency] = useState<Currency>('USD');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>(can('canManageCashDrawer') ? 'cash' : 'transfer');
  const [note, setNote] = useState('');
  const { busy, run } = useAsyncAction('pay-supplier');
  const parsed = currency === 'USD' ? parseUsdInput(amount) : parseLbpInput(amount);

  return (
    <Modal
      open
      size="sm"
      title={t('suppliers.payFor', { name: supplier.name })}
      onClose={onClose}
      busy={busy}
      footer={
        <Button
          variant="success"
          loading={busy}
          disabled={!parsed}
          onClick={() =>
            void run(async () => {
              await paySupplier({ supplierId: supplier.id, currency, amount: parsed ?? 0, rate: settings.exchangeRate, method, note });
              notify('success', t('suppliers.paymentRecorded'));
              onClose();
            })
          }
        >
          {t('suppliers.pay')}
        </Button>
      }
    >
      <div className="stack">
        <p>
          {t('suppliers.balance')}: <strong>{formatUsd(supplier.balanceUsdCents)}</strong>
        </p>
        <FormGrid>
          <SelectInput
            label={t('pos.currency')}
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Currency)}
            options={[
              { value: 'USD', label: 'USD $' },
              { value: 'LBP', label: lang === 'ar' ? 'ليرة ل.ل' : 'LBP' },
            ]}
          />
          <MoneyInput label={t('common.amount')} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          <SelectInput
            label={t('suppliers.method')}
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            options={[
              ...(can('canManageCashDrawer') ? [{ value: 'cash', label: t('suppliers.methodCash') }] : []),
              { value: 'transfer', label: t('suppliers.methodTransfer') },
              { value: 'card', label: t('suppliers.methodCard') },
              { value: 'other', label: t('suppliers.methodOther') },
            ]}
          />
          <TextInput label={t('common.note')} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormGrid>
        {method === 'cash' && <p className="muted small">{t('suppliers.cashHint')}</p>}
      </div>
    </Modal>
  );
}

function SupplierHistoryModal({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { tenantId } = useTenant();
  const [data, setData] = useState<{ purchases: Purchase[]; payments: SupplierPayment[]; returns: PurchaseReturn[] } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listPurchases(tenantId, { supplierId: supplier.id }, null), listSupplierPayments(tenantId, supplier.id), listPurchaseReturns(tenantId, supplier.id)])
      .then(([p, pay, ret]) => !cancelled && setData({ purchases: p.items, payments: pay, returns: ret }))
      .catch((e) => {
        console.error('[supplier-history]', e);
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, supplier.id, supplier.balanceUsdCents]);

  type Row = { at: number; label: string; ref: string; debit: number; credit: number };
  const rows: Row[] = data
    ? [
        ...data.purchases.map((p) => ({ at: p.createdAt ?? 0, label: t('suppliers.bill'), ref: p.number, debit: p.totalUsdCents, credit: 0 })),
        ...data.payments.map((p) => ({
          at: p.createdAt ?? 0,
          label: `${t('suppliers.payment')} (${p.currency === 'LBP' ? formatLbp(p.amount, lang) : formatUsd(p.amount)})`,
          ref: p.appliedTo.map((a) => a.purchaseNumber).join(', '),
          debit: 0,
          credit: p.amountUsdCents,
        })),
        ...data.returns.map((r) => ({ at: r.createdAt ?? 0, label: t('suppliers.return'), ref: r.purchaseNumber, debit: 0, credit: r.amountUsdCents })),
      ].sort((a, b) => b.at - a.at)
    : [];

  return (
    <Modal open size="lg" title={t('customers.historyFor', { name: supplier.name })} onClose={onClose}>
      {error ? (
        <Alert tone="error">{t('error.loadFailed')}</Alert>
      ) : !data ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="muted">{t('common.noData')}</p>
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.date')}</th>
                <th>{t('common.type')}</th>
                <th>{t('common.reference')}</th>
                <th className="num">{t('suppliers.debit')}</th>
                <th className="num">{t('suppliers.credit')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{formatDateTime(r.at, lang)}</td>
                  <td>{r.label}</td>
                  <td>{r.ref}</td>
                  <td className="num">{r.debit ? formatUsd(r.debit) : ''}</td>
                  <td className="num">{r.credit ? formatUsd(r.credit) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {data && data.purchases.some((p) => p.dueDate) && (
        <p className="muted small">
          {t('suppliers.nextDue')}:{' '}
          {formatDate(
            data.purchases
              .filter((p) => p.remainingUsdCents > 0 && p.dueDate)
              .map((p) => p.dueDate!)
              .sort()[0] ?? null,
            lang,
          )}
        </p>
      )}
    </Modal>
  );
}
