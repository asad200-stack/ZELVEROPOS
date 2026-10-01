import { useCallback, useState } from 'react';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { initialRange } from '@/domain/dates';
import { Button } from '@/components/ui/Button';
import { FormGrid, MoneyInput, TextInput } from '@/components/ui/Form';
import { Alert, EmptyState, PageHeader, StatCard, TableWrap, Toolbar } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import { useTenant } from '@/contexts/session';
import { centsToInput, lbpToUsdCents, parseLbpInput, parseUsdInput } from '@/domain/money';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { useCashbox, useSettings } from '@/hooks/useTenantData';
import { useI18n, type TranslationKey } from '@/i18n/i18n';
import { cashHeldOffline, useOfflineQueue } from '@/offline/queue';
import { adjustDrawer, listCashTransactions, recordCashMove, type CashMoveType } from '@/services/cashboxService';
import { AppError } from '@/services/errors';
import type { CashTxType } from '@/types/models';
import { downloadCsv } from '@/utils/csv';
import { formatDateTime, formatLbp, formatUsd } from '@/utils/format';

const CASH_TX_LABEL: Record<CashTxType, TranslationKey> = {
  sale: 'cash.type.sale',
  debtPayment: 'cash.type.debtPayment',
  refund: 'cash.type.refund',
  deposit: 'cash.type.deposit',
  expense: 'cash.type.expense',
  withdrawal: 'cash.type.withdrawal',
  adjustment: 'cash.type.adjustment',
  supplierPayment: 'cash.type.supplierPayment',
};

