import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from 'react';
import { useParams } from 'react-router';
import { EmptyState } from '@/components/ui/Layout';
import {
  ORDER_ADDRESS_MAX,
  ORDER_MAX_QTY,
  ORDER_NAME_MAX,
  ORDER_NOTE_MAX,
  orderProblem,
  type FulfillmentMethod,
  type PaymentMethod,
  type PublicOrderReceipt,
} from '@/domain/onlineOrders';
import { deliveryQuote, discountPercent, freeDeliveryProgress, isRtl, mapLink, openState, shopClock, type PublicProduct, toHeroProductIds, toSections, type StoreLocale, type StoreSection } from '@/domain/onlineStore';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useAsyncData } from '@/hooks/useAsyncData';
import { translate, type TranslationKey, type TParams } from '@/i18n/i18n';
import { toUserMessage, type UserMessage } from '@/services/errors';
import { api } from '@/services/functionsClient';
import { forgetCachedCatalog, readCachedCatalog, writeCachedCatalog } from './storefrontCache';
import { clearPendingPayment, readPendingPayment, savePendingPayment } from './pendingPayment';
import { trackStoreEvent } from './storefrontTrack';
import { formatLbp, formatUsd } from '@/utils/format';
import { fitKind, withSizes } from './sizeAdvisor';
import { collapseVariants } from '@/domain/variants';
import AtelierRail from './AtelierRail';
import FittingRoom from './FittingRoom';
import { FITTING_ROOM_MIN, fittingLooks } from './roomLooks';
import BistroHero from './BistroHero';
import StudioHero from './StudioHero';
import TechHero from './TechHero';
import JewelHero from './JewelHero';
import BloomHero from './BloomHero';
import PerfumeHero from './PerfumeHero';
import StorefrontQuickView, { HeartIcon } from './StorefrontQuickView';
import StorefrontTrackOrder from './StorefrontTrackOrder';
import { whatsAppLink, whatsAppOrderText, type WaWords } from './storefrontWhatsApp';
import './storefront.css';

type Cart = Record<string, number>;
type SfVars = CSSProperties & Record<`--${string}`, string>;
type Step = 'cart' | 'details';
type SortKey = 'featured' | 'priceLow' | 'priceHigh' | 'name';
/** Pseudo category for the deals filter (real categories never start with a double underscore). */
const DEALS = '__deals__';
const DAY_KEYS = [
  'onlineStore.day.0',
  'onlineStore.day.1',
  'onlineStore.day.2',
  'onlineStore.day.3',
  'onlineStore.day.4',
  'onlineStore.day.5',
  'onlineStore.day.6',
] as const;

/** "21:00" → "9:00 PM" / "9:00 م" (hours are stored as shop-local wall-clock times). */
function clockLabel(hhmm: string, lang: StoreLocale): string {
  const d = new Date(2000, 0, 1, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)));
  return d.toLocaleTimeString(lang === 'ar' ? 'ar-LB-u-nu-latn' : 'en-US', { hour: 'numeric', minute: '2-digit' });
}
const SORTS: SortKey[] = ['featured', 'priceLow', 'priceHigh', 'name'];

const HERO_PICS = 4;
const FOOT_CATS = 5;
const RELATED_MAX = 4;
const TOAST_MS = 2600;

/** Fades a product photo in once it has decoded (the shimmer behind it stops). */
function markImageLoaded(e: SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.classList.add('is-loaded');
}

/** Cached images can finish before React attaches onLoad. */
function markIfComplete(el: HTMLImageElement | null) {
  if (el?.complete) el.classList.add('is-loaded');
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Pointer-driven 3D: any element with data-tilt="<max degrees>" leans toward the mouse.
 * One delegated listener for the whole page, writes CSS variables once per frame, and stays
 * off for touch screens and reduced motion (those get the CSS-only idle motion instead).
 */
function useTilt3d(enabled: boolean) {
  useEffect(() => {
    if (!enabled || prefersReducedMotion()) return;
    if (typeof window.matchMedia !== 'function' || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let active: HTMLElement | null = null;
    let frame = 0;
    let px = 0;
    let py = 0;
    const reset = (el: HTMLElement) => {
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
      el.classList.remove('is-tilting');
    };
    const apply = () => {
      frame = 0;
      if (!active) return;
      const r = active.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const x = Math.min(1, Math.max(0, (px - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (py - r.top) / r.height));
      const max = Number(active.dataset.tilt) || 6;
      active.style.setProperty('--ry', `${((x - 0.5) * 2 * max).toFixed(2)}deg`);
      active.style.setProperty('--rx', `${((0.5 - y) * 2 * max).toFixed(2)}deg`);
      active.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
      active.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
    };
    const onMove = (e: globalThis.PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const target = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tilt]') : null;
      if (target !== active) {
        if (active) reset(active);
        active = target;
        active?.classList.add('is-tilting');
      }
      px = e.clientX;
      py = e.clientY;
      if (active && !frame) frame = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      if (active) reset(active);
      active = null;
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      if (frame) cancelAnimationFrame(frame);
      if (active) reset(active);
    };
  }, [enabled]);
}

/** The cart button the shopper can see right now (header on desktop, bottom bar on phones). */
function visibleCartTarget(): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>('[data-sf-cart]')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/** Flies a copy of the product photo from `from` into the visible cart button. */
function flyToCart(from: Element | null | undefined, imageUrl: string | null) {
  const target = visibleCartTarget();
  if (!from || !target || prefersReducedMotion()) return;
  const a = from.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  if (a.width === 0 || typeof document.body.animate !== 'function') return;
  const size = Math.min(a.width, a.height, 160);
  const ghost = document.createElement(imageUrl ? 'img' : 'div');
  if (ghost instanceof HTMLImageElement && imageUrl) ghost.src = imageUrl;
  ghost.className = 'sf-fly';
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    width: `${size}px`,
    height: `${size}px`,
    left: `${a.left + a.width / 2 - size / 2}px`,
    top: `${a.top + a.height / 2 - size / 2}px`,
  });
  document.body.appendChild(ghost);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const anim = ghost.animate(
    [
      { transform: 'perspective(700px) translate3d(0, 0, 0) rotateY(0deg) scale(1)', opacity: 1 },
      {
        transform: `perspective(700px) translate3d(${dx * 0.55}px, ${dy * 0.35 - 60}px, 120px) rotateY(180deg) scale(0.6)`,
        opacity: 0.95,
        offset: 0.55,
      },
      { transform: `perspective(700px) translate3d(${dx}px, ${dy}px, 0) rotateY(360deg) scale(0.12)`, opacity: 0.4 },
    ],
    { duration: 650, easing: 'cubic-bezier(0.45, 0, 0.2, 1)' },
  );
  const done = () => ghost.remove();
  anim.onfinish = done;
  anim.oncancel = done;
}

