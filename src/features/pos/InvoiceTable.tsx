import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/Layout';
import type { Cart, CartTotals, PricedLine } from '@/domain/cart';
import { centsToInput, parseUsdInput } from '@/domain/money';
import { useI18n } from '@/i18n/i18n';
import type { Product } from '@/types/models';
import { formatLbp, formatUsd } from '@/utils/format';
import { cardColumns, customPriceFromDiscount, customPriceFromUnit, matchesInvoiceQuery, readInvoiceView, rowWindow, scrollToRow, writeInvoiceView, type InvoiceView } from './invoiceLayout';

/** Fixed row height keeps windowing exact. Must match .inv-row height in pages.css. */
const ROW_H = 64;
/** Card view: minimum card width, gap, and the fixed height of one row of cards (card + gap). */
const CARD_MIN = 118;
const CARD_GAP = 10;
const CARD_ROW_H = 290;

interface Props {
  totals: CartTotals;
  products: Map<string, Product>;
  canEditPrice: boolean;
  customerName?: string;
  onChange: (fn: (cart: Cart) => Cart) => void;
  onRemovePrevious?: () => void;
  /** Focused after the last line is removed, so the cashier can keep scanning. */
  onFocusSearch?: () => void;
  /** Signed-in user, for remembering the cards / list choice. */
  uid: string;
}

/**
 * Invoice Table layout: every cart line as a spreadsheet-like row. Reads the same priced lines
 * as the classic cart and writes only through the shared cart updater (quantity and the
 * existing per-line custom price), so checkout, totals and permissions stay identical.
 */
