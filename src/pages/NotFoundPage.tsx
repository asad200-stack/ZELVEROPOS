import { Link } from 'react-router';
import { EmptyState } from '@/components/ui/Layout';
import { useI18n } from '@/i18n/i18n';

export default function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div className="center-screen">
      <EmptyState
        icon="search"
        title={t('common.notFoundTitle')}
        message={t('common.notFoundMessage')}
        action={
          <Link to="/" className="btn btn--primary btn--md">
            {t('common.backHome')}
          </Link>
        }
      />
    </div>
  );
}
