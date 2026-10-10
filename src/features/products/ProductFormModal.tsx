import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { Button } from '@/components/ui/Button';
import { Checkbox, FormGrid, MoneyInput, SelectInput, TextInput } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useFeedback } from '@/contexts/feedback';
import { useTenant } from '@/contexts/session';
import { isValidExchangeRate } from '@/domain/money';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useForm } from '@/hooks/useForm';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { useCategories, useSettings } from '@/hooks/useTenantData';
import { useI18n, type TranslationKey } from '@/i18n/i18n';
import { AppError, logError, toUserMessage } from '@/services/errors';
import { requireOnline } from '@/services/ops';
import { findByNormalizedName, pageSuppliers } from '@/services/catalogQuery';
import { addCategory, assertUniqueBarcode, createProduct, setProductImage, updateProduct } from '@/services/productService';
import { uploadTenantImage } from '@/services/storageService';
import { createSupplier } from '@/services/supplierService';
import type { Product } from '@/types/models';
import { productSchema, supplierSchema, toFieldErrors, type FieldErrors } from '@/validation/schemas';
import { ImeiEntryList } from './ImeiEntryList';
import { InlineCreatePanel } from './InlineCreatePanel';
import {
  NEW_OPTION,
  categoryOptions,
  mergeSuppliers,
  resolveCategory,
  resolveSupplier,
  singleFlight,
  supplierOptions,
} from './inlineCreate';
import {
  PRICE_TIERS,
  draftFromStored,
  enterAction,
  focusProductField,
  lbpEdited,
  lbpToSave,
  productFieldOrder,
  rateChanged,
  resolveCreateInventory,
  selectEnterMoves,
  usdEdited,
  type PriceTierName,
  type TierPriceDraft,
} from './productFormLogic';

interface Props {
  product: Product | null;
  onClose: () => void;
}

const USD_NAME: Record<PriceTierName, 'retail' | 'wholesale' | 'vip'> = {
  retail: 'retail',
  wholesale: 'wholesale',
  vip: 'vip',
};
const LBP_NAME: Record<PriceTierName, 'retailLbp' | 'wholesaleLbp' | 'vipLbp'> = {
  retail: 'retailLbp',
  wholesale: 'wholesaleLbp',
  vip: 'vipLbp',
};

function generateBarcode(): string {
  // 12 random digits + EAN-13 check digit.
  const digits = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  digits[0] = 2; // "in-store" prefix range
  const sum = digits.reduce((s, d, i) => s + d * (i % 2 ? 3 : 1), 0);
  return digits.join('') + ((10 - (sum % 10)) % 10);
}

/** State of one inline "add new …" panel; a save in flight is shared by repeated clicks / Enter presses. */
function useInlinePanel(select: RefObject<HTMLSelectElement | null>) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flight = useRef(singleFlight((fn: () => Promise<void>) => fn()));

  const close = () => {
    setOpen(false);
    setError(null);
    requestAnimationFrame(() => select.current?.focus());
  };

  const save = (fn: () => Promise<void>) =>
    flight.current(async () => {
      setSaving(true);
      setError(null);
      try {
        await fn();
      } catch (err) {
        logError('inline-create', err);
        const msg = toUserMessage(err);
        setError(t(msg.key, msg.params));
      } finally {
        setSaving(false);
      }
    });

  return { open, show: () => (setError(null), setOpen(true)), close, saving, error, save };
}

