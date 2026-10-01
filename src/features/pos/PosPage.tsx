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
import { computeCashPayment, computeCredit } from '@/domain/checkout';
import { parseLbpInput, parseUsdInput } from '@/domain/money';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useCategories, useCustomerMap, useCustomers, useProductMap, useProducts, useSettings } from '@/hooks/useTenantData';
import { useI18n } from '@/i18n/i18n';
import { takeReopenRequest, useOfflineQueue } from '@/offline/queue';
import type { OfflineOperation } from '@/offline/types';
import { checkout, type CheckoutResult } from '@/services/salesService';
import type { Currency, PriceTier, Product } from '@/types/models';
import { formatLbp, formatUsd } from '@/utils/format';
import { printOfflineReceipt, printSaleReceipt } from '@/features/sales/receipt';
import { CartPanel } from './CartPanel';
import { PaymentPanel, type PaymentDraft } from './PaymentPanel';
import { ProductPicker } from './ProductPicker';
import { MAX_CARTS, usePosCarts } from './usePosCarts';

const EMPTY_DRAFT: PaymentDraft = { kind: 'cash', payCurrency: 'USD', amount: '', creditUsd: '', creditLbp: '' };

export default function PosPage() {
  const { t, lang } = useI18n();
  const { tenantId, actor, can } = useTenant();
  const { notify, confirm } = useFeedback();
  const online = useOnlineStatus();
  const settings = useSettings();
  const rate = settings.exchangeRate;
  const productsState = useProducts();
  const sellable = useMemo(() => productsState.data.filter((p) => p.status === 'active'), [productsState.data]);
  const productMap = useProductMap();
  const customers = useCustomers().data;
  const customerMap = useCustomerMap();
  const categories = useCategories();
  const pos = usePosCarts(tenantId, actor.uid, settings.defaultCurrency);
  const { cart, update } = pos;
  const [draft, setDraft] = useState<PaymentDraft>({ ...EMPTY_DRAFT, payCurrency: cart.currency });
  const [imeiProduct, setImeiProduct] = useState<Product | null>(null);
  const [completed, setCompleted] = useState<CheckoutResult | null>(null);
  const [mobileTab, setMobileTab] = useState<'products' | 'cart'>('products');
  const searchRef = useRef<HTMLInputElement>(null);
  const { busy, run } = useAsyncAction('checkout');

  const totals = useMemo(() => priceCart(cart, productMap, rate), [cart, productMap, rate]);
  const customer = cart.customerId ? customerMap.get(cart.customerId) ?? null : null;

  const cashAmount =
    draft.amount.trim() === ''
      ? draft.payCurrency === 'USD'
        ? cart.currency === 'USD'
          ? totals.dueUsdCents
          : null
        : cart.currency === 'LBP'
          ? totals.dueLbp
          : null
      : draft.payCurrency === 'USD'
        ? parseUsdInput(draft.amount)
        : parseLbpInput(draft.amount);

  const cash = useMemo(() => {
    if (cashAmount === null && draft.amount.trim() !== '') return { ok: false as const, error: 'invalidAmount' as const, remainderLbp: 0 };
    const fallback = draft.payCurrency === 'USD' ? (cart.currency === 'USD' ? totals.dueUsdCents : 0) : totals.dueLbp;
    return computeCashPayment(totals, cart.currency, rate, { payCurrency: draft.payCurrency, amount: cashAmount ?? fallback });
  }, [cashAmount, draft.amount, draft.payCurrency, cart.currency, totals, rate]);

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
      if (product.imeiTracking) {
        setImeiProduct(product);
        return;
      }
      update((c) => addProductToCart(c, product));
    },
    [update],
  );

  const setCustomer = (id: string) => update((c) => ({ ...c, customerId: id || null, debtLineUsdCents: null }));
  const toggleDebtLine = (on: boolean) =>
    update((c) => ({ ...c, debtLineUsdCents: on && customer && customer.debtUsdCents > 0 ? customer.debtUsdCents : null }));

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
          cash: draft.kind === 'cash' && cash.ok ? { receivedUsdCents: cash.receivedUsdCents, receivedLbp: cash.receivedLbp } : undefined,
          credit: draft.kind === 'credit' ? { paidUsdCents: creditPaidUsd ?? 0, paidLbp: creditPaidLbp ?? 0 } : undefined,
        },
        { tenantId, uid: actor.uid, cashierName: actor.name, customerName: customer?.name ?? '' },
      );
      // The cart is cleared only once the sale is either recorded by the server or committed to IndexedDB.
      pos.resetActive();
      setDraft({ ...EMPTY_DRAFT, payCurrency: cart.currency });
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
      if (!completed && !imeiProduct) void complete();
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
      </div>

      <section className="pos__products">
        <ProductPicker
          products={sellable}
          loading={productsState.status === 'loading'}
          categories={categories}
          tier={cart.tier}
          currency={cart.currency}
          rate={rate}
          lowStockThreshold={settings.lowStockThreshold}
          searchRef={searchRef}
          onPick={pick}
        />
      </section>

      <section className="pos__cart">
        <div className="cart-tabs" role="tablist">
          {pos.carts.map((c, i) => (
            <div key={c.id} className={i === pos.active ? 'cart-tab cart-tab--active' : 'cart-tab'}>
              <button type="button" role="tab" aria-selected={i === pos.active} onClick={() => pos.setActive(i)}>
                #{c.id}
                {c.lines.length > 0 && <span className="cart-tab__count">{c.lines.length}</span>}
              </button>
              {pos.carts.length > 1 && (
                <button type="button" className="cart-tab__close" onClick={() => pos.removeCart(i)} aria-label={t('common.remove')}>
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
          ))}
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
              setDraft((d) => ({ ...d, payCurrency: currency, amount: '' }));
            }}
            options={[
              { value: 'USD', label: 'USD $' },
              { value: 'LBP', label: lang === 'ar' ? 'ليرة ل.ل' : 'LBP' },
            ]}
          />
          <SelectInput
            label={t('pos.customer')}
            value={cart.customerId ?? ''}
            onChange={(e) => setCustomer(e.target.value)}
            options={[
              { value: '', label: t('pos.walkIn') },
              ...customers.map((c) => ({ value: c.id, label: c.debtUsdCents > 0 ? `${c.name} (${formatUsd(c.debtUsdCents)})` : c.name })),
            ]}
          />
        </div>
        {customer && customer.debtUsdCents > 0 && (
          <Checkbox
            label={t('pos.addPreviousBalance', { amount: formatUsd(customer.debtUsdCents) })}
            checked={cart.debtLineUsdCents !== null}
            onChange={(e) => toggleDebtLine(e.target.checked)}
          />
        )}

        <div className="pos__lines">
          <CartPanel cart={cart} totals={totals} products={productMap} canEditPrice={can('canEditPrice')} onChange={update} />
        </div>

        {!online && <Alert tone="warning">{t('offline.posBanner')}</Alert>}

        <PaymentPanel
          draft={draft}
          onDraft={(patch) => setDraft((d) => ({ ...d, ...patch }))}
          currency={cart.currency}
          totals={totals}
          customer={customer}
          cash={cash}
          credit={credit}
          busy={busy}
          disabled={!hasItems}
          onComplete={() => void complete()}
        />
        {hasItems && (
          <Button
            variant="ghost"
            size="sm"
            icon="trash"
            onClick={async () => {
              if (await confirm({ title: t('pos.clearCart'), danger: true })) update((c) => ({ ...c, lines: [], debtLineUsdCents: null }));
            }}
          >
            {t('pos.clearCart')}
          </Button>
        )}
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
