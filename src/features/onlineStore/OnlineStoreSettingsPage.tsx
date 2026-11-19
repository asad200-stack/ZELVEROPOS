// Settings → Online Store (Milestone A). Owner-only; every call is re-authorized on the server.
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, FormGrid, SelectInput, TextArea, TextInput } from '@/components/ui/Form';
import { Alert, Badge, Card, EmptyState, PageHeader, SearchBox } from '@/components/ui/Layout';
import { PageLoader } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import {
  MAX_VISIBLE_PRODUCTS,
  STORE_FONTS,
  STORE_LOCALES,
  STORE_NAME_MAX,
  STORE_TAGLINE_MAX,
  STORE_TEMPLATES,
  isRtl,
  normalizeSlug,
  publishBlockers,
  slugProblem,
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

function OnlineStoreEditor({ initial }: { initial: LoadedStore }) {
  const { t, lang } = useI18n();
  const { notify } = useFeedback();
  const action = useAsyncAction('onlineStore');

  const [config, setConfig] = useState<OnlineStoreConfig>(initial.config);
  const [enabled, setEnabled] = useState(initial.config.enabled);
  const [draft, setDraft] = useState<StoreBranding>(initial.config.draft);
  const [slugInput, setSlugInput] = useState(initial.config.slug ?? '');
  const [selected, setSelected] = useState<string[]>(initial.config.visibleProductIds);
  const [search, setSearch] = useState('');

  const brandingDirty = enabled !== config.enabled || JSON.stringify(draft) !== JSON.stringify(config.draft);
  const productsDirty = selected.join('|') !== config.visibleProductIds.join('|');
  const slug = normalizeSlug(slugInput);
  const slugIssue = slug ? slugProblem(slug) : null;
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
  };

  const saveDraft = async () => {
    const res = await action.run(() => api.onlineStoreSaveDraft({ enabled, draft }));
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

      <Alert tone="info">{t('onlineStore.payments')} {t('onlineStore.ordersSoon')}</Alert>

      <Card title={t('onlineStore.branding')}>
        <div className="stack">
          <Checkbox label={t('onlineStore.enable')} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <p className="muted">{t('onlineStore.enableHint')}</p>
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
          </FormGrid>
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
                  {filtered.map((p) => (
                    <Checkbox
                      key={p.id}
                      label={`${p.name} · ${formatUsd(p.priceUsdCents)}${p.category ? ` · ${p.category}` : ''}`}
                      checked={selected.includes(p.id)}
                      onChange={(e) => toggleProduct(p.id, e.target.checked)}
                    />
                  ))}
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
