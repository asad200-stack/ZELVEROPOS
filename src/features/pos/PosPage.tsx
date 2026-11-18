import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { setWorkInProgress } from '@/app/serviceWorker';
import { Button } from '@/components/ui/Button';
import { SelectInput } from '@/components/ui/Form';
import { Icon } from '@/components/ui/Icon';
import { Alert } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { useFeedback } from '@/contexts/feedback';
import { useTenant } from '@/contexts/session';
import { addProductToCart, cartCanCheckout, creditRequiresCustomer, newLineKey, priceCart } from '@/domain/cart';
import { computeCredit, planCashTender, type CashTenderPlan } from '@/domain/checkout';
import { formatUsdCentsInput, parseLbpInput, parseUsdInput, usdCentsToLbp } from '@/domain/money';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { mergeKnown } from '@/domain/catalogSession';
import { useCashbox, useCategories, useSettings } from '@/hooks/useTenantData';
import { useI18n } from '@/i18n/i18n';
import { takeReopenRequest, useOfflineQueue } from '@/offline/queue';
import { getCustomer, getProductsByIds } from '@/services/catalogQuery';
import { checkout, warmCheckout, type CheckoutResult } from '@/services/salesService';
import type { Currency, Customer, PriceTier, Product } from '@/types/models';
import { formatLbp, formatUsd } from '@/utils/format';
import { CartPanel } from './CartPanel';
import { CheckoutPrintMenu } from './CheckoutPrintMenu';
import { FitAmount } from './FitAmount';
import { CustomerSelect } from './CustomerSelect';
import { QuickAddCustomerModal } from './QuickAddCustomerModal';
import { PaymentPanel, type PaymentDraft } from './PaymentPanel';
import { ProductPicker } from './ProductPicker';
import { InvoiceAddBar } from './InvoiceAddBar';
import { InvoiceTable } from './InvoiceTable';
import { readPosLayout, roomInStock, writePosLayout, type PosLayout } from './invoiceLayout';
import { registerPosCartHost, unregisterPosCartHost } from '@/features/ai/actions/cartBridge';
import { MAX_CARTS, usePosCarts } from './usePosCarts';

const INVALID_TENDER: CashTenderPlan = {
  ok: false,
  error: 'invalidAmount',
  receivedUsdCents: 0,
  receivedLbp: 0,
  changeUsdCents: 0,
  changeLbp: 0,
  remainingUsdCents: 0,
  remainingLbp: 0,
  drawerShort: false,
  allUsdCents: 0,
  allLbp: 0,
  allUsdOk: false,
  allLbpOk: false,
};

function typedAmount(raw: string, parse: (value: string) => number | null): number | null {
  if (!raw.trim()) return 0;
  return parse(raw);
}

