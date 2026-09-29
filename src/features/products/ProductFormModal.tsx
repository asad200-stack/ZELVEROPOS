import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox, FormGrid, MoneyInput, SelectInput, TextArea, TextInput } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useFeedback } from '@/contexts/feedback';
import { useTenant } from '@/contexts/session';
import { centsToInput } from '@/domain/money';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useForm } from '@/hooks/useForm';
import { useCategories, useProducts, useSuppliers } from '@/hooks/useTenantData';
import { useI18n } from '@/i18n/i18n';
import { AppError } from '@/services/errors';
import { assertUniqueBarcode, createProduct, setProductImage, updateProduct } from '@/services/productService';
import { uploadTenantImage } from '@/services/storageService';
import type { Product } from '@/types/models';
import { productSchema } from '@/validation/schemas';

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

  const submit = () =>
    run(async () => {
      const data = form.validate(productSchema);
      if (!data) return;
      assertUniqueBarcode(data.barcode, products, product?.id);
      const retail = data.retail ?? 0;
      const supplier = suppliers.find((s) => s.id === data.supplierId) ?? null;
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
      const id = product ? (await updateProduct(actor, product.id, input), product.id) : await createProduct(actor, input);
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
          <TextInput label={t('products.category')} list="product-categories" {...form.bind('category')} />
          <datalist id="product-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <div className="field-with-action">
            <TextInput label={t('products.barcode')} {...form.bind('barcode')} />
            <Button variant="secondary" size="sm" icon="barcode" onClick={() => form.set('barcode', generateBarcode())}>
              {t('products.generate')}
            </Button>
          </div>
          <SelectInput
            label={t('products.supplier')}
            {...form.bind('supplierId')}
            options={[{ value: '', label: '—' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
          />
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
