import { useEffect, useMemo, useState, type CSSProperties, type PointerEvent } from 'react';
import { useParams } from 'react-router';
import { EmptyState } from '@/components/ui/Layout';
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
import { fitKind, withSizes } from './sizeAdvisor';
import StorefrontQuickView, { HeartIcon } from './StorefrontQuickView';
import './storefront.css';

type Cart = Record<string, number>;
type SfVars = CSSProperties & Record<`--${string}`, string>;
type Step = 'cart' | 'details';

const RING_MAX = 8;
const RELATED_MAX = 4;

function readWish(slug: string): string[] {
  try {
    const raw = window.localStorage.getItem(`sf-wish-${slug}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function priceLabel(p: PublicProduct, lang: StoreLocale): string {
  if (p.priceUsdCents > 0) return formatUsd(p.priceUsdCents);
  return p.priceLbp ? formatLbp(p.priceLbp, lang) : '—';
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '•';
}

function ProductVisual({ product }: { product: PublicProduct }) {
  if (product.imageUrl) {
    return <img src={product.imageUrl} alt="" loading="lazy" decoding="async" />;
  }
  return (
    <div className="sf-ph" aria-hidden="true">
      {initial(product.name)}
    </div>
  );
}

function tilt(e: PointerEvent<HTMLElement>) {
  if (e.pointerType !== 'mouse') return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  el.style.setProperty('--ry', `${(x - 0.5) * 10}deg`);
  el.style.setProperty('--rx', `${(0.5 - y) * 10}deg`);
  el.style.setProperty('--gx', `${x * 100}%`);
  el.style.setProperty('--gy', `${y * 100}%`);
}

function untilt(e: PointerEvent<HTMLElement>) {
  const el = e.currentTarget;
  el.style.setProperty('--rx', '0deg');
  el.style.setProperty('--ry', '0deg');
}

const IconSearch = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);
const IconBag = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 4h2.2l2.3 11h10.7l2-8H6.4" />
    <circle cx="9.5" cy="19.5" r="1.4" />
    <circle cx="17" cy="19.5" r="1.4" />
  </svg>
);
const IconArrow = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
const IconCash = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
);
const IconStore = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 10v10h16V10M3 10l2-6h14l2 6H3Z" />
    <path d="M10 20v-5h4v5" />
  </svg>
);
const IconBolt = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z" />
  </svg>
);
const IconWhatsApp = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" />
  </svg>
);
const IconClose = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export default function PublicStorePage() {
  const { slug = '' } = useParams();
  const data = useAsyncData(`public-store-${slug}`, () => api.publicStoreCatalog({ slug }));
  const [chosenLang, setChosenLang] = useState<StoreLocale | null>(null);
  const [cart, setCart] = useState<Cart>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [step, setStep] = useState<Step>('cart');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [fulfillment, setFulfillment] = useState<FulfillmentMethod>('delivery');
  const [showProblem, setShowProblem] = useState(false);
  const [receipt, setReceipt] = useState<PublicOrderReceipt | null>(null);
  const [serverError, setServerError] = useState<UserMessage | null>(null);
  const [quick, setQuick] = useState<string | null>(null);
  const [sizes, setSizes] = useState<Record<string, string>>({});
  const [wish, setWish] = useState<string[]>(() => readWish(slug));
  const [wishOnly, setWishOnly] = useState(false);
  const place = useAsyncAction('storefront');

  useEffect(() => {
    try {
      window.localStorage.setItem(`sf-wish-${slug}`, JSON.stringify(wish));
    } catch {
      // Private mode or blocked storage: favorites just won't persist.
    }
  }, [slug, wish]);

  const store = data.data?.store;
  const products = useMemo(() => data.data?.products ?? [], [data.data]);
  const lang: StoreLocale = chosenLang ?? store?.defaultLocale ?? 'ar';
  const t = (key: TranslationKey, params?: TParams) => translate(lang, key, params);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) {
      const c = p.category.trim();
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()].map(([label, count]) => ({ label, count }));
  }, [products]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter(
      (p) =>
        (category === 'all' || p.category.trim() === category) &&
        (!wishOnly || wish.includes(p.id)) &&
        (!q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)),
    );
  }, [products, query, category, wishOnly, wish]);

  const ring = useMemo(() => {
    const withImage = products.filter((p) => p.imageUrl);
    const rest = products.filter((p) => !p.imageUrl);
    return [...withImage, ...rest].slice(0, RING_MAX);
  }, [products]);

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

  const overlay = cartOpen || quick !== null;
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // A nested layer (the try-on view) already handled it.
      if (e.defaultPrevented) return;
      // Close the top-most layer first.
      if (quick !== null) setQuick(null);
      else setCartOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [overlay, quick]);

  if (data.loading) {
    return (
      <div className="sf sf-loading" aria-busy="true">
        <span className="sf-sr" role="status">
          {translate('ar', 'storefront.loading')} / {translate('en', 'storefront.loading')}
        </span>
        <div className="sf-top">
          <div className="sf-wrap sf-top-row">
            <span className="sf-skel" style={{ width: 160, height: 36 }} />
            <span className="sf-skel" style={{ flex: 1, height: 40, maxWidth: 520 }} />
            <span className="sf-skel" style={{ width: 96, height: 40 }} />
          </div>
        </div>
        <div className="sf-wrap">
          <span className="sf-skel" style={{ display: 'block', width: '55%', height: 44, margin: '48px 0 16px' }} />
          <span className="sf-skel" style={{ display: 'block', width: '35%', height: 20, marginBottom: 40 }} />
          <div className="sf-grid">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="sf-skel-card">
                <span className="sf-skel" style={{ display: 'block', aspectRatio: '1 / 1' }} />
                <span className="sf-skel" style={{ display: 'block', width: '70%', height: 16, margin: '14px 14px 8px' }} />
                <span className="sf-skel" style={{ display: 'block', width: '40%', height: 16, margin: '0 14px 14px' }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (data.error || !store) {
    return (
      <main className="storefront-shell" style={{ padding: 24 }}>
        <EmptyState title={translate('ar', 'storefront.notFound')} message={translate('en', 'storefront.notFound')} />
      </main>
    );
  }

  const font = store.font === 'system' ? undefined : store.font.charAt(0).toUpperCase() + store.font.slice(1);
  const rootStyle: SfVars = {
    '--sf-primary': store.primaryColor,
    '--sf-accent': store.accentColor,
    fontFamily: font,
  };
  const addQty = (id: string, delta: number) =>
    setCart((c) => ({ ...c, [id]: Math.max(0, Math.min(ORDER_MAX_QTY, (c[id] ?? 0) + delta)) }));
  const openCart = () => {
    setStep('cart');
    setCartOpen(true);
  };
  const toCatalog = () => document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' });
  const clearFilters = () => {
    setQuery('');
    setCategory('all');
    setWishOnly(false);
  };
  const contact = store.whatsapp || store.contactPhone;
  const waDigits = store.whatsapp.replace(/\D/g, '');
  const subtotal = estUsd > 0 ? formatUsd(estUsd) : '—';
  const toggleWish = (id: string) => setWish((w) => (w.includes(id) ? w.filter((x) => x !== id) : [...w, id]));
  const quickProduct = quick ? products.find((p) => p.id === quick) : undefined;
  const related = quickProduct
    ? [
        ...products.filter((p) => p.id !== quickProduct.id && p.category.trim() && p.category.trim() === quickProduct.category.trim()),
        ...products.filter((p) => p.id !== quickProduct.id && p.category.trim() !== quickProduct.category.trim()),
      ].slice(0, RELATED_MAX)
    : [];
  const sizedNote = withSizes(
    note,
    cartItems.filter((x) => sizes[x.product.id]).map((x) => ({ name: x.product.name, size: sizes[x.product.id] ?? '' })),
    ORDER_NOTE_MAX,
  );

  async function submit() {
    if (problem) {
      setShowProblem(true);
      return;
    }
    setServerError(null);
    const res = await place.run(async () => {
      try {
        return await api.publicPlaceOrder({ slug, lines, name, phone, address, note: sizedNote, fulfillment, payment: 'cod' });
      } catch (e) {
        // Show the reason inside the drawer; guests may not see a toast.
        setServerError(toUserMessage(e));
        return undefined;
      }
    });
    if (res) {
      setReceipt(res);
      setCart({});
      setSizes({});
      setCartOpen(false);
      setStep('cart');
      window.scrollTo({ top: 0 });
    }
  }

  const stepper = (p: PublicProduct, qty: number) => (
    <div className="sf-step">
      <button type="button" aria-label={t('storefront.less', { name: p.name })} onClick={() => addQty(p.id, -1)}>
        −
      </button>
      <output aria-live="polite">{qty}</output>
      <button
        type="button"
        aria-label={t('storefront.more', { name: p.name })}
        onClick={() => addQty(p.id, 1)}
        disabled={qty >= ORDER_MAX_QTY}
      >
        +
      </button>
    </div>
  );

  const header = (
    <header className="sf-top">
      <div className="sf-wrap sf-top-row">
        <button
          type="button"
          className="sf-brand"
          onClick={() => {
            setReceipt(null);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        >
          <span className="sf-mark" aria-hidden="true">
            {initial(store.storeName)}
          </span>
          <span className="sf-brand-name">{store.storeName}</span>
        </button>
        {!receipt && (
          <label className="sf-search">
            <IconSearch />
            <span className="sf-sr">{t('storefront.searchLabel')}</span>
            <input
              type="search"
              value={query}
              placeholder={t('storefront.search')}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') toCatalog();
              }}
            />
          </label>
        )}
        <div className="sf-actions">
          {store.enabledLocales.length > 1 && (
            <div className="sf-langs">
              {store.enabledLocales.map((l) => (
                <button key={l} type="button" aria-pressed={l === lang} onClick={() => setChosenLang(l)}>
                  {l === 'ar' ? 'عربي' : 'English'}
                </button>
              ))}
            </div>
          )}
          {!receipt && (
            <button
              type="button"
              className="sf-wish-btn"
              aria-pressed={wishOnly}
              aria-label={`${t('storefront.wishlist')} (${wish.length})`}
              onClick={() => {
                setWishOnly((v) => !v);
                toCatalog();
              }}
            >
              <HeartIcon filled={wishOnly} />
              {wish.length > 0 && <span className="sf-badge">{wish.length}</span>}
            </button>
          )}
          <button
            type="button"
            className="sf-cart-btn"
            onClick={openCart}
            aria-label={t('storefront.openCart', { count: itemCount })}
          >
            <IconBag />
            <span className="sf-cart-label">{t('storefront.cart')}</span>
            {itemCount > 0 && <span className="sf-badge">{itemCount}</span>}
          </button>
        </div>
      </div>
    </header>
  );

  const footer = (
    <footer className="sf-foot">
      <div className="sf-wrap sf-foot-row">
        <span>
          © {new Date().getFullYear()} {store.storeName}
        </span>
        <div className="sf-foot-links">
          {contact && (
            <a href={`tel:${contact}`} dir="ltr">
              {contact}
            </a>
          )}
          <span>{t('storefront.poweredBy')}</span>
        </div>
      </div>
    </footer>
  );

  if (receipt) {
    return (
      <div className="sf" dir={isRtl(lang) ? 'rtl' : 'ltr'} lang={lang} style={rootStyle}>
        {header}
        <main className="sf-wrap">
          <section className="sf-receipt" aria-live="polite">
            <div className="sf-check" aria-hidden="true">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5 10 17l9-10" />
              </svg>
            </div>
            <h2>{t('storefront.thanks')}</h2>
            <p>{t('storefront.yourRef')}</p>
            <div className="sf-ref" dir="ltr">
              {receipt.ref}
            </div>
            <ul>
              {receipt.lines.map((l, i) => (
                <li key={i}>
                  <span>
                    {l.qty} × {l.name}
                  </span>
                  <span>{l.lineUsdCents > 0 ? formatUsd(l.lineUsdCents) : formatLbp(l.lineLbp, lang)}</span>
                </li>
              ))}
            </ul>
            <div className="sf-total">
              <span>{t('storefront.total')}</span>
              <strong>{receipt.totalUsdCents > 0 ? formatUsd(receipt.totalUsdCents) : formatLbp(receipt.totalLbp, lang)}</strong>
            </div>
            <p>{t(fulfillment === 'delivery' ? 'storefront.codDelivery' : 'storefront.codPickup')}</p>
            {contact && <p>{t('storefront.contact', { phone: contact })}</p>}
            <button type="button" className="sf-primary" onClick={() => setReceipt(null)}>
              {t('storefront.backToShop')}
            </button>
          </section>
        </main>
        {footer}
      </div>
    );
  }

  const activeTitle = wishOnly ? t('storefront.wishlist') : category === 'all' ? t('storefront.all') : category;

  return (
    <div className="sf" dir={isRtl(lang) ? 'rtl' : 'ltr'} lang={lang} style={rootStyle}>
      {header}

      <section className="sf-hero">
        <div className="sf-wrap sf-hero-grid">
          <div>
            <p className="sf-eyebrow">{t('storefront.featured')}</p>
            <h1>{store.storeName}</h1>
            <p className="sf-hero-sub">{store.tagline || t('storefront.heroFallback')}</p>
            <button type="button" className="sf-cta" onClick={toCatalog}>
              {t('storefront.shopNow')}
              <IconArrow />
            </button>
            <ul className="sf-perks">
              <li>
                <IconCash />
                {t('storefront.perkCod')}
              </li>
              <li>
                <IconStore />
                {t('storefront.perkPickup')}
              </li>
              <li>
                <IconBolt />
                {t('storefront.perkEasy')}
              </li>
            </ul>
          </div>
          {ring.length >= 3 && (
            <div className="sf-stage" aria-hidden="true">
              <div className="sf-tilt">
                <div className="sf-ring" style={{ '--n': String(ring.length) } as SfVars}>
                  {ring.map((p, i) => (
                    <div key={p.id} className="sf-ring-item" style={{ '--i': String(i) } as SfVars}>
                      {p.imageUrl ? <img src={p.imageUrl} alt="" decoding="async" /> : <div className="sf-ph">{initial(p.name)}</div>}
                      <div className="sf-ring-cap">
                        <b>{p.name}</b>
                        <span>{priceLabel(p, lang)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <section id="catalog" className="sf-wrap sf-catalog">
        {categories.length > 0 && (
          <aside className="sf-side">
            <h2>{t('storefront.categories')}</h2>
            <ul className="sf-cats">
              <li>
                <button type="button" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>
                  {t('storefront.all')}
                  <small>{products.length}</small>
                </button>
              </li>
              {categories.map((c) => (
                <li key={c.label}>
                  <button type="button" aria-pressed={category === c.label} onClick={() => setCategory(c.label)}>
                    {c.label}
                    <small>{c.count}</small>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}

        <div>
          <div className="sf-list-head">
            <h2>{activeTitle}</h2>
            <span>{t('storefront.productCount', { count: visible.length })}</span>
          </div>

          {products.length === 0 ? (
            <div className="sf-empty">{t('storefront.noProducts')}</div>
          ) : visible.length === 0 ? (
            <div className="sf-empty">
              <p>{wishOnly && wish.length === 0 ? t('storefront.wishEmpty') : t('storefront.noResults')}</p>
              <button type="button" className="sf-link" onClick={clearFilters}>
                {t('storefront.clearFilters')}
              </button>
            </div>
          ) : (
            <div className="sf-grid">
              {visible.map((p, k) => {
                const qty = cart[p.id] ?? 0;
                const wished = wish.includes(p.id);
                const needsPick = fitKind(p) !== null && !sizes[p.id];
                return (
                  <article
                    key={p.id}
                    className={p.inStock ? 'sf-card' : 'sf-card sf-soldout'}
                    style={{ '--k': String(k) } as SfVars}
                    onPointerMove={tilt}
                    onPointerLeave={untilt}
                  >
                    <div className="sf-media">
                      <button
                        type="button"
                        className="sf-open"
                        aria-label={t('storefront.openProduct', { name: p.name })}
                        onClick={() => setQuick(p.id)}
                      >
                        <ProductVisual product={p} />
                        <span className="sf-open-hint" aria-hidden="true">
                          {t('storefront.quickView')}
                        </span>
                      </button>
                      {p.category.trim() && <span className="sf-chip-cat">{p.category}</span>}
                      {!p.inStock && <span className="sf-chip-out">{t('storefront.outOfStock')}</span>}
                      <button
                        type="button"
                        className={wished ? 'sf-heart sf-heart-card is-on' : 'sf-heart sf-heart-card'}
                        aria-pressed={wished}
                        aria-label={t(wished ? 'storefront.wishRemove' : 'storefront.wishAdd', { name: p.name })}
                        onClick={() => toggleWish(p.id)}
                      >
                        <HeartIcon filled={wished} />
                      </button>
                    </div>
                    <div className="sf-body">
                      <h3 className="sf-name">{p.name}</h3>
                      <div className="sf-price">{priceLabel(p, lang)}</div>
                      <div className="sf-buy">
                        {!p.inStock ? null : qty === 0 ? (
                          <button
                            type="button"
                            className="sf-add"
                            onClick={() => (needsPick ? setQuick(p.id) : addQty(p.id, 1))}
                          >
                            <IconBag />
                            {needsPick ? t('storefront.chooseSize') : t('storefront.add')}
                          </button>
                        ) : (
                          stepper(p, qty)
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {footer}

      {itemCount > 0 && !overlay && (
        <button type="button" className="sf-float" onClick={openCart}>
          <span>{t('storefront.cartSummary', { count: itemCount })}</span>
          <b>{subtotal}</b>
        </button>
      )}

      {waDigits && !overlay && (
        <a
          className={itemCount > 0 ? 'sf-wa is-raised' : 'sf-wa'}
          href={`https://wa.me/${waDigits}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('storefront.whatsapp')}
          title={t('storefront.whatsapp')}
        >
          <IconWhatsApp />
        </a>
      )}

      {quickProduct && (
        <StorefrontQuickView
          key={quickProduct.id}
          product={quickProduct}
          related={related}
          t={t}
          priceOf={(x) => priceLabel(x, lang)}
          qty={cart[quickProduct.id] ?? 0}
          maxQty={ORDER_MAX_QTY}
          onAdd={() => addQty(quickProduct.id, 1)}
          onLess={() => addQty(quickProduct.id, -1)}
          size={sizes[quickProduct.id] ?? ''}
          onSize={(s) => setSizes((m) => ({ ...m, [quickProduct.id]: s }))}
          wished={wish.includes(quickProduct.id)}
          onWish={() => toggleWish(quickProduct.id)}
          onClose={() => setQuick(null)}
          onPick={(x) => setQuick(x.id)}
        />
      )}

      {cartOpen && (
        <>
          <div className="sf-scrim" onClick={() => setCartOpen(false)} />
          <aside className="sf-drawer" role="dialog" aria-modal="true" aria-labelledby="sf-drawer-title">
            <div className="sf-drawer-head">
              <h2 id="sf-drawer-title">{step === 'cart' ? t('storefront.cart') : t('storefront.yourDetails')}</h2>
              <button type="button" className="sf-x" aria-label={t('storefront.close')} onClick={() => setCartOpen(false)} autoFocus>
                <IconClose />
              </button>
            </div>

            {cartItems.length === 0 ? (
              <div className="sf-drawer-body">
                <div className="sf-drawer-empty">
                  <IconBag />
                  <p>{t('storefront.cartEmpty')}</p>
                  <button type="button" className="sf-link" onClick={() => setCartOpen(false)}>
                    {t('storefront.backToShop')}
                  </button>
                </div>
              </div>
            ) : step === 'cart' ? (
              <>
                <div className="sf-drawer-body">
                  <ul className="sf-lines">
                    {cartItems.map(({ product: p, qty }) => (
                      <li key={p.id} className="sf-line">
                        <div className="sf-thumb">
                          <ProductVisual product={p} />
                        </div>
                        <div>
                          <div className="sf-line-name">{p.name}</div>
                          {sizes[p.id] && <div className="sf-line-size">{t('storefront.sizeLabel', { size: sizes[p.id] ?? '' })}</div>}
                          <div className="sf-line-price">{priceLabel(p, lang)}</div>
                        </div>
                        {stepper(p, qty)}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="sf-drawer-foot">
                  <div className="sf-total">
                    <span>{t('storefront.subtotal')}</span>
                    <strong>{subtotal}</strong>
                  </div>
                  <button type="button" className="sf-primary" onClick={() => setStep('details')}>
                    {t('storefront.continue')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="sf-drawer-body">
                  <div className="sf-form">
                    <label className="sf-field">
                      {t('storefront.name')}
                      <input value={name} maxLength={ORDER_NAME_MAX} autoComplete="name" onChange={(e) => setName(e.target.value)} />
                    </label>
                    <label className="sf-field">
                      {t('storefront.phone')}
                      <input
                        value={phone}
                        inputMode="tel"
                        autoComplete="tel"
                        dir="ltr"
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </label>
                    <h3>{t('storefront.fulfillment')}</h3>
                    <div className="sf-seg" role="radiogroup" aria-label={t('storefront.fulfillment')}>
                      {(['delivery', 'pickup'] as const).map((m) => (
                        <label key={m}>
                          <input
                            type="radio"
                            name="sf-fulfillment"
                            value={m}
                            checked={fulfillment === m}
                            onChange={() => setFulfillment(m)}
                          />
                          <span>
                            {m === 'delivery' ? <IconBolt /> : <IconStore />}
                            {t(m === 'delivery' ? 'storefront.delivery' : 'storefront.pickup')}
                          </span>
                        </label>
                      ))}
                    </div>
                    <label className="sf-field">
                      {t(fulfillment === 'delivery' ? 'storefront.address' : 'storefront.addressOptional')}
                      <textarea
                        rows={2}
                        value={address}
                        maxLength={ORDER_ADDRESS_MAX}
                        autoComplete="street-address"
                        onChange={(e) => setAddress(e.target.value)}
                      />
                    </label>
                    <label className="sf-field">
                      {t('storefront.note')}
                      <textarea rows={2} value={note} maxLength={ORDER_NOTE_MAX} onChange={(e) => setNote(e.target.value)} />
                    </label>
                    <p className="sf-note">
                      <IconCash />
                      {t(fulfillment === 'delivery' ? 'storefront.perkCod' : 'storefront.perkPickup')}
                    </p>
                    {showProblem && problem && (
                      <div className="sf-msg sf-msg-warn" role="alert">
                        {t(`error.onlineOrders.${problem}`)}
                      </div>
                    )}
                    {serverError && (
                      <div className="sf-msg sf-msg-err" role="alert">
                        {t(serverError.key, serverError.params)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="sf-drawer-foot">
                  <div className="sf-total">
                    <span>{t('storefront.subtotal')}</span>
                    <strong>{subtotal}</strong>
                  </div>
                  <button
                    type="button"
                    className="sf-primary"
                    onClick={() => void submit()}
                    disabled={place.busy || lines.length === 0}
                  >
                    {place.busy ? t('storefront.placing') : t('storefront.placeOrder')}
                  </button>
                  <button type="button" className="sf-ghost" onClick={() => setStep('cart')}>
                    {t('storefront.backToCart')}
                  </button>
                </div>
              </>
            )}
          </aside>
        </>
      )}
    </div>
  );
}
