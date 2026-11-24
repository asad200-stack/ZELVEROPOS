// Online orders inbox (Milestone B). Owner-only; every call is re-authorized on the server,
// and the server owns the status machine and the stock give-back on cancel/reject.
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SelectInput } from '@/components/ui/Form';
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui/Layout';
import { PageLoader } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import {
  ORDER_STATUSES,
  REVIEW_STATUSES,
  canSettleByHand,
  nextStatuses,
  waitsForPayment,
  type ManualPayment,
  type OnlineOrder,
  type OrderStatus,
  type ProductReview,
  type ReviewStatus,
} from '@/domain/onlineOrders';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useAsyncData } from '@/hooks/useAsyncData';
import type { TranslationKey } from '@/i18n/en';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/services/functionsClient';
import { formatDateTime, formatLbp, formatUsd } from '@/utils/format';
import { customerWhatsAppLink } from './customerWhatsApp';
import { newOrderIds, playChime } from './orderAlerts';
import StoreStatsPanel from './StoreStatsPanel';

type BadgeTone = 'default' | 'success' | 'danger' | 'warning' | 'info';

const STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  pending: 'warning',
  accepted: 'info',
  preparing: 'info',
  ready: 'info',
  delivered: 'success',
  cancelled: 'default',
  rejected: 'danger',
};

function isStatus(v: string): v is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(v);
}

type Tab = 'orders' | 'reviews' | 'stats';

const TAB_LABEL: Record<Tab, TranslationKey> = {
  orders: 'onlineOrders.tabOrders',
  reviews: 'onlineOrders.tabReviews',
  stats: 'onlineOrders.tabStats',
};

export default function OnlineOrdersPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('orders');
  return (
    <div className="page stack">
      <div style={{ display: 'flex', gap: 8 }} role="tablist">
        {(['orders', 'reviews', 'stats'] as const).map((k) => (
          <Button
            key={k}
            size="sm"
            role="tab"
            aria-selected={tab === k}
            variant={tab === k ? 'primary' : 'secondary'}
            onClick={() => setTab(k)}
          >
            {t(TAB_LABEL[k])}
          </Button>
        ))}
      </div>
      {tab === 'orders' ? <OrdersPanel /> : tab === 'reviews' ? <ReviewsPanel /> : <StoreStatsPanel />}
    </div>
  );
}

const POLL_MS = 45_000;

/** While the inbox is open and visible, checks for new pending orders and reports their refs. */
function useNewOrderAlert(onNew: (refs: string[]) => void) {
  const known = useRef<Set<string> | null>(null);
  const fire = useEffectEvent(onNew);
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await api.onlineOrdersList({ status: 'pending', limit: 20 });
        if (stopped) return;
        const ids = res.orders.map((o) => o.id);
        const fresh = newOrderIds(known.current, ids);
        known.current = new Set([...(known.current ?? []), ...ids]);
        if (fresh.length > 0) fire(res.orders.filter((o) => fresh.includes(o.id)).map((o) => o.ref));
      } catch {
        // Offline or a hiccup: try again on the next tick.
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, []);
}

