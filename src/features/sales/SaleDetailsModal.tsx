import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Form';
import { Alert, Badge, TableWrap } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { canProcessReturn } from '@/constants/permissions';
import { useFeedback } from '@/contexts/feedback';
import { useTenant } from '@/contexts/session';
import { planReturn } from '@/domain/returns';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useSettings } from '@/hooks/useTenantData';
import { getCustomer } from '@/services/catalogQuery';
import { useI18n, type TranslationKey } from '@/i18n/i18n';
import { getSale, listReturnsForSale, processReturn } from '@/services/salesService';
import type { Sale, SaleReturn } from '@/types/models';
import { formatDateTime, formatLbp, formatUsd } from '@/utils/format';
import { printReturnReceipt, printSaleReceipt } from './receipt';

interface Props {
  sale: Sale;
  onClose: () => void;
  onUpdated: (sale: Sale) => void;
}

export function SaleDetailsModal({ sale, onClose, onUpdated }: Props) {
  const { t, lang } = useI18n();
  const { tenantId, can } = useTenant();
  const settings = useSettings();
  const online = useOnlineStatus();
  const [returns, setReturns] = useState<{ saleId: string; list: SaleReturn[] } | null>(null);
  const [returning, setReturning] = useState(false);
  const returnAction = useAsyncAction('return');

  useEffect(() => {
    let cancelled = false;
    listReturnsForSale(tenantId, sale.id)
      .then((list) => !cancelled && setReturns({ saleId: sale.id, list }))
      .catch((e) => {
        console.error('[sale-details] returns', e);
        if (!cancelled) setReturns({ saleId: sale.id, list: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, sale.id, sale.lastReturnId]);

  const canReturn = canProcessReturn(can) && sale.returnStatus !== 'full';
  const p = sale.payment;
  const saleReturns = returns?.saleId === sale.id ? returns.list : null;

  return (
    <Modal open size="lg" title={`${t('sales.invoice')} ${sale.invoiceNumber}`} onClose={onClose} busy={returnAction.busy}>
      {returning ? (
        <ReturnForm
          sale={sale}
          action={returnAction}
          onCancel={() => setReturning(false)}
          onDone={async (ret) => {
            setReturning(false);
            const fresh = await getSale(tenantId, sale.id);
            if (fresh) onUpdated(fresh);
            printReturnReceipt(ret, { settings, lang, t });
          }}
        />
      ) : (
        <div className="stack">
          <div className="details-grid">
            <div>
              <span className="muted">{t('common.date')}</span>
              <strong>{formatDateTime(sale.createdAt, lang)}</strong>
            </div>
            <div>
              <span className="muted">{t('sales.type')}</span>
              <strong>{t(sale.kind === 'credit' ? 'pos.credit' : 'pos.cash')}</strong>
            </div>
            <div>
              <span className="muted">{t('pos.customer')}</span>
              <strong>{sale.customerName || t('pos.walkIn')}</strong>
            </div>
            {sale.orderLabel ? (
              <div>
                <span className="muted">{t('receipt.order')}</span>
                <strong>{sale.orderLabel}</strong>
              </div>
            ) : null}
            {sale.note ? (
              <div>
                <span className="muted">{t('receipt.note')}</span>
                <strong>{sale.note}</strong>
              </div>
            ) : null}
            <div>
              <span className="muted">{t('receipt.cashier')}</span>
              <strong>{sale.createdByName}</strong>
            </div>
          </div>
          {sale.offline && <Badge tone="warning">{t('sales.offlineSale')}</Badge>}

          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('pos.item')}</th>
                  <th className="num">{t('pos.qty')}</th>
                  <th className="num">{t('pos.price')}</th>
                  <th className="num">{t('pos.subtotal')}</th>
                </tr>
              </thead>
              <tbody>
                {sale.items.map((i, idx) => (
                  <tr key={idx}>
                    <td>
                      {i.name}
                      {i.imei && <div className="small muted">IMEI {i.imei}</div>}
                      {i.returnedQty > 0 && <div className="small text-warning">{t('sales.returnedQty', { qty: i.returnedQty })}</div>}
                    </td>
                    <td className="num">{i.quantity}</td>
                    <td className="num">
                      {sale.currency === 'LBP' ? formatLbp(i.unitLbp, lang) : formatUsd(i.unitUsdCents)}
                      {i.discountUsdCents > 0 && <div className="small text-success">−{formatUsd(i.discountUsdCents)}</div>}
                    </td>
                    <td className="num">{sale.currency === 'LBP' ? formatLbp(i.unitLbp * i.quantity, lang) : formatUsd(i.unitUsdCents * i.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>

          <div className="summary-list">
            <Row label={t('pos.total')} value={sale.currency === 'LBP' ? formatLbp(sale.totalLbp, lang) : formatUsd(sale.totalUsdCents)} strong />
            {sale.discountUsdCents > 0 && <Row label={t('pos.discount')} value={formatUsd(sale.discountUsdCents)} />}
            {sale.checkoutDiscountUsdCents > 0 && (
              <Row
                label={t(sale.checkoutDiscountKind === 'roundDown' ? 'pos.checkoutDiscountRoundDown' : 'pos.checkoutDiscount')}
                value={sale.currency === 'LBP' ? formatLbp(sale.checkoutDiscountLbp, lang) : formatUsd(sale.checkoutDiscountUsdCents)}
              />
            )}
            {sale.checkoutDiscountUsdCents > 0 && (
              <Row label={t('pos.amountToCollect')} value={sale.currency === 'LBP' ? formatLbp(sale.payableLbp, lang) : formatUsd(sale.payableUsdCents)} strong />
            )}
            {p.receivedUsdCents > 0 && <Row label={t('receipt.paidUsd')} value={formatUsd(p.receivedUsdCents)} />}
            {p.receivedLbp > 0 && <Row label={t('receipt.paidLbp')} value={formatLbp(p.receivedLbp, lang)} />}
            {(p.changeUsdCents ?? 0) > 0 && <Row label={t('receipt.changeUsd')} value={formatUsd(p.changeUsdCents ?? 0)} />}
            {(p.changeLbp ?? 0) > 0 && <Row label={t('receipt.changeLbp')} value={formatLbp(p.changeLbp ?? 0, lang)} />}
            {p.settledPreviousUsdCents > 0 && <Row label={t('pos.previousBalanceSettled')} value={formatUsd(p.settledPreviousUsdCents)} />}
            {sale.kind === 'credit' && <Row label={t('receipt.unpaid')} value={formatUsd(p.unpaidUsdCents)} />}
            {sale.returnedUsdCents > 0 && <Row label={t('sales.returned')} value={formatUsd(sale.returnedUsdCents)} />}
            {(sale.refundedUsdCents > 0 || sale.refundedLbp > 0) && (
              <Row
                label={t('sales.refunded')}
                value={[sale.refundedUsdCents ? formatUsd(sale.refundedUsdCents) : '', sale.refundedLbp ? formatLbp(sale.refundedLbp, lang) : ''].filter(Boolean).join(' + ')}
              />
            )}
          </div>

          {saleReturns && saleReturns.length > 0 && (
            <div>
              <h3 className="section-title">{t('sales.returnsHistory')}</h3>
              <ul className="plain-list">
                {saleReturns.map((r) => (
                  <li key={r.id}>
                    <strong>{r.number}</strong> · {formatDateTime(r.createdAt, lang)} · {formatUsd(r.amountUsdCents)}
                    {r.reason && <span className="muted"> · {r.reason}</span>}{' '}
                    <Button variant="ghost" size="sm" icon="printer" onClick={() => printReturnReceipt(r, { settings, lang, t })} aria-label={t('common.print')} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="modal-actions">
            <Button variant="secondary" icon="printer" onClick={() => printSaleReceipt(sale, { settings, lang, t })}>
              {t('common.print')}
            </Button>
            {canReturn && (
              <Button variant="danger" icon="undo" disabled={!online} title={!online ? t('error.offlineNotAllowed') : undefined} onClick={() => setReturning(true)}>
                {t('returns.start')}
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? 'summary-list__row summary-list__row--strong' : 'summary-list__row'}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

const RETURN_ERRORS: Record<string, TranslationKey> = {
  empty: 'error.return.empty',
  tooMany: 'error.return.tooMany',
  invalid: 'error.return.invalid',
};

interface ReturnFormProps {
  sale: Sale;
  action: ReturnType<typeof useAsyncAction>;
  onCancel: () => void;
  onDone: (ret: SaleReturn) => Promise<void>;
}

function ReturnForm({ sale, action, onCancel, onDone }: ReturnFormProps) {
  const { t, lang } = useI18n();
  const { confirm } = useFeedback();
  const { tenantId } = useTenant();
  const [debtUsdCents, setDebtUsdCents] = useState(0);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  const { busy, run } = action;

  const request = sale.items.map((_, index) => ({ index, quantity: Number(qty[index] || 0) }));
  useEffect(() => {
    const id = sale.customerId;
    if (!id) return;
    let cancelled = false;
    getCustomer(tenantId, id)
      .then((customer) => {
        if (!cancelled && customer) setDebtUsdCents(customer.debtUsdCents);
      })
      .catch((error: unknown) => console.error('[return] customer', error));
    return () => {
      cancelled = true;
    };
  }, [tenantId, sale.customerId]);
  const debt = debtUsdCents;
  const plan = planReturn(sale, request, debt);

  const submit = () =>
    run(async () => {
      if (!plan.ok) return;
      const ok = await confirm({
        title: t('returns.confirmTitle'),
        message: t('returns.confirmMessage', { amount: formatUsd(plan.amountUsdCents) }),
        danger: true,
        confirmLabel: t('returns.confirm'),
      });
      if (!ok) return;
      const ret = await processReturn({ saleId: sale.id, lines: request, reason });
      await onDone(ret);
    });

  return (
    <div className="stack">
      <p className="muted">{t('returns.hint')}</p>
      <TableWrap>
        <table className="table">
          <thead>
            <tr>
              <th>{t('pos.item')}</th>
              <th className="num">{t('returns.remaining')}</th>
              <th className="num">{t('returns.qtyToReturn')}</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((item, i) => {
              const remaining = item.quantity - item.returnedQty;
              return (
                <tr key={i}>
                  <td>
                    {item.name}
                    {item.imei && <div className="small muted">IMEI {item.imei}</div>}
                  </td>
                  <td className="num">{remaining}</td>
                  <td className="num">
                    <input
                      className="input input--qty"
                      dir="ltr"
                      type="number"
                      min={0}
                      max={remaining}
                      disabled={remaining === 0}
                      aria-label={`${t('returns.qtyToReturn')} — ${item.name}`}
                      value={qty[i] ?? ''}
                      onChange={(e) => setQty((q) => ({ ...q, [i]: e.target.value }))}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
      <TextInput label={t('returns.reason')} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
      {plan.amountUsdCents > 0 && (
        <div className="summary-list">
          <Row label={t('returns.amount')} value={formatUsd(plan.amountUsdCents)} strong />
          {plan.debtReducedUsdCents > 0 && <Row label={t('returns.debtReduced')} value={formatUsd(plan.debtReducedUsdCents)} />}
          {plan.refundUsdCents > 0 && <Row label={t('returns.refundUsd')} value={formatUsd(plan.refundUsdCents)} />}
          {plan.refundLbp > 0 && <Row label={t('returns.refundLbp')} value={formatLbp(plan.refundLbp, lang)} />}
        </div>
      )}
      {!plan.ok && plan.error && plan.error !== 'empty' && <Alert tone="error">{t(RETURN_ERRORS[plan.error])}</Alert>}
      <div className="modal-actions">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button variant="danger" icon="undo" loading={busy} disabled={!plan.ok} onClick={() => void submit()}>
          {t('returns.confirm')}
        </Button>
      </div>
    </div>
  );
}
