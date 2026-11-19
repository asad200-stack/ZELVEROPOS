// Public storefront (Milestone B): /s/:slug. Guests browse the published catalog and place a
// cash-on-delivery / pay-at-pickup order. The server decides prices, availability and stock;
// the cart here only holds product ids and quantities.
import { useMemo, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router';
import { Button } from '@/components/ui/Button';
import { FormGrid, SelectInput, TextArea, TextInput } from '@/components/ui/Form';
import { Alert, EmptyState } from '@/components/ui/Layout';
import { PageLoader } from '@/components/ui/Spinner';
import {
  ORDER_ADDRESS_MAX,
  ORDER_MAX_QTY,
  ORDER_NAME_MAX,
  ORDER_NOTE_MAX,
  orderProblem,
  type FulfillmentMethod,
  type PublicOrderReceipt,
} from '@/domain/onlineOrders';
import { isRtl, type PublicProduct, type StoreLocale } from '@/domain/onlineStore';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useAsyncData } from '@/hooks/useAsyncData';
import { translate, type TranslationKey, type TParams } from '@/i18n/i18n';
import { toUserMessage, type UserMessage } from '@/services/errors';
import { api } from '@/services/functionsClient';
import { formatLbp, formatUsd } from '@/utils/format';

type Cart = Record<string, number>;

function priceLabel(p: Pick<PublicProduct, 'priceUsdCents' | 'priceLbp'>, lang: StoreLocale): string {
  if (p.priceUsdCents > 0) return formatUsd(p.priceUsdCents);
  return p.priceLbp ? formatLbp(p.priceLbp, lang) : '—';
}

