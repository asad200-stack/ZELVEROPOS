import { Icon } from '@/components/ui/Icon';
import { FitAmount } from './FitAmount';
import { POS_UI_ID } from './posUi';

export function ProductTile({
  name,
  imageUrl,
  usd,
  lbp,
  stockLabel,
  tone,
  disabled,
  onPick,
}: {
  name: string;
  imageUrl: string | null;
  usd: string;
  lbp: string;
  stockLabel: string;
  tone: 'ok' | 'low' | 'out';
  disabled: boolean;
  onPick: () => void;
}) {
  const stockClass =
    tone === 'out' ? 'product-tile__stock product-tile__stock--out' : tone === 'low' ? 'product-tile__stock product-tile__stock--low' : 'product-tile__stock';
  return (
    <button type="button" className="product-tile" data-pos-ui={POS_UI_ID} onClick={onPick} disabled={disabled}>
      <span className="product-tile__media">
        {imageUrl ? (
          <img className="product-tile__img" src={imageUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="product-tile__img product-tile__img--empty">
            <Icon name="package" size={22} />
          </span>
        )}
      </span>
      <span className="product-tile__name" title={name}>
        {name}
      </span>
      <span className="product-tile__usd">
        <FitAmount value={usd} />
      </span>
      <span className="product-tile__lbp">
        <FitAmount value={lbp} className="fit-amount--muted" />
      </span>
      <span className={stockClass}>{stockLabel}</span>
    </button>
  );
}
