import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Checkbox, TextArea } from '@/components/ui/Form';
import { Alert, Badge, EmptyState, TableWrap } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { useFeedback } from '@/contexts/feedback';
import { useSettings } from '@/hooks/useTenantData';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useI18n, type TranslationKey } from '@/i18n/i18n';
import { dismissQueued, reopenQueued, retryQueued, summarize, syncOfflineQueue, useOfflineQueue } from '@/offline/queue';
import { isPaused, needsAction, type OfflineOperation } from '@/offline/types';
import { printOfflineReceipt } from '@/features/sales/receipt';
import { formatDateTime, formatLbp, formatUsd } from '@/utils/format';

type Tone = 'default' | 'success' | 'danger' | 'warning' | 'info';

function statusLabel(op: OfflineOperation): TranslationKey {
  return isPaused(op) ? 'offline.status.PAUSED' : (`offline.status.${op.status}` as TranslationKey);
}

function statusTone(op: OfflineOperation): Tone {
  if (op.status === 'SYNCED') return 'success';
  if (needsAction(op)) return 'danger';
  if (op.status === 'CONFLICT' || op.status === 'REJECTED') return 'default';
  return op.status === 'SYNCING' ? 'info' : 'warning';
}

function formatReceived(op: OfflineOperation, lang: 'ar' | 'en'): string {
  const r = op.snapshot.received;
  return [r.usdCents > 0 ? formatUsd(r.usdCents) : '', r.lbp > 0 ? formatLbp(r.lbp, lang) : ''].filter(Boolean).join(' + ');
}

function totalOf(op: OfflineOperation, lang: 'ar' | 'en') {
  return op.snapshot.currency === 'LBP' ? formatLbp(op.snapshot.totalLbp, lang) : formatUsd(op.snapshot.totalUsdCents);
}

