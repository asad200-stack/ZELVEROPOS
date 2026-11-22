import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { MAX_OPTION_AXES, MAX_VARIANTS, OPTION_PRESET_KEYS, comboKey } from '@/domain/variants';
import { useI18n } from '@/i18n/i18n';
import {
  EMPTY_ROW,
  addValues,
  draftCombos,
  newAxis,
  selectAll,
  toggleValue,
  totalStock,
  withPreset,
  type AxisDraft,
  type RowDraft,
  type VariantDraft,
} from './variantDraft';

interface Props {
  draft: VariantDraft;
  /** Receives an update of the latest draft, so quick taps in a row never undo each other. */
  onChange: (update: (current: VariantDraft) => VariantDraft) => void;
  error: string | null;
}

/** One kind of option: its name, a ready-made list, value chips to tick, and a box to type more. */
function AxisEditor({ axis, onAxis, onRemove }: { axis: AxisDraft; onAxis: (update: (a: AxisDraft) => AxisDraft) => void; onRemove?: () => void }) {
  const { t } = useI18n();
  const [typed, setTyped] = useState('');
  const all = axis.values.length > 0 && axis.on.length === axis.values.length;
  const add = () => {
    if (!typed.trim()) return;
    const text = typed;
    onAxis((a) => addValues(a, text));
    setTyped('');
  };
  return (
    <fieldset className="vb-axis">
      <div className="vb-axis-head">
        <input
          className="input vb-axis-name"
          value={axis.name}
          maxLength={30}
          aria-label={t('products.variants.axisName')}
          placeholder={t('products.variants.axisName')}
          onChange={(e) => {
            const name = e.target.value;
            onAxis((a) => ({ ...a, name }));
          }}
        />
        <div className="vb-presets" role="radiogroup" aria-label={t('products.variants.preset')}>
          {OPTION_PRESET_KEYS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={axis.preset === k} className="vb-preset" onClick={() => onAxis((a) => withPreset(a, k))}>
              {t(`products.variants.preset.${k}`)}
            </button>
          ))}
        </div>
        {onRemove && (
          <Button variant="ghost" size="sm" onClick={onRemove}>
            {t('common.remove')}
          </Button>
        )}
      </div>
      {axis.values.length > 0 && (
        <div className="vb-values">
          <button type="button" className="vb-all" aria-pressed={all} onClick={() => onAxis((a) => selectAll(a, !all))}>
            {all ? t('products.variants.none') : t('products.variants.all')}
          </button>
          {axis.values.map((v) => (
            <button key={v} type="button" className="vb-chip" aria-pressed={axis.on.includes(v)} onClick={() => onAxis((a) => toggleValue(a, v))}>
              {v}
            </button>
          ))}
        </div>
      )}
      <div className="vb-add">
        <input
          className="input"
          value={typed}
          maxLength={200}
          placeholder={t(axis.preset === 'colors' ? 'products.variants.addColors' : 'products.variants.addValues')}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              add();
            }
          }}
        />
        <Button variant="secondary" size="sm" onClick={add} disabled={!typed.trim()}>
          {t('products.variants.add')}
        </Button>
      </div>
    </fieldset>
  );
}

/**
 * Builds an item sold in sizes/colours: the owner ticks the sizes (or taps "All") and types the
 * quantity of each one, so medium can have 10 and small 1.
 */
export function VariantBuilder({ draft, onChange, error }: Props) {
  const { t } = useI18n();
  const [same, setSame] = useState('');
  const combos = draftCombos(draft);
  const setAxis = (i: number, update: (a: AxisDraft) => AxisDraft) =>
    onChange((d) => ({ ...d, axes: d.axes.map((x, k) => (k === i ? update(x) : x)) }));
  const setRow = (key: string, patch: Partial<RowDraft>) =>
    onChange((d) => ({ ...d, rows: { ...d.rows, [key]: { ...(d.rows[key] ?? EMPTY_ROW), ...patch } } }));
  const fillAll = () => {
    const qty = same.trim();
    if (!/^\d{1,7}$/.test(qty)) return;
    onChange((d) => {
      const rows = { ...d.rows };
      for (const values of draftCombos(d)) {
        const key = comboKey(values);
        rows[key] = { ...(rows[key] ?? EMPTY_ROW), stock: qty };
      }
      return { ...d, rows };
    });
  };

  return (
    <section className="vb" aria-label={t('products.variants.title')}>
      {draft.axes.map((axis, i) => (
        <AxisEditor
          key={i}
          axis={axis}
          onAxis={(update) => setAxis(i, update)}
          onRemove={i > 0 ? () => onChange((d) => ({ ...d, axes: d.axes.filter((_, k) => k !== i) })) : undefined}
        />
      ))}
      {draft.axes.length < MAX_OPTION_AXES && (
        <Button
          variant="secondary"
          size="sm"
          icon="plus"
          onClick={() => onChange((d) => (d.axes.length >= MAX_OPTION_AXES ? d : { ...d, axes: [...d.axes, newAxis(t('products.variants.colorName'), 'colors')] }))}
        >
          {t('products.variants.addAxis')}
        </Button>
      )}

      {combos.length > 0 && (
        <>
          <div className="vb-same">
            <span>{t('products.variants.sameQty')}</span>
            <input className="input" inputMode="numeric" dir="ltr" value={same} onChange={(e) => setSame(e.target.value)} aria-label={t('products.variants.sameQty')} />
            <Button variant="secondary" size="sm" onClick={fillAll} disabled={!/^\d{1,7}$/.test(same.trim())}>
              {t('products.variants.apply')}
            </Button>
          </div>
          <div className="vb-table-wrap">
            <table className="vb-table">
              <thead>
                <tr>
                  <th>{t('products.variants.option')}</th>
                  <th>{t('products.variants.qty')}</th>
                  <th>{t('products.variants.price')}</th>
                  <th>{t('products.barcode')}</th>
                </tr>
              </thead>
              <tbody>
                {combos.map((values) => {
                  const key = comboKey(values);
                  const row = draft.rows[key] ?? EMPTY_ROW;
                  const label = values.join(' / ');
                  return (
                    <tr key={key}>
                      <th scope="row">{label}</th>
                      <td>
                        <input
                          className="input"
                          inputMode="numeric"
                          dir="ltr"
                          placeholder="0"
                          aria-label={t('products.variants.qtyOf', { option: label })}
                          value={row.stock}
                          onChange={(e) => setRow(key, { stock: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          inputMode="decimal"
                          dir="ltr"
                          placeholder={t('products.variants.samePrice')}
                          aria-label={t('products.variants.priceOf', { option: label })}
                          value={row.price}
                          onChange={(e) => setRow(key, { price: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          dir="ltr"
                          maxLength={100}
                          aria-label={t('products.variants.barcodeOf', { option: label })}
                          value={row.barcode}
                          onChange={(e) => setRow(key, { barcode: e.target.value })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className={combos.length > MAX_VARIANTS ? 'field__error' : 'field__hint'}>
            {combos.length > MAX_VARIANTS
              ? t('products.variants.errTooMany', { max: MAX_VARIANTS })
              : t('products.variants.summary', { options: combos.length, pieces: totalStock(draft) })}
          </p>
        </>
      )}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
