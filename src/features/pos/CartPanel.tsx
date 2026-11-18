import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { MoneyInput } from '@/components/ui/Form';
import type { Cart, CartTotals, PricedLine } from '@/domain/cart';
import { centsToInput, parseUsdInput } from '@/domain/money';
import { useI18n } from '@/i18n/i18n';
import type { Product } from '@/types/models';
import { formatLbp, formatUsd } from '@/utils/format';
import { FitAmount } from './FitAmount';

interface Props {
  cart: Cart;
  totals: CartTotals;
  products: Map<string, Product>;
  canEditPrice: boolean;
  customerName?: string;
  onChange: (fn: (cart: Cart) => Cart) => void;
  onRemovePrevious?: () => void;
}

export function CartPanel({ totals, products, canEditPrice, customerName, onChange, onRemovePrevious }: Props) {
  const { t, lang } = useI18n();
  const [editing, setEditing] = useState<PricedLine | null>(null);

  const setQty = (key: string, qty: number, max = 99_999) =>
    onChange((c) => ({
      ...c,
      lines: c.lines.map((l) => (l.key === key ? { ...l, quantity: Math.max(1, Math.min(max, Math.floor(qty) || 1)) } : l)),
    }));
  const remove = (key: string) => onChange((c) => ({ ...c, lines: c.lines.filter((l) => l.key !== key) }));

  const hasPrevious = totals.debtLineUsdCents > 0;
  if (totals.lines.length === 0 && !hasPrevious) {
    return <EmptyState icon="cart" title={t('pos.cartEmpty')} message={t('pos.cartEmptyHint')} />;
  }

  return (
    <div className="cart-lines">
      {totals.lines.map((line) => {
        const product = products.get(line.productId);
        const overStock = !line.imei && product && line.quantity > product.stock;
        const maxQty = !line.imei && product ? Math.max(1, product.stock) : 99_999;
        return (
          <div key={line.key} className={line.missing ? 'cart-line cart-line--error' : 'cart-line'}>
            <div className="cart-line__identity">
              {product?.imageUrl ? (
                <img className="cart-line__img" src={product.imageUrl} alt="" />
              ) : (
                <span className="cart-line__img cart-line__img--empty">
                  <Icon name="package" size={16} />
                </span>
              )}
              <div className="cart-line__info">
                <div className="cart-line__name" title={line.name}>{line.name}</div>
                <div className="cart-line__unit">
                  <FitAmount value={formatUsd(line.unitUsdCents)} className="fit-amount--unit" />
                </div>
                <div className="cart-line__meta">
                  {line.imei && <span className="cart-line__imei">IMEI {line.imei}</span>}
                  {line.discountUsdCents > 0 && <span className="text-success">−{formatUsd(line.discountUsdCents)}</span>}
                  {line.customUsdCents === 0 && <span className="cart-line__free-badge">{t('pos.free')}</span>}
                  {line.customUsdCents !== null && line.customUsdCents !== 0 && line.discountUsdCents === 0 && <span className="text-warning">*</span>}
                  {overStock && <span className="text-danger">{t('pos.overStock', { stock: product.stock })}</span>}
                  {line.missing && <span className="text-danger">{t('pos.productRemoved')}</span>}
                </div>
              </div>
            </div>
            <div className="cart-line__controls">
              <div className="cart-line__qty">
                <div className="qty">
                  <button type="button" onClick={() => setQty(line.key, line.quantity - 1, maxQty)} disabled={!!line.imei || line.quantity <= 1} aria-label="-">
                    <Icon name="minus" size={14} />
                  </button>
                  <input
                    className="qty__input"
                    dir="ltr"
                    inputMode="numeric"
                    value={line.quantity}
                    disabled={!!line.imei}
                    onChange={(e) => setQty(line.key, Number(e.target.value), maxQty)}
                    aria-label={t('pos.qty')}
                  />
                  <button
                    type="button"
                    onClick={() => setQty(line.key, line.quantity + 1, maxQty)}
                    disabled={!!line.imei || line.quantity >= maxQty}
                    aria-label="+"
                  >
                    <Icon name="plus" size={14} />
                  </button>
                </div>
              </div>
              <div className="cart-line__total">
                <FitAmount value={formatUsd(line.lineUsdCents)} className="fit-amount--line" />
                <FitAmount value={formatLbp(line.lineLbp, lang)} className="fit-amount--muted" />
              </div>
              <div className="cart-line__actions">
                {canEditPrice && !line.missing && <Button variant="ghost" size="sm" icon="tag" onClick={() => setEditing(line)} aria-label={t('pos.editPrice')} />}
                <Button variant="ghost" size="sm" icon="trash" onClick={() => remove(line.key)} aria-label={t('common.remove')} />
              </div>
            </div>
          </div>
        );
      })}
      {hasPrevious && (
        <div className="cart-line cart-line--debt">
          <div className="cart-line__identity">
            <span className="cart-line__img cart-line__img--debt">
              <Icon name="history" size={16} />
            </span>
            <div className="cart-line__info">
              <div className="cart-line__name">{t('pos.previousBalance')}</div>
              {customerName && <div className="cart-line__meta">{t('pos.previousCustomer', { name: customerName })}</div>}
              <div className="cart-line__meta">{t('pos.debtPayment')}</div>
            </div>
          </div>
          <div className="cart-line__controls">
            <div className="cart-line__total">
              <FitAmount value={formatUsd(totals.debtLineUsdCents)} className="fit-amount--line" />
              <FitAmount value={formatLbp(totals.debtLineLbp, lang)} className="fit-amount--muted" />
            </div>
            <div className="cart-line__actions">
              <Button variant="ghost" size="sm" icon="x" onClick={onRemovePrevious} aria-label={t('pos.removePrevious')} />
            </div>
          </div>
        </div>
      )}
      {editing && (
        <LinePriceModal
          line={editing}
          onClose={() => setEditing(null)}
          onSave={(cents) => {
            onChange((c) => ({
              ...c,
              lines: c.lines.map((l) => (l.key === editing.key ? { ...l, customUsdCents: cents === editing.originalUnitUsdCents ? null : cents } : l)),
            }));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function LinePriceModal({ line, onClose, onSave }: { line: PricedLine; onClose: () => void; onSave: (cents: number) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(centsToInput(line.unitUsdCents));
  const cents = parseUsdInput(value);
  return (
    <Modal
      open
      size="sm"
      title={t('pos.editPrice')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={() => onSave(line.originalUnitUsdCents)}>
            {t('pos.resetPrice')}
          </Button>
          <Button variant="secondary" onClick={() => onSave(0)}>
            {t('pos.markFree')}
          </Button>
          <Button disabled={cents === null} onClick={() => cents !== null && onSave(cents)}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <p className="muted small">
        {line.name} · {t('pos.listPrice')}: {formatUsd(line.originalUnitUsdCents)}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (cents !== null) onSave(cents);
        }}
      >
        <MoneyInput currency="usd" label={t('pos.unitPriceUsd')} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      </form>
    </Modal>
  );
}
