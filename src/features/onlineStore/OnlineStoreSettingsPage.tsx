// Settings → Online Store (Milestone A). Owner-only; every call is re-authorized on the server.
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, FormGrid, SelectInput, TextArea, TextInput } from '@/components/ui/Form';
import { Alert, Badge, Card, EmptyState, PageHeader, SearchBox } from '@/components/ui/Layout';
import { PageLoader } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import {
  DELIVERY_FEE_MAX_USD_CENTS,
  DELIVERY_ZONES_MAX,
  LISTING_DESC_MAX,
  STORE_ADDRESS_MAX,
  defaultHours,
  discountPercent,
  MAX_VISIBLE_PRODUCTS,
  STORE_FONTS,
  STORE_LOCALES,
  STORE_NAME_MAX,
  STORE_TAGLINE_MAX,
  STORE_TEMPLATES,
  isRtl,
  domainProblem,
  normalizeDomain,
  normalizeSlug,
  publishBlockers,
  slugProblem,
  ZONE_NAME_MAX,
  newZoneId,
  toFreeDeliveryThreshold,
  type DayHours,
  type DeliveryZone,
  type ProductListing,
  type OnlineStoreConfig,
  type PublicProduct,
  type StoreBranding,
  type StoreFont,
  type StoreLocale,
  type StoreTemplate,
} from '@/domain/onlineStore';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/services/functionsClient';
import { formatDateTime, formatUsd, normalizeSearch } from '@/utils/format';

interface LoadedStore {
  config: OnlineStoreConfig;
  products: PublicProduct[];
  productsTruncated: boolean;
}

export default function OnlineStoreSettingsPage() {
  const { t } = useI18n();
  const data = useAsyncData('online-store-config', () => api.onlineStoreGetConfig({}));

  if (data.loading && !data.data) return <PageLoader />;
  if (data.error || !data.data) {
    return (
      <div className="page stack">
        <PageHeader title={t('onlineStore.title')} subtitle={t('onlineStore.subtitle')} />
        <Alert tone="error" onRetry={data.reload} retryLabel={t('common.retry')}>
          {t('onlineStore.loadError')}
        </Alert>
      </div>
    );
  }
  return <OnlineStoreEditor initial={data.data} />;
}

/** Web description and price-before-discount for one product. Saved immediately (no publish step). */
const DAY_KEYS = [
  'onlineStore.day.0',
  'onlineStore.day.1',
  'onlineStore.day.2',
  'onlineStore.day.3',
  'onlineStore.day.4',
  'onlineStore.day.5',
  'onlineStore.day.6',
] as const;

function ListingEditor({
  productId,
  priceUsdCents,
  listing,
  onSaved,
}: {
  productId: string;
  priceUsdCents: number;
  listing: ProductListing | undefined;
  onSaved: (config: OnlineStoreConfig) => void;
}) {
  const { t } = useI18n();
  const { notify } = useFeedback();
  const action = useAsyncAction('onlineStore');
  const [description, setDescription] = useState(listing?.description ?? '');
  const [before, setBefore] = useState(listing?.compareAtUsdCents ? String(listing.compareAtUsdCents / 100) : '');
  const beforeCents = before.trim() ? Math.round(Number(before) * 100) : null;
  const beforeBad = beforeCents !== null && (!Number.isFinite(beforeCents) || beforeCents <= priceUsdCents);
  const pct = !beforeBad && beforeCents ? discountPercent({ priceUsdCents, compareAtUsdCents: beforeCents }) : null;

  const save = async () => {
    if (beforeBad) return;
    const res = await action.run(() =>
      api.onlineStoreSaveListing({ productId, description: description.trim(), compareAtUsdCents: beforeCents }),
    );
    if (!res) return;
    notify('success', t('onlineStore.listing.saved'));
    onSaved(res.config);
  };

  return (
    <div className="os-listing">
      <TextArea
        label={t('onlineStore.listing.description')}
        placeholder={t('onlineStore.listing.descriptionHint')}
        rows={3}
        maxLength={LISTING_DESC_MAX}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <TextInput
        label={t('onlineStore.listing.before')}
        hint={beforeBad ? t('onlineStore.listing.beforeTooLow', { price: formatUsd(priceUsdCents) }) : pct ? t('onlineStore.listing.beforePct', { pct }) : t('onlineStore.listing.beforeHint')}
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        dir="ltr"
        value={before}
        onChange={(e) => setBefore(e.target.value)}
      />
      <div className="modal-actions">
        <Button variant="primary" size="sm" loading={action.busy} disabled={beforeBad} onClick={() => void save()}>
          {t('onlineStore.listing.save')}
        </Button>
      </div>
    </div>
  );
}

