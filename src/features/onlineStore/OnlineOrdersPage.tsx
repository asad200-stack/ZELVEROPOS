// Online orders inbox (Milestone B). Owner-only; every call is re-authorized on the server,
// and the server owns the status machine and the stock give-back on cancel/reject.
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SelectInput } from '@/components/ui/Form';
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui/Layout';
import { PageLoader } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import { ORDER_STATUSES, nextStatuses, type OnlineOrder, type OrderStatus } from '@/domain/onlineOrders';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/services/functionsClient';
import { formatDateTime, formatLbp, formatUsd } from '@/utils/format';

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

export default function OnlineOrdersPage() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all');
  const data = useAsyncData(`online-orders:${filter}`, () =>
    api.onlineOrdersList(filter === 'all' ? {} : { status: filter }),
  );

  const options = [
    { value: 'all', label: t('onlineOrders.filterAll') },
    ...ORDER_STATUSES.map((s) => ({ value: s, label: t(`onlineOrders.status.${s}`) })),
  ];

  return (
    <div className="page stack">
      <PageHeader
        title={t('onlineOrders.title')}
        subtitle={t('onlineOrders.subtitle')}
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

  const next = nextStatuses(order.status);
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
          <div className="muted">
            {order.fulfillment === 'delivery' ? t('onlineOrders.delivery') : t('onlineOrders.pickup')} · {t('onlineOrders.cod')}
          </div>
          {order.address && <div>{order.address}</div>}
          {order.note && <div className="muted">“{order.note}”</div>}
        </div>
        <ul style={{ margin: 0, paddingInlineStart: 18 }}>
          {order.lines.map((l) => (
            <li key={l.productId}>
              {l.qty} × {l.name} — {l.lineUsdCents > 0 ? formatUsd(l.lineUsdCents) : formatLbp(l.lineLbp, lang)}
            </li>
          ))}
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
