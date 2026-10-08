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
  onChange: (fn: (cart: Cart) => Cart) => void;
}

export function CartPanel({ totals, products, canEditPrice, onChange }: Props) {
  const { t, lang } = useI18n();
  const [editing, setEditing] = useState<PricedLine | null>(null);

  const setQty = (key: string, qty: number) =>
    onChange((c) => ({
      ...c,
      lines: c.lines.map((l) => (l.key === key ? { ...l, quantity: Math.max(1, Math.min(99_999, Math.floor(qty) || 1)) } : l)),
    }));
  const remove = (key: string) => onChange((c) => ({ ...c, lines: c.lines.filter((l) => l.key !== key) }));

  if (totals.lines.length === 0 && !totals.debtLineUsdCents) {
    return <EmptyState icon="cart" title={t('pos.cartEmpty')} message={t('pos.cartEmptyHint')} />;
  }

  return (
    <div className="cart-lines">
      {totals.lines.map((line) => {
        const product = products.get(line.productId);
        const overStock = !line.imei && product && line.quantity > product.stock;
        return (
          <div key={line.key} className={line.missing ? 'cart-line cart-line--error' : 'cart-line'}>
            {product?.imageUrl ? (
              <img className="cart-line__img" src={product.imageUrl} alt="" />
            ) : (
              <span className="cart-line__img cart-line__img--empty">
                <Icon name="package" size={16} />
              </span>
            )}
            <div className="cart-line__info">
              <div className="cart-line__name">{line.name}</div>
              <div className="cart-line__meta">
                {line.imei && <span className="cart-line__imei">IMEI {line.imei}</span>}
                <FitAmount value={formatUsd(line.unitUsdCents)} />
                <FitAmount value={formatLbp(line.unitLbp, lang)} className="fit-amount--muted" />
                {line.discountUsdCents > 0 && <span className="text-success">−{formatUsd(line.discountUsdCents)}</span>}
                {line.customUsdCents !== null && line.discountUsdCents === 0 && <span className="text-warning">*</span>}
                {overStock && <span className="text-danger">{t('pos.overStock', { stock: product.stock })}</span>}
                {line.missing && <span className="text-danger">{t('pos.productRemoved')}</span>}
              </div>
            </div>
            <div className="qty">
              <button type="button" onClick={() => setQty(line.key, line.quantity - 1)} disabled={!!line.imei || line.quantity <= 1} aria-label="-">
                <Icon name="minus" size={14} />
              </button>
              <input
                className="qty__input"
                dir="ltr"
                inputMode="numeric"
                value={line.quantity}
                disabled={!!line.imei}
                onChange={(e) => setQty(line.key, Number(e.target.value))}
                aria-label={t('pos.qty')}
              />
              <button type="button" onClick={() => setQty(line.key, line.quantity + 1)} disabled={!!line.imei} aria-label="+">
                <Icon name="plus" size={14} />
              </button>
            </div>
            <div className="cart-line__total">
              <FitAmount value={formatUsd(line.lineUsdCents)} />
              <FitAmount value={formatLbp(line.lineLbp, lang)} className="fit-amount--muted" />
            </div>
            <div className="cart-line__actions">
              {canEditPrice && !line.missing && <Button variant="ghost" size="sm" icon="tag" onClick={() => setEditing(line)} aria-label={t('pos.editPrice')} />}
              <Button variant="ghost" size="sm" icon="trash" onClick={() => remove(line.key)} aria-label={t('common.remove')} />
            </div>
          </div>
        );
      })}
      {totals.debtLineUsdCents > 0 && (
        <div className="cart-line cart-line--debt">
          <div className="cart-line__info">
            <div className="cart-line__name">{t('pos.previousBalance')}</div>
          </div>
          <div className="cart-line__total">
            <FitAmount value={formatUsd(totals.debtLineUsdCents)} />
            <FitAmount value={formatLbp(totals.debtLineLbp, lang)} className="fit-amount--muted" />
          </div>
          <div className="cart-line__actions">
            <Button variant="ghost" size="sm" icon="trash" onClick={() => onChange((c) => ({ ...c, debtLineUsdCents: null }))} aria-label={t('common.remove')} />
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
        <MoneyInput label={t('pos.unitPriceUsd')} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      </form>
    </Modal>
  );
}