function OnlineStoreEditor({ initial }: { initial: LoadedStore }) {
  const { t, lang } = useI18n();
  const { notify } = useFeedback();
  const action = useAsyncAction('onlineStore');

  const [config, setConfig] = useState<OnlineStoreConfig>(initial.config);
  const [enabled, setEnabled] = useState(initial.config.enabled);
  const [draft, setDraft] = useState<StoreBranding>(initial.config.draft);
  const [slugInput, setSlugInput] = useState(initial.config.slug ?? '');
  const [domainInput, setDomainInput] = useState(initial.config.customDomain);
  const [selected, setSelected] = useState<string[]>(initial.config.visibleProductIds);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const brandingDirty = enabled !== config.enabled || JSON.stringify(draft) !== JSON.stringify(config.draft);
  const productsDirty = selected.join('|') !== config.visibleProductIds.join('|');
  const slug = normalizeSlug(slugInput);
  const slugIssue = slug ? slugProblem(slug) : null;
  const domain = normalizeDomain(domainInput);
  const domainIssue = domain ? domainProblem(domain) : null;
  const blockers = publishBlockers(config);
  const isPublished = config.publication === 'published';

  const set = <K extends keyof StoreBranding>(key: K, value: StoreBranding[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const toggleLocale = (l: StoreLocale, on: boolean) =>
    setDraft((d) => ({ ...d, enabledLocales: STORE_LOCALES.filter((x) => (x === l ? on : d.enabledLocales.includes(x))) }));

  const toggleProduct = (id: string, on: boolean) =>
    setSelected((cur) => (on ? (cur.includes(id) || cur.length >= MAX_VISIBLE_PRODUCTS ? cur : [...cur, id]) : cur.filter((x) => x !== id)));

  const filtered = useMemo(() => {
    const q = normalizeSearch(search);
    if (!q) return initial.products;
    return initial.products.filter((p) => normalizeSearch(`${p.name} ${p.category}`).includes(q));
  }, [initial.products, search]);

  const apply = (next: OnlineStoreConfig) => {
    setConfig(next);
    setEnabled(next.enabled);
    setDraft(next.draft);
    setSelected(next.visibleProductIds);
    setSlugInput(next.slug ?? '');
    setDomainInput(next.customDomain);
  };

  const setZone = (i: number, patch: Partial<DeliveryZone>) =>
    setDraft((d) => ({ ...d, deliveryZones: d.deliveryZones.map((z, k) => (k === i ? { ...z, ...patch } : z)) }));
  const addZone = () =>
    setDraft((d) =>
      d.deliveryZones.length >= DELIVERY_ZONES_MAX ? d : { ...d, deliveryZones: [...d.deliveryZones, { id: newZoneId(), name: '', feeUsdCents: 0 }] },
    );
  const setDay = (d: number, patch: Partial<DayHours>) =>
    setDraft((cur) => ({ ...cur, hours: cur.hours.map((h, k) => (k === d ? { ...h, ...patch } : h)) }));
  const removeZone = (i: number) => setDraft((d) => ({ ...d, deliveryZones: d.deliveryZones.filter((_, k) => k !== i) }));
  const toCents = (raw: string, max: number) => {
    const dollars = Number(raw);
    return Number.isFinite(dollars) && dollars > 0 ? Math.min(max, Math.round(dollars * 100)) : 0;
  };

  const saveDraft = async () => {
    // Rows left without a name are dropped instead of failing the whole save.
    const clean = {
      ...draft,
      deliveryZones: draft.deliveryZones.map((z) => ({ ...z, name: z.name.trim() })).filter((z) => z.name.length > 0),
    };
    const res = await action.run(() => api.onlineStoreSaveDraft({ enabled, draft: clean }));
    if (!res) return;
    apply(res.config);
    notify('success', t('onlineStore.draftSaved'));
  };

  const saveSlug = async () => {
    if (!slug || slugIssue) return;
    const res = await action.run(() => api.onlineStoreSetSlug({ slug }));
    if (!res) return;
    apply(res.config);
    notify('success', t('onlineStore.slugSaved'));
  };

  const saveDomain = async () => {
    if (domainIssue) return;
    const res = await action.run(() => api.onlineStoreSetDomain({ domain }));
    if (!res) return;
    apply(res.config);
    notify('success', t(domain ? 'onlineStore.domain.saved' : 'onlineStore.domain.removed'));
  };

  const saveProducts = async () => {
    const res = await action.run(() => api.onlineStoreSetProductVisibility({ productIds: selected }));
    if (!res) return;
    apply(res.config);
    notify('success', t('onlineStore.productsSaved'));
  };

  const publish = async () => {
    const res = await action.run(() => api.onlineStorePublish({}));
    if (!res) return;
    apply(res.config);
    notify('success', t('onlineStore.published'));
  };

  const unpublish = async () => {
    const res = await action.run(() => api.onlineStoreUnpublish({}));
    if (!res) return;
    apply(res.config);
    notify('success', t('onlineStore.unpublished'));
  };

  const statusBadge = !config.enabled ? (
    <Badge tone="default">{t('onlineStore.status.disabled')}</Badge>
  ) : isPublished ? (
    <Badge tone="success">{t('onlineStore.status.published')}</Badge>
  ) : (
    <Badge tone="warning">{t('onlineStore.status.draft')}</Badge>
  );

  const preview = config.draft;
  const previewFont = preview.font === 'system' ? undefined : preview.font.charAt(0).toUpperCase() + preview.font.slice(1);

  return (
    <div className="page stack">
      <PageHeader title={t('onlineStore.title')} subtitle={t('onlineStore.subtitle')} actions={statusBadge} />

      <Alert tone="info">{t('onlineStore.payments')}</Alert>

      <Card title={t('onlineStore.branding')}>
        <div className="stack">
          <Checkbox label={t('onlineStore.enable')} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {!enabled && <p className="muted">{t('onlineStore.enableHint')}</p>}
          <FormGrid cols={2}>
            <TextInput
              label={t('onlineStore.storeName')}
              required
              maxLength={STORE_NAME_MAX}
              value={draft.storeName}
              onChange={(e) => set('storeName', e.target.value)}
            />
            <SelectInput
              label={t('onlineStore.template')}
              value={draft.template}
              onChange={(e) => set('template', e.target.value as StoreTemplate)}
              options={STORE_TEMPLATES.map((v) => ({ value: v, label: t(`onlineStore.template.${v}`) }))}
            />
            <TextArea
              label={t('onlineStore.tagline')}
              fieldClassName="span-2"
              maxLength={STORE_TAGLINE_MAX}
              rows={2}
              value={draft.tagline}
              onChange={(e) => set('tagline', e.target.value)}
            />
            <Field label={t('onlineStore.primaryColor')}>
              {(id) => (
                <input id={id} className="input" type="color" value={draft.primaryColor} onChange={(e) => set('primaryColor', e.target.value.toUpperCase())} />
              )}
            </Field>
            <Field label={t('onlineStore.accentColor')}>
              {(id) => (
                <input id={id} className="input" type="color" value={draft.accentColor} onChange={(e) => set('accentColor', e.target.value.toUpperCase())} />
              )}
            </Field>
            <SelectInput
              label={t('onlineStore.font')}
              value={draft.font}
              onChange={(e) => set('font', e.target.value as StoreFont)}
              options={STORE_FONTS.map((v) => ({ value: v, label: t(`onlineStore.font.${v}`) }))}
            />
            <SelectInput
              label={t('onlineStore.defaultLocale')}
              value={draft.defaultLocale}
              onChange={(e) => set('defaultLocale', e.target.value as StoreLocale)}
              options={STORE_LOCALES.map((v) => ({ value: v, label: t(`onlineStore.locale.${v}`) }))}
            />
            <Field label={t('onlineStore.locales')}>
              {() => (
                <div className="row-gap">
                  {STORE_LOCALES.map((l) => (
                    <Checkbox
                      key={l}
                      label={t(`onlineStore.locale.${l}`)}
                      checked={draft.enabledLocales.includes(l)}
                      onChange={(e) => toggleLocale(l, e.target.checked)}
                    />
                  ))}
                </div>
              )}
            </Field>
            <TextInput
              label={t('onlineStore.contactPhone')}
              hint={t('onlineStore.phoneHint')}
              inputMode="tel"
              dir="ltr"
              maxLength={16}
              value={draft.contactPhone}
              onChange={(e) => set('contactPhone', e.target.value.trim())}
            />
            <TextInput
              label={t('onlineStore.whatsapp')}
              hint={t('onlineStore.phoneHint')}
              inputMode="tel"
              dir="ltr"
              maxLength={16}
              value={draft.whatsapp}
              onChange={(e) => set('whatsapp', e.target.value.trim())}
            />
            <TextInput
              label={t('onlineStore.freeDeliveryOver')}
              hint={t('onlineStore.freeDeliveryHint')}
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              dir="ltr"
              value={draft.freeDeliveryOverUsdCents === null ? '' : String(draft.freeDeliveryOverUsdCents / 100)}
              onChange={(e) => {
                const dollars = Number(e.target.value);
                const cents = Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
                set('freeDeliveryOverUsdCents', toFreeDeliveryThreshold(cents));
              }}
            />
            <TextInput
              label={t('onlineStore.minOrder')}
              hint={t('onlineStore.minOrderHint')}
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              dir="ltr"
              value={draft.minOrderUsdCents === null ? '' : String(draft.minOrderUsdCents / 100)}
              onChange={(e) => set('minOrderUsdCents', toFreeDeliveryThreshold(toCents(e.target.value, Number.MAX_SAFE_INTEGER)))}
            />
            <TextInput
              label={t('onlineStore.storeAddress')}
              hint={t('onlineStore.storeAddressHint')}
              maxLength={STORE_ADDRESS_MAX}
              value={draft.storeAddress}
              onChange={(e) => set('storeAddress', e.target.value)}
            />
          </FormGrid>
          <div className="os-hours">
            <Checkbox
              label={t('onlineStore.hours.enable')}
              checked={draft.hours.length === 7}
              onChange={(e) => set('hours', e.target.checked ? defaultHours() : [])}
            />
            {draft.hours.map((h, d) => (
              <div key={DAY_KEYS[d]} className="os-hours__row">
                <span className="os-hours__day">{t(DAY_KEYS[d] ?? 'onlineStore.day.0')}</span>
                <Checkbox label={t('onlineStore.hours.closed')} checked={h.closed} onChange={(e) => setDay(d, { closed: e.target.checked })} />
                <input
                  type="time"
                  className="input"
                  dir="ltr"
                  aria-label={t('onlineStore.hours.open')}
                  value={h.open}
                  disabled={h.closed}
                  onChange={(e) => e.target.value && setDay(d, { open: e.target.value })}
                />
                <input
                  type="time"
                  className="input"
                  dir="ltr"
                  aria-label={t('onlineStore.hours.close')}
                  value={h.close}
                  disabled={h.closed}
                  onChange={(e) => e.target.value && setDay(d, { close: e.target.value })}
                />
              </div>
            ))}
          </div>
          <div className="os-zones">
            <div className="os-zones__head">
              <strong>{t('onlineStore.zones.title')}</strong>
              <span>{t('onlineStore.zones.hint')}</span>
            </div>
            {draft.deliveryZones.map((z, i) => (
              <div key={z.id} className="os-zones__row">
                <TextInput
                  label={t('onlineStore.zones.name')}
                  maxLength={ZONE_NAME_MAX}
                  value={z.name}
                  onChange={(e) => setZone(i, { name: e.target.value })}
                />
                <TextInput
                  label={t('onlineStore.zones.fee')}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.25"
                  dir="ltr"
                  value={String(z.feeUsdCents / 100)}
                  onChange={(e) => setZone(i, { feeUsdCents: toCents(e.target.value, DELIVERY_FEE_MAX_USD_CENTS) })}
                />
                <Button variant="ghost" onClick={() => removeZone(i)}>
                  {t('onlineStore.zones.remove')}
                </Button>
              </div>
            ))}
            {draft.deliveryZones.length < DELIVERY_ZONES_MAX && (
              <div>
                <Button variant="secondary" onClick={addZone}>
                  {t('onlineStore.zones.add')}
                </Button>
              </div>
            )}
          </div>
          {brandingDirty && <Alert tone="warning">{t('onlineStore.unsaved')}</Alert>}
          <div className="modal-actions">
            <Button variant="primary" loading={action.busy} disabled={!brandingDirty} onClick={() => void saveDraft()}>
              {t('onlineStore.saveDraft')}
            </Button>
          </div>
        </div>
      </Card>

      <Card title={t('onlineStore.slug')}>
        <div className="stack">
          <TextInput
            label={t('onlineStore.slug')}
            hint={t('onlineStore.slugHint')}
            dir="ltr"
            maxLength={30}
            autoCapitalize="off"
            spellCheck={false}
            value={slugInput}
            error={
              slugIssue === 'format'
                ? t('error.onlineStore.slugInvalid')
                : slugIssue === 'reserved'
                  ? t('error.onlineStore.slugReserved')
                  : undefined
            }
            onChange={(e) => setSlugInput(e.target.value)}
          />
          {config.slug && <p className="muted">{t('onlineStore.slugCurrent', { slug: config.slug })}</p>}
          <div className="modal-actions">
            <Button
              variant="primary"
              loading={action.busy}
              disabled={!slug || slugIssue !== null || slug === config.slug}
              onClick={() => void saveSlug()}
            >
              {t('onlineStore.slugSave')}
            </Button>
          </div>
        </div>
      </Card>

      <Card title={t('onlineStore.domain.title')}>
        <div className="stack">
          <TextInput
            label={t('onlineStore.domain.label')}
            hint={t('onlineStore.domain.hint')}
            dir="ltr"
            maxLength={140}
            autoCapitalize="off"
            spellCheck={false}
            placeholder="shop.example.com"
            value={domainInput}
            error={domainIssue ? t(`error.onlineStore.domain.${domainIssue}`) : undefined}
            onChange={(e) => setDomainInput(e.target.value)}
          />
          {config.customDomain ? (
            <ol className="os-domain-steps muted">
              <li>{t('onlineStore.domain.step1', { domain: config.customDomain })}</li>
              <li>{t('onlineStore.domain.step2')}</li>
              <li>{t('onlineStore.domain.step3', { domain: config.customDomain })}</li>
            </ol>
          ) : null}
          <div className="modal-actions">
            <Button
              variant="primary"
              loading={action.busy}
              disabled={domainIssue !== null || domain === config.customDomain}
              onClick={() => void saveDomain()}
            >
              {t(domain || !config.customDomain ? 'onlineStore.domain.save' : 'onlineStore.domain.remove')}
            </Button>
          </div>
        </div>
      </Card>

      <Card title={t('onlineStore.products')}>
        <div className="stack">
          <p className="muted">{t('onlineStore.productsHint')}</p>
          {initial.products.length === 0 ? (
            <EmptyState icon="box" title={t('onlineStore.productsEmpty')} message={t('onlineStore.productsEmptyHint')} />
          ) : (
            <>
              <SearchBox value={search} onChange={setSearch} placeholder={t('common.search')} />
              <p className="muted">{t('onlineStore.productsSelected', { count: selected.length, max: MAX_VISIBLE_PRODUCTS })}</p>
              {initial.productsTruncated && <Alert tone="info">{t('onlineStore.productsTruncated')}</Alert>}
              {filtered.length === 0 ? (
                <p className="muted">{t('onlineStore.productsNoMatch')}</p>
              ) : (
                <div className="stack">
                  {filtered.map((p) => {
                    const listing = config.listings[p.id];
                    const pct = listing ? discountPercent({ priceUsdCents: p.priceUsdCents, compareAtUsdCents: listing.compareAtUsdCents }) : null;
                    return (
                      <div key={p.id} className="os-product">
                        <div className="os-product__row">
                          <Checkbox
                            label={`${p.name} · ${formatUsd(p.priceUsdCents)}${p.category ? ` · ${p.category}` : ''}`}
                            checked={selected.includes(p.id)}
                            onChange={(e) => toggleProduct(p.id, e.target.checked)}
                          />
                          <div className="os-product__tags">
                            {pct !== null && <Badge tone="success">−{pct}%</Badge>}
                            {listing?.description && <Badge tone="info">{t('onlineStore.listing.hasDesc')}</Badge>}
                            <Button variant="ghost" size="sm" onClick={() => setEditing(editing === p.id ? null : p.id)}>
                              {t('onlineStore.listing.edit')}
                            </Button>
                          </div>
                        </div>
                        {editing === p.id && (
                          <ListingEditor
                            key={p.id}
                            productId={p.id}
                            priceUsdCents={p.priceUsdCents}
                            listing={listing}
                            onSaved={(next) => {
                              // Only the listings change; keep any unsaved branding edits on screen.
                              setConfig((c) => ({ ...c, listings: next.listings }));
                              setEditing(null);
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="modal-actions">
                <Button variant="primary" loading={action.busy} disabled={!productsDirty} onClick={() => void saveProducts()}>
                  {t('onlineStore.productsSave')}
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>

      <Card title={t('onlineStore.preview')}>
        <div className="stack">
          <p className="muted">{t('onlineStore.previewHint')}</p>
          <div
            dir={isRtl(preview.defaultLocale) ? 'rtl' : 'ltr'}
            style={{
              background: preview.primaryColor,
              color: '#FFFFFF',
              borderRadius: 12,
              padding: 20,
              fontFamily: previewFont,
              borderBottom: `6px solid ${preview.accentColor}`,
            }}
          >
            <strong style={{ fontSize: 22 }}>{preview.storeName || '—'}</strong>
            {preview.tagline && <p style={{ margin: '6px 0 0' }}>{preview.tagline}</p>}
            <small>{t(`onlineStore.template.${preview.template}`)}</small>
          </div>
        </div>
      </Card>

      <Card
        title={isPublished ? t('onlineStore.status.published') : t('onlineStore.publish')}
        actions={statusBadge}
      >
        <div className="stack">
          {config.publishedAt !== null && (
            <p className="muted">{t('onlineStore.publishedAt', { date: formatDateTime(config.publishedAt, lang) })}</p>
          )}
          {blockers.length > 0 && (
            <Alert tone="warning">
              {t('onlineStore.blockers')}
              <ul>
                {blockers.map((b) => (
                  <li key={b}>{t(`onlineStore.blocker.${b}`)}</li>
                ))}
              </ul>
            </Alert>
          )}
          <div className="modal-actions">
            {isPublished && (
              <Button variant="secondary" loading={action.busy} onClick={() => void unpublish()}>
                {t('onlineStore.unpublish')}
              </Button>
            )}
            <Button
              variant="primary"
              loading={action.busy}
              disabled={blockers.length > 0 || brandingDirty || productsDirty}
              onClick={() => void publish()}
            >
              {t('onlineStore.publish')}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
