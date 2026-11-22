import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Checkbox, Field, FormGrid, MoneyInput, TextInput } from '@/components/ui/Form';
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
import { newClientOperationId } from '@/services/clientOperation';
import { addCategory, assertUniqueBarcode, createProduct, createProductGroup, setProductImage, updateProduct } from '@/services/productService';
import { uploadTenantImage } from '@/services/storageService';
import { createSupplier } from '@/services/supplierService';
import type { ProductDraftFields } from '@/features/ai/actions/productDraft';
import type { Product } from '@/types/models';
import { productSchema, supplierSchema, toFieldErrors, type FieldErrors } from '@/validation/schemas';
import { ImeiEntryList } from './ImeiEntryList';
import { InlineCreatePanel } from './InlineCreatePanel';
import { VariantBuilder } from './VariantBuilder';
import { newAxis, readDraft, type VariantDraft } from './variantDraft';
import {
  NEW_OPTION,
  categoryOptions,
  filterSelectOptions,
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
  /** Fields the user actually stated. Omitted fields stay blank. */
  seed?: ProductDraftFields | null;
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
function useInlinePanel(select: RefObject<HTMLElement | null>) {
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

interface MenuBox {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
}

function menuBox(anchor: HTMLElement): MenuBox {
  const rect = anchor.getBoundingClientRect();
  const gap = 4;
  const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
  const spaceAbove = rect.top - gap - 8;
  const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
  const maxHeight = Math.max(120, Math.min(260, openUp ? spaceAbove : spaceBelow));
  return openUp
    ? { bottom: window.innerHeight - rect.top + gap, left: rect.left, width: rect.width, maxHeight }
    : { top: rect.bottom + gap, left: rect.left, width: rect.width, maxHeight };
}

function preferredOptionIndex(options: { value: string; label: string }[], query: string, selected: string): number {
  const q = query.trim().toLowerCase();
  if (q) {
    const match = options.findIndex(
      (option) => option.value !== '' && option.value !== NEW_OPTION && option.label.toLowerCase().includes(q),
    );
    if (match >= 0) return match;
  }
  const current = options.findIndex((option) => option.value === selected && option.value !== '');
  return current;
}

/** Closed control matches a normal select. Search lives in the open list, so the form row stays one field tall. */
function FilterableSelect({
  label,
  query,
  onQuery,
  searchLabel,
  options,
  selectRef,
  error,
  disabled,
  name,
  value,
  onChange,
  onAdvance,
}: {
  label: string;
  query: string;
  onQuery: (value: string) => void;
  searchLabel: string;
  options: { value: string; label: string }[];
  selectRef: RefObject<HTMLElement | null>;
  error?: string | null;
  disabled?: boolean;
  name: string;
  value: string;
  onChange: (value: string) => void;
  onAdvance?: () => void;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<MenuBox | null>(null);
  const listKey = `${query}\n${options.map((option) => option.value).join('\n')}`;
  const [highlightState, setHighlightState] = useState({ key: '', index: 0 });
  const fallback = preferredOptionIndex(options, query, value);
  const highlight = highlightState.key === listKey ? highlightState.index : fallback;
  const selectedLabel = options.find((option) => option.value === value)?.label ?? '—';

  const closeMenu = () => {
    setOpen(false);
    onQuery('');
  };

  const openMenu = (initial = '') => {
    onQuery(initial);
    setOpen(true);
  };

  const commit = (next: string, advance: boolean) => {
    setOpen(false);
    onQuery('');
    onChange(next);
    if (next === NEW_OPTION) return;
    if (advance) onAdvance?.();
    else buttonRef.current?.focus();
  };

  const moveHighlight = (delta: number) => {
    if (!options.length) return;
    const start = highlight < 0 ? (delta > 0 ? -1 : options.length) : highlight;
    const next = Math.min(options.length - 1, Math.max(0, start + delta));
    setHighlightState({ key: listKey, index: next });
  };

  useEffect(() => {
    if (!open || !box || document.activeElement === searchRef.current) return;
    searchRef.current?.focus();
  }, [open, box]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      if (buttonRef.current) setBox(menuBox(buttonRef.current));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
      onQuery('');
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open, onQuery]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight, listKey]);

  return (
    <Field label={label} error={error}>
      {(id) => (
        <div ref={rootRef}>
          <button
            type="button"
            id={id}
            name={name}
            className="input select-menu__button"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            disabled={disabled}
            ref={(node) => {
              buttonRef.current = node;
              selectRef.current = node;
            }}
            onClick={() => (open ? closeMenu() : openMenu())}
            onKeyDown={(event) => {
              if (disabled) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                openMenu();
                return;
              }
              if (event.key === 'Escape' && open) {
                event.preventDefault();
                event.stopPropagation();
                closeMenu();
                return;
              }
              if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
                event.preventDefault();
                openMenu(event.key);
              }
            }}
          >
            <span className="select-menu__value">{selectedLabel}</span>
            <Icon name="chevronDown" size={16} className="select-menu__chevron" />
          </button>
          {open &&
            box &&
            createPortal(
              <div ref={panelRef} className="select-menu__panel" style={box}>
                <div className="select-menu__filter">
                  <Icon name="search" size={14} />
                  <input
                    ref={searchRef}
                    className="select-menu__search"
                    value={query}
                    placeholder={searchLabel}
                    aria-label={`${label} ${searchLabel}`}
                    role="combobox"
                    aria-expanded
                    aria-controls={listId}
                    aria-autocomplete="list"
                    aria-activedescendant={highlight >= 0 && options[highlight] ? `${listId}-${highlight}` : undefined}
                    autoComplete="off"
                    onChange={(event) => onQuery(event.target.value)}
                    onBlur={(event) => {
                      const next = event.relatedTarget as Node | null;
                      if (next && (panelRef.current?.contains(next) || rootRef.current?.contains(next))) return;
                      closeMenu();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        closeMenu();
                        buttonRef.current?.focus();
                        return;
                      }
                      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        moveHighlight(event.key === 'ArrowDown' ? 1 : -1);
                        return;
                      }
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      event.stopPropagation();
                      const option = highlight >= 0 ? options[highlight] : undefined;
                      if (option) commit(option.value, true);
                    }}
                  />
                </div>
                <ul id={listId} className="select-menu__list" role="listbox" aria-label={label}>
                  {options.map((option, index) => (
                    <li key={option.value || 'empty'}>
                      <button
                        type="button"
                        id={`${listId}-${index}`}
                        role="option"
                        aria-selected={option.value === value}
                        data-active={index === highlight ? 'true' : undefined}
                        className={index === highlight && highlight >= 0 ? 'select-menu__option select-menu__option--active' : 'select-menu__option'}
                        onMouseEnter={() => setHighlightState({ key: listKey, index })}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => commit(option.value, false)}
                      >
                        {option.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>,
              document.body,
            )}
        </div>
      )}
    </Field>
  );
}

