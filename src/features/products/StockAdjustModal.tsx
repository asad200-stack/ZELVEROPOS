import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox, FormGrid, MoneyInput, SelectInput, TextArea, TextInput } from '@/components/ui/Form';
import { Alert } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { useFeedback } from '@/contexts/feedback';
import { useTenant } from '@/contexts/session';
import { weightedAverageCost } from '@/domain/inventory';
import { parseUsdInput } from '@/domain/money';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useI18n } from '@/i18n/i18n';
import { adjustStock } from '@/services/productService';
import type { Product } from '@/types/models';
import { formatUsd } from '@/utils/format';

export function StockAdjustModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { t } = useI18n();
  const { actor, can } = useTenant();
  const { notify } = useFeedback();
  const { busy, run } = useAsyncAction('stock-adjust');
  const [mode, setMode] = useState<'add' | 'remove' | 'set'>('add');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [payFromCashbox, setPayFromCashbox] = useState(false);
  const [imeisToAdd, setImeisToAdd] = useState('');
  const [imeisToRemove, setImeisToRemove] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const canSeeCost = can('canViewCosts');
  const canPay = can('canManageCashDrawer');

  const qty = Math.floor(Number(quantity) || 0);
  const cost = unitCost.trim() ? parseUsdInput(unitCost) : null;
  const addQty = product.imeiTracking ? imeisToAdd.split(/[\s,;]+/).filter(Boolean).length : mode === 'add' ? qty : 0;
  const newAvg = cost !== null && addQty > 0 ? weightedAverageCost(product.stock, product.costUsdCents, addQty, cost) : null;

  const submit = () =>
    run(async () => {
      await adjustStock(actor, {
        productId: product.id,
        mode,
        quantity: qty,
        unitCostUsdCents: canSeeCost && addQty > 0 ? cost : null,
        payFromCashbox: canPay && payFromCashbox,
        imeisToAdd: imeisToAdd.split(/[\s,;]+/).filter(Boolean),
        imeisToRemove,
        note,
      });
      notify('success', t('products.stockUpdated'));
      onClose();
    });

  const available = product.imeis.filter((e) => e.status === 'available');

  return (
    <Modal
      open
      title={t('products.adjustStockFor', { name: product.name })}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="muted">{t('products.currentStock', { count: product.stock })}</p>
        {product.imeiTracking ? (
          <>
            <TextArea label={t('products.imeisToAdd')} rows={3} value={imeisToAdd} onChange={(e) => setImeisToAdd(e.target.value)} placeholder={t('products.imeiListHint')} />
            {available.length > 0 && (
              <div className="field">
                <span className="field__label">{t('products.imeisToRemove')}</span>
                <div className="checkbox-grid">
                  {available.map((e) => (
                    <Checkbox
                      key={e.imei}
                      label={e.imei}
                      checked={imeisToRemove.includes(e.imei)}
                      onChange={(ev) => setImeisToRemove((list) => (ev.target.checked ? [...list, e.imei] : list.filter((x) => x !== e.imei)))}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <FormGrid>
            <SelectInput
              label={t('products.adjustMode')}
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
              options={[
                { value: 'add', label: t('products.modeAdd') },
                { value: 'remove', label: t('products.modeRemove') },
                { value: 'set', label: t('products.modeSet') },
              ]}
            />
            <TextInput label={t('pos.qty')} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus />
          </FormGrid>
        )}
        {canSeeCost && addQty > 0 && (
          <>
            <MoneyInput label={t('products.unitCostOfAdded')} value={unitCost} onChange={(e) => setUnitCost(e.target.value)} hint={t('products.weightedHint')} />
            {newAvg !== null && (
              <Alert tone="info">
                {t('products.newAverageCost', { from: formatUsd(product.costUsdCents), to: formatUsd(newAvg) })}
              </Alert>
            )}
            {canPay && cost !== null && cost > 0 && (
              <Checkbox
                label={t('products.payFromCashbox', { amount: formatUsd(cost * addQty) })}
                checked={payFromCashbox}
                onChange={(e) => setPayFromCashbox(e.target.checked)}
              />
            )}
          </>
        )}
        <TextInput label={t('common.note')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </div>
    </Modal>
  );
}
