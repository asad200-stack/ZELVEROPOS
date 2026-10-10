import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { setWorkInProgress } from '@/app/serviceWorker';
import { Button } from '@/components/ui/Button';
import { Checkbox, SelectInput } from '@/components/ui/Form';
import { Icon } from '@/components/ui/Icon';
import { Alert, Badge } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { useFeedback } from '@/contexts/feedback';
import { useTenant } from '@/contexts/session';
import { addProductToCart, newLineKey, priceCart } from '@/domain/cart';
import { computeCredit, planCashTender, type CashTenderPlan } from '@/domain/checkout';
import { parseLbpInput, parseUsdInput, usdCentsToLbp } from '@/domain/money';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { mergeKnown } from '@/domain/catalogSession';
import { useCashbox, useCategories, useSettings } from '@/hooks/useTenantData';
import { useI18n } from '@/i18n/i18n';
import { takeReopenRequest, useOfflineQueue } from '@/offline/queue';
import type { OfflineOperation } from '@/offline/types';
import { getCustomer, getProductsByIds } from '@/services/catalogQuery';
import { checkout, type CheckoutResult } from '@/services/salesService';
import type { Currency, Customer, PriceTier, Product } from '@/types/models';
import { formatLbp, formatUsd } from '@/utils/format';
import { printOfflineReceipt, printSaleReceipt } from '@/features/sales/receipt';
import { CartPanel } from './CartPanel';
import { FitAmount } from './FitAmount';
import { CustomerSelect } from './CustomerSelect';
import { PaymentPanel, type PaymentDraft } from './PaymentPanel';
import { ProductPicker } from './ProductPicker';
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
  const { cart, update } = pos;
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
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const skipRenameSave = useRef(false);
  const [imeiProduct, setImeiProduct] = useState<Product | null>(null);
  const [completed, setCompleted] = useState<CheckoutResult | null>(null);
  const [mobileTab, setMobileTab] = useState<'products' | 'cart' | 'checkout'>('products');
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
      dueUsdCents: totals.dueUsdCents,
      dueLbp: totals.dueLbp,
      rate,
      receivedUsdCents,
      receivedLbp,
      manual: draft.changeManual,
      manualUsdCents: manualUsdCents ?? 0,
      manualLbp: manualLbp ?? 0,
      drawerUsdCents: drawerKnown ? cashbox.data.usdCents : Number.MAX_SAFE_INTEGER,
      drawerLbp: drawerKnown ? cashbox.data.lbp : Number.MAX_SAFE_INTEGER,
    });
  }, [draft, totals.dueUsdCents, totals.dueLbp, rate, cashbox.status, cashbox.data.usdCents, cashbox.data.lbp]);

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
            includePreviousDebt: cart.debtLineUsdCents !== null,
          })
        : null,
    [customer, totals.productsUsdCents, creditPaidUsd, creditPaidLbp, rate, cart.debtLineUsdCents],
  );

  const pick = useCallback(
    (product: Product) => {
      setKnownProducts((known) => mergeKnown(known, [product]));
      if (product.imeiTracking) {
        setImeiProduct(product);
        return;
      }
      update((c) => addProductToCart(c, product));
    },
    [update],
  );

  const setCustomer = (next: Customer | null) => {
    setKnownCustomer(next);
    update((c) => ({ ...c, customerId: next?.id ?? null, debtLineUsdCents: null }));
  };

  const toggleDebtLine = (on: boolean) => {
    update((c) => ({ ...c, debtLineUsdCents: on && customer && customer.debtUsdCents > 0 ? customer.debtUsdCents : null }));
  };

  const complete = () =>
    run(async () => {
      if (cart.lines.length === 0) {
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
      setCompleted(result);
      setMobileTab('products');
      if (result.mode === 'online' && result.duplicate) notify('info', t('pos.duplicateSale'));
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

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === 'F2') {
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    } else if (e.key === 'F9') {
      e.preventDefault();
      if (!completed && !imeiProduct && !document.querySelector('[role="dialog"]')) void complete();
    }
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const hasItems = cart.lines.length > 0;
  const workInProgress = busy || pos.carts.some((c) => c.lines.length > 0);
  useEffect(() => {
    setWorkInProgress('pos', workInProgress);
    return () => setWorkInProgress('pos', false);
  }, [workInProgress]);

  return (
    <div className={`pos pos--${mobileTab}`}>
      <div className="pos__tabs-mobile segmented">
        <button type="button" className={mobileTab === 'products' ? 'segmented__item segmented__item--active' : 'segmented__item'} onClick={() => setMobileTab('products')}>
          {t('nav.products')}
        </button>
        <button type="button" className={mobileTab === 'cart' ? 'segmented__item segmented__item--active' : 'segmented__item'} onClick={() => setMobileTab('cart')}>
          {t('pos.cart')} ({totals.itemCount})
        </button>
        <button type="button" className={mobileTab === 'checkout' ? 'segmented__item segmented__item--active' : 'segmented__item'} onClick={() => setMobileTab('checkout')}>
          {t('pos.checkout')}
        </button>
      </div>

      <section className="pos__products">
        <ProductPicker
          tenantId={tenantId}
          categories={categories}
          tier={cart.tier}
          rate={rate}
          lowStockThreshold={settings.lowStockThreshold}
          searchRef={searchRef}
          onPick={pick}
        />
      </section>

      <section className="pos__cart">
        <header className="cart-head">
          <h2>{t('pos.cartItems', { count: totals.itemCount })}</h2>
          <Button
            variant="ghost"
            size="sm"
            icon="trash"
            disabled={!hasItems}
            onClick={async () => {
              if (await confirm({ title: t('pos.clearCart'), danger: true })) {
                update((c) => ({ ...c, lines: [], debtLineUsdCents: null, draft: { ...c.draft, receivedUsd: '', receivedLbp: '', changeUsd: '', changeLbp: '', changeManual: null } }));
              }
            }}
          >
            {t('pos.clearCart')}
          </Button>
        </header>
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
        </div>

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
              { value: 'USD', label: 'USD $' },
              { value: 'LBP', label: lang === 'ar' ? 'ليرة ل.ل' : 'LBP' },
            ]}
          />
          <CustomerSelect tenantId={tenantId} selected={customer} onSelect={setCustomer} />
          {customer && customer.debtUsdCents > 0 && (
          <Checkbox
            label={t('pos.addPreviousBalance', { amount: formatUsd(customer.debtUsdCents) })}
            checked={cart.debtLineUsdCents !== null}
            onChange={(e) => toggleDebtLine(e.target.checked)}
          />
          )}
        </div>

        {customer && <p className="cart-customer">{customer.name}</p>}

        <div className="pos__lines">
          <CartPanel cart={cart} totals={totals} products={productMap} canEditPrice={can('canEditPrice')} onChange={update} />
        </div>

        {!online && <Alert tone="warning">{t('offline.posBanner')}</Alert>}

        <footer className="cart-foot">
          <div className="cart-foot__row">
            <span>{t('pos.subtotal')}</span>
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
          <div className="cart-foot__total">
            <span>{t('pos.total')}</span>
            <span className="cart-foot__money">
              <FitAmount value={formatUsd(totals.dueUsdCents)} />
              <FitAmount value={formatLbp(totals.dueLbp, lang)} className="fit-amount--sub" />
            </span>
          </div>
          <div className="cart-foot__actions">
            <Button variant="secondary" icon="clipboard" disabled={!hasItems || pos.carts.length >= MAX_CARTS} onClick={() => pos.addCart()}>
              {t('pos.saveCart')}
            </Button>
            <Button
              disabled={!hasItems}
              onClick={() => {
                setMobileTab('checkout');
                requestAnimationFrame(() => document.getElementById(draft.kind === 'cash' ? 'received-usd' : 'complete-sale')?.focus());
              }}
            >
              {t('pos.checkout')}
            </Button>
          </div>
        </footer>
      </section>

      <section className="pos__checkout">
        <PaymentPanel
          draft={draft}
          onDraft={setDraft}
          note={cart.note}
          onNote={(note) => update((c) => ({ ...c, note: note.slice(0, 200) }))}
          totals={totals}
          customer={customer}
          cash={cash}
          credit={credit}
          busy={busy}
          disabled={!hasItems}
          onComplete={() => void complete()}
        />
      </section>

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
        <Modal
          open
          size="sm"
          title={t(completed.mode === 'online' ? 'pos.saleCompleted' : 'offline.savedTitle')}
          onClose={() => {
            setCompleted(null);
            searchRef.current?.focus();
          }}
          footer={
            <>
              <Button
                variant="secondary"
                icon="printer"
                onClick={() =>
                  completed.mode === 'online'
                    ? printSaleReceipt(completed.sale, { settings, lang, t })
                    : printOfflineReceipt(completed.operation, { settings, lang, t })
                }
              >
                {t(completed.mode === 'online' ? 'common.print' : 'offline.printProof')}
              </Button>
              <Button
                autoFocus
                onClick={() => {
                  setCompleted(null);
                  searchRef.current?.focus();
                }}
              >
                {t('pos.newSale')}
              </Button>
            </>
          }
        >
          {completed.mode === 'online' ? (
            <div className="sale-done">
              <Icon name="check" size={40} className="text-success" />
              <div className="sale-done__number">{completed.sale.invoiceNumber}</div>
              <div className="sale-done__total">{formatUsd(completed.sale.totalUsdCents)}</div>
            </div>
          ) : (
            <OfflineSaleDone operation={completed.operation} cause={completed.cause} />
          )}
        </Modal>
      )}
    </div>
  );
}

function OfflineSaleDone({ operation, cause }: { operation: OfflineOperation; cause: 'offline' | 'network' }) {
  const { t, lang } = useI18n();
  const s = operation.snapshot;
  const cashTaken = s.received.usdCents > 0 || s.received.lbp > 0;
  const received = [s.received.usdCents > 0 && formatUsd(s.received.usdCents), s.received.lbp > 0 && formatLbp(s.received.lbp, lang)]
    .filter(Boolean)
    .join(' + ');
  return (
    <div className="sale-done">
      <Icon name="wifiOff" size={40} className="text-warning" />
      <Badge tone="warning">{t('offline.status.PENDING_SYNC')}</Badge>
      <div className="sale-done__number">{operation.offlineRef}</div>
      <div className="sale-done__total">{s.currency === 'LBP' ? formatLbp(s.totalLbp, lang) : formatUsd(s.totalUsdCents)}</div>
      <Alert tone="warning">{t(cause === 'network' ? 'offline.savedAfterNetworkError' : 'offline.savedNotInvoice')}</Alert>
      {cashTaken && <Alert tone="error">{t('offline.cashWarning', { amount: received })}</Alert>}
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