export default function PublicStorePage() {
  const { slug = '' } = useParams();
  const data = useAsyncData(`public-store-${slug}`, () => api.publicStoreCatalog({ slug }));
  const [chosenLang, setChosenLang] = useState<StoreLocale | null>(null);
  const [cart, setCart] = useState<Cart>({});
  const [checkout, setCheckout] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [fulfillment, setFulfillment] = useState<FulfillmentMethod>('delivery');
  const [showProblem, setShowProblem] = useState(false);
  const [receipt, setReceipt] = useState<PublicOrderReceipt | null>(null);
  const [serverError, setServerError] = useState<UserMessage | null>(null);
  const place = useAsyncAction('storefront');

  const store = data.data?.store;
  const products = useMemo(() => data.data?.products ?? [], [data.data]);
  const lang: StoreLocale = chosenLang ?? store?.defaultLocale ?? 'ar';
  const t = (key: TranslationKey, params?: TParams) => translate(lang, key, params);

  const lines = useMemo(
    () => Object.entries(cart).filter(([, q]) => q > 0).map(([productId, qty]) => ({ productId, qty })),
    [cart],
  );
  const cartItems = lines
    .map((l) => ({ ...l, product: products.find((p) => p.id === l.productId) }))
    .filter((x): x is typeof x & { product: PublicProduct } => !!x.product);
  const estUsd = cartItems.reduce((s, x) => s + x.product.priceUsdCents * x.qty, 0);
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);
  const problem = orderProblem(lines, { name, phone, address }, fulfillment);

  if (data.loading) return <PageLoader />;
  if (data.error || !store) {
    return (
      <main className="storefront-shell" style={{ padding: 24 }}>
        <EmptyState title={translate('ar', 'storefront.notFound')} message={translate('en', 'storefront.notFound')} />
      </main>
    );
  }

  const font = store.font === 'system' ? undefined : store.font.charAt(0).toUpperCase() + store.font.slice(1);
  const shell: CSSProperties = { fontFamily: font, minHeight: '100vh', background: 'var(--bg, #f7f7f8)' };
  const addQty = (id: string, delta: number) =>
    setCart((c) => ({ ...c, [id]: Math.max(0, Math.min(ORDER_MAX_QTY, (c[id] ?? 0) + delta)) }));

  async function submit() {
    if (problem) {
      setShowProblem(true);
      return;
    }
    setServerError(null);
    const res = await place.run(async () => {
      try {
        return await api.publicPlaceOrder({ slug, lines, name, phone, address, note, fulfillment, payment: 'cod' });
      } catch (e) {
        // Show the reason inside the checkout card; guests may not see a toast.
        setServerError(toUserMessage(e));
        return undefined;
      }
    });
    if (res) {
      setReceipt(res);
      setCart({});
      setCheckout(false);
    }
  }

  const header = (
    <header style={{ background: store.primaryColor, color: '#fff', padding: '20px 16px', borderBottom: `6px solid ${store.accentColor}` }}>
      <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>{store.storeName}</h1>
          {store.tagline && <p style={{ margin: '4px 0 0', opacity: 0.9 }}>{store.tagline}</p>}
        </div>
        {store.enabledLocales.length > 1 &&
          store.enabledLocales.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={l === lang}
              onClick={() => setChosenLang(l)}
              style={{ background: l === lang ? '#fff' : 'transparent', color: l === lang ? store.primaryColor : '#fff', border: '1px solid #fff', borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}
            >
              {l === 'ar' ? 'عربي' : 'English'}
            </button>
          ))}
      </div>
    </header>
  );

  if (receipt) {
    return (
      <div dir={isRtl(lang) ? 'rtl' : 'ltr'} style={shell}>
        {header}
        <main style={{ maxWidth: 560, margin: '24px auto', padding: '0 16px' }}>
          <div className="card" style={{ padding: 20 }}>
            <h2 style={{ marginTop: 0 }}>{t('storefront.thanks')}</h2>
            <p>{t('storefront.yourRef')}</p>
            <p style={{ fontSize: 28, fontWeight: 700, margin: '4px 0 16px', color: store.primaryColor }}>{receipt.ref}</p>
            <ul style={{ paddingInlineStart: 18 }}>
              {receipt.lines.map((l, i) => (
                <li key={i}>
                  {l.qty} × {l.name} — {l.lineUsdCents > 0 ? formatUsd(l.lineUsdCents) : formatLbp(l.lineLbp, lang)}
                </li>
              ))}
            </ul>
            <p>
              <strong>{t('storefront.total')}: </strong>
              {receipt.totalUsdCents > 0 ? formatUsd(receipt.totalUsdCents) : formatLbp(receipt.totalLbp, lang)}
            </p>
            <p className="muted">{t(receipt.fulfillment === 'delivery' ? 'storefront.codDelivery' : 'storefront.codPickup')}</p>
            {(store.whatsapp || store.contactPhone) && <p className="muted">{t('storefront.contact', { phone: store.whatsapp || store.contactPhone })}</p>}
            <Button onClick={() => setReceipt(null)}>{t('storefront.backToShop')}</Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div dir={isRtl(lang) ? 'rtl' : 'ltr'} style={shell}>
      {header}
      <main style={{ maxWidth: 960, margin: '0 auto', padding: '16px 16px 96px' }}>
        {!checkout && (
          <>
            {products.length === 0 ? (
              <EmptyState title={t('storefront.noProducts')} />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                {products.map((p) => {
                  const qty = cart[p.id] ?? 0;
                  return (
                    <div key={p.id} className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 8 }} />
                      ) : (
                        <div aria-hidden style={{ width: '100%', aspectRatio: '1', borderRadius: 8, background: store.accentColor, opacity: 0.15 }} />
                      )}
                      <strong>{p.name}</strong>
                      <span>{priceLabel(p, lang)}</span>
                      {!p.inStock ? (
                        <span className="muted">{t('storefront.outOfStock')}</span>
                      ) : qty === 0 ? (
                        <Button onClick={() => addQty(p.id, 1)}>{t('storefront.add')}</Button>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                          <Button variant="secondary" aria-label={t('storefront.less', { name: p.name })} onClick={() => addQty(p.id, -1)}>−</Button>
                          <span aria-live="polite">{qty}</span>
                          <Button variant="secondary" aria-label={t('storefront.more', { name: p.name })} onClick={() => addQty(p.id, 1)} disabled={qty >= ORDER_MAX_QTY}>+</Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {checkout && (
          <div className="card" style={{ padding: 16, maxWidth: 560, margin: '0 auto' }}>
            <h2 style={{ marginTop: 0 }}>{t('storefront.checkout')}</h2>
            <ul style={{ paddingInlineStart: 18 }}>
              {cartItems.map((x) => (
                <li key={x.productId}>
                  {x.qty} × {x.product.name} — {priceLabel({ priceUsdCents: x.product.priceUsdCents * x.qty, priceLbp: x.product.priceLbp === null ? null : x.product.priceLbp * x.qty }, lang)}
                </li>
              ))}
            </ul>
            <FormGrid>
              <TextInput label={t('storefront.name')} value={name} maxLength={ORDER_NAME_MAX} autoComplete="name" onChange={(e) => setName(e.target.value)} />
              <TextInput label={t('storefront.phone')} value={phone} inputMode="tel" autoComplete="tel" dir="ltr" onChange={(e) => setPhone(e.target.value)} />
              <SelectInput
                label={t('storefront.fulfillment')}
                value={fulfillment}
                options={[
                  { value: 'delivery', label: t('storefront.delivery') },
                  { value: 'pickup', label: t('storefront.pickup') },
                ]}
                onChange={(e) => setFulfillment(e.target.value === 'pickup' ? 'pickup' : 'delivery')}
              />
              <TextArea label={t(fulfillment === 'delivery' ? 'storefront.address' : 'storefront.addressOptional')} value={address} maxLength={ORDER_ADDRESS_MAX} rows={2} autoComplete="street-address" onChange={(e) => setAddress(e.target.value)} />
              <TextArea label={t('storefront.note')} value={note} maxLength={ORDER_NOTE_MAX} rows={2} onChange={(e) => setNote(e.target.value)} />
            </FormGrid>
            <p className="muted">{t(fulfillment === 'delivery' ? 'storefront.codDelivery' : 'storefront.codPickup')}</p>
            {showProblem && problem && <Alert tone="warning">{t(`error.onlineOrders.${problem}`)}</Alert>}
            {serverError && <Alert tone="error">{t(serverError.key, serverError.params)}</Alert>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <Button variant="secondary" onClick={() => setCheckout(false)}>{t('storefront.backToShop')}</Button>
              <Button onClick={() => void submit()} disabled={place.busy || lines.length === 0}>
                {place.busy ? t('storefront.placing') : t('storefront.placeOrder')}
              </Button>
            </div>
          </div>
        )}
      </main>

      {!checkout && itemCount > 0 && (
        <div style={{ position: 'fixed', insetInline: 0, bottom: 0, background: '#fff', color: '#111', borderTop: '1px solid #ddd', padding: 12 }}>
          <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ flex: 1 }}>
              {t('storefront.cartSummary', { count: itemCount })}
              {estUsd > 0 && ` · ${formatUsd(estUsd)}`}
            </span>
            <Button onClick={() => setCheckout(true)} style={{ background: store.primaryColor }}>{t('storefront.checkout')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