export default function PosPage() {
  const { t, lang } = useI18n();
  const { tenantId, actor, can } = useTenant();
  const { notify, confirm } = useFeedback();
  const online = useOnlineStatus();
  const settings = useSettings();
  const cashbox = useCashbox();
  const rate = settings.exchangeRate;
  const categories = useCategories();
  const pos = usePosCarts(tenantId, actor.uid, settings.defaultCurrency);
  const [knownProducts, setKnownProducts] = useState<Map<string, Product>>(() => new Map());
  const [knownCustomer, setKnownCustomer] = useState<Customer | null>(null);
  /** Open quick-add dialog, with the text typed in the customer search. */
  const [quickCustomer, setQuickCustomer] = useState<{ seed: string } | null>(null);
  const { cart, update } = pos;
  const cartRef = useRef(cart);
  useLayoutEffect(() => {
    cartRef.current = cart;
  });
  useEffect(() => {
    const host = {
      getCart: () => cartRef.current,
      update,
    };
    registerPosCartHost(host);
    return () => unregisterPosCartHost(host);
  }, [update]);
  const draft = cart.draft;
  const customer = cart.customerId && knownCustomer?.id === cart.customerId ? knownCustomer : null;
  const productMap = knownProducts;
  const lineKey = cart.lines.map((line) => line.productId).join('\n');

  useEffect(() => {
    const missing = [...new Set(cart.lines.map((line) => line.productId))].filter((id) => !knownProducts.has(id));
    if (missing.length === 0) return;
    let cancelled = false;
    getProductsByIds(tenantId, missing)
      .then((found) => {
        if (!cancelled && found.length > 0) setKnownProducts((known) => mergeKnown(known, found));
      })
      .catch((error: unknown) => console.error('[pos] cart products', error));
    return () => {
      cancelled = true;
    };
    // knownProducts is read to skip ids already held. A missing deleted id is not retried this session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineKey, tenantId]);

  useEffect(() => {
    const id = cart.customerId;
    if (!id) return;
    if (knownCustomer?.id === id) return;
    let cancelled = false;
    getCustomer(tenantId, id)
      .then((found) => {
        if (!cancelled) setKnownCustomer(found);
      })
      .catch((error: unknown) => console.error('[pos] customer', error));
    return () => {
      cancelled = true;
    };
  }, [cart.customerId, tenantId, knownCustomer?.id]);
  const setDraft = (patch: Partial<PaymentDraft>) => update((c) => ({ ...c, draft: { ...c.draft, ...patch } }));
  /**
   * Applies an EXPLICIT checkout-level discount the cashier chose (fixed amount or round-down).
   * Never called automatically just because cash is short — only from a cashier button click.
   */
  const setCheckoutDiscount = (usdCents: number, kind: 'fixed' | 'roundDown') =>
    update((c) => ({ ...c, checkoutDiscountUsdCents: Math.max(0, Math.round(usdCents)), checkoutDiscountKind: kind }));
  const clearCheckoutDiscount = () => update((c) => ({ ...c, checkoutDiscountUsdCents: 0, checkoutDiscountKind: null }));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const skipRenameSave = useRef(false);
  const [imeiProduct, setImeiProduct] = useState<Product | null>(null);
  const [completed, setCompleted] = useState<CheckoutResult | null>(null);
  const [mobileTab, setMobileTab] = useState<'products' | 'cart'>('products');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  /** Invalidates ProductPicker's one-shot page after stock commits on the server. */
  const [catalogRevision, setCatalogRevision] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const { busy, run } = useAsyncAction('checkout');

  const totals = useMemo(() => priceCart(cart, productMap, rate), [cart, productMap, rate]);

  const cash = useMemo(() => {
    const receivedUsdCents = typedAmount(draft.receivedUsd, parseUsdInput);
    const receivedLbp = typedAmount(draft.receivedLbp, parseLbpInput);
    const manualUsdCents = draft.changeManual === 'usd' ? typedAmount(draft.changeUsd, parseUsdInput) : 0;
    const manualLbp = draft.changeManual === 'lbp' ? typedAmount(draft.changeLbp, parseLbpInput) : 0;
    if (receivedUsdCents === null || receivedLbp === null || manualUsdCents === null || manualLbp === null) return INVALID_TENDER;
    const drawerKnown = cashbox.status === 'ready';
    return planCashTender({
      dueUsdCents: totals.payableUsdCents,
      dueLbp: totals.payableLbp,
      rate,
      receivedUsdCents,
      receivedLbp,
      manual: draft.changeManual,
      manualUsdCents: manualUsdCents ?? 0,
      manualLbp: manualLbp ?? 0,
      drawerUsdCents: drawerKnown ? cashbox.data.usdCents : Number.MAX_SAFE_INTEGER,
      drawerLbp: drawerKnown ? cashbox.data.lbp : Number.MAX_SAFE_INTEGER,
    });
  }, [draft, totals.payableUsdCents, totals.payableLbp, rate, cashbox.status, cashbox.data.usdCents, cashbox.data.lbp]);

  const creditPaidUsd = parseUsdInput(draft.creditUsd || '0');
  const creditPaidLbp = parseLbpInput(draft.creditLbp || '0');
  const credit = useMemo(
    () =>
      customer
        ? computeCredit({
            productsUsdCents: totals.productsUsdCents,
            paidUsdCents: creditPaidUsd ?? -1,
            paidLbp: creditPaidLbp ?? -1,
            rate,
            customerDebtUsdCents: customer.debtUsdCents,
            creditLimitUsdCents: customer.creditLimitUsdCents,
            previousUsdCents: cart.debtLineUsdCents ?? 0,
          })
        : null,
    [customer, totals.productsUsdCents, creditPaidUsd, creditPaidLbp, rate, cart.debtLineUsdCents],
  );

  /**
   * The one way products enter a cart, shared by both layouts (tile tap, invoice search, scanner).
   * Never puts more in the cart than is in stock: the server rejects an oversold checkout anyway,
   * this stops it at the counter.
   */
  const addProduct = useCallback(
    (product: Product, qty = 1) => {
      setKnownProducts((known) => mergeKnown(known, [product]));
      if (product.imeiTracking) {
        setImeiProduct(product);
        return;
      }
      const inCart = cartRef.current.lines
        .filter((l) => l.productId === product.id && !l.imei)
        .reduce((sum, l) => sum + l.quantity, 0);
      const room = roomInStock(product.stock, inCart);
      if (room <= 0) {
        notify('warning', `${product.name}: ${t('pos.overStock', { stock: Math.max(0, product.stock) })}`);
        return;
      }
      const count = Math.min(Math.max(1, Math.floor(qty)), room);
      if (count < qty) notify('warning', `${product.name}: ${t('pos.overStock', { stock: Math.max(0, product.stock) })}`);
      update((c) => addProductToCart(c, product, count));
    },
    [update, notify, t],
  );
  const pick = useCallback((product: Product) => addProduct(product, 1), [addProduct]);

  /** Classic grid or invoice table. Remembered per user; both read and write the same cart. */
  const [layout, setLayoutState] = useState<PosLayout>(() => readPosLayout(actor.uid));
  const setLayout = (next: PosLayout) => {
    setLayoutState(next);
    writePosLayout(actor.uid, next);
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  const setCustomer = (next: Customer | null) => {
    setKnownCustomer(next);
    update((c) => ({
      ...c,
      customerId: next?.id ?? null,
      debtLineUsdCents: null,
      draft: next ? c.draft : { ...c.draft, kind: 'cash' as const },
    }));
  };

  const toggleDebtLine = (amountUsdCents: number | null) => {
    if (amountUsdCents !== null && !online) return;
    update((c) => {
      if (!customer || customer.debtUsdCents <= 0 || amountUsdCents === null) return { ...c, debtLineUsdCents: null };
      const cents = Math.max(0, Math.min(customer.debtUsdCents, Math.round(amountUsdCents)));
      return { ...c, debtLineUsdCents: cents > 0 ? cents : null };
    });
  };

  const complete = () =>
    run(async () => {
      if (!cartCanCheckout(cart)) {
        notify('warning', t('error.cartEmpty'));
        return;
      }
      if (draft.kind === 'cash' && !cash.ok) return;
      if (draft.kind === 'credit') {
        if (!customer || !credit?.ok) return;
        const ok = await confirm({
          title: t('pos.confirmCreditTitle'),
          message: t('pos.confirmCreditMessage', {
            customer: customer.name,
            paid: formatUsd(credit.paidTotalUsdCents),
            debt: formatUsd(credit.newTotalDebtUsdCents),
          }),
          confirmLabel: t('pos.completeSale'),
        });
        if (!ok) return;
      }
      const result = await checkout(
        {
          cart,
          kind: draft.kind,
          rate,
          totals,
          cash:
            draft.kind === 'cash' && cash.ok
              ? {
                  receivedUsdCents: cash.receivedUsdCents,
                  receivedLbp: cash.receivedLbp,
                  changeUsdCents: cash.changeUsdCents,
                  changeLbp: cash.changeLbp,
                }
              : undefined,
          credit: draft.kind === 'credit' ? { paidUsdCents: creditPaidUsd ?? 0, paidLbp: creditPaidLbp ?? 0 } : undefined,
        },
        { tenantId, uid: actor.uid, cashierName: actor.name, customerName: customer?.name ?? '' },
      );
      // The cart is cleared only once the sale is either recorded by the server or committed to IndexedDB.
      pos.resetActive();
      setCheckoutOpen(false);
      setCompleted(result);
      setMobileTab('products');
      if (result.mode === 'online') {
        // One-shot catalog is not a listener; bump the page key so tiles re-read committed stock.
        setCatalogRevision((n) => n + 1);
        const soldIds = [...new Set(result.sale.items.map((item) => item.productId))];
        if (soldIds.length > 0) {
          void getProductsByIds(tenantId, soldIds)
            .then((found) => {
              if (found.length > 0) setKnownProducts((known) => mergeKnown(known, found));
            })
            .catch((error: unknown) => console.error('[pos] catalog stock refresh', error));
        }
        if (result.duplicate) notify('info', t('pos.duplicateSale'));
      }
    });

  const queue = useOfflineQueue();
  useEffect(() => {
    const op = takeReopenRequest();
    if (!op) return;
    const opened = pos.openInCart({
      tier: op.snapshot.tier,
      currency: op.snapshot.currency,
      customerId: op.snapshot.customerId,
      debtLineUsdCents: null,
      label: op.snapshot.orderLabel ?? '',
      note: op.snapshot.note ?? '',
      lines: op.snapshot.lines.map((l) => ({
        key: newLineKey(),
        productId: l.productId,
        name: l.name,
        tier: l.tier,
        quantity: l.quantity,
        customUsdCents: l.customUsdCents,
        imei: l.imei,
      })),
    });
    notify(opened ? 'info' : 'error', t(opened ? 'offline.reopened' : 'offline.reopenNoRoom', { ref: op.offlineRef }));
  }, [queue, pos, notify, t]);

  const hasItems = cartCanCheckout(cart);
  const cartTitle = cart.label.trim() || `#${cart.id}`;
  const openCheckout = () => {
    if (!hasItems) {
      notify('warning', t('error.cartEmpty'));
      return;
    }
    if (creditRequiresCustomer(draft.kind, cart.customerId)) {
      notify('warning', t('pos.creditNeedsCustomer'));
      return;
    }
    // Cash Received must never show a leftover amount from an earlier attempt on this cart —
    // every time Checkout opens, it starts prefilled to the exact amount due in USD.
    if (draft.kind === 'cash') {
      setDraft({
        receivedUsd: totals.payableUsdCents > 0 ? formatUsdCentsInput(totals.payableUsdCents) : '',
        receivedLbp: '',
        changeUsd: '',
        changeLbp: '',
        changeManual: null,
        tenderUsdManual: false,
        tenderLbpManual: false,
      });
    }
    setCheckoutOpen(true);
    requestAnimationFrame(() => document.getElementById(draft.kind === 'cash' ? 'received-usd' : 'complete-sale')?.focus());
  };
  const closeCheckout = () => setCheckoutOpen(false);

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === 'F2') {
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    } else if (e.key === 'F9') {
      e.preventDefault();
      if (completed || imeiProduct || document.querySelector('.modal[role="dialog"]')) return;
      if (checkoutOpen) void complete();
      else openCheckout();
    } else if (e.key === 'Escape' && checkoutOpen && !completed && !imeiProduct) {
      e.preventDefault();
      closeCheckout();
    }
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Wake the checkout server while the cashier is still adding items, so Complete sale is quick.
  const hasLines = cart.lines.length > 0;
  useEffect(() => {
    if (hasLines && online) warmCheckout();
  }, [hasLines, online, checkoutOpen]);

  const workInProgress = busy || pos.carts.some((c) => cartCanCheckout(c) || c.lines.length > 0);
  useEffect(() => {
    setWorkInProgress('pos', workInProgress);
    return () => setWorkInProgress('pos', false);
  }, [workInProgress]);

  return (
    <div className={`pos pos--layout-${layout} pos--${mobileTab}${checkoutOpen ? ' pos--pay' : ''}`}>
      <div className="pos__modebar">
        <div className="segmented pos__mode" role="radiogroup" aria-label={t('pos.layout.label')}>
          <button
            type="button"
            role="radio"
            aria-checked={layout === 'classic'}
            className={layout === 'classic' ? 'segmented__item segmented__item--active' : 'segmented__item'}
            onClick={() => setLayout('classic')}
            title={t('pos.layout.classicHint')}
          >
            <Icon name="grid" size={14} />
            <span>{t('pos.layout.classic')}</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={layout === 'invoice'}
            className={layout === 'invoice' ? 'segmented__item segmented__item--active' : 'segmented__item'}
            onClick={() => setLayout('invoice')}
            title={t('pos.layout.invoiceHint')}
          >
            <Icon name="table" size={14} />
            <span>{t('pos.layout.invoice')}</span>
          </button>
        </div>
        <span className="pos__shortcuts" aria-hidden="true">
          <kbd>F2</kbd> {t('pos.layout.keySearch')} <kbd>F9</kbd> {t('pos.checkout')}
        </span>
      </div>

      <div className="pos__tabs-mobile segmented">
        <button type="button" className={mobileTab === 'products' ? 'segmented__item segmented__item--active' : 'segmented__item'} onClick={() => { setMobileTab('products'); setCheckoutOpen(false); }}>
          {layout === 'invoice' ? t('pos.layout.invoice') : t('nav.products')}
        </button>
        <button type="button" className={mobileTab === 'cart' && !checkoutOpen ? 'segmented__item segmented__item--active' : 'segmented__item'} onClick={() => { setMobileTab('cart'); setCheckoutOpen(false); }}>
          {t('pos.cart')} ({totals.itemCount})
        </button>
        <button type="button" className={checkoutOpen ? 'segmented__item segmented__item--active' : 'segmented__item'} onClick={() => { setMobileTab('cart'); openCheckout(); }}>
          {t('pos.checkout')}
        </button>
      </div>

      <section className="pos__products">
        {layout === 'classic' ? (
          <ProductPicker
            tenantId={tenantId}
            categories={categories}
            tier={cart.tier}
            rate={rate}
            lowStockThreshold={settings.lowStockThreshold}
            searchRef={searchRef}
            onPick={pick}
            catalogRevision={catalogRevision}
          />
        ) : (
          // Invoice layout: the scan box and the invoice lines take the product grid's place.
          <div className="inv-pane">
            <InvoiceAddBar tenantId={tenantId} tier={cart.tier} rate={rate} searchRef={searchRef} onAdd={addProduct} />
            <InvoiceTable
              totals={totals}
              products={productMap}
              canEditPrice={can('canEditPrice')}
              customerName={customer?.name}
              onChange={update}
              onRemovePrevious={() => toggleDebtLine(null)}
              onFocusSearch={() => searchRef.current?.focus()}
              uid={actor.uid}
            />
          </div>
        )}
      </section>

      <section className="pos__cart">
        <div className="cart-tabs" role="tablist">
          {pos.carts.map((c, i) => {
            const title = c.label.trim() || `#${c.id}`;
            return (
              <div key={c.id} className={i === pos.active ? 'cart-tab cart-tab--active' : 'cart-tab'}>
                {renaming === c.id ? (
                  <input
                    className="cart-tab__name"
                    value={renameValue}
                    autoFocus
                    maxLength={40}
                    aria-label={t('pos.renameCart')}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        pos.renameCart(c.id, renameValue);
                        setRenaming(null);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        skipRenameSave.current = true;
                        setRenaming(null);
                      }
                    }}
                    onBlur={() => {
                      if (skipRenameSave.current) {
                        skipRenameSave.current = false;
                        return;
                      }
                      pos.renameCart(c.id, renameValue);
                      setRenaming(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={i === pos.active}
                    title={title}
                    onClick={() => pos.setActive(i)}
                    onDoubleClick={() => {
                      setRenaming(c.id);
                      setRenameValue(c.label);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setRenaming(c.id);
                      setRenameValue(c.label);
                    }}
                  >
                    <span className="cart-tab__label">{title}</span>
                    {c.lines.length > 0 && <span className="cart-tab__count">{c.lines.length}</span>}
                  </button>
                )}
                {i === pos.active && renaming !== c.id && (
                  <button
                    type="button"
                    className="cart-tab__edit"
                    aria-label={t('pos.renameCart')}
                    title={t('pos.renameCart')}
                    onClick={() => {
                      setRenaming(c.id);
                      setRenameValue(c.label);
                    }}
                  >
                    <Icon name="edit" size={12} />
                  </button>
                )}
                {pos.carts.length > 1 && (
                  <button type="button" className="cart-tab__close" onClick={() => pos.removeCart(i)} aria-label={t('common.remove')}>
                    <Icon name="x" size={12} />
                  </button>
                )}
              </div>
            );
          })}
          {pos.carts.length < MAX_CARTS && (
            <button type="button" className="cart-tab cart-tab--add" onClick={pos.addCart} aria-label={t('pos.newCart')}>
              <Icon name="plus" size={14} />
            </button>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon="trash"
            className="cart-tabs__clear"
            disabled={!hasItems}
            onClick={async () => {
              if (await confirm({ title: t('pos.clearCart'), message: t('pos.clearCartConfirm'), danger: true })) {
                update((c) => ({ ...c, lines: [], debtLineUsdCents: null, draft: { ...c.draft, receivedUsd: '', receivedLbp: '', changeUsd: '', changeLbp: '', changeManual: null, tenderUsdManual: false, tenderLbpManual: false } }));
              }
            }}
          >
            {t('pos.clearCart')}
          </Button>
        </div>

        <div className="cart-head">
          <div className="cart-options">
            <SelectInput
              label={t('pos.priceTier')}
              value={cart.tier}
              onChange={(e) => {
                const tier = e.target.value as PriceTier;
                update((c) => ({ ...c, tier, lines: c.lines.map((l) => ({ ...l, tier, customUsdCents: null })) }));
              }}
              options={[
                { value: 'retail', label: t('products.retail') },
                { value: 'wholesale', label: t('products.wholesale') },
                { value: 'vip', label: t('products.vip') },
              ]}
            />
            <SelectInput
              label={t('pos.currency')}
              value={cart.currency}
              onChange={(e) => {
                const currency = e.target.value as Currency;
                update((c) => ({ ...c, currency }));
              }}
              options={[
                // Symbol first so it stays visible even in the narrow cart column.
                { value: 'USD', label: '$ USD' },
                { value: 'LBP', label: lang === 'ar' ? 'ل.ل ليرة' : 'LBP' },
              ]}
            />
            <div className="field cart-options__pay">
              <span className="field__label">{t('pos.paymentMethod')}</span>
              <div className="segmented" role="radiogroup" aria-label={t('pos.paymentMethod')}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.kind === 'cash'}
                  className={draft.kind === 'cash' ? 'segmented__item segmented__item--active' : 'segmented__item'}
                  onClick={() => setDraft({ kind: 'cash' })}
                >
                  {t('pos.fullPayment')}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.kind === 'credit'}
                  className={draft.kind === 'credit' ? 'segmented__item segmented__item--active' : 'segmented__item'}
                  onClick={() => setDraft({ kind: 'credit' })}
                >
                  {t('pos.creditSale')}
                </button>
              </div>
            </div>
          </div>
          <CustomerSelect
            tenantId={tenantId}
            selected={customer}
            onSelect={setCustomer}
            onAddNew={can('canViewCustomers') ? (seed) => setQuickCustomer({ seed }) : undefined}
            hint={creditRequiresCustomer(draft.kind, cart.customerId) ? t('pos.selectCustomer') : undefined}
            actions={
              customer && customer.debtUsdCents > 0 ? (
                <span className="cart-debt-actions">
                  <span className={cart.debtLineUsdCents !== null ? 'cart-debt-chip cart-debt-chip--on' : 'cart-debt-chip'}>
                    {cart.debtLineUsdCents !== null
                      ? t('pos.previousShort', { amount: formatUsd(cart.debtLineUsdCents) })
                      : t('pos.previousDue', { amount: formatUsd(customer.debtUsdCents) })}
                  </span>
                  {cart.debtLineUsdCents !== null ? (
                    <button type="button" className="cart-debt-btn" onClick={() => toggleDebtLine(null)}>
                      {t('common.remove')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="cart-debt-btn"
                      disabled={!online}
                      title={!online ? t('pos.previousOffline') : undefined}
                      onClick={() => toggleDebtLine(customer.debtUsdCents)}
                    >
                      {t('pos.addPrevious')}
                    </button>
                  )}
                </span>
              ) : null
            }
          />
        </div>

        <div className="pos__lines">
          {layout === 'invoice' ? (
            // The lines live in the invoice on the left; here only a short summary.
            <div className="inv-summary">
              <span className="inv-summary__count">{totals.lines.length}</span>
              <span>{t('pos.invoice.lines', { count: totals.lines.length, units: totals.itemCount })}</span>
            </div>
          ) : (
            <CartPanel
              cart={cart}
              totals={totals}
              products={productMap}
              canEditPrice={can('canEditPrice')}
              customerName={customer?.name}
              onChange={update}
              onRemovePrevious={() => toggleDebtLine(null)}
            />
          )}
        </div>

        {!online && <Alert tone="warning">{t('offline.posBanner')}</Alert>}

        <footer className="cart-foot">
          <div className="cart-foot__row cart-foot__subtotal">
            <span>{t('pos.saleSubtotal')}</span>
            <span className="cart-foot__money">
              <FitAmount value={formatUsd(totals.productsUsdCents)} />
              <FitAmount value={formatLbp(totals.productsLbp, lang)} className="fit-amount--muted" />
            </span>
          </div>
          {totals.discountUsdCents > 0 && (
            <div className="cart-foot__row">
              <span>{t('pos.discount')}</span>
              <span className="cart-foot__money">
                <FitAmount value={`−${formatUsd(totals.discountUsdCents)}`} className="fit-amount--good" />
                <FitAmount value={formatLbp(usdCentsToLbp(totals.discountUsdCents, rate), lang)} className="fit-amount--muted" />
              </span>
            </div>
          )}
          {totals.debtLineUsdCents > 0 && (
            <div className="cart-foot__row">
              <span>{t('pos.previousBalance')}</span>
              <span className="cart-foot__money">
                <FitAmount value={formatUsd(totals.debtLineUsdCents)} />
                <FitAmount value={formatLbp(totals.debtLineLbp, lang)} className="fit-amount--muted" />
              </span>
            </div>
          )}
          <div className="cart-foot__total">
            <span>{t('pos.totalToCollect')}</span>
            <span className="cart-foot__money">
              <FitAmount value={formatUsd(totals.dueUsdCents)} />
              <FitAmount value={formatLbp(totals.dueLbp, lang)} className="fit-amount--sub" />
            </span>
          </div>
          <div className="cart-foot__actions">
            <Button variant="secondary" icon="clipboard" disabled={!hasItems || pos.carts.length >= MAX_CARTS} onClick={() => pos.addCart()}>
              {t('pos.saveCart')}
            </Button>
            <Button disabled={!hasItems || creditRequiresCustomer(draft.kind, cart.customerId)} onClick={openCheckout}>
              {t('pos.checkout')}
            </Button>
          </div>
        </footer>
      </section>

      {checkoutOpen && (
        <div className="pos__pay" role="dialog" aria-modal="true" aria-labelledby="pos-checkout-title">
          <button type="button" className="pos__pay-backdrop" aria-label={t('pos.closeCheckout')} onClick={closeCheckout} />
          <aside className="pos__checkout">
            <header className="pos__checkout-head">
              <div>
                <h2 id="pos-checkout-title">{t('pos.checkout')}</h2>
                <p className="pos__checkout-cart">{t('pos.payingCart', { name: cartTitle })}</p>
              </div>
              <Button variant="ghost" size="sm" icon="x" aria-label={t('pos.closeCheckout')} onClick={closeCheckout} />
            </header>
            <PaymentPanel
              draft={draft}
              onDraft={setDraft}
              note={cart.note}
              onNote={(note) => update((c) => ({ ...c, note: note.slice(0, 200) }))}
              totals={totals}
              customer={customer}
              cash={cash}
              credit={credit}
              previousUsdCents={cart.debtLineUsdCents}
              rate={rate}
              busy={busy}
              disabled={!hasItems || creditRequiresCustomer(draft.kind, cart.customerId)}
              onComplete={() => void complete()}
              // Invoice layout: discounts are entered per line in the table, so checkout shows no
              // discount tools (an existing checkout discount can still be seen and removed).
              canDiscount={can('canEditPrice') && layout === 'classic'}
              onRoundDown={() => {
                if (draft.kind !== 'cash' || cash.error !== 'underpaid') return;
                // cash.remainingUsdCents is the whole shortfall already expressed in USD cents;
                // cash.remainingLbp is the SAME shortfall shown in LBP for display, not a second
                // amount to add — summing both here used to double-count the shortfall.
                setCheckoutDiscount(totals.checkoutDiscountUsdCents + cash.remainingUsdCents, 'roundDown');
              }}
              onApplyFixedDiscount={(usdCents) => setCheckoutDiscount(usdCents, 'fixed')}
              onClearDiscount={clearCheckoutDiscount}
            />
          </aside>
        </div>
      )}

      {quickCustomer && (
        <QuickAddCustomerModal
          seed={quickCustomer.seed}
          onClose={() => setQuickCustomer(null)}
          onSelected={(created) => {
            // Same path as picking from the search list: only the customer changes; the cart lines,
            // prices, currency, discount and payment method (cash/credit) stay as they were.
            setCustomer(created);
            setQuickCustomer(null);
          }}
        />
      )}
      {imeiProduct && (
        <ImeiPicker
          product={imeiProduct}
          inCart={cart.lines.filter((l) => l.imei).map((l) => l.imei!)}
          onClose={() => setImeiProduct(null)}
          onPick={(imei) => {
            update((c) => addProductToCart(c, imeiProduct, 1, imei));
            setImeiProduct(null);
          }}
        />
      )}

      {completed && (
        <CheckoutPrintMenu
          result={completed}
          settings={settings}
          onClose={() => {
            setCompleted(null);
            searchRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function ImeiPicker({ product, inCart, onClose, onPick }: { product: Product; inCart: string[]; onClose: () => void; onPick: (imei: string) => void }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState('');
  const available = product.imeis.filter((e) => e.status === 'available' && !inCart.includes(e.imei) && e.imei.includes(filter.trim()));
  return (
    <Modal open size="sm" title={t('pos.selectImei', { name: product.name })} onClose={onClose}>
      <input
        className="input"
        dir="ltr"
        placeholder={t('pos.scanImei')}
        value={filter}
        autoFocus
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && available.length === 1) onPick(available[0].imei);
        }}
      />
      <div className="imei-list">
        {available.length === 0 ? (
          <p className="muted">{t('pos.noImei')}</p>
        ) : (
          available.slice(0, 100).map((e) => (
            <button key={e.imei} type="button" className="imei-list__item" onClick={() => onPick(e.imei)}>
              {e.imei}
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}
