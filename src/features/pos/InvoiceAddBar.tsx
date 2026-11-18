import { useCallback, useDeferredValue, useId, useState, type KeyboardEvent, type RefObject } from 'react';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { Icon } from '@/components/ui/Icon';
import { emptyProductQuery } from '@/domain/catalogPlan';
import { tierUsdCents } from '@/domain/pricing';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { useI18n } from '@/i18n/i18n';
import { findProductByBarcode, pageProducts } from '@/services/catalogQuery';
import type { Page } from '@/services/salesService';
import type { PriceTier, Product } from '@/types/models';
import { formatUsd } from '@/utils/format';
import { parseQuantityPrefix } from './invoiceLayout';

interface Props {
  tenantId: string;
  tier: PriceTier;
  rate: number;
  searchRef: RefObject<HTMLInputElement | null>;
  /** Adds `qty` units through the same stock-checked path as tapping a product tile. */
  onAdd: (product: Product, qty: number) => void;
}

const MAX_SUGGESTIONS = 8;

/**
 * Invoice mode's product entry: scan or type, then Enter. A barcode scanner (which types the code
 * and presses Enter) adds the exact product; typing a name shows a short keyboard-navigable list.
 * "12*code" adds 12 at once. The field keeps focus so the next item can be scanned immediately.
 */
export function InvoiceAddBar({ tenantId, tier, rate, searchRef, onAdd }: Props) {
  const { t } = useI18n();
  const listId = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [busy, setBusy] = useState(false);
  const { qty, query } = parseQuantityPrefix(text);
  const deferred = useDeferredValue(query);
  const searching = deferred.trim().length >= 2;
  const fetchPage = useCallback(
    (cursor: QueryDocumentSnapshot | null): Promise<Page<Product>> =>
      // Nothing to look up until two characters are typed: no Firestore read at all.
      searching ? pageProducts(tenantId, emptyProductQuery({ search: deferred }), cursor) : Promise.resolve({ items: [], cursor: null, hasMore: false }),
    [tenantId, deferred, searching],
  );
  const page = usePagedQuery(searching ? `${tenantId}|inv-add|${deferred.trim()}` : `${tenantId}|inv-add|idle`, fetchPage);
  const results = searching ? page.items.filter((p) => p.status !== 'archived').slice(0, MAX_SUGGESTIONS) : [];
  const index = Math.min(highlight, Math.max(0, results.length - 1));

  const add = (product: Product) => {
    onAdd(product, qty);
    setText('');
    setOpen(false);
    setHighlight(0);
    searchRef.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight(Math.min(results.length - 1, index + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(Math.max(0, index - 1));
    } else if (e.key === 'Escape') {
      setText('');
      setOpen(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const code = query.trim();
      if (!code || busy) return;
      // A highlighted suggestion wins when the list is open; otherwise try the exact barcode.
      if (open && results[index] && query === deferred) {
        add(results[index]);
        return;
      }
      setBusy(true);
      void findProductByBarcode(tenantId, code, true)
        .then((exact) => {
          const pick = exact ?? (results.length === 1 ? results[0] : null);
          if (pick) add(pick);
          else setOpen(true);
        })
        .finally(() => setBusy(false));
    }
  };

  return (
    <div className="inv-add">
      <div className="search-box inv-add__box">
        <Icon name="barcode" size={18} />
        <input
          ref={searchRef}
          className="input"
          type="search"
          value={text}
          placeholder={t('pos.invoice.addPlaceholder')}
          aria-label={t('pos.invoice.addPlaceholder')}
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          autoFocus
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKey}
        />
        {qty > 1 && <span className="inv-add__qty" dir="ltr">×{qty}</span>}
        {(busy || (searching && page.loading)) && <span className="inv-add__spin" aria-hidden="true" />}
      </div>
      {open && searching && (
        <ul className="inv-add__list" id={listId} role="listbox">
          {!page.loading && results.length === 0 && <li className="inv-add__none">{t('pos.noProducts')}</li>}
          {results.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === index}>
              <button
                type="button"
                className={i === index ? 'inv-add__opt inv-add__opt--active' : 'inv-add__opt'}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => add(p)}
              >
                <span className="inv-add__name">
                  {p.imageUrl ? (
                    <img className="inv-thumb" src={p.imageUrl} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <span className="inv-thumb inv-thumb--empty" aria-hidden="true">
                      <Icon name="package" size={14} />
                    </span>
                  )}
                  <span className="inv-add__label">{p.name}</span>
                </span>
                <span className="inv-add__meta" dir="ltr">{p.barcode || '—'}</span>
                <span className={p.stock <= 0 ? 'inv-add__stock inv-add__stock--out' : 'inv-add__stock'}>
                  {p.stock <= 0 ? t('products.outOfStock') : t('products.stockCount', { count: p.stock })}
                </span>
                <span className="inv-add__price" dir="ltr">{formatUsd(tierUsdCents(p, tier, rate))}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="inv-add__hint">{t('pos.invoice.addHint')}</p>
    </div>
  );
}