export function ProductFormModal({ product, seed = null, onClose }: Props) {
  const { t } = useI18n();
  const { actor, tenantId, can } = useTenant();
  const { notify } = useFeedback();
  const categories = useCategories();
  const [supplierSearch, setSupplierSearch] = useState('');
  const [categoryQuery, setCategoryQuery] = useState('');
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
  const createOpRef = useRef<string | null>(null);
  const canSeeCost = can('canViewCosts');
  const rateOk = isValidExchangeRate(rate);

  const statedTierCents: Record<PriceTierName, number | undefined> = {
    retail: seed?.retailUsdCents,
    wholesale: seed?.wholesaleUsdCents,
    vip: seed?.vipUsdCents,
  };
  const initialDrafts = Object.fromEntries(
    PRICE_TIERS.map((tier) => {
      const stated = !product ? statedTierCents[tier] : undefined;
      if (stated != null) return [tier, draftFromStored(stated, null, rate, false)];
      return [
        tier,
        draftFromStored(product?.prices[tier].usdCents ?? 0, product?.prices[tier].lbp ?? null, rate, !product || tier !== 'retail'),
      ];
    }),
  ) as Record<PriceTierName, TierPriceDraft>;
  const lbpMode = useRef(Object.fromEntries(PRICE_TIERS.map((tier) => [tier, initialDrafts[tier].lbpMode])) as Record<PriceTierName, 'auto' | 'manual'>);

  const form = useForm({
    name: product?.name ?? (!product ? seed?.name ?? '' : ''),
    category: product?.category ?? (!product ? seed?.category ?? '' : ''),
    barcode: product?.barcode ?? (!product ? seed?.barcode ?? '' : ''),
    retail: initialDrafts.retail.usd,
    wholesale: initialDrafts.wholesale.usd,
    vip: initialDrafts.vip.usd,
    retailLbp: initialDrafts.retail.lbp,
    wholesaleLbp: initialDrafts.wholesale.lbp,
    vipLbp: initialDrafts.vip.lbp,
    cost: product
      ? product.costKnown === false
        ? ''
        : String((product.costUsdCents / 100).toFixed(2))
      : seed?.costUsdCents != null
        ? (seed.costUsdCents / 100).toFixed(2)
        : '',
    minStock: product?.minStock !== null && product?.minStock !== undefined
      ? String(product.minStock)
      : !product && seed?.minStock != null
        ? String(seed.minStock)
        : '',
    expiryDate: product?.expiryDate ?? '',
    initialStock: !product && seed?.initialStock != null ? String(seed.initialStock) : '',
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

  const categorySelect = useRef<HTMLElement>(null);
  const supplierSelect = useRef<HTMLElement>(null);
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
  // New items can be made in sizes/colours, one product per option with its own stock.
  const [variantsOn, setVariantsOn] = useState(false);
  const [variantDraft, setVariantDraft] = useState<VariantDraft>(() => ({ axes: [newAxis(t('products.variants.sizeName'), 'clothes')], rows: {} }));
  const [variantError, setVariantError] = useState<string | null>(null);
  const withVariants = !product && variantsOn;
  const showInitialStock = !product && !withVariants;
  const showImeiEntry = !product && !withVariants && form.values.imeiTracking;
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

  const advanceFrom = (fieldName: string) => {
    const action = enterAction({ tag: 'INPUT', name: fieldName, inInline: false }, fieldOrder);
    if (action.type === 'focus') focusProductField(formRef.current, action.name);
  };

  const onCategoryChange = (next: string) => {
    if (next !== NEW_OPTION) return form.set('category', next);
    setNewCategory('');
    setCategoryError(null);
    categoryPanel.show();
  };

  const onSupplierChange = (next: string) => {
    if (next !== NEW_OPTION) return form.set('supplierId', next);
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
      const options = withVariants ? readDraft(variantDraft) : null;
      if (options && !options.ok) {
        setVariantError(t(options.error, options.params));
        return;
      }
      setVariantError(null);
      const inventory = resolveCreateInventory(data.imeiTracking, product ? null : data.initialStock, product ? [] : serials);
      if (!inventory.ok) {
        setSerialError(t('error.initialImeiCount', { stock: inventory.stock }));
        return;
      }
      setSerialError(null);
      if (options?.ok) {
        for (const row of options.rows) await assertUniqueBarcode(tenantId, row.barcode);
      } else {
        await assertUniqueBarcode(tenantId, data.barcode, product?.id);
      }
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
        costKnown: !canSeeCost
          ? product?.costKnown !== false
          : product
            ? product.costKnown === false
              ? data.cost != null
              : true
            : seed
              ? seed.costUsdCents != null || data.cost != null
              : true,
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
      if (options?.ok) {
        createOpRef.current ??= newClientOperationId();
        const saved = await createProductGroup({ ...input, barcode: '', imeiTracking: false, initialImeis: [] }, options.axes, options.rows, createOpRef.current);
        // Each option keeps its own copy of the photo, so replacing one later never breaks the others.
        if (image) {
          for (const optionId of saved.ids) {
            const uploaded = await uploadTenantImage(tenantId, 'products', optionId, image);
            await setProductImage(actor, optionId, uploaded, null);
          }
        }
        createOpRef.current = null;
        notify('success', t('products.variants.created', { count: saved.ids.length }));
        onClose();
        return;
      }
      let id = product?.id ?? '';
      if (product) {
        await updateProduct(actor, product.id, input, product);
      } else {
        createOpRef.current ??= newClientOperationId();
        const saved = await createProduct(input, createOpRef.current);
        id = saved.id;
      }
      if (image) {
        const uploaded = await uploadTenantImage(tenantId, 'products', id, image);
        await setProductImage(actor, id, uploaded, product?.imagePath ?? null);
      }
      createOpRef.current = null;
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
          <div className="stack">
            <TextInput label={t('products.name')} required autoFocus {...form.bind('name')} />
            {!withVariants && (
              <div className="field-with-action">
                <TextInput {...form.bind('barcode')} label={t('products.barcode')} dir="ltr" />
                <Button variant="secondary" size="sm" icon="barcode" onClick={() => form.set('barcode', generateBarcode())}>
                  {t('products.generate')}
                </Button>
              </div>
            )}
          </div>
          <div className="stack">
            <FilterableSelect
              label={t('products.category')}
              query={categoryQuery}
              onQuery={setCategoryQuery}
              searchLabel={t('common.search')}
              options={filterSelectOptions(
                categoryOptions(categories, form.values.category, t('products.addNewCategory')),
                categoryQuery,
                form.values.category,
              )}
              selectRef={categorySelect}
              error={form.bind('category').error}
              disabled={categoryPanel.saving}
              name="category"
              value={form.values.category}
              onChange={onCategoryChange}
              onAdvance={() => advanceFrom('category')}
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
            <FilterableSelect
              label={t('products.supplier')}
              query={supplierSearch}
              onQuery={setSupplierSearch}
              searchLabel={t('common.search')}
              options={filterSelectOptions(
                supplierOptions(allSuppliers, canCreateSupplier ? t('products.addNewSupplier') : null),
                supplierSearch,
                form.values.supplierId,
              )}
              selectRef={supplierSelect}
              error={form.bind('supplierId').error}
              disabled={supplierPanel.saving}
              name="supplierId"
              value={form.values.supplierId}
              onChange={onSupplierChange}
              onAdvance={() => advanceFrom('supplierId')}
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
          </div>
        </FormGrid>

        <h3 className="section-title">{t('products.prices')}</h3>
        {!rateOk && <p className="field__error">{t('products.lbpRateMissing')}</p>}
        {rateOk && <p className="field__hint">{t('products.lbpAutoHint')}</p>}
        <FormGrid cols={3}>
          <MoneyInput currency="usd" label={`${t('products.retail')} ($)`} required {...form.bind('retail')} onChange={(e) => onUsd('retail', e.target.value)} />
          <MoneyInput currency="usd" label={`${t('products.wholesale')} ($)`} placeholder={form.values.retail} {...form.bind('wholesale')} onChange={(e) => onUsd('wholesale', e.target.value)} />
          <MoneyInput currency="usd" label={`${t('products.vip')} ($)`} placeholder={form.values.retail} {...form.bind('vip')} onChange={(e) => onUsd('vip', e.target.value)} />
          <MoneyInput currency="lbp" label={`${t('products.retail')} (LBP)`} {...form.bind('retailLbp')} onChange={(e) => onLbp('retail', e.target.value)} />
          <MoneyInput currency="lbp" label={`${t('products.wholesale')} (LBP)`} {...form.bind('wholesaleLbp')} onChange={(e) => onLbp('wholesale', e.target.value)} />
          <MoneyInput currency="lbp" label={`${t('products.vip')} (LBP)`} {...form.bind('vipLbp')} onChange={(e) => onLbp('vip', e.target.value)} />
        </FormGrid>

        <FormGrid cols={3}>
          {canSeeCost && <MoneyInput currency="usd" label={`${t('products.cost')} ($)`} {...form.bind('cost')} />}
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

        {!product && (
          <div className="vb-toggle">
            <Checkbox
              label={t('products.variants.toggle')}
              checked={variantsOn}
              onChange={(e) => {
                setVariantsOn(e.target.checked);
                setVariantError(null);
                if (e.target.checked) form.set('imeiTracking', false);
              }}
            />
            <p className="field__hint">{t('products.variants.toggleHint')}</p>
          </div>
        )}
        {withVariants && <VariantBuilder draft={variantDraft} onChange={(update) => {
              setVariantDraft(update);
              setVariantError(null);
            }} error={variantError} />}

        {!withVariants && <Checkbox label={t('products.imeiTracking')} {...form.bindCheckbox('imeiTracking')} />}
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
