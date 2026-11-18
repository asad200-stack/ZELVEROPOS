import { useCallback, useDeferredValue, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { useI18n } from '@/i18n/i18n';
import { pageCustomers } from '@/services/catalogQuery';
import type { Customer } from '@/types/models';
import { formatUsd } from '@/utils/format';

interface Props {
  tenantId: string;
  selected: Customer | null;
  onSelect: (customer: Customer | null) => void;
  actions?: ReactNode;
  hint?: string;
  /** Opens the quick-add dialog with whatever was typed. Omitted when the user may not add customers. */
  onAddNew?: (seed: string) => void;
}

/** Compact cart-header picker: search + Walk-in + optional debt actions on one row. */
export function CustomerSelect({ tenantId, selected, onSelect, actions, hint, onAddNew }: Props) {
  const { t } = useI18n();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const deferred = useDeferredValue(search);
  const fetchPage = useCallback(
    (cursor: QueryDocumentSnapshot | null) => pageCustomers(tenantId, { search: deferred, recent: !deferred.trim() }, cursor),
    [tenantId, deferred],
  );
  const page = usePagedQuery(`${tenantId}|customers|${deferred.trim()}`, fetchPage);
  const results = page.items.slice(0, 8);
  const resultsKey = `${tenantId}|${deferred.trim()}|${results.map((c) => c.id).join(',')}`;
  const [highlightState, setHighlightState] = useState({ key: resultsKey, index: 0 });
  const highlight = highlightState.key === resultsKey ? highlightState.index : 0;
  const setHighlight = (value: number | ((current: number) => number)) => {
    setHighlightState((prev) => {
      const current = prev.key === resultsKey ? prev.index : 0;
      return { key: resultsKey, index: typeof value === 'function' ? value(current) : value };
    });
  };
  const showList = open;
  const value = open || search ? search : (selected?.name ?? '');
  const activeId = results[highlight] ? `${listId}-${results[highlight].id}` : undefined;

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const pick = (customer: Customer) => {
    onSelect(customer);
    setSearch('');
    setOpen(false);
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setHighlight((i) => Math.min(results.length - 1, i + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((i) => Math.max(0, i - 1));
      return;
    }
    if (event.key === 'Enter' && open && results[highlight]) {
      event.preventDefault();
      pick(results[highlight]);
    }
  };

  return (
    <>
    <div className="cart-customer-row" ref={rootRef}>
      <label className="field cart-customer-row__search">
        <span className={hint ? 'field__label field__label--warn' : 'field__label'}>{hint || t('pos.customer')}</span>
        <input
          className="input"
          value={value}
          placeholder={t('customers.searchPlaceholder')}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={open ? activeId : undefined}
          aria-autocomplete="list"
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            if (selected && !search) setSearch('');
          }}
          onKeyDown={onKey}
        />
        {showList && (
          <ul className="cart-customer-results" id={listId} role="listbox">
            {page.loading && <li className="cart-customer-results__status">{t('pos.searchingCustomers')}</li>}
            {!page.loading && results.length === 0 && (
              <li className="cart-customer-results__status">{t('customers.noneFound')}</li>
            )}
            {results.map((customer, index) => (
              <li key={customer.id}>
                <button
                  type="button"
                  id={`${listId}-${customer.id}`}
                  role="option"
                  aria-selected={index === highlight}
                  className={index === highlight ? 'cart-customer-option cart-customer-option--active' : 'cart-customer-option'}
                  onMouseEnter={() => setHighlight(index)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(customer)}
                >
                  <span className="cart-customer-option__avatar" aria-hidden="true">
                    <Icon name="user" size={16} />
                  </span>
                  <span className="cart-customer-option__body">
                    <span className="cart-customer-option__name">{customer.name}</span>
                    <span className="cart-customer-option__phone">{customer.phone || '—'}</span>
                  </span>
                  <span className={customer.debtUsdCents > 0 ? 'cart-customer-option__debt' : 'cart-customer-option__debt cart-customer-option__debt--ok'}>
                    {customer.debtUsdCents > 0 ? t('pos.debtBadge', { amount: formatUsd(customer.debtUsdCents) }) : t('customers.noDebt')}
                  </span>
                </button>
              </li>
            ))}
            {page.hasMore && (
              <li>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={page.loadingMore}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void page.loadMore()}
                >
                  {t('common.loadMore')}
                </Button>
              </li>
            )}
            {onAddNew && (
              <li className="cart-customer-results__add">
                <button
                  type="button"
                  className="cart-customer-add"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const seed = search;
                    setSearch('');
                    setOpen(false);
                    onAddNew(seed);
                  }}
                >
                  <Icon name="plus" size={16} />
                  <span>{search.trim() ? t('pos.quickCustomer.addNamed', { name: search.trim() }) : t('pos.quickCustomer.add')}</span>
                </button>
              </li>
            )}
          </ul>
        )}
      </label>
      <Button type="button" size="sm" variant={selected ? 'secondary' : 'primary'} onClick={() => onSelect(null)}>
        {t('pos.walkInShort')}
      </Button>
      {actions}
    </div>
    {onAddNew && hint && !selected && !open && (
      <button type="button" className="cart-customer-add cart-customer-add--below" onClick={() => onAddNew(search)}>
        <Icon name="plus" size={16} />
        <span>{t('pos.quickCustomer.add')}</span>
      </button>
    )}
    </>
  );
}