/** Queue / recovery panel: every offline sale on this device, with its status, reason and actions. */
export function OfflineQueuePanel({ uid, isOwner, onClose }: { uid: string; isOwner: boolean; onClose: () => void }) {
  const { t, lang } = useI18n();
  const queue = useOfflineQueue();
  const [showHandled, setShowHandled] = useState(false);
  const [review, setReview] = useState<string | null>(null);
  const action = useAsyncAction('offline-queue');
  const summary = summarize(queue.operations);

  const visible = useMemo(
    () =>
      queue.operations
        .filter((op) => showHandled || (op.status !== 'SYNCED' && !op.resolution))
        .slice()
        .reverse(),
    [queue.operations, showHandled],
  );
  const reviewed = review ? queue.operations.find((op) => op.id === review) ?? null : null;
  const outside = [summary.outsideDrawer.usdCents > 0 && formatUsd(summary.outsideDrawer.usdCents), summary.outsideDrawer.lbp > 0 && formatLbp(summary.outsideDrawer.lbp, lang)]
    .filter(Boolean)
    .join(' + ');

  return (
    <Modal
      open
      size="xl"
      title={t('offline.panel.title')}
      onClose={onClose}
      footer={
        <>
          <Checkbox label={t('offline.panel.showHandled')} checked={showHandled} onChange={(e) => setShowHandled(e.target.checked)} />
          <Button variant="secondary" icon="refresh" onClick={() => void action.run(syncOfflineQueue)} disabled={action.busy || queue.syncing}>
            {t('offline.panel.syncNow')}
          </Button>
          <Button onClick={onClose}>{t('common.close')}</Button>
        </>
      }
    >
      {queue.unavailable && <Alert tone="error">{t('offline.panel.unavailable')}</Alert>}
      {outside && <Alert tone="error">{t('offline.panel.outsideDrawer', { amount: outside })}</Alert>}
      {queue.othersInStore > 0 && <Alert tone="info">{t('offline.panel.otherUsers', { count: queue.othersInStore })}</Alert>}
      {visible.length === 0 ? (
        <EmptyState icon="check" title={t('offline.panel.empty')} />
      ) : (
        <TableWrap>
          <table className="table" data-testid="offline-queue">
            <thead>
              <tr>
                <th>{t('offline.panel.ref')}</th>
                <th>{t('offline.panel.created')}</th>
                <th className="hide-sm">{t('offline.panel.customer')}</th>
                <th className="num">{t('offline.panel.total')}</th>
                <th>{t('offline.panel.status')}</th>
                <th className="num hide-sm">{t('offline.panel.attempts')}</th>
                <th className="hide-sm">{t('offline.panel.lastAttempt')}</th>
                <th>{t('offline.panel.reason')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((op) => (
                <tr key={op.id} data-offline-ref={op.offlineRef} data-status={op.status}>
                  <td>
                    <strong>{op.offlineRef}</strong>
                    {op.result && <div className="small">→ {op.result.invoiceNumber}</div>}
                  </td>
                  <td>{formatDateTime(op.createdAt, lang)}</td>
                  <td className="hide-sm">{op.snapshot.customerName || '—'}</td>
                  <td className="num">{totalOf(op, lang)}</td>
                  <td>
                    <Badge tone={statusTone(op)}>{t(statusLabel(op))}</Badge>
                  </td>
                  <td className="num hide-sm">{op.attempts}</td>
                  <td className="hide-sm">{op.lastAttemptAt ? formatDateTime(op.lastAttemptAt, lang) : '—'}</td>
                  <td className="small">
                    {op.reason ? t(`offline.reason.${op.reason}` as TranslationKey) : op.lastError ? op.lastError.code : '—'}
                    {op.resolution && <div className="muted">{t('offline.panel.resolved', { action: t(`offline.action.${op.resolution.action}` as TranslationKey) })}</div>}
                  </td>
                  <td className="actions-cell">
                    {op.uid === uid && (op.status === 'PENDING_SYNC' || needsAction(op)) && (
                      <Button size="sm" variant="secondary" onClick={() => void action.run(() => retryQueued(op.id))} disabled={action.busy}>
                        {t('offline.action.retry')}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setReview(op.id)}>
                      {t('offline.action.review')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {reviewed && <OfflineReview op={reviewed} uid={uid} isOwner={isOwner} onClose={() => setReview(null)} onReopened={onClose} />}
    </Modal>
  );
}

function OfflineReview({ op, uid, isOwner, onClose, onReopened }: { op: OfflineOperation; uid: string; isOwner: boolean; onClose: () => void; onReopened: () => void }) {
  const { t, lang } = useI18n();
  const settings = useSettings();
  const navigate = useNavigate();
  const { confirm, notify } = useFeedback();
  const [note, setNote] = useState('');
  const action = useAsyncAction('offline-review');
  const s = op.snapshot;
  const failed = (op.status === 'CONFLICT' || op.status === 'REJECTED') && !op.resolution;
  const received = formatReceived(op, lang);

  const dismiss = async () => {
    if (!note.trim()) {
      notify('warning', t('offline.dismissNote'));
      return;
    }
    if (!(await confirm({ title: t('offline.dismissTitle', { ref: op.offlineRef }), message: t('offline.dismissMessage'), danger: true, confirmLabel: t('offline.action.dismiss') }))) return;
    void action.run(async () => {
      await dismissQueued(op.id, note);
      onClose();
    });
  };

  const reopen = () =>
    void action.run(async () => {
      await reopenQueued(op.id);
      onClose();
      onReopened();
      void navigate('/pos');
    });

  return (
    <Modal
      open
      size="lg"
      title={t('offline.review.title', { ref: op.offlineRef })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" icon="printer" onClick={() => printOfflineReceipt(op, { settings, lang, t })}>
            {t('offline.printProof')}
          </Button>
          {failed && op.uid === uid && op.status === 'CONFLICT' && (
            <Button variant="secondary" onClick={reopen} disabled={action.busy}>
              {t('offline.action.reopen')}
            </Button>
          )}
          {op.uid === uid && (op.status === 'PENDING_SYNC' || needsAction(op)) && (
            <Button onClick={() => void action.run(() => retryQueued(op.id))} disabled={action.busy}>
              {t('offline.action.retry')}
            </Button>
          )}
        </>
      }
    >
      <p className="muted">{t('offline.review.captured', { time: formatDateTime(op.createdAt, lang), cashier: s.cashierName })}</p>
      <p>
        <Badge tone={statusTone(op)}>{t(statusLabel(op))}</Badge>{' '}
        {op.result && (
          <strong>
            {t('offline.panel.invoice')}: {op.result.invoiceNumber}
          </strong>
        )}
      </p>
      {op.reason && <Alert tone={failed ? 'error' : 'info'}>{t(`offline.reason.${op.reason}` as TranslationKey)}</Alert>}
      {received && op.status !== 'SYNCED' && !op.resolution && <Alert tone="error">{t('offline.cashWarning', { amount: received })}</Alert>}
      {failed && <p className="small muted">{t('offline.review.retryHint')}</p>}

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
            {s.lines.map((l, i) => (
              <tr key={i}>
                <td>
                  {l.name} <span className="small muted">({t(`products.${l.tier}` as TranslationKey)})</span>
                  {l.imei && <div className="small muted">IMEI {l.imei}</div>}
                  {l.customUsdCents !== null && l.customUsdCents !== l.originalUnitUsdCents && (
                    <div className="small muted">
                      {t('pos.listPrice')}: {formatUsd(l.originalUnitUsdCents)}
                    </div>
                  )}
                </td>
                <td className="num">{l.quantity}</td>
                <td className="num">{s.currency === 'LBP' ? formatLbp(l.unitLbp, lang) : formatUsd(l.unitUsdCents)}</td>
                <td className="num">{s.currency === 'LBP' ? formatLbp(l.lineLbp, lang) : formatUsd(l.lineUsdCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <p>
        {t('pos.total')}: <strong>{totalOf(op, lang)}</strong> · {t('settings.exchangeRate')}: {s.rate.toLocaleString('en-US')} ·{' '}
        {t(s.kind === 'cash' ? 'pos.cash' : 'pos.credit')}
        {s.customerName && ` · ${s.customerName}`}
      </p>

      {op.lastError && (
        <details>
          <summary>{t('offline.review.serverSaid')}</summary>
          <pre className="small">{JSON.stringify(op.serverResponse ?? op.lastError, null, 2)}</pre>
        </details>
      )}
      <details>
        <summary>{t('offline.review.history')}</summary>
        <ul className="small">
          {op.history.map((h, i) => (
            <li key={i}>
              {formatDateTime(h.at, lang)} — {t(`offline.status.${h.status}` as TranslationKey)}
              {h.reason ? ` · ${h.reason}` : ''}
              {h.note ? ` · ${h.note}` : ''}
            </li>
          ))}
        </ul>
      </details>

      {failed && isOwner && (
        <div className="stack">
          <TextArea label={t('offline.dismissNote')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          <Button variant="danger" onClick={() => void dismiss()} disabled={action.busy}>
            {t('offline.action.dismiss')}
          </Button>
        </div>
      )}
    </Modal>
  );
}
