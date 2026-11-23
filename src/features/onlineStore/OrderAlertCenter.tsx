import { Link } from 'react-router';
import { Icon } from '@/components/ui/Icon';
import { useI18n } from '@/i18n/i18n';
import type { OrderAlerts } from './useOrderAlerts';

/** Floating card on every screen when website orders arrive. */
export function OrderAlertBanner({ alerts }: { alerts: OrderAlerts }) {
  const { t } = useI18n();
  if (alerts.fresh.length === 0) return null;
  const refs = alerts.fresh.slice(-3).join('، ');
  return (
    <div className="order-alert" role="status" aria-live="polite">
      <span className="order-alert__icon" aria-hidden="true">
        <Icon name="receipt" />
      </span>
      <div className="order-alert__text">
        <strong>{t(alerts.fresh.length === 1 ? 'onlineOrders.alert.one' : 'onlineOrders.alert.many', { n: alerts.fresh.length })}</strong>
        <span dir="ltr">{refs}</span>
      </div>
      <Link className="btn btn--primary btn--sm" to="/online-orders" onClick={alerts.dismiss}>
        {t('onlineOrders.alert.open')}
      </Link>
      <button type="button" className="order-alert__x" aria-label={t('onlineOrders.alert.dismiss')} onClick={alerts.dismiss}>
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