export default function CashboxPage() {
  const { t, lang } = useI18n();
  const { tenantId, isOwner } = useTenant();
  const cashbox = useCashbox();
  const settings = useSettings();
  const [range, setRange] = useState(() => initialRange('today'));
  const [type, setType] = useState<CashTxType | 'all'>('all');
  const [move, setMove] = useState<CashMoveType | null>(null);
  const [adjusting, setAdjusting] = useState(false);

  const fetchPage = useCallback(
    (cursor: QueryDocumentSnapshot | null) => listCashTransactions(tenantId, { from: range.from, to: range.to, type }, cursor),
    [tenantId, range.from, range.to, type],
  );
  const history = usePagedQuery(`${tenantId}|${range.from}|${range.to}|${type}|${cashbox.data.lastTxId}`, fetchPage);
  const combined = cashbox.data.usdCents + lbpToUsdCents(cashbox.data.lbp, settings.exchangeRate);
  const offlineHeld = cashHeldOffline(useOfflineQueue().operations);

  return (
    <div className="page">
      <PageHeader
        title={t('nav.cashbox')}
        actions={
          <>
            <Button variant="success" icon="arrowDown" onClick={() => setMove('deposit')}>
              {t('cash.deposit')}
            </Button>
            <Button variant="secondary" icon="arrowUp" onClick={() => setMove('expense')}>
              {t('cash.expense')}
            </Button>
            <Button variant="secondary" icon="arrowUp" onClick={() => setMove('withdrawal')}>
              {t('cash.withdrawal')}
            </Button>
            {isOwner && (
              <Button variant="ghost" icon="edit" onClick={() => setAdjusting(true)}>
                {t('cash.adjust')}
              </Button>
            )}
          </>
        }
      />
      {offlineHeld.count > 0 && (
        <Alert tone="warning">
          {t('offline.cashboxWarning', {
            count: offlineHeld.count,
            amount: [offlineHeld.usdCents > 0 && formatUsd(offlineHeld.usdCents), offlineHeld.lbp > 0 && formatLbp(offlineHeld.lbp, lang)].filter(Boolean).join(' + '),
          })}
        </Alert>
      )}
      <div className="stats">
        <StatCard icon="dollar" tone="success" label={t('cash.balanceUsd')} value={formatUsd(cashbox.data.usdCents)} />
        <StatCard icon="wallet" tone="info" label={t('cash.balanceLbp')} value={formatLbp(cashbox.data.lbp, lang)} />
        <StatCard icon="chart" label={t('cash.combined')} value={formatUsd(combined)} sub={t('cash.atRate', { rate: settings.exchangeRate.toLocaleString('en-US') })} />
      </div>

      <Toolbar>
        <DateRangeFilter value={range} onChange={setRange} />
        <select className="input" value={type} onChange={(e) => setType(e.target.value as CashTxType | 'all')} aria-label={t('common.type')}>
          <option value="all">{t('cash.allTypes')}</option>
          {(Object.keys(CASH_TX_LABEL) as CashTxType[]).map((k) => (
            <option key={k} value={k}>
              {t(CASH_TX_LABEL[k])}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          icon="download"
          disabled={!history.items.length}
          onClick={() =>
            downloadCsv(
              `cashbox-${range.from}-${range.to}.csv`,
              [t('common.date'), t('common.type'), 'USD', 'LBP', t('cash.category'), t('common.note'), t('common.reference'), t('common.user')],
              history.items.map((x) => [formatDateTime(x.createdAt, lang), t(CASH_TX_LABEL[x.type]), (x.usdCents / 100).toFixed(2), x.lbp, x.category, x.note, x.refNumber ?? '', x.createdByName]),
            )
          }
        >
          {t('common.exportCsv')}
        </Button>
      </Toolbar>

      {history.error ? (
        <Alert tone="error" onRetry={history.reload} retryLabel={t('common.retry')}>
          {t('error.loadFailed')}
        </Alert>
      ) : history.loading ? (
        <PageLoader />
      ) : history.items.length === 0 ? (
        <EmptyState icon="wallet" title={t('cash.empty')} />
      ) : (
        <>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('common.type')}</th>
                  <th className="num">USD</th>
                  <th className="num">LBP</th>
                  <th className="hide-sm">{t('common.note')}</th>
                  <th className="num hide-sm">{t('cash.balanceAfter')}</th>
                  <th>{t('common.user')}</th>
                </tr>
              </thead>
              <tbody>
                {history.items.map((x) => (
                  <tr key={x.id}>
                    <td>{formatDateTime(x.createdAt, lang)}</td>
                    <td>
                      {t(CASH_TX_LABEL[x.type])}
                      {x.refNumber && <div className="small muted">{x.refNumber}</div>}
                    </td>
                    <td className={x.usdCents < 0 ? 'num text-danger' : 'num'}>{x.usdCents ? formatUsd(x.usdCents) : ''}</td>
                    <td className={x.lbp < 0 ? 'num text-danger' : 'num'}>{x.lbp ? formatLbp(x.lbp, lang) : ''}</td>
                    <td className="hide-sm">
                      {x.category && x.category !== x.type && <span className="muted small">{x.category} · </span>}
                      {x.note}
                    </td>
                    <td className="num hide-sm small">
                      {x.balanceAfter ? (
                        <>
                          {formatUsd(x.balanceAfter.usdCents)}
                          <br />
                          {formatLbp(x.balanceAfter.lbp, lang)}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{x.createdByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {history.hasMore && (
            <div className="load-more">
              <Button variant="secondary" loading={history.loadingMore} onClick={() => void history.loadMore()}>
                {t('common.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}
      {move && <CashMoveModal type={move} onClose={() => setMove(null)} />}
      {adjusting && <AdjustDrawerModal onClose={() => setAdjusting(false)} />}
    </div>
  );
}

const MOVE_TITLE: Record<CashMoveType, TranslationKey> = { deposit: 'cash.deposit', expense: 'cash.expense', withdrawal: 'cash.withdrawal' };
const EXPENSE_CATEGORIES: TranslationKey[] = ['cash.cat.rent', 'cash.cat.salaries', 'cash.cat.utilities', 'cash.cat.supplies', 'cash.cat.transport', 'cash.cat.other'];

function CashMoveModal({ type, onClose }: { type: CashMoveType; onClose: () => void }) {
  const { t } = useI18n();
  const { notify } = useFeedback();
  const cashbox = useCashbox().data;
  const [usd, setUsd] = useState('');
  const [lbp, setLbp] = useState('');
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const { busy, run } = useAsyncAction('cash-move');
  const usdCents = parseUsdInput(usd || '0');
  const lbpAmount = parseLbpInput(lbp || '0');
  const valid = usdCents !== null && lbpAmount !== null && usdCents + lbpAmount > 0;

  return (
    <Modal
      open
      size="sm"
      title={t(MOVE_TITLE[type])}
      onClose={onClose}
      busy={busy}
      footer={
        <Button
          loading={busy}
          disabled={!valid}
          onClick={() =>
            void run(async () => {
              if (type !== 'deposit' && ((usdCents ?? 0) > cashbox.usdCents || (lbpAmount ?? 0) > cashbox.lbp)) {
                throw new AppError('error.drawerInsufficient');
              }
              await recordCashMove({ type, usdCents: usdCents ?? 0, lbp: lbpAmount ?? 0, category, note });
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
        <FormGrid>
          <MoneyInput label="USD" value={usd} onChange={(e) => setUsd(e.target.value)} autoFocus />
          <MoneyInput label="LBP" value={lbp} onChange={(e) => setLbp(e.target.value)} />
        </FormGrid>
        {type === 'expense' ? (
          <div className="chips">
            {EXPENSE_CATEGORIES.map((k) => (
              <button key={k} type="button" className={category === t(k) ? 'chip chip--active' : 'chip'} onClick={() => setCategory(t(k))}>
                {t(k)}
              </button>
            ))}
          </div>
        ) : null}
        <TextInput label={t('common.note')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </div>
    </Modal>
  );
}

function AdjustDrawerModal({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18n();
  const { notify } = useFeedback();
  const cashbox = useCashbox().data;
  const [usd, setUsd] = useState(centsToInput(cashbox.usdCents));
  const [lbp, setLbp] = useState(String(cashbox.lbp));
  const [note, setNote] = useState('');
  const { busy, run } = useAsyncAction('cash-adjust');
  const usdCents = parseUsdInput(usd);
  const lbpAmount = parseLbpInput(lbp);
  return (
    <Modal
      open
      size="sm"
      title={t('cash.adjust')}
      onClose={onClose}
      busy={busy}
      footer={
        <Button
          loading={busy}
          disabled={usdCents === null || lbpAmount === null || !note.trim()}
          onClick={() =>
            void run(async () => {
              await adjustDrawer({ usdCents: usdCents ?? 0, lbp: lbpAmount ?? 0 }, note);
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
        <p className="muted small">
          {t('cash.adjustHint', { usd: formatUsd(cashbox.usdCents), lbp: formatLbp(cashbox.lbp, lang) })}
        </p>
        <FormGrid>
          <MoneyInput label={t('cash.countedUsd')} value={usd} onChange={(e) => setUsd(e.target.value)} />
          <MoneyInput label={t('cash.countedLbp')} value={lbp} onChange={(e) => setLbp(e.target.value)} />
        </FormGrid>
        <TextInput label={t('common.note')} required value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </div>
    </Modal>
  );
}
