import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useI18n } from '@/i18n/i18n';
import { FitAmount } from './FitAmount';
import { ProductTile } from './ProductTile';
import { POS_UI_ID } from './posUi';

const PREVIEW_CART_KEY = 'zelvero.preview.posCart';

const FIXTURES = [
  { id: 'oil', name: 'زيت زيتون بكر ممتاز عبوة كبيرة ٥ لتر', usd: '$1.25', lbp: '111,875 LBP', stock: '40', tone: 'ok' as const },
  { id: 'phone', name: 'Samsung Galaxy A55 5G 256GB', usd: '$1,299.99', lbp: '116,349,105 LBP', stock: '3', tone: 'low' as const },
  { id: 'charger', name: 'شاحن سريع USB-C Fast Charger 65W', usd: '$24.50', lbp: '2,192,750 LBP', stock: '0', tone: 'out' as const },
  { id: 'water', name: 'Mineral Water 500ml × 24 pack', usd: '$5.75', lbp: '514,625 LBP', stock: '15', tone: 'ok' as const },
  { id: 'rice', name: 'أرز بسمتي هندي فاخر ١٠ كغ', usd: '$18.99', lbp: '1,699,605 LBP', stock: '25', tone: 'ok' as const },
  { id: 'bread', name: 'Bread', usd: '$1.00', lbp: '89,500 LBP', stock: '30', tone: 'ok' as const },
];

function readCart(): string[] {
  try {
    const raw = sessionStorage.getItem(PREVIEW_CART_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Local preview of the canonical POS card and cart. It does not connect to Firebase,
 * does not read the production cart, and is not registered in production builds.
 */
export function PosPreviewPage() {
  const { t, lang, setLang } = useI18n();
  const [cart, setCart] = useState<string[]>(readCart);
  useEffect(() => {
    sessionStorage.setItem(PREVIEW_CART_KEY, JSON.stringify(cart));
  }, [cart]);

  const add = (id: string) => setCart((prev) => (prev.includes(id) ? prev : [...prev, id]));

  return (
    <div className="preview-shell">
      <div className="preview-banner" data-testid="preview-banner" data-pos-ui={POS_UI_ID}>
        <strong>{t('preview.banner')}</strong>
        <span>{t('preview.build', { id: `${POS_UI_ID} · ${import.meta.env.MODE}` })}</span>
        <button type="button" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
          {lang === 'ar' ? 'EN' : 'ع'}
        </button>
      </div>
      <div className="pos">
        <section className="pos__products">
          <div className="picker">
            <div className="picker__grid" data-testid="preview-grid">
              {FIXTURES.map((item) => (
                <ProductTile
                  key={item.id}
                  name={item.name}
                  imageUrl={null}
                  usd={item.usd}
                  lbp={item.lbp}
                  stockLabel={item.tone === 'out' ? t('products.outOfStock') : t('products.stockCount', { count: Number(item.stock) })}
                  tone={item.tone}
                  disabled={item.tone === 'out'}
                  onPick={() => add(item.id)}
                />
              ))}
            </div>
          </div>
        </section>
        <section className="pos__cart">
          <div className="pos__lines">
            <div className="cart-lines">
              {cart.map((id) => {
                const item = FIXTURES.find((row) => row.id === id);
                if (!item) return null;
                return (
                  <div key={id} className="cart-line" data-testid="preview-cart-line">
                    <div className="cart-line__identity">
                      <span className="cart-line__img cart-line__img--empty">
                        <Icon name="package" size={16} />
                      </span>
                      <div className="cart-line__info">
                        <div className="cart-line__name" title={item.name}>{item.name}</div>
                        <div className="cart-line__unit">
                          <FitAmount value={item.usd} className="fit-amount--unit" />
                        </div>
                      </div>
                    </div>
                    <div className="cart-line__controls">
                      <div className="cart-line__qty">
                        <div className="qty">
                          <button type="button" disabled aria-label="-">−</button>
                          <span>1</span>
                          <button type="button" disabled aria-label="+">+</button>
                        </div>
                      </div>
                      <div className="cart-line__total">
                        <FitAmount value={item.usd} className="fit-amount--line" />
                        <FitAmount value={item.lbp} className="fit-amount--muted" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