function readWish(slug: string): string[] {
  try {
    const raw = window.localStorage.getItem(`sf-wish-${slug}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function uniqueById<P extends { id: string }>(list: P[]): P[] {
  const seen = new Set<string>();
  return list.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

function priceLabel(p: PublicProduct, lang: StoreLocale): string {
  if (p.priceUsdCents > 0) return formatUsd(p.priceUsdCents);
  return p.priceLbp ? formatLbp(p.priceLbp, lang) : '—';
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '•';
}

/** `cutout` themes show the background-free photo when the owner made one. */
function ProductVisual({ product, cutout = false }: { product: PublicProduct; cutout?: boolean }) {
  const src = (cutout && product.cutoutUrl) || product.imageUrl;
  if (src) {
    return (
      <img
        className={cutout && product.cutoutUrl ? 'sf-img sf-img-cutout' : 'sf-img'}
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={markImageLoaded}
        onError={markImageLoaded}
        ref={markIfComplete}
      />
    );
  }
  return (
    <div className="sf-ph" aria-hidden="true">
      {initial(product.name)}
    </div>
  );
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
const IconTruck = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" />
    <circle cx="7" cy="17.5" r="1.6" />
    <circle cx="17.5" cy="17.5" r="1.6" />
  </svg>
);
const IconHome = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 11 12 4l8 7v9h-5v-6h-6v6H4z" />
  </svg>
);
const IconCheck = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5 10 17l9-10" />
  </svg>
);
const IconClose = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

/** `slug` is passed when the shop is opened on its own domain; otherwise it comes from /s/:slug. */
export default function PublicStorePage({ slug: fixedSlug }: { slug?: string } = {}) {
  const params = useParams();
  const slug = fixedSlug ?? params.slug ?? '';
  const fresh = useAsyncData(`public-store-${slug}`, () => api.publicStoreCatalog({ slug }));
  // Returning visitors see the last catalogue at once; the fresh one replaces it when it lands.
  const cached = useMemo(() => readCachedCatalog(slug), [slug]);
  useEffect(() => {
    if (fresh.data) writeCachedCatalog(slug, fresh.data);
    else if (fresh.error) forgetCachedCatalog(slug);
  }, [fresh.data, fresh.error, slug]);
  const catalog = fresh.data ?? (fresh.error ? null : cached);
  const data = {
    data: catalog,
    error: fresh.error,
    loading: fresh.loading && !cached,
  };
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
  const [zoneId, setZoneId] = useState('');
  const [showProblem, setShowProblem] = useState(false);
  // Back from Whish (?pay=REF): restore the receipt saved before leaving; its payment is re-checked below.
  const [receipt, setReceipt] = useState<PublicOrderReceipt | null>(() =>
    new URLSearchParams(window.location.search).get('pay') ? (readPendingPayment(slug)?.receipt ?? null) : null,
  );
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cod');
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState<UserMessage | null>(null);
  const [serverError, setServerError] = useState<UserMessage | null>(null);
  // Deep link: /s/<slug>?p=<productId> opens that product (ignored if it is not in the catalog).
  const [quick, setQuick] = useState<string | null>(() => new URLSearchParams(window.location.search).get('p'));
  const [sizes, setSizes] = useState<Record<string, string>>({});
  const [wish, setWish] = useState<string[]>(() => readWish(slug));
  const [wishOnly, setWishOnly] = useState(false);
  const [trackOpen, setTrackOpen] = useState(false);
  const [trackRef, setTrackRef] = useState('');
  const [bump, setBump] = useState(0);
  const [sort, setSort] = useState<SortKey>('featured');
  // Re-evaluated every minute so "open now" flips without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const [toast, setToast] = useState<{ name: string; id: number } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const place = useAsyncAction('storefront');
  useTilt3d(!!data.data);

  useEffect(() => {
    try {
      window.localStorage.setItem(`sf-wish-${slug}`, JSON.stringify(wish));
    } catch {
      // Private mode or blocked storage: favorites just won't persist.
    }
  }, [slug, wish]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // Anonymous counters for the owner's stats tab (see storefrontTrack.ts).
  const loaded = !!data.data;
  useEffect(() => {
    if (loaded) trackStoreEvent(slug, 'visit');
  }, [loaded, slug]);
  useEffect(() => {
    if (quick) trackStoreEvent(slug, 'view', quick);
  }, [quick, slug]);
  // Returning from Whish: ask the server (which asks Whish) how the payment went.
  const returnRef = useMemo(() => new URLSearchParams(window.location.search).get('pay'), []);
  useEffect(() => {
    const saved = readPendingPayment(slug);
    if (!returnRef || !saved || saved.receipt.ref !== returnRef) return;
    let stop = false;
    void api
      .publicCheckPayment({ slug, ref: saved.receipt.ref, phone: saved.phone })
      .then((r) => {
        if (stop) return;
        setReceipt({ ...saved.receipt, paymentStatus: r.paymentStatus });
        if (r.paymentStatus === 'paid') clearPendingPayment(slug);
      })
      .catch(() => undefined);
    const url = new URL(window.location.href);
    url.searchParams.delete('pay');
    url.searchParams.delete('fakeWhish');
    window.history.replaceState(window.history.state, '', url);
    return () => {
      stop = true;
    };
  }, [returnRef, slug]);

  // The tab, bookmark and history entry carry the shop's name instead of the POS app's.
  const shopName = data.data?.store.storeName ?? '';
  useEffect(() => {
    if (!shopName) return;
    const before = document.title;
    document.title = shopName;
    return () => {
      document.title = before;
    };
  }, [shopName]);

  // Keep the address bar in step with the open product so it can be copied or shared.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (quick) url.searchParams.set('p', quick);
    else url.searchParams.delete('p');
    window.history.replaceState(window.history.state, '', url);
  }, [quick]);

  const store = data.data?.store;
  const allProducts = useMemo(() => catalog?.products ?? [], [catalog]);
  // Sizes/colours of one item show as one card; the cart and orders keep the exact option.
  const collapsed = useMemo(() => collapseVariants(allProducts), [allProducts]);
  // Pieces the owner photographed for the fitting room (shown instead of the hero when there are enough).
  const looks = useMemo(() => fittingLooks(allProducts), [allProducts]);
  const products = collapsed.listed;
  /** The card listed for any product id (an option leads to its item's card). */
  const listedFor = (id: string) => products.find((p) => p.id === (collapsed.leadOf.get(id) ?? id));
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
        (category === 'all' || (category === DEALS ? p.compareAtUsdCents !== null : p.category.trim() === category)) &&
        (!wishOnly || wish.includes(p.id)) &&
        (!q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)),
    );
  }, [products, query, category, wishOnly, wish]);

  const sorted = useMemo(() => {
    if (sort === 'featured') return visible;
    const list = [...visible];
    // Products priced only in LBP sort after the dollar-priced ones.
    const usd = (p: PublicProduct) => (p.priceUsdCents > 0 ? p.priceUsdCents : Number.MAX_SAFE_INTEGER);
    if (sort === 'priceLow') list.sort((a, b) => usd(a) - usd(b));
    else if (sort === 'priceHigh') list.sort((a, b) => (b.priceUsdCents || -1) - (a.priceUsdCents || -1));
    else list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [visible, sort]);

  const heroPics = useMemo(() => products.filter((p) => p.imageUrl && p.inStock).slice(0, HERO_PICS), [products]);
  const categoryTiles = useMemo(
    () =>
      categories.map((c) => ({
        ...c,
        image: products.find((p) => p.category.trim() === c.label && p.imageUrl)?.imageUrl ?? null,
      })),
    [categories, products],
  );

  const lines = useMemo(
    () => Object.entries(cart).filter(([, q]) => q > 0).map(([productId, qty]) => ({ productId, qty })),
    [cart],
  );
  const cartItems = lines
    .map((l) => ({ ...l, product: allProducts.find((p) => p.id === l.productId) }))
    .filter((x): x is typeof x & { product: PublicProduct } => !!x.product);
  const estUsd = cartItems.reduce((s, x) => s + x.product.priceUsdCents * x.qty, 0);
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);
  const delivery = data.data?.store ? deliveryQuote(data.data.store, estUsd, fulfillment, zoneId) : null;
  const problem = orderProblem(lines, { name, phone, address }, fulfillment) ?? delivery?.problem ?? null;

  const quickOpen = quick !== null && allProducts.some((p) => p.id === quick);
  const overlay = cartOpen || quickOpen || trackOpen;
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // A nested layer (the try-on view) already handled it.
      if (e.defaultPrevented) return;
      // Close the top-most layer first.
      if (trackOpen) setTrackOpen(false);
      else if (quick !== null) setQuick(null);
      else setCartOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [overlay, quick, trackOpen]);

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
  const addQty = (id: string, delta: number) => {
    setCart((c) => ({ ...c, [id]: Math.max(0, Math.min(ORDER_MAX_QTY, (c[id] ?? 0) + delta)) }));
    if (delta > 0) {
      setBump((n) => n + 1);
      trackStoreEvent(slug, 'add', id);
    }
  };
  /** First add of a product: photo flies to the cart and a short confirmation shows. */
  const addFrom = (p: PublicProduct, from: Element | null | undefined) => {
    addQty(p.id, 1);
    flyToCart(from, p.imageUrl);
    window.clearTimeout(toastTimer.current);
    setToast({ name: p.name, id: Date.now() });
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  };
  const focusSearch = () => {
    setReceipt(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    window.setTimeout(() => document.getElementById('sf-q')?.focus({ preventScroll: true }), 350);
  };
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
  const whishOn = !!data.data?.payments?.whish;
  const hasZones = store.deliveryZones.length > 0;
  const deliveryFee = delivery?.feeUsdCents ?? 0;
  const grandTotal = estUsd > 0 ? formatUsd(estUsd + deliveryFee) : '—';
  const minShort = store.minOrderUsdCents !== null && estUsd < store.minOrderUsdCents ? store.minOrderUsdCents - estUsd : 0;
  const freeProgress = freeDeliveryProgress(store.freeDeliveryOverUsdCents, estUsd);
  const freebar = freeProgress && (
    <div className="sf-freebar">
      <p>
        {freeProgress.reached
          ? t('storefront.freeDelivery.reached')
          : t('storefront.freeDelivery.remaining', { amount: formatUsd(freeProgress.remainingUsdCents) })}
      </p>
      <div className="sf-freebar-track" aria-hidden="true">
        <span style={{ width: `${Math.round(freeProgress.ratio * 100)}%` }} />
      </div>
    </div>
  );
  const toggleWish = (id: string) => setWish((w) => (w.includes(id) ? w.filter((x) => x !== id) : [...w, id]));
  const quickFound = quick ? allProducts.find((p) => p.id === quick) : undefined;
  // An option without its own photo shows the item's photo from another option.
  const quickProduct =
    quickFound && !quickFound.imageUrl && quickFound.groupId
      ? { ...quickFound, imageUrl: collapsed.siblings.get(quickFound.groupId)?.find((v) => v.imageUrl)?.imageUrl ?? null }
      : quickFound;
  const quickLead = quickProduct ? (collapsed.leadOf.get(quickProduct.id) ?? quickProduct.id) : null;
  const related = quickProduct
    ? [
        ...products.filter((p) => p.id !== quickLead && p.category.trim() && p.category.trim() === quickProduct.category.trim()),
        ...products.filter((p) => p.id !== quickLead && p.category.trim() !== quickProduct.category.trim()),
      ].slice(0, RELATED_MAX)
    : [];
  const sizedNote = withSizes(
    note,
    cartItems.filter((x) => sizes[x.product.id]).map((x) => ({ name: x.product.name, size: sizes[x.product.id] ?? '' })),
    ORDER_NOTE_MAX,
  );

  const waWords: WaWords = {
    hello: (storeName, ref) => t('storefront.wa.hello', { store: storeName, ref }),
    total: (amount) => t('storefront.wa.total', { amount }),
    name: (v) => t('storefront.wa.name', { name: v }),
    phone: (v) => t('storefront.wa.phone', { phone: v }),
    delivery: (v) => t('storefront.wa.delivery', { address: v }),
    pickup: t('storefront.wa.pickup'),
    note: (v) => t('storefront.wa.note', { note: v }),
    fee: (zone, amount) => t('storefront.wa.fee', { zone, amount }),
  };
  const waFor = (r: PublicOrderReceipt) =>
    whatsAppLink(store.whatsapp, whatsAppOrderText(r, { storeName: store.storeName, name, phone, address, note: sizedNote }, waWords, lang));

  /** Opens Whish again for an unpaid order (from the receipt). */
  async function payNow(r: PublicOrderReceipt) {
    const saved = readPendingPayment(slug);
    const guestPhone = saved?.receipt.ref === r.ref ? saved.phone : phone;
    setPayBusy(true);
    setPayError(null);
    try {
      const res = await api.publicPayOrder({ slug, ref: r.ref, phone: guestPhone });
      if (res.paymentStatus === 'paid') setReceipt({ ...r, paymentStatus: 'paid' });
      else if (res.payUrl) {
        savePendingPayment(slug, { receipt: r, phone: guestPhone });
        window.location.assign(res.payUrl);
      }
    } catch (e) {
      setPayError(toUserMessage(e));
    } finally {
      setPayBusy(false);
    }
  }

  async function submit(viaWhatsApp = false) {
    if (problem) {
      setShowProblem(true);
      return;
    }
    setServerError(null);
    // Opened during the click so the browser does not block it; filled once the order exists.
    const waWindow = viaWhatsApp ? window.open('about:blank', '_blank') : null;
    const res = await place.run(async () => {
      try {
        return await api.publicPlaceOrder({
          slug,
          lines,
          name,
          phone,
          address,
          note: sizedNote,
          fulfillment,
          payment: whishOn && !viaWhatsApp ? payMethod : 'cod',
          ...(fulfillment === 'delivery' && hasZones ? { zoneId } : {}),
        });
      } catch (e) {
        // Show the reason inside the drawer; guests may not see a toast.
        setServerError(toUserMessage(e));
        return undefined;
      }
    });
    if (!res) waWindow?.close();
    if (res && viaWhatsApp) {
      const url = waFor(res);
      if (url && waWindow) waWindow.location.href = url;
      else if (url) window.location.assign(url);
      else waWindow?.close();
    }
    if (res?.payUrl) {
      // Leave for Whish's payment page; the receipt comes back with us on return.
      savePendingPayment(slug, { receipt: res, phone });
      setCart({});
      window.location.assign(res.payUrl);
      return;
    }
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
              id="sf-q"
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
          {waDigits && (
            // Phones: WhatsApp lives in the header instead of a floating bubble over the products.
            <a
              className="sf-wa-top"
              href={`https://wa.me/${waDigits}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('storefront.whatsapp')}
              title={t('storefront.whatsapp')}
            >
              <IconWhatsApp />
            </a>
          )}
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
            className="sf-track-btn"
            aria-label={t('storefront.track.open')}
            title={t('storefront.track.open')}
            onClick={() => {
              setTrackRef('');
              setTrackOpen(true);
            }}
          >
            <IconTruck />
            <span className="sf-track-label">{t('storefront.track.open')}</span>
          </button>
          <button
            type="button"
            className="sf-cart-btn"
            data-sf-cart=""
            onClick={openCart}
            aria-label={t('storefront.openCart', { count: itemCount })}
          >
            <IconBag />
            <span className="sf-cart-label">{t('storefront.cart')}</span>
            {itemCount > 0 && (
              <span key={bump} className="sf-badge">
                {itemCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );

  const openNow = openState(store.hours, shopClock(new Date(now)));
  const openText = openNow
    ? openNow.open
      ? openNow.until
        ? `${t('storefront.hours.openNow')} · ${t('storefront.hours.closesAt', { time: clockLabel(openNow.until, lang) })}`
        : t('storefront.hours.openNow')
      : openNow.until
        ? `${t('storefront.hours.closedNow')} · ${
            openNow.untilDay === null
              ? t('storefront.hours.opensAt', { time: clockLabel(openNow.until, lang) })
              : t('storefront.hours.opensDay', { day: t(DAY_KEYS[openNow.untilDay] ?? 'onlineStore.day.0'), time: clockLabel(openNow.until, lang) })
          }`
        : t('storefront.hours.closedNow')
    : null;
  const mapUrl = mapLink(store.storeAddress);

  const pickCategory = (label: string) => {
    setReceipt(null);
    setWishOnly(false);
    setCategory(label);
    window.setTimeout(toCatalog, 0);
  };

  const bar = (
    <div className="sf-bar">
      <div className="sf-wrap sf-bar-row">
        <span>
          {store.freeDeliveryOverUsdCents
            ? t('storefront.bar.freeOver', { amount: formatUsd(store.freeDeliveryOverUsdCents) })
            : t(whishOn ? 'storefront.bar.codOrWhish' : 'storefront.bar.cod')}
        </span>
        {contact && (
          <a href={`tel:${contact}`} dir="ltr">
            {contact}
          </a>
        )}
      </div>
    </div>
  );

  const footer = (
    <footer className="sf-foot">
      <div className="sf-wrap">
        <ul className="sf-trust">
          <li>
            <span className="sf-trust-ic">
              <IconCash />
            </span>
            <div>
              <b>{t('storefront.perkCod')}</b>
              <span>{t('storefront.trust.codDesc')}</span>
            </div>
          </li>
          <li>
            <span className="sf-trust-ic">
              <IconStore />
            </span>
            <div>
              <b>{t('storefront.perkPickup')}</b>
              <span>{t('storefront.trust.pickupDesc')}</span>
            </div>
          </li>
          <li>
            <span className="sf-trust-ic">
              <IconBolt />
            </span>
            <div>
              <b>{t('storefront.perkEasy')}</b>
              <span>{t('storefront.trust.easyDesc')}</span>
            </div>
          </li>
          {waDigits && (
            <li>
              <span className="sf-trust-ic">
                <IconWhatsApp />
              </span>
              <div>
                <b>{t('storefront.whatsapp')}</b>
                <span>{t('storefront.trust.chatDesc')}</span>
              </div>
            </li>
          )}
        </ul>
        <div className="sf-foot-grid">
          <div className="sf-foot-brand">
            <span className="sf-mark" aria-hidden="true">
              {initial(store.storeName)}
            </span>
            <b>{store.storeName}</b>
            <p>{store.tagline || t('storefront.heroFallback')}</p>
          </div>
          {categories.length > 0 && (
            <nav aria-label={t('storefront.footer.shop')}>
              <h3>{t('storefront.footer.shop')}</h3>
              <ul>
                {categories.slice(0, FOOT_CATS).map((c) => (
                  <li key={c.label}>
                    <button type="button" onClick={() => pickCategory(c.label)}>
                      {c.label}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <nav aria-label={t('storefront.footer.help')}>
            <h3>{t('storefront.footer.help')}</h3>
            <ul>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setTrackRef(receipt?.ref ?? '');
                    setTrackOpen(true);
                  }}
                >
                  {t('storefront.track.open')}
                </button>
              </li>
              <li>
                <button type="button" onClick={openCart}>
                  {t('storefront.cart')}
                </button>
              </li>
            </ul>
          </nav>
          {(contact || waDigits || store.storeAddress) && (
            <div>
              <h3>{t('storefront.footer.contact')}</h3>
              <ul>
                {store.storeAddress && (
                  <li>
                    {mapUrl ? (
                      <a href={mapUrl} target="_blank" rel="noopener noreferrer">
                        {store.storeAddress}
                      </a>
                    ) : (
                      store.storeAddress
                    )}
                  </li>
                )}
                {contact && (
                  <li>
                    <a href={`tel:${contact}`} dir="ltr">
                      {contact}
                    </a>
                  </li>
                )}
                {waDigits && (
                  <li>
                    <a href={`https://wa.me/${waDigits}`} target="_blank" rel="noopener noreferrer">
                      {t('storefront.whatsapp')}
                    </a>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
        {store.hours.length === 7 && (
          <div className="sf-hours">
            <h3>{t('storefront.hours.title')}</h3>
            <ul>
              {store.hours.map((h, d) => (
                <li key={DAY_KEYS[d]} className={openNow && shopClock(new Date(now)).day === d ? 'is-today' : undefined}>
                  <span>{t(DAY_KEYS[d] ?? 'onlineStore.day.0')}</span>
                  <span dir="ltr">{h.closed ? t('storefront.hours.closed') : `${clockLabel(h.open, lang)} – ${clockLabel(h.close, lang)}`}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="sf-foot-row">
          <span>
            © {new Date(now).getFullYear()} {store.storeName}
          </span>
          <span>{t('storefront.poweredBy')}</span>
        </div>
      </div>
    </footer>
  );

  const bottomNav = (
    <nav className="sf-bnav" aria-label={t('storefront.nav.label')}>
      <button
        type="button"
        aria-current={!receipt && !wishOnly && !cartOpen ? 'page' : undefined}
        onClick={() => {
          setReceipt(null);
          setWishOnly(false);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      >
        <IconHome />
        <span>{t('storefront.nav.home')}</span>
      </button>
      <button type="button" onClick={focusSearch}>
        <IconSearch />
        <span>{t('storefront.nav.search')}</span>
      </button>
      <button
        type="button"
        aria-pressed={wishOnly}
        onClick={() => {
          setReceipt(null);
          setWishOnly((v) => !v);
          window.setTimeout(toCatalog, 0);
        }}
      >
        <HeartIcon filled={wishOnly} />
        <span>{t('storefront.wishlist')}</span>
        {wish.length > 0 && <b className="sf-bnav-dot">{wish.length}</b>}
      </button>
      <button type="button" className="sf-bnav-cart" data-sf-cart="" onClick={openCart} aria-label={t('storefront.openCart', { count: itemCount })}>
        <IconBag />
        <span>{t('storefront.nav.cart')}</span>
        {itemCount > 0 && (
          <b key={bump} className="sf-badge sf-bnav-badge">
            {itemCount}
          </b>
        )}
      </button>
      <button
        type="button"
        onClick={() => {
          setTrackRef(receipt?.ref ?? '');
          setTrackOpen(true);
        }}
      >
        <IconTruck />
        <span>{t('storefront.nav.track')}</span>
      </button>
    </nav>
  );

  const toastView = toast && !overlay && (
    <div key={toast.id} className="sf-toast" role="status">
      <span className="sf-toast-ic">
        <IconCheck />
      </span>
      <span className="sf-toast-text">{t('storefront.addedToCart', { name: toast.name })}</span>
      <button
        type="button"
        onClick={() => {
          setToast(null);
          openCart();
        }}
      >
        {t('storefront.viewCart')}
      </button>
    </div>
  );

  if (receipt) {
    return (
      <div className={`sf sf-theme-${store.theme ?? 'classic'}`} dir={isRtl(lang) ? 'rtl' : 'ltr'} lang={lang} style={rootStyle}>
        {bar}
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
                    {l.qty} × <bdi>{l.name}</bdi>
                  </span>
                  <span>{l.lineUsdCents > 0 ? formatUsd(l.lineUsdCents) : formatLbp(l.lineLbp, lang)}</span>
                </li>
              ))}
              {(receipt.deliveryFeeUsdCents > 0 || receipt.deliveryZone) && (
                <li>
                  <span>{t('storefront.zone.feeLine', { zone: receipt.deliveryZone })}</span>
                  <span>{receipt.deliveryFeeUsdCents > 0 ? formatUsd(receipt.deliveryFeeUsdCents) : t('storefront.zone.free')}</span>
                </li>
              )}
            </ul>
            <div className="sf-total">
              <span>{t('storefront.total')}</span>
              <strong>{receipt.totalUsdCents > 0 ? formatUsd(receipt.totalUsdCents) : formatLbp(receipt.totalLbp, lang)}</strong>
            </div>
            {receipt.payment === 'whish' ? (
              <div className={receipt.paymentStatus === 'paid' ? 'sf-paybox is-paid' : 'sf-paybox'} role="status">
                <b>{t(receipt.paymentStatus === 'paid' ? 'storefront.pay.paid' : receipt.paymentStatus === 'failed' ? 'storefront.pay.failed' : 'storefront.pay.unpaid')}</b>
                {receipt.paymentStatus !== 'paid' && (
                  <>
                    <span>{t('storefront.pay.unpaidHint')}</span>
                    <button type="button" className="sf-primary" disabled={payBusy} onClick={() => void payNow(receipt)}>
                      {t('storefront.pay.payNow')}
                    </button>
                    {payError && <span className="sf-msg">{t(payError.key, payError.params)}</span>}
                  </>
                )}
              </div>
            ) : (
              <p>{t(receipt.fulfillment === 'delivery' ? 'storefront.codDelivery' : 'storefront.codPickup')}</p>
            )}
            {contact && <p>{t('storefront.contact', { phone: contact })}</p>}
            <button
              type="button"
              className={receipt.payment === 'whish' && receipt.paymentStatus !== 'paid' ? 'sf-ghost' : 'sf-primary'}
              onClick={() => setReceipt(null)}
            >
              {t('storefront.backToShop')}
            </button>
            {waFor(receipt) && (
              <a className="sf-wa-order" href={waFor(receipt) ?? undefined} target="_blank" rel="noopener noreferrer">
                <IconWhatsApp />
                {t('storefront.wa.send')}
              </a>
            )}
            <button
              type="button"
              className="sf-ghost"
              onClick={() => {
                setTrackRef(receipt.ref);
                setTrackOpen(true);
              }}
            >
              {t('storefront.track.thisOrder')}
            </button>
          </section>
        </main>
        {trackOpen && (
          <StorefrontTrackOrder
            slug={slug}
            t={t}
            lang={lang}
            initialRef={trackRef}
            initialPhone={phone}
            onClose={() => setTrackOpen(false)}
          />
        )}
        {footer}
        {!overlay && bottomNav}
      </div>
    );
  }

  const card = (p: PublicProduct, k: number) => {
      const qty = cart[p.id] ?? 0;
      const wished = wish.includes(p.id);
      const grouped = !!p.groupId && (collapsed.siblings.get(p.groupId)?.length ?? 0) > 1;
      const needsPick = grouped || (fitKind(p) !== null && !sizes[p.id]);
      return (
        <article
          key={p.id}
          className={p.inStock ? 'sf-card' : 'sf-card sf-soldout'}
          style={{ '--k': String(k) } as SfVars}
          data-tilt="6"
        >
          <div className="sf-media">
            <button
              type="button"
              className="sf-open"
              aria-label={t('storefront.openProduct', { name: p.name })}
              onClick={() => setQuick(p.id)}
            >
              <ProductVisual product={p} cutout={store.theme !== 'classic'} />
              <span className="sf-open-hint" aria-hidden="true">
                {t('storefront.quickView')}
              </span>
            </button>
            {!p.inStock && <span className="sf-chip-out">{t('storefront.outOfStock')}</span>}
            {p.inStock && discountPercent(p) !== null && <span className="sf-chip-off">−{discountPercent(p)}%</span>}
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
            {p.category.trim() && <span className="sf-cat">{p.category}</span>}
            <h3 className="sf-name">{p.name}</h3>
            {p.rating && (
              <span className="sf-rating" aria-label={t('storefront.ratingAria', { avg: p.rating.average, count: p.rating.count })}>
                <span aria-hidden="true">★</span> {p.rating.average.toFixed(1)} <small>({p.rating.count})</small>
              </span>
            )}
            <div className="sf-price">
              <span className="sf-price-now">
                {collapsed.priceVaries.has(p.id) ? t('storefront.fromPrice', { price: priceLabel(p, lang) }) : priceLabel(p, lang)}
                {p.compareAtUsdCents !== null && <s className="sf-was">{formatUsd(p.compareAtUsdCents)}</s>}
              </span>
              {p.priceUsdCents > 0 && p.priceLbp ? <small>{formatLbp(p.priceLbp, lang)}</small> : null}
            </div>
            <div className="sf-buy">
              {!p.inStock ? null : qty === 0 || grouped ? (
                <button
                  type="button"
                  className="sf-add"
                  onClick={(e) => (needsPick ? setQuick(p.id) : addFrom(p, e.currentTarget.closest('.sf-card')?.querySelector('.sf-media')))}
                >
                  <IconBag />
                  {grouped
                    ? t('storefront.chooseOption', { name: p.options[0]?.name ?? t('storefront.size') })
                    : needsPick
                      ? t('storefront.chooseSize')
                      : t('storefront.add')}
                </button>
              ) : (
                stepper(p, qty)
              )}
            </div>
          </div>
        </article>
      );
  };

  const bestSellers = uniqueById(
    (data.data?.bestSellerIds ?? []).map(listedFor).filter((p): p is PublicProduct => !!p),
  );
  const newArrivals = products.filter((p) => p.isNew && p.inStock).slice(0, 8);
  const shelf = (id: string, title: string, list: PublicProduct[]) =>
    list.length >= 2 && category === 'all' && !wishOnly && !query.trim() ? (
      <section className="sf-wrap sf-shelf" aria-labelledby={id}>
        <h2 id={id} className="sf-sec-title">
          {title}
        </h2>
        <div className="sf-row">{list.map((p, k) => card(p, k))}</div>
      </section>
    ) : null;

  const dealsCount = products.filter((p) => p.compareAtUsdCents !== null).length;
  const activeTitle = wishOnly ? t('storefront.wishlist') : category === 'all' ? t('storefront.all') : category === DEALS ? t('storefront.deals') : category;

  const heroTitle = store.heroTitle || store.storeName;
  const heroSubtitle = store.heroSubtitle || store.tagline || t('storefront.heroFallback');
  const heroCtaText = store.heroCta || t('storefront.shopNow');
  // Pieces on the 3D rail: the owner's picks in their order, else the first products with photos.
  const pickedHero = uniqueById(
    toHeroProductIds(store.heroProductIds)
      .map(listedFor)
      .filter((p): p is PublicProduct => !!p && !!(p.cutoutUrl || p.imageUrl)),
  );
  const heroItems = pickedHero.length > 0 ? pickedHero : products.filter((p) => p.imageUrl).slice(0, 8);
  // Perfume window: the owner's photo, else the first showcase piece (cut-out first), else any photo.
  const heroImage = store.heroImageUrl || pickedHero[0]?.cutoutUrl || pickedHero[0]?.imageUrl || heroPics[0]?.imageUrl || null;

  const heroEyebrow = openNow ? <span className={openNow.open ? 'sf-open is-open' : 'sf-open'}>{openText}</span> : null;
  const heroWhatsApp = (className: string) =>
    waDigits ? (
      <a className={className} href={`https://wa.me/${waDigits}`} target="_blank" rel="noopener noreferrer">
        <IconWhatsApp />
        {t('storefront.whatsapp')}
      </a>
    ) : null;

  const classicHero = (
        <section className="sf-hero">
          <div className={store.heroImageUrl || heroPics.length >= 3 ? 'sf-wrap sf-hero-grid' : 'sf-wrap sf-hero-grid sf-hero-solo'}>
            <div className="sf-hero-copy">
              <div className="sf-hero-tags">
                <p className="sf-eyebrow">{t('storefront.heroStats', { count: products.filter((p) => p.inStock).length })}</p>
                {openNow && <p className={openNow.open ? 'sf-open is-open' : 'sf-open'}>{openText}</p>}
              </div>
              <h1>{heroTitle}</h1>
              <p className="sf-hero-sub">{heroSubtitle}</p>
              <div className="sf-hero-actions">
                <button type="button" className="sf-cta" onClick={toCatalog}>
                  {heroCtaText}
                  <IconArrow />
                </button>
                {waDigits && (
                  <a className="sf-cta-2" href={`https://wa.me/${waDigits}`} target="_blank" rel="noopener noreferrer">
                    <IconWhatsApp />
                    {t('storefront.whatsapp')}
                  </a>
                )}
              </div>
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
            {store.heroImageUrl ? (
              <figure className="sf-hero-photo" aria-hidden="true">
                <img src={store.heroImageUrl} alt="" decoding="async" fetchPriority="high" />
              </figure>
            ) : heroPics.length >= 3 ? (
              <div className="sf-scene" data-tilt="7" aria-hidden="true">
                <div className="sf-sway">
              <div className={`sf-bento sf-bento-${heroPics.length}`}>
                {heroPics.map((p) => (
                  <figure key={p.id} className="sf-bento-item">
                    <span className="sf-bento-img">
                      <img src={p.imageUrl ?? ''} alt="" decoding="async" fetchPriority="high" />
                    </span>
                    <figcaption>
                      <b>{p.name}</b>
                      <span>{priceLabel(p, lang)}</span>
                    </figcaption>
                  </figure>
                ))}
              </div>
                </div>
              </div>
            ) : null}
          </div>
        </section>
  );

  const sectionViews: Record<StoreSection, ReactNode> = {
    categories: categoryTiles.length >= 2 && (
        <section className="sf-wrap sf-shelf" aria-labelledby="sf-shelf-title">
          <h2 id="sf-shelf-title" className="sf-sec-title">
            {t('storefront.shopByCategory')}
          </h2>
          <div className="sf-tiles">
            {categoryTiles.map((c) => (
              <button
                key={c.label}
                type="button"
                className="sf-tile"
                aria-pressed={category === c.label}
                onClick={() => pickCategory(c.label)}
              >
                <span className="sf-tile-img">
                  {c.image ? (
                    <img src={c.image} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <span className="sf-ph">{initial(c.label)}</span>
                  )}
                </span>
                <span className="sf-tile-name">{c.label}</span>
                <small>{t('storefront.productCount', { count: c.count })}</small>
              </button>
            ))}
          </div>
        </section>
      ),
    bestSellers: shelf('sf-best', t('storefront.bestSellers'), bestSellers),
    newArrivals: shelf('sf-new', t('storefront.newArrivals'), newArrivals),
    catalog: (
          <section id="catalog" className="sf-wrap sf-catalog">
            <div>
              <div className="sf-toolbar">
                <div className="sf-list-head">
                  <h2>{activeTitle}</h2>
                  <span>{t('storefront.productCount', { count: visible.length })}</span>
                </div>
                <label className="sf-sort">
                  <span>{t('storefront.sort.label')}</span>
                  <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                    {SORTS.map((k) => (
                      <option key={k} value={k}>
                        {t(`storefront.sort.${k}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {categories.length > 0 && (
                <div className="sf-chips" role="group" aria-label={t('storefront.categories')}>
                  <button
                    type="button"
                    aria-pressed={category === 'all' && !wishOnly}
                    onClick={() => {
                      setWishOnly(false);
                      setCategory('all');
                    }}
                  >
                    {t('storefront.all')}
                    <small>{products.length}</small>
                  </button>
                  {dealsCount > 0 && (
                    <button type="button" className="sf-chip-deals" aria-pressed={category === DEALS} onClick={() => setCategory(DEALS)}>
                      {t('storefront.deals')}
                      <small>{dealsCount}</small>
                    </button>
                  )}
                  {categories.map((c) => (
                    <button key={c.label} type="button" aria-pressed={category === c.label} onClick={() => setCategory(c.label)}>
                      {c.label}
                      <small>{c.count}</small>
                    </button>
                  ))}
                </div>
              )}

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
                  {sorted.map((p, k) => card(p, k))}
                </div>
              )}
            </div>
          </section>
    ),
  };

  return (
    <div className={`sf sf-theme-${store.theme ?? 'classic'}`} dir={isRtl(lang) ? 'rtl' : 'ltr'} lang={lang} style={rootStyle}>
      {bar}
      {header}

      {looks.length >= FITTING_ROOM_MIN ? (
        <FittingRoom
          storeName={store.storeName}
          looks={looks}
          t={t}
          priceOf={(p) => priceLabel(p, lang)}
          sizeOf={(id) => sizes[id] ?? ''}
          onSize={(id, s) => setSizes((m) => ({ ...m, [id]: s }))}
          onAdd={(p, from) => addFrom(p, from)}
          onOpen={(id) => setQuick(id)}
          bagIcon={<IconBag />}
        />
      ) : store.theme === 'studio' ? (
        <StudioHero
          title={heroTitle}
          subtitle={heroSubtitle}
          cta={heroCtaText}
          items={heroItems}
          price={(p) => priceLabel(p, lang)}
          onOpen={(id) => setQuick(id)}
          onCta={toCatalog}
          pickLabel={(name) => t('storefront.studio.show', { name })}
          pauseLabel={t('storefront.studio.pause')}
          playLabel={t('storefront.studio.play')}
          eyebrow={heroEyebrow}
          secondary={heroWhatsApp('st-cta-2')}
        />
      ) : store.theme === 'tech' ? (
        <TechHero
          title={heroTitle}
          subtitle={heroSubtitle}
          cta={heroCtaText}
          items={heroItems}
          price={(p) => priceLabel(p, lang)}
          onOpen={(id) => setQuick(id)}
          onCta={toCatalog}
          pickLabel={(name) => t('storefront.studio.show', { name })}
          eyebrow={heroEyebrow}
          secondary={heroWhatsApp('tc-cta-2')}
        />
      ) : store.theme === 'jewel' ? (
        <JewelHero
          title={heroTitle}
          subtitle={heroSubtitle}
          cta={heroCtaText}
          items={heroItems}
          price={(p) => priceLabel(p, lang)}
          onOpen={(id) => setQuick(id)}
          onCta={toCatalog}
          hint={t('storefront.jewel.hint')}
          touchHint={t('storefront.jewel.touchHint')}
          eyebrow={heroEyebrow}
          secondary={heroWhatsApp('jw-cta-2')}
        />
      ) : store.theme === 'bloom' ? (
        <BloomHero
          title={heroTitle}
          subtitle={heroSubtitle}
          cta={heroCtaText}
          items={heroItems}
          price={(p) => priceLabel(p, lang)}
          onOpen={(id) => setQuick(id)}
          onCta={toCatalog}
          eyebrow={heroEyebrow}
          secondary={heroWhatsApp('bl-cta-2')}
        />
      ) : store.theme === 'bistro' ? (
        <BistroHero
          title={heroTitle}
          subtitle={heroSubtitle}
          cta={heroCtaText}
          items={heroItems}
          price={(p) => priceLabel(p, lang)}
          onOpen={(id) => setQuick(id)}
          onCta={toCatalog}
          eyebrow={heroEyebrow}
          secondary={heroWhatsApp('bi-cta-2')}
        />
      ) : store.theme === 'atelier' ? (
        <AtelierRail
          title={heroTitle}
          subtitle={heroSubtitle}
          cta={heroCtaText}
          items={heroItems}
          price={(p) => priceLabel(p, lang)}
          hint={t('storefront.atelier.hint')}
          touchHint={t('storefront.atelier.touchHint')}
          onOpen={(id) => setQuick(id)}
          onCta={toCatalog}
          eyebrow={openNow ? <span className={openNow.open ? 'sf-open is-open' : 'sf-open'}>{openText}</span> : null}
          secondary={
            waDigits ? (
              <a className="at-cta-2" href={`https://wa.me/${waDigits}`} target="_blank" rel="noopener noreferrer">
                <IconWhatsApp />
                {t('storefront.whatsapp')}
              </a>
            ) : null
          }
        />
      ) : store.theme === 'perfume' ? (
        <PerfumeHero
          title={heroTitle}
          subtitle={heroSubtitle}
          cta={heroCtaText}
          imageUrl={heroImage}
          cutout={!store.heroImageUrl && !!pickedHero[0]?.cutoutUrl}
          eyebrow={openNow ? <span className={openNow.open ? 'sf-open is-open' : 'sf-open'}>{openText}</span> : null}
          onCta={toCatalog}
          secondary={
            waDigits ? (
              <a className="pf-cta-2" href={`https://wa.me/${waDigits}`} target="_blank" rel="noopener noreferrer">
                <IconWhatsApp />
                {t('storefront.whatsapp')}
              </a>
            ) : null
          }
        />
      ) : (
        classicHero
      )}

      {toSections(store.sections).map((k) => (
        <Fragment key={k}>{sectionViews[k]}</Fragment>
      ))}

      {trackOpen && (
        <StorefrontTrackOrder
          slug={slug}
          t={t}
          lang={lang}
          initialRef={trackRef}
          onClose={() => setTrackOpen(false)}
        />
      )}

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

      {toastView}
      {!overlay && bottomNav}

      {quickProduct && (
        <StorefrontQuickView
          key={quickProduct.groupId ?? quickProduct.id}
          variants={quickProduct.groupId ? (collapsed.siblings.get(quickProduct.groupId) ?? []) : []}
          onVariant={(id) => setQuick(id)}
          slug={slug}
          lang={lang}
          product={quickProduct}
          related={related}
          t={t}
          priceOf={(x) => priceLabel(x, lang)}
          qty={cart[quickProduct.id] ?? 0}
          maxQty={ORDER_MAX_QTY}
          onAdd={() => {
            const first = (cart[quickProduct.id] ?? 0) === 0;
            addQty(quickProduct.id, 1);
            if (first) flyToCart(document.querySelector('.sf-qv-stage'), quickProduct.imageUrl);
          }}
          onLess={() => addQty(quickProduct.id, -1)}
          size={sizes[quickProduct.id] ?? ''}
          onSize={(s) => setSizes((m) => ({ ...m, [quickProduct.id]: s }))}
          wished={wish.includes(quickProduct.id)}
          onWish={() => toggleWish(quickProduct.id)}
          onClose={() => setQuick(null)}
          onPick={(x) => setQuick(x.id)}
          shareUrl={`${window.location.origin}/s/${slug}?p=${encodeURIComponent(quickProduct.id)}`}
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
                  {freebar}
                  {minShort > 0 && (
                    <p className="sf-min-note">
                      {t('storefront.zone.minShort', { min: formatUsd(store.minOrderUsdCents ?? 0), amount: formatUsd(minShort) })}
                    </p>
                  )}
                  <div className="sf-total">
                    <span>{t('storefront.subtotal')}</span>
                    <strong>{subtotal}</strong>
                  </div>
                  <button type="button" className="sf-primary" onClick={() => {
                      setStep('details');
                      trackStoreEvent(slug, 'checkout');
                    }}>
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
                    {whishOn && (
                      <>
                        <h3>{t('storefront.pay.title')}</h3>
                        <div className="sf-seg" role="radiogroup" aria-label={t('storefront.pay.title')}>
                          {(['cod', 'whish'] as const).map((m) => (
                            <label key={m}>
                              <input type="radio" name="sf-payment" value={m} checked={payMethod === m} onChange={() => setPayMethod(m)} />
                              <span>{t(m === 'cod' ? (fulfillment === 'delivery' ? 'storefront.pay.cod' : 'storefront.pay.atPickup') : 'storefront.pay.whish')}</span>
                            </label>
                          ))}
                        </div>
                        {payMethod === 'whish' && <p className="sf-min-note">{t('storefront.pay.whishHint')}</p>}
                      </>
                    )}
                    {fulfillment === 'delivery' && hasZones && (
                      <label className="sf-field">
                        {t('storefront.zone.label')}
                        <select className="sf-select" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                          <option value="">{t('storefront.zone.choose')}</option>
                          {store.deliveryZones.map((z) => (
                            <option key={z.id} value={z.id}>
                              {z.name} — {z.feeUsdCents > 0 ? formatUsd(z.feeUsdCents) : t('storefront.zone.free')}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
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
                  {fulfillment === 'delivery' && hasZones && (
                    <div className="sf-sum">
                      <span>{t('storefront.subtotal')}</span>
                      <span>{subtotal}</span>
                      <span>{delivery?.zone ? t('storefront.zone.feeLine', { zone: delivery.zone.name }) : t('storefront.zone.feeTbd')}</span>
                      <span>{delivery?.zone ? (deliveryFee > 0 ? formatUsd(deliveryFee) : t('storefront.zone.free')) : '—'}</span>
                    </div>
                  )}
                  <div className="sf-total">
                    <span>{fulfillment === 'delivery' && hasZones ? t('storefront.total') : t('storefront.subtotal')}</span>
                    <strong>{fulfillment === 'delivery' && hasZones ? grandTotal : subtotal}</strong>
                  </div>
                  <button
                    type="button"
                    className="sf-primary"
                    onClick={() => void submit()}
                    disabled={place.busy || lines.length === 0}
                  >
                    {place.busy ? t('storefront.placing') : t('storefront.placeOrder')}
                  </button>
                  {/* Ordering over WhatsApp is a cash order; with Whish chosen the guest pays on Whish instead. */}
                  {waDigits && !(whishOn && payMethod === 'whish') && (
                    <button
                      type="button"
                      className="sf-wa-order"
                      onClick={() => void submit(true)}
                      disabled={place.busy || lines.length === 0}
                    >
                      <IconWhatsApp />
                      {t('storefront.wa.order')}
                    </button>
                  )}
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
