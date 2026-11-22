import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { compareValues } from '@/domain/variants';
import { tierUsdCents } from '@/domain/pricing';
import { useI18n } from '@/i18n/i18n';
import { toUserMessage } from '@/services/errors';
import { listGroupOptions } from '@/services/productService';
import type { PriceTier, Product } from '@/types/models';
import { formatUsd } from '@/utils/format';

const valuesOf = (p: Product) => (p.options ?? []).map((o) => o.value);

function byOptions(a: Product, b: Product): number {
  const x = valuesOf(a);
  const y = valuesOf(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const c = compareValues(x[i] ?? '', y[i] ?? '') || (x[i] ?? '').localeCompare(y[i] ?? '');
    if (c) return c;
  }
  return 0;
}

/** Cashier picks the size/colour of an item; sold-out options stay visible but cannot be picked. */
export function OptionPickModal({
  tenantId,
  item,
  tier,
  rate,
  onPick,
  onClose,
}: {
  tenantId: string;
  item: Product;
  tier: PriceTier;
  rate: number;
  onPick: (option: Product) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [options, setOptions] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listGroupOptions(tenantId, item.groupId ?? '')
      .then((list) => live && setOptions(list.filter((p) => p.status !== 'archived').sort(byOptions)))
      .catch((e: unknown) => {
        if (!live) return;
        const m = toUserMessage(e);
        setError(t(m.key, m.params));
      });
    return () => {
      live = false;
    };
    // t only formats the message; the options are read once per item.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, item.groupId]);

  return (
    <Modal open title={t('pos.pickOption', { name: item.groupName || item.name })} onClose={onClose}>
      {error ? (
        <p className="field__error">{error}</p>
      ) : !options ? (
        <PageLoader />
      ) : (
        <div className="option-pick">
          {options.map((p, i) => {
            const out = p.stock <= 0;
            return (
              <button
                key={p.id}
                type="button"
                className="option-pick__btn"
                disabled={out}
                autoFocus={i === options.findIndex((o) => o.stock > 0)}
                onClick={() => {
                  onPick(p);
                  onClose();
                }}
              >
                <b>
                  <bdi>{valuesOf(p).join(' / ') || p.name}</bdi>
                </b>
                <span>{formatUsd(tierUsdCents(p, tier, rate))}</span>
                <small>{out ? t('products.outOfStock') : t('products.stockCount', { count: p.stock })}</small>
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