export function InvoiceTable({ totals, products, canEditPrice, customerName, onChange, onRemovePrevious, onFocusSearch, uid }: Props) {
  const { t, lang } = useI18n();
  const [filter, setFilter] = useState('');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 480, width: 640 });
  const [view, setViewState] = useState<InvoiceView>(() => readInvoiceView(uid));
  const setView = (next: InvoiceView) => {
    setViewState(next);
    writeInvoiceView(uid, next);
  };
  const cards = view === 'cards';

  const rows = useMemo(
    () =>
      totals.lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => matchesInvoiceQuery(filter, [line.name, products.get(line.productId)?.barcode, line.imei])),
    [totals.lines, filter, products],
  );
  // Cards are windowed by whole rows of cards; the list by single rows.
  const cols = cards ? cardColumns(scroll.width - 24, CARD_MIN, CARD_GAP) : 1;
  const unitH = cards ? CARD_ROW_H : ROW_H;
  const gridRows = Math.ceil(rows.length / cols);
  const rw = rowWindow(scroll.top, scroll.height, unitH, gridRows, 4, cards ? 15 : 60);
  const win = { start: rw.start * cols, end: Math.min(rows.length, rw.end * cols), padTop: rw.padTop, padBottom: rw.padBottom };

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setScroll({ top: el.scrollTop, height: el.clientHeight, width: el.clientWidth });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A newly added line (scan) becomes the active row and is scrolled into view.
  const lastKey = totals.lines[totals.lines.length - 1]?.key ?? null;
  const prevCount = useRef(totals.lines.length);
  useEffect(() => {
    if (totals.lines.length > prevCount.current && lastKey) {
      setActiveKey(lastKey);
      const el = bodyRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
    prevCount.current = totals.lines.length;
  }, [totals.lines.length, lastKey]);

  const setQty = (key: string, qty: number, max: number) =>
    onChange((c) => ({
      ...c,
      lines: c.lines.map((l) => (l.key === key ? { ...l, quantity: Math.max(1, Math.min(max, Math.floor(qty) || 1)) } : l)),
    }));
  const setCustom = (key: string, customUsdCents: number | null) =>
    onChange((c) => ({ ...c, lines: c.lines.map((l) => (l.key === key ? { ...l, customUsdCents } : l)) }));
  const remove = (key: string) => {
    const pos = rows.findIndex((r) => r.line.key === key);
    const next = rows[pos + 1]?.line.key ?? rows[pos - 1]?.line.key ?? null;
    onChange((c) => ({ ...c, lines: c.lines.filter((l) => l.key !== key) }));
    setActiveKey(next);
    if (!next) onFocusSearch?.();
  };

  const focusRow = (index: number) => {
    const target = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (!target) return;
    setActiveKey(target.line.key);
    const el = bodyRef.current;
    if (el) {
      const top = scrollToRow(Math.floor(rows.indexOf(target) / cols), el.scrollTop, el.clientHeight, unitH);
      if (top !== null) el.scrollTop = top;
    }
    requestAnimationFrame(() => bodyRef.current?.querySelector<HTMLElement>(`[data-row="${target.line.key}"]`)?.focus());
  };

  const onRowKey = (event: KeyboardEvent<HTMLDivElement>, line: PricedLine, maxQty: number) => {
    if (event.target !== event.currentTarget) return; // typing inside a cell editor
    const index = rows.findIndex((r) => r.line.key === line.key);
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusRow(index + cols);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusRow(index - cols);
    } else if (cards && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault();
      focusRow(index + ((event.key === 'ArrowRight') !== rtl ? 1 : -1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusRow(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusRow(rows.length - 1);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      remove(line.key);
    } else if ((event.key === '+' || event.key === '=') && !line.imei) {
      event.preventDefault();
      setQty(line.key, line.quantity + 1, maxQty);
    } else if (event.key === '-' && !line.imei) {
      event.preventDefault();
      setQty(line.key, line.quantity - 1, maxQty);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.querySelector<HTMLInputElement>('input')?.focus();
    }
  };

  const hasPrevious = totals.debtLineUsdCents > 0;
  if (totals.lines.length === 0 && !hasPrevious) {
    return (
      <div className="inv inv--empty">
        <EmptyState icon="barcode" title={t('pos.invoice.emptyTitle')} message={t('pos.invoice.emptyHint')} />
      </div>
    );
  }

  return (
    <div className="inv">
      <div className="inv__tools">
        <div className="search-box inv__filter">
          <Icon name="filter" size={14} />
          <input
            className="input"
            type="search"
            value={filter}
            placeholder={t('pos.invoice.filter')}
            aria-label={t('pos.invoice.filter')}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                focusRow(0);
              } else if (e.key === 'Escape') setFilter('');
            }}
          />
        </div>
        <span className="inv__count">
          {filter.trim()
            ? t('pos.invoice.shown', { shown: rows.length, total: totals.lines.length })
            : t('pos.invoice.lines', { count: totals.lines.length, units: totals.itemCount })}
        </span>
        <span className="inv__keys" aria-hidden="true">
          {cards ? '←→↑↓' : '↑↓'} · Enter · +/− · Del
        </span>
        <div className="segmented inv__view" role="radiogroup" aria-label={t('pos.invoice.view')}>
          <button
            type="button"
            role="radio"
            aria-checked={cards}
            className={cards ? 'segmented__item segmented__item--active' : 'segmented__item'}
            title={t('pos.invoice.viewCards')}
            aria-label={t('pos.invoice.viewCards')}
            onClick={() => setView('cards')}
          >
            <Icon name="grid" size={14} />
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!cards}
            className={!cards ? 'segmented__item segmented__item--active' : 'segmented__item'}
            title={t('pos.invoice.viewList')}
            aria-label={t('pos.invoice.viewList')}
            onClick={() => setView('list')}
          >
            <Icon name="menu" size={14} />
          </button>
        </div>
      </div>

      <div className="inv__table" role="grid" aria-rowcount={rows.length + 1} aria-label={t('pos.invoice.title')}>
        {!cards && (
        <div className="inv-row inv-row--head" role="row">
          <span role="columnheader" className="inv-c inv-c--n">#</span>
          <span role="columnheader" className="inv-c inv-c--name">{t('pos.invoice.product')}</span>
          <span role="columnheader" className="inv-c inv-c--qty">{t('pos.qty')}</span>
          <span role="columnheader" className="inv-c inv-c--price">{t('pos.invoice.unitPrice')}</span>
          <span role="columnheader" className="inv-c inv-c--disc">{t('pos.discount')}</span>
          <span role="columnheader" className="inv-c inv-c--total">{t('pos.invoice.lineTotal')}</span>
          <span role="columnheader" className="inv-c inv-c--act"><span className="sr-only">{t('common.remove')}</span></span>
        </div>
        )}

        <div
          className="inv__body"
          ref={bodyRef}
          onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight, width: e.currentTarget.clientWidth })}
        >
          {rows.length === 0 && <p className="inv__none">{t('pos.invoice.noMatch')}</p>}
          {win.padTop > 0 && <div style={{ height: win.padTop }} aria-hidden="true" />}
          {cards && (
            <div className="inv-cards" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
              {rows.slice(win.start, win.end).map(({ line, index }) => {
                const product = products.get(line.productId);
                const maxQty = !line.imei && product ? Math.max(1, product.stock) : 99_999;
                const overStock = !line.imei && product !== undefined && line.quantity > product.stock;
                const isActive = (activeKey ?? rows[0]?.line.key) === line.key;
                const priceEditable = canEditPrice && !line.missing;
                return (
                  <div
                    key={line.key}
                    data-row={line.key}
                    role="row"
                    aria-rowindex={index + 1}
                    aria-selected={isActive}
                    tabIndex={isActive ? 0 : -1}
                    className={['inv-card', isActive ? 'inv-card--active' : '', line.missing ? 'inv-card--error' : '', overStock ? 'inv-card--warn' : ''].filter(Boolean).join(' ')}
                    onFocus={() => setActiveKey(line.key)}
                    onClick={() => setActiveKey(line.key)}
                    onKeyDown={(e) => onRowKey(e, line, maxQty)}
                  >
                    <span className="inv-card__n" aria-hidden="true">{index + 1}</span>
                    <button type="button" className="inv-del inv-card__del" tabIndex={-1} aria-label={t('common.remove')} title={t('common.remove')} onClick={() => remove(line.key)}>
                      <Icon name="trash" size={14} />
                    </button>
                    <span className="inv-card__media" role="gridcell">
                      {product?.imageUrl ? (
                        <img src={product.imageUrl} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <Icon name="package" size={32} />
                      )}
                    </span>
                    <span className="inv-card__name" role="gridcell" title={line.name}>{line.name}</span>
                    <span className="inv-card__meta">
                      {product && !line.imei && (
                        <span className={overStock ? 'inv-stock inv-stock--bad' : product.stock <= 5 ? 'inv-stock inv-stock--low' : 'inv-stock'}>
                          {overStock ? t('pos.overStock', { stock: product.stock }) : t('products.stockCount', { count: product.stock })}
                        </span>
                      )}
                      {line.imei && <span className="inv-tag">IMEI {line.imei}</span>}
                      {line.missing && <span className="inv-tag inv-tag--bad">{t('pos.productRemoved')}</span>}
                    </span>
                    <span className="inv-card__prices" role="gridcell">
                      {priceEditable ? (
                        <>
                          <CellInput
                            value={centsToInput(line.unitUsdCents)}
                            inputMode="decimal"
                            label={t('pos.invoice.unitPrice')}
                            prefix="$"
                            onCommit={(raw) => {
                              const cents = parseUsdInput(raw || '0');
                              if (cents !== null) setCustom(line.key, customPriceFromUnit(line.originalUnitUsdCents, cents));
                            }}
                          />
                          <CellInput
                            value={line.discountUsdCents > 0 ? centsToInput(line.discountUsdCents) : ''}
                            placeholder="0"
                            inputMode="decimal"
                            label={t('pos.discount')}
                            prefix="−$"
                            onCommit={(raw) => {
                              const cents = parseUsdInput(raw || '0');
                              if (cents !== null) setCustom(line.key, customPriceFromDiscount(line.originalUnitUsdCents, cents));
                            }}
                          />
                        </>
                      ) : (
                        <span className="inv-static" dir="ltr">
                          {formatUsd(line.unitUsdCents)}
                          {line.discountUsdCents > 0 && <span className="text-success"> −{formatUsd(line.discountUsdCents)}</span>}
                        </span>
                      )}
                    </span>
                    <span className="inv-card__foot">
                      {line.imei ? (
                        <span className="inv-static">×1</span>
                      ) : (
                        <span className="inv-qty">
                          <button type="button" tabIndex={-1} aria-label="-" disabled={line.quantity <= 1} onClick={() => setQty(line.key, line.quantity - 1, maxQty)}>
                            <Icon name="minus" size={14} />
                          </button>
                          <CellInput
                            value={String(line.quantity)}
                            inputMode="numeric"
                            label={t('pos.qty')}
                            onCommit={(raw) => {
                              const n = Number(raw.trim());
                              if (Number.isFinite(n) && n > 0) setQty(line.key, n, maxQty);
                            }}
                          />
                          <button type="button" tabIndex={-1} aria-label="+" disabled={line.quantity >= maxQty} onClick={() => setQty(line.key, line.quantity + 1, maxQty)}>
                            <Icon name="plus" size={14} />
                          </button>
                        </span>
                      )}
                      <span className="inv-card__total" dir="ltr">
                        <strong>{formatUsd(line.lineUsdCents)}</strong>
                        <small>{formatLbp(line.lineLbp, lang)}</small>
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {!cards && rows.slice(win.start, win.end).map(({ line, index }, i) => {
            const product = products.get(line.productId);
            const maxQty = !line.imei && product ? Math.max(1, product.stock) : 99_999;
            const overStock = !line.imei && product !== undefined && line.quantity > product.stock;
            const isActive = (activeKey ?? rows[0]?.line.key) === line.key;
            const priceEditable = canEditPrice && !line.missing;
            return (
              <div
                key={line.key}
                data-row={line.key}
                role="row"
                aria-rowindex={win.start + i + 2}
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                className={['inv-row', isActive ? 'inv-row--active' : '', line.missing ? 'inv-row--error' : '', overStock ? 'inv-row--warn' : ''].filter(Boolean).join(' ')}
                onFocus={() => setActiveKey(line.key)}
                onClick={() => setActiveKey(line.key)}
                onKeyDown={(e) => onRowKey(e, line, maxQty)}
              >
                <span role="gridcell" className="inv-c inv-c--n">{index + 1}</span>
                <span role="gridcell" className="inv-c inv-c--name" title={line.name}>
                  {product?.imageUrl ? (
                    <img className="inv-thumb" src={product.imageUrl} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <span className="inv-thumb inv-thumb--empty" aria-hidden="true">
                      <Icon name="package" size={20} />
                    </span>
                  )}
                  <span className="inv-name-block">
                    <span className="inv-name">{line.name}</span>
                    <span className="inv-meta">
                      {product?.barcode && <span className="inv-meta__sku" dir="ltr">{product.barcode}</span>}
                      {product && !line.imei && (
                        <span
                          className={overStock ? 'inv-stock inv-stock--bad' : product.stock <= 5 ? 'inv-stock inv-stock--low' : 'inv-stock'}
                          title={overStock ? t('pos.overStock', { stock: product.stock }) : undefined}
                        >
                          {overStock ? t('pos.overStock', { stock: product.stock }) : t('products.stockCount', { count: product.stock })}
                        </span>
                      )}
                      {line.imei && <span className="inv-tag">IMEI {line.imei}</span>}
                      {line.missing && <span className="inv-tag inv-tag--bad">{t('pos.productRemoved')}</span>}
                    </span>
                  </span>
                </span>
                <span role="gridcell" className="inv-c inv-c--qty">
                  {line.imei ? (
                    <span className="inv-static">1</span>
                  ) : (
                    <span className="inv-qty">
                      <button type="button" tabIndex={-1} aria-label="-" disabled={line.quantity <= 1} onClick={() => setQty(line.key, line.quantity - 1, maxQty)}>
                        <Icon name="minus" size={14} />
                      </button>
                      <CellInput
                        value={String(line.quantity)}
                        inputMode="numeric"
                        label={t('pos.qty')}
                        onCommit={(raw) => {
                          const n = Number(raw.trim());
                          if (Number.isFinite(n) && n > 0) setQty(line.key, n, maxQty);
                        }}
                      />
                      <button type="button" tabIndex={-1} aria-label="+" disabled={line.quantity >= maxQty} onClick={() => setQty(line.key, line.quantity + 1, maxQty)}>
                        <Icon name="plus" size={14} />
                      </button>
                    </span>
                  )}
                </span>
                <span role="gridcell" className="inv-c inv-c--price">
                  {priceEditable ? (
                    <CellInput
                      value={centsToInput(line.unitUsdCents)}
                      inputMode="decimal"
                      label={t('pos.invoice.unitPrice')}
                      prefix="$"
                      onCommit={(raw) => {
                        const cents = parseUsdInput(raw || '0');
                        if (cents !== null) setCustom(line.key, customPriceFromUnit(line.originalUnitUsdCents, cents));
                      }}
                    />
                  ) : (
                    <span className="inv-static" dir="ltr">{formatUsd(line.unitUsdCents)}</span>
                  )}
                </span>
                <span role="gridcell" className="inv-c inv-c--disc">
                  {priceEditable ? (
                    <CellInput
                      value={line.discountUsdCents > 0 ? centsToInput(line.discountUsdCents) : ''}
                      placeholder="0"
                      inputMode="decimal"
                      label={t('pos.discount')}
                      prefix="−$"
                      onCommit={(raw) => {
                        const cents = parseUsdInput(raw || '0');
                        if (cents !== null) setCustom(line.key, customPriceFromDiscount(line.originalUnitUsdCents, cents));
                      }}
                    />
                  ) : (
                    <span className={line.discountUsdCents > 0 ? 'inv-static text-success' : 'inv-static muted'} dir="ltr">
                      {line.discountUsdCents > 0 ? `−${formatUsd(line.discountUsdCents)}` : '—'}
                    </span>
                  )}
                </span>
                <span role="gridcell" className="inv-c inv-c--total" dir="ltr">
                  <strong>{formatUsd(line.lineUsdCents)}</strong>
                  <small>{formatLbp(line.lineLbp, lang)}</small>
                </span>
                <span role="gridcell" className="inv-c inv-c--act">
                  <button type="button" className="inv-del" tabIndex={-1} aria-label={t('common.remove')} title={t('common.remove')} onClick={() => remove(line.key)}>
                    <Icon name="trash" size={14} />
                  </button>
                </span>
              </div>
            );
          })}
          {win.padBottom > 0 && <div style={{ height: win.padBottom }} aria-hidden="true" />}
          {hasPrevious && (
            <div className="inv-row inv-row--debt" role="row">
              <span role="gridcell" className="inv-c inv-c--n">
                <Icon name="history" size={14} />
              </span>
              <span role="gridcell" className="inv-c inv-c--name">
                <span className="inv-name">{t('pos.previousBalance')}</span>
                {customerName && <span className="inv-tag">{t('pos.previousCustomer', { name: customerName })}</span>}
              </span>
              <span role="gridcell" className="inv-c inv-c--total" dir="ltr">
                <strong>{formatUsd(totals.debtLineUsdCents)}</strong>
                <small>{formatLbp(totals.debtLineLbp, lang)}</small>
              </span>
              <span role="gridcell" className="inv-c inv-c--act">
                <button type="button" className="inv-del" aria-label={t('pos.removePrevious')} title={t('pos.removePrevious')} onClick={onRemovePrevious}>
                  <Icon name="x" size={14} />
                </button>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Spreadsheet-style cell: edits a local draft and commits on Enter or blur; Escape cancels.
 * Committing returns focus to the row so arrow-key navigation continues.
 */
function CellInput({
  value,
  label,
  onCommit,
  inputMode,
  placeholder,
  prefix,
}: {
  value: string;
  label: string;
  onCommit: (raw: string) => void;
  inputMode: 'numeric' | 'decimal';
  placeholder?: string;
  prefix?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const finish = (row: HTMLElement | null, commit: boolean) => {
    if (commit && draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
    row?.focus();
  };
  return (
    <span className="inv-cell">
      {prefix && <span className="inv-cell__prefix" aria-hidden="true">{prefix}</span>}
      <input
        className="inv-cell__input"
        dir="ltr"
        value={shown}
        placeholder={placeholder}
        inputMode={inputMode}
        aria-label={label}
        tabIndex={-1}
        onFocus={(e) => {
          setDraft(value);
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== value) onCommit(draft);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          const row = e.currentTarget.closest<HTMLElement>('[role="row"]');
          if (e.key === 'Enter') {
            e.preventDefault();
            finish(row, true);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(null);
            row?.focus();
          } else if (e.key === 'Tab') {
            // Tab moves to the next editable cell in the same row.
            const inputs = row ? [...row.querySelectorAll<HTMLInputElement>('.inv-cell__input')] : [];
            const i = inputs.indexOf(e.currentTarget);
            const next = inputs[i + (e.shiftKey ? -1 : 1)];
            if (next) {
              e.preventDefault();
              if (draft !== null && draft !== value) onCommit(draft);
              setDraft(null);
              next.focus();
            }
          }
        }}
      />
    </span>
  );
}
