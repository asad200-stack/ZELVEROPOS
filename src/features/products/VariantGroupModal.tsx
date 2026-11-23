import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import { useTenant } from '@/contexts/session';
import { OPTION_PRESETS, OPTION_PRESET_KEYS, axesOf, cleanValues, comboKey, compareValues, photoAxisIndex, samePhotoLook, type OptionAxis } from '@/domain/variants';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useI18n } from '@/i18n/i18n';
import { newClientOperationId } from '@/services/clientOperation';
import { toUserMessage } from '@/services/errors';
import { addProductOptions, adjustStock, listGroupOptions, setOptionsPhoto } from '@/services/productService';
import { prepareImage, uploadPreparedImage } from '@/services/storageService';
import type { Product } from '@/types/models';
import { formatUsd } from '@/utils/format';
import { VariantBuilder } from './VariantBuilder';
import { readDraft, type AxisDraft, type VariantDraft } from './variantDraft';

const valuesOf = (p: Product) => (p.options ?? []).map((o) => o.value);

/** Sorts options size by size, then colour by colour. */
function byOptions(a: Product, b: Product): number {
  const x = valuesOf(a);
  const y = valuesOf(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const c = compareValues(x[i] ?? '', y[i] ?? '') || (x[i] ?? '').localeCompare(y[i] ?? '');
    if (c) return c;
  }
  return 0;
}

/** An option kind as the builder starts it: its values ticked, plus the rest of its size list to pick from. */
function withKnownSizes(axis: OptionAxis): AxisDraft {
  const preset = OPTION_PRESET_KEYS.find((k) => {
    const list: readonly string[] = OPTION_PRESETS[k];
    return list.length > 0 && axis.values.every((v) => list.includes(v.toUpperCase()));
  });
  const values = preset ? cleanValues([...OPTION_PRESETS[preset], ...axis.values]).sort(compareValues) : axis.values;
  return { name: axis.name, preset: preset ?? 'custom', values, on: values.filter((v) => axis.values.includes(v)) };
}

interface Look {
  key: string;
  /** The colour (or other non-size value), '' when the item only comes in sizes. */
  label: string;
  options: Product[];
  imageUrl: string | null;
}

/** Options grouped by what they look like: one photo per colour, or one for all sizes. */
function looksOf(options: readonly Product[]): Look[] {
  const live = options.filter((p) => p.status !== 'archived');
  const axis = photoAxisIndex(axesOf(live));
  const out: Look[] = [];
  for (const p of live) {
    const vals = valuesOf(p);
    const hit = out.find((l) => samePhotoLook(valuesOf(l.options[0]!), vals, axis));
    if (hit) {
      hit.options.push(p);
      hit.imageUrl ??= p.imageUrl;
    } else {
      out.push({ key: axis < 0 ? '*' : (vals[axis] ?? '').toLowerCase(), label: axis < 0 ? '' : (vals[axis] ?? ''), options: [p], imageUrl: p.imageUrl });
    }
  }
  return out;
}

/** One photo per colour: every size of that colour shows it, on the store and at the till. */
function LookPhotos({ options, onChanged }: { options: Product[]; onChanged: (next: Product[]) => void }) {
  const { t } = useI18n();
  const { tenantId, actor } = useTenant();
  const { notify } = useFeedback();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<Look | null>(null);
  const looks = looksOf(options);

  const pick = (look: Look) => {
    target.current = look;
    input.current?.click();
  };

  const upload = async (file: File) => {
    const look = target.current;
    if (!look) return;
    setBusyKey(look.key);
    try {
      const blob = await prepareImage(file);
      const first = look.options[0]!;
      const image = await uploadPreparedImage(tenantId, 'products', first.groupId ? `${first.groupId}-look` : first.id, blob);
      await setOptionsPhoto(actor, look.options, image);
      const ids = new Set(look.options.map((o) => o.id));
      onChanged(options.map((o) => (ids.has(o.id) ? { ...o, imageUrl: image.url, imagePath: image.path } : o)));
      notify('success', t('products.variants.photoSaved', { count: look.options.length }));
    } catch (e) {
      const m = toUserMessage(e);
      notify('error', t(m.key, m.params));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="vb-looks">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void upload(f);
        }}
      />
      {looks.map((look) => (
        <div key={look.key} className="vb-look">
          <div className="vb-look-img">{look.imageUrl ? <img src={look.imageUrl} alt="" loading="lazy" /> : <span aria-hidden="true">+</span>}</div>
          <div className="vb-look-text">
            <strong>
              <bdi>{look.label || t('products.variants.allSizes')}</bdi>
            </strong>
            <span className="muted">{t('products.variants.photoFor', { count: look.options.length })}</span>
          </div>
          <Button size="sm" variant="secondary" loading={busyKey === look.key} disabled={busyKey !== null} onClick={() => pick(look)}>
            {look.imageUrl ? t('products.variants.photoChange') : t('products.variants.photoAdd')}
          </Button>
        </div>
      ))}
    </div>
  );
}

