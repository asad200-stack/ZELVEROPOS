import { useCallback, useDeferredValue, useState } from 'react';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { Button } from '@/components/ui/Button';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { useI18n } from '@/i18n/i18n';
import { pageCustomers } from '@/services/catalogQuery';
import type { Customer } from '@/types/models';
import { formatUsd } from '@/utils/format';

interface Props {
  tenantId: string;
  selected: Customer | null;
  onSelect: (customer: Customer | null) => void;
}

/** Recent customers, then a bounded name, phone or email search. Never the whole collection. */
export function CustomerSelect({ tenantId, selected, onSelect }: Props) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search);
  const fetchPage = useCallback(
    (cursor: QueryDocumentSnapshot | null) => pageCustomers(tenantId, { search: deferred, recent: !deferred.trim() }, cursor),
    [tenantId, deferred],
  );
  const page = usePagedQuery(`${tenantId}|customers|${deferred.trim()}`, fetchPage);

  return (
    <div className="stack">
      <label className="field">
        <span className="field__label">{t('pos.customer')}</span>
        <input className="input" value={search} placeholder={t('customers.searchPlaceholder')} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <div className="list-row">
        <Button type="button" size="sm" variant={selected ? 'secondary' : 'primary'} onClick={() => onSelect(null)}>
          {t('pos.walkIn')}
        </Button>
        {selected && <strong>{selected.name}</strong>}
      </div>
      {page.items.length > 0 && (
        <ul className="plain-list">
          {page.items.slice(0, 8).map((customer) => (
            <li key={customer.id}>
              <button type="button" className="list-row" onClick={() => onSelect(customer)}>
                <span>{customer.name}</span>
                <span className="muted small">{customer.debtUsdCents > 0 ? formatUsd(customer.debtUsdCents) : customer.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {page.hasMore && (
        <Button variant="ghost" size="sm" loading={page.loadingMore} onClick={() => void page.loadMore()}>
          {t('common.loadMore')}
        </Button>
      )}
    </div>
  );
}
