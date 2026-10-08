import { useCallback, useMemo, useState } from 'react';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { Button } from '@/components/ui/Button';
import { Checkbox, FormGrid, MoneyInput, SelectInput, TextInput } from '@/components/ui/Form';
import { Alert, Badge, EmptyState, PageHeader, TableWrap, Toolbar } from '@/components/ui/Layout';
import { clickableRow } from '@/components/ui/clickableRow';
import { Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import { useTenant } from '@/contexts/session';
import { localDate } from '@/domain/dates';
import { centsToInput, parseUsdInput } from '@/domain/money';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { useProducts, useSuppliers } from '@/hooks/useTenantData';
import { useI18n, type TranslationKey } from '@/i18n/i18n';
import { createPurchase, listPurchases, returnToSupplier } from '@/services/supplierService';
import type { BillStatus, Purchase } from '@/types/models';
import { formatDate, formatUsd, normalizeSearch } from '@/utils/format';

const STATUS_LABEL: Record<BillStatus, TranslationKey> = { unpaid: 'purchases.unpaid', partial: 'purchases.partial', paid: 'purchases.paid' };
const STATUS_TONE: Record<BillStatus, 'danger' | 'warning' | 'success'> = { unpaid: 'danger', partial: 'warning', paid: 'success' };

export default function PurchasesPage() {
  const { t, lang } = useI18n();
  const { tenantId } = useTenant();
  const suppliers = useSuppliers().data;
  const [supplierId, setSupplierId] = useState('');
  const [status, setStatus] = useState<BillStatus | 'all'>('all');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Purchase | null>(null);

  const fetchPage = useCallback(
    (cursor: QueryDocumentSnapshot | null) => listPurchases(tenantId, { supplierId: supplierId || null, status }, cursor),
    [tenantId, supplierId, status],
  );
  const purchases = usePagedQuery(`${tenantId}|${supplierId}|${status}`, fetchPage);

  return (
    <div className="page">
      <PageHeader
        title={t('nav.purchases')}
        actions={
          <Button icon="plus" onClick={() => setCreating(true)} disabled={!suppliers.length} title={!suppliers.length ? t('purchases.needSupplier') : undefined}>
            {t('purchases.new')}
          </Button>
        }
      />
      <Toolbar>
        <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label={t('products.supplier')}>
          <option value="">{t('purchases.allSuppliers')}</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value as BillStatus | 'all')} aria-label={t('common.status')}>
          <option value="all">{t('purchases.allStatuses')}</option>
          <option value="unpaid">{t('purchases.unpaid')}</option>
          <option value="partial">{t('purchases.partial')}</option>
          <option value="paid">{t('purchases.paid')}</option>
        </select>
      </Toolbar>
      {purchases.error ? (
        <Alert tone="error" onRetry={purchases.reload} retryLabel={t('common.retry')}>
          {t('error.loadFailed')}
        </Alert>
      ) : purchases.loading ? (
        <PageLoader />
      ) : purchases.items.length === 0 ? (
        <EmptyState icon="clipboard" title={t('purchases.empty')} />
      ) : (
        <>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('purchases.number')}</th>
                  <th>{t('common.date')}</th>
                  <th>{t('products.supplier')}</th>
                  <th className="num">{t('pos.total')}</th>
                  <th className="num">{t('purchases.remaining')}</th>
                  <th>{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {purchases.items.map((p) => (
                  <tr key={p.id} {...clickableRow(() => setSelected(p))}>
                    <td>
                      <strong>{p.number}</strong>
                    </td>
                    <td>{formatDate(p.date, lang)}</td>
                    <td>{p.supplierName}</td>
                    <td className="num">{formatUsd(p.totalUsdCents - p.returnedUsdCents)}</td>
                    <td className="num">{formatUsd(p.remainingUsdCents)}</td>
                    <td>
                      <Badge tone={STATUS_TONE[p.status]}>{t(STATUS_LABEL[p.status])}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {purchases.hasMore && (
            <div className="load-more">
              <Button variant="secondary" loading={purchases.loadingMore} onClick={() => void purchases.loadMore()}>
                {t('common.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}
      {creating && (
        <PurchaseFormModal
          onClose={(saved) => {
            setCreating(false);
            if (saved) purchases.reload();
          }}
        />
      )}
      {selected && (
        <PurchaseDetailsModal
          purchase={selected}
          onClose={(changed) => {
            setSelected(null);
            if (changed) purchases.reload();
          }}
        />
      )}
    </div>
  );
}

interface DraftLine {
  productId: string;
  quantity: string;
  unitCost: string;
}

function PurchaseFormModal({ onClose }: { onClose: (saved: boolean) => void }) {
  const { t } = useI18n();
  const { can } = useTenant();
  const { notify } = useFeedback();
  const suppliers = useSuppliers().data;
  const products = useProducts().data;
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '');
  const [date, setDate] = useState(localDate());
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [search, setSearch] = useState('');
  const [updateCost, setUpdateCost] = useState(true);
  const [paidNow, setPaidNow] = useState('');
  const [payFromCashbox, setPayFromCashbox] = useState(false);
  const [note, setNote] = useState('');
  const { busy, run } = useAsyncAction('purchase-create');

  const matches = useMemo(() => {
    const q = normalizeSearch(search);
    if (!q) return [];
    return products.filter((p) => p.status === 'active').filter((p) => normalizeSearch(p.name).includes(q) || p.barcode === search.trim()).slice(0, 8);
  }, [products, search]);

  const parsed = lines.map((l) => ({ productId: l.productId, quantity: Math.floor(Number(l.quantity)), unitCostUsdCents: parseUsdInput(l.unitCost) }));
  const valid = parsed.length > 0 && parsed.every((l) => l.quantity > 0 && l.unitCostUsdCents !== null);
  const total = parsed.reduce((s, l) => s + (l.quantity > 0 ? l.quantity * (l.unitCostUsdCents ?? 0) : 0), 0);
  const paid = parseUsdInput(paidNow || '0');

  const submit = () =>
    run(async () => {
      if (!valid || paid === null) return;
      await createPurchase({
        supplierId,
        date,
        dueDate: dueDate || null,
        items: parsed.map((l) => ({ productId: l.productId, quantity: l.quantity, unitCostUsdCents: l.unitCostUsdCents ?? 0 })),
        updateCost,
        paidNowUsdCents: paid,
        payFromCashbox: payFromCashbox && can('canManageCashDrawer'),
        note,
      });
      notify('success', t('purchases.saved'));
      onClose(true);
    });

  return (
    <Modal
      open
      size="xl"
      title={t('purchases.new')}
      onClose={() => onClose(false)}
      busy={busy}
      footer={
        <>
          <span className="modal-footer__total">
            {t('pos.total')}: <strong>{formatUsd(total)}</strong>
          </span>
          <Button loading={busy} disabled={!valid || !supplierId || paid === null || paid > total} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <FormGrid cols={3}>
          <SelectInput label={t('products.supplier')} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
          <TextInput label={t('common.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <TextInput label={t('purchases.dueDate')} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </FormGrid>
        <div className="product-search">
          <TextInput label={t('purchases.addProduct')} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('pos.searchPlaceholder')} />
          {matches.length > 0 && (
            <div className="dropdown">
              {matches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="dropdown__item"
                  onClick={() => {
                    setLines((ls) => (ls.some((l) => l.productId === p.id) ? ls : [...ls, { productId: p.id, quantity: '1', unitCost: centsToInput(p.costUsdCents) }]));
                    setSearch('');
                  }}
                >
                  {p.name} <span className="muted small">({t('products.stockCount', { count: p.stock })})</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {lines.length > 0 && (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('pos.item')}</th>
                  <th className="num">{t('pos.qty')}</th>
                  <th className="num">{t('purchases.unitCost')}</th>
                  <th className="num">{t('pos.subtotal')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const p = products.find((x) => x.id === l.productId);
                  const cost = parseUsdInput(l.unitCost) ?? 0;
                  return (
                    <tr key={l.productId}>
                      <td>{p?.name ?? l.productId}</td>
                      <td className="num">
                        <input className="input input--qty" dir="ltr" inputMode="numeric" value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                      </td>
                      <td className="num">
                        <input className="input input--money" inputMode="decimal" value={l.unitCost} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitCost: e.target.value } : x)))} />
                      </td>
                      <td className="num">{formatUsd((Math.floor(Number(l.quantity)) || 0) * cost)}</td>
                      <td>
                        <Button variant="ghost" size="sm" icon="trash" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={t('common.remove')} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Checkbox label={t('purchases.updateCost')} checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} />
        <FormGrid>
          <MoneyInput label={t('purchases.paidNow')} value={paidNow} onChange={(e) => setPaidNow(e.target.value)} placeholder="0" />
          <TextInput label={t('common.note')} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormGrid>
        {can('canManageCashDrawer') && (paid ?? 0) > 0 && (
          <Checkbox label={t('purchases.payFromCashbox')} checked={payFromCashbox} onChange={(e) => setPayFromCashbox(e.target.checked)} />
        )}
        {paid !== null && paid > total && <Alert tone="error">{t('purchases.paidTooMuch')}</Alert>}
      </div>
    </Modal>
  );
}

function PurchaseDetailsModal({ purchase, onClose }: { purchase: Purchase; onClose: (changed: boolean) => void }) {
  const { t, lang } = useI18n();
  const { notify, confirm } = useFeedback();
  const [returning, setReturning] = useState(false);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [note, setNote] = useState('');
  const { busy, run } = useAsyncAction('purchase-return');
  const lines = purchase.items.map((_, index) => ({ index, quantity: Math.floor(Number(qty[index] || 0)) }));
  const amount = lines.reduce((s, l) => s + l.quantity * (purchase.items[l.index]?.unitCostUsdCents ?? 0), 0);

  return (
    <Modal open size="lg" title={`${t('purchases.number')} ${purchase.number}`} onClose={() => onClose(false)} busy={busy}>
      <div className="stack">
        <div className="details-grid">
          <div>
            <span className="muted">{t('products.supplier')}</span>
            <strong>{purchase.supplierName}</strong>
          </div>
          <div>
            <span className="muted">{t('common.date')}</span>
            <strong>{formatDate(purchase.date, lang)}</strong>
          </div>
          <div>
            <span className="muted">{t('purchases.remaining')}</span>
            <strong>{formatUsd(purchase.remainingUsdCents)}</strong>
          </div>
          <div>
            <span className="muted">{t('common.status')}</span>
            <Badge tone={STATUS_TONE[purchase.status]}>{t(STATUS_LABEL[purchase.status])}</Badge>
          </div>
        </div>
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>{t('pos.item')}</th>
                <th className="num">{t('pos.qty')}</th>
                <th className="num">{t('purchases.unitCost')}</th>
                <th className="num">{t('pos.subtotal')}</th>
                {returning && <th className="num">{t('returns.qtyToReturn')}</th>}
              </tr>
            </thead>
            <tbody>
              {purchase.items.map((it, i) => (
                <tr key={i}>
                  <td>
                    {it.name}
                    {it.returnedQty > 0 && <div className="small text-warning">{t('sales.returnedQty', { qty: it.returnedQty })}</div>}
                  </td>
                  <td className="num">{it.quantity}</td>
                  <td className="num">{formatUsd(it.unitCostUsdCents)}</td>
                  <td className="num">{formatUsd(it.unitCostUsdCents * it.quantity)}</td>
                  {returning && (
                    <td className="num">
                      <input
                        className="input input--qty"
                        type="number"
                        min={0}
                        max={it.quantity - it.returnedQty}
                        disabled={it.quantity === it.returnedQty}
                        value={qty[i] ?? ''}
                        onChange={(e) => setQty((q) => ({ ...q, [i]: e.target.value }))}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        {purchase.note && <p className="muted">{purchase.note}</p>}
        {returning ? (
          <>
            <TextInput label={t('common.note')} value={note} onChange={(e) => setNote(e.target.value)} />
            {amount > 0 && <p>{t('purchases.returnValue', { amount: formatUsd(amount) })}</p>}
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setReturning(false)} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                loading={busy}
                disabled={amount <= 0}
                onClick={() =>
                  void run(async () => {
                    if (!(await confirm({ title: t('purchases.confirmReturn', { amount: formatUsd(amount) }), danger: true }))) return;
                    await returnToSupplier({ purchaseId: purchase.id, lines, note });
                    notify('success', t('purchases.returned'));
                    onClose(true);
                  })
                }
              >
                {t('returns.confirm')}
              </Button>
            </div>
          </>
        ) : (
          purchase.items.some((i) => i.quantity > i.returnedQty) && (
            <div className="modal-actions">
              <Button variant="danger" icon="undo" onClick={() => setReturning(true)}>
                {t('purchases.returnToSupplier')}
              </Button>
            </div>
          )
        )}
      </div>
    </Modal>
  );
}
