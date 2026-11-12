import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, EmptyState, TableWrap } from '@/components/ui/Layout';
import { PageLoader } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useAsyncData } from '@/hooks/useAsyncData';
import { cleanupOutcomeKey } from '@/features/admin/storageCleanupLabels';
import { useI18n } from '@/i18n/i18n';
import type { TranslationKey } from '@/i18n/en';
import { api } from '@/services/functionsClient';
import { formatDate } from '@/utils/format';

type CleanupOutcome = 'complete' | 'storage-failed' | 'account-remains' | 'unverified';

function outcomeLabel(outcome: 'storage-failed' | 'account-remains' | 'unverified' | null): TranslationKey {
  if (outcome === 'storage-failed') return 'admin.cleanupOutcomeStorageFailed';
  if (outcome === 'account-remains') return 'admin.cleanupOutcomeAccountRemains';
  if (outcome === 'unverified') return 'admin.cleanupOutcomeUnverified';
  return 'admin.cleanupOutcomePending';
}

export function StorageCleanupPanel({ reloadKey }: { reloadKey: number }) {
  const { t, lang } = useI18n();
  const { notify } = useFeedback();
  const [notice, setNotice] = useState<CleanupOutcome | null>(null);
  const pending = useAsyncData(`cleanup|${reloadKey}`, async () => (await api.adminListStorageCleanup({})).records);
  const { busy, run } = useAsyncAction('admin-storage-cleanup');

  const retry = (tenantId: string) => {
    void run(async () => {
      const result = await api.adminRetryStorageCleanup({ tenantId });
      setNotice(result.outcome);
      notify(result.outcome === 'complete' ? 'success' : 'warning', t(cleanupOutcomeKey(result.outcome)));
      pending.reload();
    });
  };

  return (
    <>
      {notice && <Alert tone={notice === 'complete' ? 'success' : 'warning'}>{t(cleanupOutcomeKey(notice))}</Alert>}
      {pending.error ? (
        <Alert tone="error" onRetry={pending.reload} retryLabel={t('common.retry')}>
          {t('error.loadFailed')}
        </Alert>
      ) : pending.loading ? (
        <PageLoader />
      ) : (pending.data ?? []).length === 0 ? (
        <EmptyState icon="check" title={t('admin.cleanupEmpty')} />
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>{t('admin.cleanupTenant')}</th>
                <th>{t('common.status')}</th>
                <th>{t('admin.cleanupAttempt')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(pending.data ?? []).map((row) => (
                <tr key={row.tenantId}>
                  <td dir="ltr">{row.tenantId}</td>
                  <td>
                    <Badge tone="warning">{t('admin.cleanupOutcomePending')}</Badge>
                    <div className="small muted">{t(outcomeLabel(row.lastOutcome))}</div>
                  </td>
                  <td>{formatDate(row.lastAttemptAt ?? row.updatedAt, lang)}</td>
                  <td className="actions-cell">
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => retry(row.tenantId)}>
                      {t('admin.retryStorageCleanup')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}
