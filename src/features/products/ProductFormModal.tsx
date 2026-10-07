import { useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox, FormGrid, MoneyInput, SelectInput, TextArea, TextInput } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useFeedback } from '@/contexts/feedback';
import { useTenant } from '@/contexts/session';
import { centsToInput } from '@/domain/money';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useForm } from '@/hooks/useForm';
import { useCategories, useProducts, useSuppliers } from '@/hooks/useTenantData';
import { useI18n, type TranslationKey } from '@/i18n/i18n';
import { AppError, logError, toUserMessage } from '@/services/errors';
import { requireOnline } from '@/services/ops';
import { addCategory, assertUniqueBarcode, createProduct, setProductImage, updateProduct } from '@/services/productService';
import { uploadTenantImage } from '@/services/storageService';
import { createSupplier } from '@/services/supplierService';
import type { Product } from '@/types/models';
import { productSchema, supplierSchema, toFieldErrors, type FieldErrors } from '@/validation/schemas';
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

interface Props {
  product: Product | null;
  onClose: () => void;
}

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
  const products = useProducts().data;
  const suppliers = useSuppliers().data;
  const categories = useCategories();
  const { busy, run } = useAsyncAction('product-save');
  const [image, setImage] = useState<File | null>(null);
  const canSeeCost = can('canViewCosts');

  const form = useForm({
    name: product?.name ?? '',
    category: product?.category ?? '',
    barcode: product?.barcode ?? '',
    retail: centsToInput(product?.prices.retail.usdCents ?? null),
    wholesale: product?.prices.wholesale.usdCents ? centsToInput(product.prices.wholesale.usdCents) : '',
    vip: product?.prices.vip.usdCents ? centsToInput(product.prices.vip.usdCents) : '',
    retailLbp: product?.prices.retail.lbp ? String(product.prices.retail.lbp) : '',
    wholesaleLbp: product?.prices.wholesale.lbp ? String(product.prices.wholesale.lbp) : '',
    vipLbp: product?.prices.vip.lbp ? String(product.prices.vip.lbp) : '',
    cost: product ? centsToInput(product.costUsdCents) : '',
    minStock: product?.minStock !== null && product?.minStock !== undefined ? String(product.minStock) : '',
    expiryDate: product?.expiryDate ?? '',
    initialStock: '',
    supplierId: product?.supplierId ?? '',
    imeiTracking: product?.imeiTracking ?? false,
    imeis: '',
  });

  const categorySelect = useRef<HTMLSelectElement>(null);
  const supplierSelect = useRef<HTMLSelectElement>(null);
  const categoryPanel = useInlinePanel(categorySelect);
  const supplierPanel = useInlinePanel(supplierSelect);
  const [newCategory, setNewCategory] = useState('');
  const [newSupplier, setNewSupplier] = useState({ name: '', phone: '' });
  const [categoryError, setCategoryError] = useState<TranslationKey | null>(null);
  const [supplierErrors, setSupplierErrors] = useState<FieldErrors>({});
  const [createdSuppliers, setCreatedSuppliers] = useState<{ id: string; name: string }[]>([]);
  const allSuppliers = mergeSuppliers(suppliers, createdSuppliers);
  const canCreateSupplier = can('canViewSuppliers');

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
      const outcome = await resolveSupplier(parsed.data, suppliers, (input) =>
        createSupplier(actor, { ...input, contactPerson: '', email: '', address: '' }, suppliers),
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
      assertUniqueBarcode(data.barcode, products, product?.id);
      const retail = data.retail ?? 0;
      const supplier = allSuppliers.find((s) => s.id === data.supplierId) ?? null;
      const input = {
        name: data.name,
        category: data.category,
        barcode: data.barcode,
        prices: {
          retail: { usdCents: retail, lbp: data.retailLbp },
          wholesale: { usdCents: data.wholesale ?? retail, lbp: data.wholesaleLbp },
          vip: { usdCents: data.vip ?? retail, lbp: data.vipLbp },
        },
        costUsdCents: canSeeCost ? (data.cost ?? 0) : (product?.costUsdCents ?? 0),
        minStock: data.minStock,
        supplierId: supplier?.id ?? null,
        supplierName: supplier?.name ?? '',
        expiryDate: data.expiryDate,
        imeiTracking: data.imeiTracking,
        initialStock: data.initialStock ?? 0,
        initialImeis: data.imeis.split(/[\s,;]+/).filter(Boolean),
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
        className="stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
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
            <TextInput label={t('products.barcode')} {...form.bind('barcode')} />
            <Button variant="secondary" size="sm" icon="barcode" onClick={() => form.set('barcode', generateBarcode())}>
              {t('products.generate')}
            </Button>
          </div>
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
        <FormGrid cols={3}>
          <MoneyInput label={`${t('products.retail')} ($)`} required {...form.bind('retail')} />
          <MoneyInput label={`${t('products.wholesale')} ($)`} placeholder={form.values.retail} {...form.bind('wholesale')} />
          <MoneyInput label={`${t('products.vip')} ($)`} placeholder={form.values.retail} {...form.bind('vip')} />
          <MoneyInput label={`${t('products.retail')} (LBP)`} hint={t('products.lbpOptional')} {...form.bind('retailLbp')} />
          <MoneyInput label={`${t('products.wholesale')} (LBP)`} {...form.bind('wholesaleLbp')} />
          <MoneyInput label={`${t('products.vip')} (LBP)`} {...form.bind('vipLbp')} />
        </FormGrid>

        <FormGrid cols={3}>
          {canSeeCost && <MoneyInput label={`${t('products.cost')} ($)`} {...form.bind('cost')} />}
          <TextInput label={t('products.minStock')} inputMode="numeric" hint={t('products.minStockHint')} {...form.bind('minStock')} />
          <TextInput label={t('products.expiryDate')} type="date" {...form.bind('expiryDate')} />
          {!product && !form.values.imeiTracking && (
            <TextInput label={t('products.initialStock')} inputMode="numeric" {...form.bind('initialStock')} />
          )}
        </FormGrid>

        <Checkbox label={t('products.imeiTracking')} {...form.bindCheckbox('imeiTracking')} />
        {!product && form.values.imeiTracking && (
          <TextArea label={t('products.imeiList')} rows={3} placeholder={t('products.imeiListHint')} {...form.bind('imeis')} />
        )}

        <div className="field">
          <label className="field__label" htmlFor="product-image">
            {t('products.image')}
          </label>
          <input
            id="product-image"
            className="input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setImage(e.target.files?.[0] ?? null)}
          />
          {product?.imageUrl && !image && <img className="image-preview" src={product.imageUrl} alt="" />}
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
