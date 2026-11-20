import { EmptyState } from '@/components/ui/Layout';
import { useAsyncData } from '@/hooks/useAsyncData';
import { translate } from '@/i18n/i18n';
import { api } from '@/services/functionsClient';
import PublicStorePage from './PublicStorePage';

/** A shop opened on its own domain: every path shows that shop's storefront. */
export default function CustomDomainStore({ host }: { host: string }) {
  const found = useAsyncData(`store-domain-${host}`, () => api.publicStoreByDomain({ domain: host }));
  if (found.data) return <PublicStorePage slug={found.data.slug} />;
  return (
    <main className="storefront-shell" style={{ padding: 24 }}>
      {found.error ? (
        <EmptyState title={translate('ar', 'storefront.notFound')} message={translate('en', 'storefront.notFound')} />
      ) : (
        <p className="muted" style={{ textAlign: 'center' }}>
          {translate('ar', 'storefront.loading')} / {translate('en', 'storefront.loading')}
        </p>
      )}
    </main>
  );
}