function OrdersPanel() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all');
  const data = useAsyncData(`online-orders:${filter}`, () =>
    api.onlineOrdersList(filter === 'all' ? {} : { status: filter }),
    { keep: true },
  );
  const [fresh, setFresh] = useState<string[]>([]);
  useNewOrderAlert((refs) => {
    setFresh((cur) => [...cur, ...refs.filter((r) => !cur.includes(r))]);
    playChime();
  });

  const options = [
    { value: 'all', label: t('onlineOrders.filterAll') },
    ...ORDER_STATUSES.map((s) => ({ value: s, label: t(`onlineOrders.status.${s}`) })),
  ];

  return (
    <div className="stack">
      <PageHeader
        title={t('onlineOrders.title')}
        subtitle={t('onlineOrders.subtitle')}
        actions={
          <Button variant="secondary" icon="refresh" onClick={data.reload} loading={data.loading}>
            {t('onlineOrders.refresh')}
          </Button>
        }
      />
      {fresh.length > 0 && (
        <Alert
          tone="success"
          onRetry={() => {
            setFresh([]);
            data.reload();
          }}
          retryLabel={t('onlineOrders.showNew')}
        >
          {t('onlineOrders.newArrived', { count: fresh.length, refs: fresh.join(' · ') })}
        </Alert>
      )}
      <div style={{ maxWidth: 260 }}>
        <SelectInput
          label={t('onlineOrders.filter')}
          value={filter}
          options={options}
          onChange={(e) => setFilter(isStatus(e.target.value) ? e.target.value : 'all')}
        />
      </div>
      {data.loading && !data.data ? (
        <PageLoader />
      ) : data.error || !data.data ? (
        <Alert tone="error" onRetry={data.reload} retryLabel={t('common.retry')}>
          {t('onlineOrders.loadError')}
        </Alert>
      ) : data.data.orders.length === 0 ? (
        <EmptyState icon="receipt" title={t('onlineOrders.emptyTitle')} message={t('onlineOrders.emptyMessage')} />
      ) : (
        <div className="stack">
          {data.data.orders.map((o) => (
            <OrderCard key={o.id} order={o} onChanged={data.reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrderCard({ order, onChanged }: { order: OnlineOrder; onChanged: () => void }) {
  const { t, lang } = useI18n();
  const { notify } = useFeedback();
  const action = useAsyncAction('onlineOrders');
  const [pending, setPending] = useState<OrderStatus | null>(null);
  const [checking, setChecking] = useState(false);

  const checkPay = async () => {
    setChecking(true);
    const res = await action.run(() => api.onlineOrdersCheckPayment({ orderId: order.id }));
    setChecking(false);
    if (res && res.paymentStatus !== order.paymentStatus) onChanged();
  };

  const [settling, setSettling] = useState<ManualPayment | null>(null);
  const settle = async (how: ManualPayment) => {
    if (!window.confirm(t(how === 'whish' ? 'onlineOrders.pay.confirmPaid' : 'onlineOrders.pay.confirmCash', { ref: order.ref }))) return;
    setSettling(how);
    const res = await action.run(() => api.onlineOrdersSettlePayment({ orderId: order.id, how }));
    setSettling(null);
    if (res) {
      notify('success', t(how === 'whish' ? 'onlineOrders.pay.markedPaid' : 'onlineOrders.pay.markedCash', { ref: order.ref }));
      onChanged();
    }
  };

  const move = async (status: OrderStatus) => {
    if ((status === 'cancelled' || status === 'rejected') && !window.confirm(t('onlineOrders.confirmStop', { ref: order.ref }))) return;
    setPending(status);
    const res = await action.run(() => api.onlineOrdersSetStatus({ orderId: order.id, status }));
    setPending(null);
    if (res) {
      notify('success', t('onlineOrders.moved', { ref: order.ref, status: t(`onlineOrders.status.${status}`) }));
      onChanged();
    }
  };

  // A Whish order is prepared only once the money is in.
  const next = nextStatuses(order.status).filter((s) => !waitsForPayment(order, s));
  const waiting = nextStatuses(order.status).some((s) => waitsForPayment(order, s));
  const statusText =
    order.status === 'ready'
      ? t(order.fulfillment === 'delivery' ? 'onlineOrders.wa.readyDelivery' : 'onlineOrders.wa.readyPickup', { name: order.customerName, ref: order.ref })
      : t(`onlineOrders.wa.${order.status}`, { name: order.customerName, ref: order.ref });
  const waLink = customerWhatsAppLink(order.customerPhone, statusText);
  const total = [order.totalUsdCents > 0 ? formatUsd(order.totalUsdCents) : '', order.totalLbp > 0 ? formatLbp(order.totalLbp, lang) : '']
    .filter(Boolean)
    .join(' · ');

  return (
    <Card
      title={
        <span>
          {order.ref} <Badge tone={STATUS_TONE[order.status]}>{t(`onlineOrders.status.${order.status}`)}</Badge>
        </span>
      }
      actions={<span className="muted">{formatDateTime(order.createdAtMs, lang)}</span>}
    >
      <div className="stack">
        <div>
          <strong>{order.customerName}</strong> · <a href={`tel:${order.customerPhone}`}>{order.customerPhone}</a>
          {waLink && (
            <>
              {' · '}
              <a href={waLink} target="_blank" rel="noopener noreferrer" title={statusText}>
                {t('onlineOrders.wa.button')}
              </a>
            </>
          )}
          <div className="muted">
            {order.fulfillment === 'delivery' ? t('onlineOrders.delivery') : t('onlineOrders.pickup')}
            {order.payment === 'cod' ? ` · ${t('onlineOrders.cod')}` : ''}
          </div>
          {order.address && <div>{order.address}</div>}
          {order.note && <div className="muted">“{order.note}”</div>}
        </div>
        {order.payment === 'whish' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <Badge tone={order.paymentStatus === 'paid' ? 'success' : order.paymentStatus === 'failed' ? 'danger' : 'warning'}>
              {t(order.paymentStatus === 'paid' ? 'onlineOrders.pay.whishPaid' : order.paymentStatus === 'failed' ? 'onlineOrders.pay.whishFailed' : 'onlineOrders.pay.whishUnpaid')}
            </Badge>
            {order.paymentStatus === 'paid' && order.payerPhone && (
              <span className="muted">{t('onlineOrders.pay.payer', { phone: order.payerPhone })}</span>
            )}
            {order.paymentStatus !== 'paid' && (
              <Button size="sm" variant="secondary" loading={checking} onClick={() => void checkPay()}>
                {t('onlineOrders.pay.check')}
              </Button>
            )}
            {canSettleByHand(order) && (
              <>
                <Button size="sm" variant="secondary" loading={settling === 'whish'} disabled={action.busy} onClick={() => void settle('whish')}>
                  {t('onlineOrders.pay.markPaid')}
                </Button>
                <Button size="sm" variant="ghost" loading={settling === 'cash'} disabled={action.busy} onClick={() => void settle('cash')}>
                  {t('onlineOrders.pay.toCash')}
                </Button>
              </>
            )}
          </div>
        )}
        {waiting && <p className="field__hint">{t('onlineOrders.pay.waitHint')}</p>}
        <ul style={{ margin: 0, paddingInlineStart: 18 }}>
          {order.lines.map((l) => (
            <li key={l.productId}>
              {l.qty} × <bdi>{l.name}</bdi> — {l.lineUsdCents > 0 ? formatUsd(l.lineUsdCents) : formatLbp(l.lineLbp, lang)}
            </li>
          ))}
          {(order.deliveryZone || order.deliveryFeeUsdCents > 0) && (
            <li>
              {t('onlineOrders.deliveryFee', { zone: order.deliveryZone || '—' })} —{' '}
              {order.deliveryFeeUsdCents > 0 ? formatUsd(order.deliveryFeeUsdCents) : t('storefront.zone.free')}
            </li>
          )}
        </ul>
        <div>
          <strong>{t('onlineOrders.total')}:</strong> {total}
        </div>
        {next.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {next.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={s === 'cancelled' || s === 'rejected' ? 'danger' : 'primary'}
                loading={pending === s}
                disabled={action.busy}
                onClick={() => void move(s)}
              >
                {t(`onlineOrders.action.${s}`)}
              </Button>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function isReviewStatus(v: string): v is ReviewStatus {
  return (REVIEW_STATUSES as readonly string[]).includes(v);
}

const REVIEW_TONE: Record<ReviewStatus, BadgeTone> = { pending: 'warning', approved: 'success', rejected: 'danger' };

function ReviewsPanel() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<ReviewStatus>('pending');
  const data = useAsyncData(`online-reviews:${filter}`, () => api.onlineReviewsList({ status: filter }), { keep: true });
  const options = REVIEW_STATUSES.map((s) => ({ value: s, label: t(`onlineOrders.reviewStatus.${s}`) }));

  return (
    <div className="stack">
      <PageHeader
        title={t('onlineOrders.reviewsTitle')}
        subtitle={t('onlineOrders.reviewsSubtitle')}
        actions={
          <Button variant="secondary" icon="refresh" onClick={data.reload} loading={data.loading}>
            {t('onlineOrders.refresh')}
          </Button>
        }
      />
      <div style={{ maxWidth: 260 }}>
        <SelectInput
          label={t('onlineOrders.filter')}
          value={filter}
          options={options}
          onChange={(e) => setFilter(isReviewStatus(e.target.value) ? e.target.value : 'pending')}
        />
      </div>
      {data.loading && !data.data ? (
        <PageLoader />
      ) : data.error || !data.data ? (
        <Alert tone="error" onRetry={data.reload} retryLabel={t('common.retry')}>
          {t('onlineOrders.reviewsLoadError')}
        </Alert>
      ) : data.data.reviews.length === 0 ? (
        <EmptyState icon="receipt" title={t('onlineOrders.reviewsEmpty')} message={t('onlineOrders.reviewsEmptyMessage')} />
      ) : (
        <div className="stack">
          {data.data.reviews.map((r) => (
            <ReviewCard key={r.id} review={r} onChanged={data.reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({ review, onChanged }: { review: ProductReview; onChanged: () => void }) {
  const { t, lang } = useI18n();
  const { notify } = useFeedback();
  const action = useAsyncAction('onlineOrders');
  const [pending, setPending] = useState<ReviewStatus | null>(null);

  const setStatus = async (status: ReviewStatus) => {
    setPending(status);
    const res = await action.run(() => api.onlineReviewsSetStatus({ reviewId: review.id, status }));
    setPending(null);
    if (res) {
      notify('success', t('onlineOrders.reviewMoved', { status: t(`onlineOrders.reviewStatus.${status}`) }));
      onChanged();
    }
  };

  const stars = '★'.repeat(review.rating) + '☆'.repeat(Math.max(0, 5 - review.rating));
  return (
    <Card
      title={
        <span>
          <span aria-label={t('onlineOrders.reviewRating', { rating: review.rating })} style={{ color: '#F59E0B' }}>
            {stars}
          </span>{' '}
          <Badge tone={REVIEW_TONE[review.status]}>{t(`onlineOrders.reviewStatus.${review.status}`)}</Badge>
        </span>
      }
      actions={<span className="muted">{formatDateTime(review.createdAtMs, lang)}</span>}
    >
      <div className="stack">
        <div>
          <strong>{review.name}</strong> · {review.productName}
          <div className="muted">{t('onlineOrders.reviewOrder', { ref: review.orderRef })}</div>
        </div>
        {review.text ? <p style={{ margin: 0 }}>{review.text}</p> : <span className="muted">{t('onlineOrders.reviewNoText')}</span>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {review.status !== 'approved' && (
            <Button size="sm" variant="primary" loading={pending === 'approved'} disabled={action.busy} onClick={() => void setStatus('approved')}>
              {t('onlineOrders.reviewApprove')}
            </Button>
          )}
          {review.status !== 'rejected' && (
            <Button size="sm" variant="danger" loading={pending === 'rejected'} disabled={action.busy} onClick={() => void setStatus('rejected')}>
              {t('onlineOrders.reviewReject')}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