export function ProductFormModal({ product, onClose }: Props) {
  const { t } = useI18n();
  const { actor, tenantId, can } = useTenant();
  const { notify } = useFeedback();
  const categories = useCategories();
  const [supplierSearch, setSupplierSearch] = useState('');
  const fetchSuppliers = useCallback(
    (cursor: QueryDocumentSnapshot | null) => pageSuppliers(tenantId, { search: supplierSearch }, cursor),
    [tenantId, supplierSearch],
  );
  const suppliersPage = usePagedQuery(`${tenantId}|product-suppliers|${supplierSearch}`, fetchSuppliers);
  const [heldSupplier] = useState<{ id: string; name: string } | null>(
    product?.supplierId ? { id: product.supplierId, name: product.supplierName } : null,
  );
  const rate = useSettings().exchangeRate;
  const { busy, run } = useAsyncAction('product-save');
  const [image, setImage] = useState<File | null>(null);
  const [serials, setSerials] = useState<string[]>([]);
  const [serialError, setSerialError] = useState<string | null>(null);
  const canSeeCost = can('canViewCosts');
  const rateOk = isValidExchangeRate(rate);

  const initialDrafts = Object.fromEntries(
    PRICE_TIERS.map((tier) => [
      tier,
      draftFromStored(product?.prices[tier].usdCents ?? 0, product?.prices[tier].lbp ?? null, rate, !product || tier !== 'retail'),
    ]),
  ) as Record<PriceTierName, TierPriceDraft>;
  const lbpMode = useRef(Object.fromEntries(PRICE_TIERS.map((tier) => [tier, initialDrafts[tier].lbpMode])) as Record<PriceTierName, 'auto' | 'manual'>);

  const form = useForm({
    name: product?.name ?? '',
    category: product?.category ?? '',
    barcode: product?.barcode ?? '',
    retail: initialDrafts.retail.usd,
    wholesale: initialDrafts.wholesale.usd,
    vip: initialDrafts.vip.usd,
    retailLbp: initialDrafts.retail.lbp,
    wholesaleLbp: initialDrafts.wholesale.lbp,
    vipLbp: initialDrafts.vip.lbp,
    cost: product ? String((product.costUsdCents / 100).toFixed(2)) : '',
    minStock: product?.minStock !== null && product?.minStock !== undefined ? String(product.minStock) : '',
    expiryDate: product?.expiryDate ?? '',
    initialStock: '',
    supplierId: product?.supplierId ?? '',
    imeiTracking: product?.imeiTracking ?? false,
    imeis: '',
  });

  useEffect(() => {
    for (const tier of PRICE_TIERS) {
      const usd = form.values[USD_NAME[tier]];
      const lbp = form.values[LBP_NAME[tier]];
      const next = rateChanged({ usd, lbp, lbpMode: lbpMode.current[tier] }, rate);
      if (next.lbp !== lbp) form.set(LBP_NAME[tier], next.lbp);
    }
    // form.set is stable. LBP itself is not a dependency, or a rate update would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rate, form.values.retail, form.values.wholesale, form.values.vip]);

  const categorySelect = useRef<HTMLSelectElement>(null);
  const supplierSelect = useRef<HTMLSelectElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const categoryPanel = useInlinePanel(categorySelect);
  const supplierPanel = useInlinePanel(supplierSelect);
  const [newCategory, setNewCategory] = useState('');
  const [newSupplier, setNewSupplier] = useState({ name: '', phone: '' });
  const [categoryError, setCategoryError] = useState<TranslationKey | null>(null);
  const [supplierErrors, setSupplierErrors] = useState<FieldErrors>({});
  const [createdSuppliers, setCreatedSuppliers] = useState<{ id: string; name: string }[]>([]);
  const allSuppliers = mergeSuppliers(
    mergeSuppliers(suppliersPage.items, heldSupplier ? [heldSupplier] : []),
    createdSuppliers,
  );
  const canCreateSupplier = can('canViewSuppliers');
  const showInitialStock = !product;
  const showImeiEntry = !product && form.values.imeiTracking;
  const fieldOrder = productFieldOrder({ showCost: canSeeCost, showInitialStock, showImeiEntry });

  const onUsd = (tier: PriceTierName, usd: string) => {
    const next = usdEdited({ usd, lbp: form.values[LBP_NAME[tier]], lbpMode: lbpMode.current[tier] }, usd, rate);
    lbpMode.current[tier] = next.lbpMode;
    form.set(USD_NAME[tier], next.usd);
    if (next.lbp !== form.values[LBP_NAME[tier]]) form.set(LBP_NAME[tier], next.lbp);
  };

  const onLbp = (tier: PriceTierName, lbp: string) => {
    const next = lbpEdited({ usd: form.values[USD_NAME[tier]], lbp: form.values[LBP_NAME[tier]], lbpMode: lbpMode.current[tier] }, lbp, rate);
    lbpMode.current[tier] = next.lbpMode;
    form.set(LBP_NAME[tier], next.lbp);
  };

  const onCategoryChange = (e: ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value !== NEW_OPTION) return form.set('category', e.target.value);
    setNewCategory('');
    setCategoryError(null);
    categoryPanel.show();
  };

  const onSupplierChange = (e: ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value !== NEW_OPTION) return form.set('supplierId', e.target.value);
    setNewSupplier({ name: '', phone: '' });
    setSupplierErrors({});
    supplierPanel.show();
  };

  const saveCategory = () =>
    categoryPanel.save(async () => {
      const name = newCategory.trim();
      setCategoryError(!name ? 'validation.required' : name.length > 100 ? 'validation.tooLong' : null);
      if (!name || name.length > 100) return;
      requireOnline();
      const outcome = await resolveCategory(newCategory, categories, (name) => addCategory(tenantId, name));
      if (outcome.kind === 'invalid') return;
      form.set('category', outcome.value);
      notify(outcome.kind === 'created' ? 'success' : 'info', t(outcome.kind === 'created' ? 'products.categoryCreated' : 'products.categoryExists', { name: outcome.value }));
      categoryPanel.close();
    });

  const saveSupplier = () =>
    supplierPanel.save(async () => {
      const parsed = supplierSchema.safeParse({ ...newSupplier, contactPerson: '', email: '', address: '' });
      setSupplierErrors(parsed.success ? {} : toFieldErrors(parsed.error));
      if (!parsed.success) return;
      requireOnline();
      const remote = await findByNormalizedName(tenantId, 'suppliers', parsed.data.name);
      if (remote && !allSuppliers.some((supplier) => supplier.id === remote.id)) {
        setCreatedSuppliers((list) => [...list, remote]);
        form.set('supplierId', remote.id);
        notify('info', t('products.supplierExists', { name: remote.name }));
        supplierPanel.close();
        return;
      }
      const outcome = await resolveSupplier(parsed.data, allSuppliers, (input) =>
        createSupplier(actor, { ...input, contactPerson: '', email: '', address: '' }),
      );
      if (outcome.kind === 'invalid') return;
      if (outcome.kind === 'created') setCreatedSuppliers((list) => [...list, outcome.value]);
      form.set('supplierId', outcome.value.id);
      notify(outcome.kind === 'created' ? 'success' : 'info', t(outcome.kind === 'created' ? 'products.supplierCreated' : 'products.supplierExists', { name: outcome.value.name }));
      supplierPanel.close();
    });

  const submit = () =>
    run(async () => {
      if (categoryPanel.saving || supplierPanel.saving) return;
      const data = form.validate(productSchema);
      if (!data) return;
      const inventory = resolveCreateInventory(data.imeiTracking, product ? null : data.initialStock, product ? [] : serials);
      if (!inventory.ok) {
        setSerialError(t('error.initialImeiCount', { stock: inventory.stock }));
        return;
      }
      setSerialError(null);
      await assertUniqueBarcode(tenantId, data.barcode, product?.id);
      const retail = data.retail ?? 0;
      const supplier = allSuppliers.find((s) => s.id === data.supplierId) ?? null;
      const tier = (name: PriceTierName, usd: number | null) => ({
        usdCents: usd ?? retail,
        lbp: lbpToSave({ usd: form.values[USD_NAME[name]], lbp: form.values[LBP_NAME[name]], lbpMode: lbpMode.current[name] }),
      });
      const input = {
        name: data.name,
        category: data.category,
        barcode: data.barcode,
        prices: {
          retail: tier('retail', data.retail),
          wholesale: tier('wholesale', data.wholesale),
          vip: tier('vip', data.vip),
        },
        costUsdCents: canSeeCost ? (data.cost ?? 0) : (product?.costUsdCents ?? 0),
        minStock: data.minStock,
        supplierId: supplier?.id ?? null,
        supplierName: supplier?.name ?? '',
        expiryDate: data.expiryDate,
        imeiTracking: data.imeiTracking,
        initialStock: product ? 0 : inventory.initialStock,
        initialImeis: product ? [] : inventory.initialImeis,
      };
      if (product?.imeiTracking && !data.imeiTracking && product.imeis.some((e) => e.status === 'available')) {
        throw new AppError('error.imeiTrackingLocked');
      }
      const id = product ? (await updateProduct(actor, product.id, input, product), product.id) : await createProduct(input);
      if (image) {
        const uploaded = await uploadTenantImage(tenantId, 'products', id, image);
        await setProductImage(actor, id, uploaded, product?.imagePath ?? null);
      }
      notify('success', t(product ? 'common.saved' : 'products.created'));
      onClose();
    });

  const onFormKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== 'Enter') return;
    const target = e.target as HTMLInputElement;
    const action = enterAction(
      { tag: target.tagName, name: target.name || target.id, type: target.type, inInline: !!target.closest('.inline-create') },
      fieldOrder,
    );
    if (action.type === 'ignore' || action.type === 'add-serial') return;
    e.preventDefault();
    if (action.type === 'focus') focusProductField(formRef.current, action.name);
  };

  const onFormKeyUp = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== 'Enter') return;
    const target = e.target as HTMLSelectElement;
    if (target.tagName !== 'SELECT' || target.closest('.inline-create')) return;
    if (!selectEnterMoves(target.value, categoryPanel.open || supplierPanel.open)) return;
    const action = enterAction({ tag: 'INPUT', name: target.name, inInline: false }, fieldOrder);
    if (action.type === 'focus') focusProductField(formRef.current, action.name);
  };

  return (
    <Modal
      open
      size="lg"
      title={product ? t('products.edit') : t('products.add')}
      onClose={onClose}
      busy={busy || categoryPanel.saving || supplierPanel.saving}
      onEscapeKey={() => {
        const panel = [supplierPanel, categoryPanel].find((p) => p.open);
        if (panel && !panel.saving) panel.close();
        return !!panel;
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy || categoryPanel.saving || supplierPanel.saving}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} disabled={categoryPanel.saving || supplierPanel.saving} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        ref={formRef}
        className="stack product-form"
        noValidate
        onSubmit={(e: FormEvent) => e.preventDefault()}
        onKeyDown={onFormKeyDown}
        onKeyUp={onFormKeyUp}
      >
        <FormGrid>
          <TextInput label={t('products.name')} required autoFocus {...form.bind('name')} />
          <SelectInput
            ref={categorySelect}
            label={t('products.category')}
            {...form.bind('category')}
            onChange={onCategoryChange}
            disabled={categoryPanel.saving}
            options={categoryOptions(categories, form.values.category, t('products.addNewCategory'))}
          />
          {categoryPanel.open && (
            <InlineCreatePanel
              title={t('products.newCategory')}
              saving={categoryPanel.saving}
              error={categoryPanel.error}
              onSave={() => void saveCategory()}
              onCancel={categoryPanel.close}
            >
              <TextInput
                label={t('products.categoryName')}
                required
                maxLength={100}
                autoComplete="off"
                error={categoryError && t(categoryError)}
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
              />
            </InlineCreatePanel>
          )}
          <div className="field-with-action">
            <TextInput {...form.bind('barcode')} label={t('products.barcode')} dir="ltr" />
            <Button variant="secondary" size="sm" icon="barcode" onClick={() => form.set('barcode', generateBarcode())}>
              {t('products.generate')}
            </Button>
          </div>
          <TextInput label={t('common.search')} value={supplierSearch} onChange={(e) => setSupplierSearch(e.target.value)} />
          <SelectInput
            ref={supplierSelect}
            label={t('products.supplier')}
            {...form.bind('supplierId')}
            onChange={onSupplierChange}
            disabled={supplierPanel.saving}
            options={supplierOptions(allSuppliers, canCreateSupplier ? t('products.addNewSupplier') : null)}
          />
          {supplierPanel.open && (
            <InlineCreatePanel
              title={t('suppliers.add')}
              saving={supplierPanel.saving}
              error={supplierPanel.error}
              onSave={() => void saveSupplier()}
              onCancel={supplierPanel.close}
            >
              <TextInput
                label={t('suppliers.name')}
                required
                maxLength={100}
                autoComplete="off"
                error={supplierErrors.name && t(supplierErrors.name)}
                value={newSupplier.name}
                onChange={(e) => setNewSupplier((s) => ({ ...s, name: e.target.value }))}
              />
              <TextInput
                label={t('auth.phone')}
                type="tel"
                maxLength={30}
                autoComplete="off"
                error={supplierErrors.phone && t(supplierErrors.phone)}
                value={newSupplier.phone}
                onChange={(e) => setNewSupplier((s) => ({ ...s, phone: e.target.value }))}
              />
            </InlineCreatePanel>
          )}
        </FormGrid>

        <h3 className="section-title">{t('products.prices')}</h3>
        {!rateOk && <p className="field__error">{t('products.lbpRateMissing')}</p>}
        {rateOk && <p className="field__hint">{t('products.lbpAutoHint')}</p>}
        <FormGrid cols={3}>
          <MoneyInput label={`${t('products.retail')} ($)`} required {...form.bind('retail')} onChange={(e) => onUsd('retail', e.target.value)} />
          <MoneyInput label={`${t('products.wholesale')} ($)`} placeholder={form.values.retail} {...form.bind('wholesale')} onChange={(e) => onUsd('wholesale', e.target.value)} />
          <MoneyInput label={`${t('products.vip')} ($)`} placeholder={form.values.retail} {...form.bind('vip')} onChange={(e) => onUsd('vip', e.target.value)} />
          <MoneyInput label={`${t('products.retail')} (LBP)`} {...form.bind('retailLbp')} onChange={(e) => onLbp('retail', e.target.value)} />
          <MoneyInput label={`${t('products.wholesale')} (LBP)`} {...form.bind('wholesaleLbp')} onChange={(e) => onLbp('wholesale', e.target.value)} />
          <MoneyInput label={`${t('products.vip')} (LBP)`} {...form.bind('vipLbp')} onChange={(e) => onLbp('vip', e.target.value)} />
        </FormGrid>

        <FormGrid cols={3}>
          {canSeeCost && <MoneyInput label={`${t('products.cost')} ($)`} {...form.bind('cost')} />}
          <TextInput label={t('products.minStock')} inputMode="numeric" hint={t('products.minStockHint')} {...form.bind('minStock')} />
          <TextInput label={t('products.expiryDate')} type="date" {...form.bind('expiryDate')} />
        </FormGrid>

        {showInitialStock && (
          <FormGrid cols={3}>
            <TextInput
              label={t('products.initialStock')}
              inputMode="numeric"
              {...form.bind('initialStock')}
              onChange={(e) => {
                form.set('initialStock', e.target.value);
                setSerialError(null);
              }}
            />
          </FormGrid>
        )}

        <Checkbox label={t('products.imeiTracking')} {...form.bindCheckbox('imeiTracking')} />
        {product && form.values.imeiTracking && <p className="field__hint">{t('products.imeiEditHint')}</p>}
        {showImeiEntry && (
          <ImeiEntryList
            serials={serials}
            onChange={(next) => {
              setSerials(next);
              setSerialError(null);
            }}
            error={serialError}
          />
        )}

        <div className="field product-form__image">
          <label className="field__label" htmlFor="product-image">
            {t('products.image')}
          </label>
          <input
            id="product-image"
            name="product-image"
            className="input input--file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setImage(e.target.files?.[0] ?? null)}
          />
          {product?.imageUrl && !image && <img className="image-preview" src={product.imageUrl} alt="" />}
        </div>
      </form>
    </Modal>
  );
}