/**
 * Every size/colour of one item on one screen: type new quantities for the ones it has, and add
 * sizes or colours it does not have yet (e.g. XL after S/M/L).
 */
export function VariantGroupModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { t } = useI18n();
  const { tenantId, can } = useTenant();
  const { notify } = useFeedback();
  const { busy, run } = useAsyncAction('variant-group');
  const groupId = product.groupId ?? '';
  const [options, setOptions] = useState<Product[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<VariantDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [opId] = useState(newClientOperationId);

  useEffect(() => {
    let live = true;
    listGroupOptions(tenantId, groupId)
      .then((list) => {
        if (!live) return;
        const sorted = [...list].sort(byOptions);
        setOptions(sorted);
        const axes = axesOf(sorted.filter((p) => p.status !== 'archived'));
        setDraft({ axes: axes.map(withKnownSizes), rows: {} });
      })
      .catch((e: unknown) => {
        if (!live) return;
        const m = toUserMessage(e);
        setLoadError(t(m.key, m.params));
      });
    return () => {
      live = false;
    };
    // t only formats the message; the list is loaded once per item.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, groupId]);

  const existing = useMemo(() => new Set((options ?? []).map((p) => comboKey(valuesOf(p)).toLowerCase())), [options]);
  const changed = (options ?? []).filter((p) => {
    const raw = counts[p.id]?.trim();
    return raw !== undefined && raw !== '' && /^\d{1,7}$/.test(raw) && Number(raw) !== p.stock;
  });
  const badCount = Object.values(counts).some((raw) => raw.trim() !== '' && !/^\d{1,7}$/.test(raw.trim()));
  const fresh = draft ? readDraft(draft, existing) : null;
  const hasNew = !!fresh?.ok;
  const canAdjust = can('canEditProducts');

  const save = () =>
    run(async () => {
      if (badCount) return;
      if (draft && fresh && !fresh.ok && fresh.error !== 'products.variants.errNothingNew') {
        setDraftError(t(fresh.error, fresh.params));
        return;
      }
      for (const p of changed) {
        await adjustStock({
          productId: p.id,
          mode: 'set',
          quantity: Number(counts[p.id]),
          unitCostUsdCents: null,
          payFromCashbox: false,
          imeisToAdd: [],
          imeisToRemove: [],
          note: t('products.variants.countNote'),
        });
      }
      let added = 0;
      if (fresh?.ok) {
        const res = await addProductOptions(groupId, fresh.rows, opId);
        added = res.ids.length;
      }
      notify('success', t('products.variants.groupSaved', { changed: changed.length, added }));
      onClose();
    });

  const title = product.groupName || product.name;

  return (
    <Modal
      open
      size="lg"
      title={t('products.variants.groupTitle', { name: title })}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} disabled={!options || badCount || (changed.length === 0 && !hasNew)} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !options || !draft ? (
        <PageLoader />
      ) : (
        <div className="stack">
          <h3 className="section-title">{t('products.variants.current')}</h3>
          <div className="vb-table-wrap">
            <table className="vb-table">
              <thead>
                <tr>
                  <th>{t('products.variants.option')}</th>
                  <th>{t('products.retail')}</th>
                  <th>{t('products.variants.inStock')}</th>
                  {canAdjust && <th>{t('products.variants.newCount')}</th>}
                </tr>
              </thead>
              <tbody>
                {options.map((p) => {
                  const label = valuesOf(p).join(' / ') || p.name;
                  return (
                    <tr key={p.id}>
                      <th scope="row">
                        <bdi>{label}</bdi> {p.status === 'archived' && <Badge>{t('products.variants.archived')}</Badge>}
                      </th>
                      <td className="num">{formatUsd(p.prices.retail.usdCents)}</td>
                      <td className="num">
                        <Badge tone={p.stock <= 0 ? 'danger' : 'success'}>{p.stock}</Badge>
                      </td>
                      {canAdjust && (
                        <td>
                          <input
                            className="input"
                            inputMode="numeric"
                            dir="ltr"
                            placeholder={String(p.stock)}
                            aria-label={t('products.variants.newCountOf', { option: label })}
                            value={counts[p.id] ?? ''}
                            disabled={p.imeiTracking || p.status === 'archived'}
                            onChange={(e) => setCounts((c) => ({ ...c, [p.id]: e.target.value }))}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {badCount && <p className="field__error">{t('products.variants.errCount')}</p>}
          <p className="field__hint">{t('products.variants.countHint')}</p>

          {canAdjust && (
            <>
              <h3 className="section-title">{t('products.variants.photos')}</h3>
              <p className="field__hint">{t('products.variants.photosHint')}</p>
              <LookPhotos options={options} onChanged={setOptions} />
            </>
          )}

          {can('canAddProducts') && (
            <>
              <h3 className="section-title">{t('products.variants.addMore')}</h3>
              <p className="field__hint">{t('products.variants.addMoreHint')}</p>
              <VariantBuilder
                draft={draft}
                existing={existing}
                fixedAxes
                error={draftError}
                onChange={(update) => {
                  setDraft((d) => (d ? update(d) : d));
                  setDraftError(null);
                }}
              />
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
