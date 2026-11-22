import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { FormGrid, TextArea, TextInput } from '@/components/ui/Form';
import { useTenant } from '@/contexts/session';
import { useFeedback } from '@/contexts/feedback';
import {
  HERO_CTA_MAX,
  HERO_SUBTITLE_MAX,
  HERO_TITLE_MAX,
  STORE_SECTIONS,
  STORE_THEMES,
  type OnlineStoreConfig,
  type PublicProduct,
  type StoreBranding,
  type StoreSection,
  type StoreTheme,
} from '@/domain/onlineStore';
import { useI18n } from '@/i18n/i18n';
import { deleteStorageFile, storagePathFromUrl, uploadTenantImage } from '@/services/storageService';
import { HeroPicker } from './HeroPicker';
import { applyPreset, matchingKind, STORE_KINDS, STORE_PRESETS, type StoreKind } from './storePresets';

/** Colours each theme was designed around; offered when the owner switches theme. */
const THEME_COLORS: Record<StoreTheme, { primaryColor: string; accentColor: string }> = {
  classic: { primaryColor: '#1F6FEB', accentColor: '#F59E0B' },
  perfume: { primaryColor: '#C9A46A', accentColor: '#7A5A44' },
  atelier: { primaryColor: '#1C1A17', accentColor: '#B9A88F' },
  studio: { primaryColor: '#FF4A1C', accentColor: '#111111' },
  bistro: { primaryColor: '#2F4A33', accentColor: '#E0A82E' },
  tech: { primaryColor: '#4C7DFF', accentColor: '#0E1217' },
  jewel: { primaryColor: '#E2C3B4', accentColor: '#0F1630' },
  bloom: { primaryColor: '#4F6B4A', accentColor: '#E8A49C' },
};

interface Props {
  draft: StoreBranding;
  set: <K extends keyof StoreBranding>(key: K, value: StoreBranding[K]) => void;
  /** Products shown online, for the 3D showcase picker. */
  products: PublicProduct[];
  config: OnlineStoreConfig;
  onConfig: (next: OnlineStoreConfig) => void;
}

/** Theme, hero text and photo, and the order of the home page sections. Saved with the draft. */
export function StoreDesignEditor({ draft, set, products, config, onConfig }: Props) {
  const { t } = useI18n();
  const { tenantId } = useTenant();
  const { notify } = useFeedback();
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const pickTheme = (theme: StoreTheme) => {
    if (theme === draft.theme) return;
    set('theme', theme);
    // Only swap colours the owner hasn't customised away from the previous theme's own.
    const before = THEME_COLORS[draft.theme];
    if (draft.primaryColor.toUpperCase() === before.primaryColor && draft.accentColor.toUpperCase() === before.accentColor) {
      set('primaryColor', THEME_COLORS[theme].primaryColor);
      set('accentColor', THEME_COLORS[theme].accentColor);
    }
  };

  /** Deletes a replaced hero photo that only the draft used (the live site keeps its own). */
  const dropDraftHero = async (url: string) => {
    const path = url ? storagePathFromUrl(url) : null;
    if (!path || !path.startsWith(`tenants/${tenantId}/logo/store-hero-`)) return;
    if (url === config.published?.heroImageUrl || url === config.draft.heroImageUrl) return;
    await deleteStorageFile(path);
  };

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try {
      const res = await uploadTenantImage(tenantId, 'logo', 'store-hero', f);
      await dropDraftHero(draft.heroImageUrl);
      set('heroImageUrl', res.url);
    } catch {
      notify('error', t('onlineStore.design.uploadFailed'));
    } finally {
      setUploading(false);
      if (file.current) file.current.value = '';
    }
  };

  const shown = draft.sections;
  const hidden = STORE_SECTIONS.filter((k) => !shown.includes(k));
  const move = (k: StoreSection, dir: -1 | 1) => {
    const i = shown.indexOf(k);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= shown.length) return;
    const next = [...shown];
    [next[i], next[j]] = [next[j] as StoreSection, next[i] as StoreSection];
    set('sections', next);
  };
  const toggle = (k: StoreSection, on: boolean) => {
    if (!on) {
      set('sections', shown.filter((x) => x !== k));
      return;
    }
    // A section that comes back is placed just above the product list.
    const next: StoreSection[] = shown.filter((x) => x !== 'catalog' && x !== k);
    next.push(k, 'catalog');
    set('sections', next);
  };

  const kind = matchingKind(draft);
  const pickKind = (k: StoreKind) => {
    const next = applyPreset(draft, k);
    for (const key of Object.keys(next) as (keyof StoreBranding)[]) {
      if (JSON.stringify(next[key]) !== JSON.stringify(draft[key])) set(key, next[key]);
    }
  };

  return (
    <div className="stack os-design">
      <h3 className="os-design-title">{t('onlineStore.design.title')}</h3>

      <div className="stack" style={{ gap: 8 }}>
        <b>{t('onlineStore.kind.title')}</b>
        <span className="muted">{t('onlineStore.kind.hint')}</span>
        <div className="os-kinds" role="radiogroup" aria-label={t('onlineStore.kind.title')}>
          {STORE_KINDS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className="os-kind" onClick={() => pickKind(k)}>
              <span className="os-kind-swatch" aria-hidden="true" style={{ background: STORE_PRESETS[k].primaryColor }} />
              {t(`onlineStore.kind.${k}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="os-themes" role="radiogroup" aria-label={t('onlineStore.design.theme')}>
        {STORE_THEMES.map((theme) => (
          <button
            key={theme}
            type="button"
            role="radio"
            aria-checked={draft.theme === theme}
            className={`os-theme os-theme--${theme}`}
            onClick={() => pickTheme(theme)}
          >
            <span className="os-theme-art" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <b>{t(`onlineStore.design.theme.${theme}`)}</b>
            <small>{t(`onlineStore.design.themeHint.${theme}`)}</small>
          </button>
        ))}
      </div>

      {draft.theme !== 'classic' && (
        <HeroPicker products={products} picked={draft.heroProductIds} onPick={(ids) => set('heroProductIds', ids)} config={config} onConfig={onConfig} />
      )}

      <FormGrid cols={2}>
        <TextInput
          label={t('onlineStore.design.heroTitle')}
          hint={t('onlineStore.design.heroTitleHint')}
          maxLength={HERO_TITLE_MAX}
          value={draft.heroTitle}
          placeholder={draft.storeName}
          onChange={(e) => set('heroTitle', e.target.value)}
        />
        <TextInput
          label={t('onlineStore.design.heroCta')}
          maxLength={HERO_CTA_MAX}
          value={draft.heroCta}
          placeholder={t('storefront.shopNow')}
          onChange={(e) => set('heroCta', e.target.value)}
        />
        <TextArea
          label={t('onlineStore.design.heroSubtitle')}
          fieldClassName="span-2"
          rows={2}
          maxLength={HERO_SUBTITLE_MAX}
          value={draft.heroSubtitle}
          placeholder={draft.tagline}
          onChange={(e) => set('heroSubtitle', e.target.value)}
        />
      </FormGrid>

      <div className="os-hero-img">
        <div className="os-hero-thumb">
          {draft.heroImageUrl ? <img src={draft.heroImageUrl} alt="" /> : <span className="muted">{t('onlineStore.design.heroImageNone')}</span>}
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <b>{t('onlineStore.design.heroImage')}</b>
          <span className="muted">{t('onlineStore.design.heroImageHint')}</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void upload(e.target.files?.[0])} />
            <Button variant="secondary" loading={uploading} onClick={() => file.current?.click()}>
              {t(draft.heroImageUrl ? 'onlineStore.design.heroImageChange' : 'onlineStore.design.heroImageUpload')}
            </Button>
            {draft.heroImageUrl && (
              <Button
                variant="ghost"
                onClick={() => {
                  void dropDraftHero(draft.heroImageUrl);
                  set('heroImageUrl', '');
                }}
              >
                {t('onlineStore.design.heroImageRemove')}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <b>{t('onlineStore.design.sections')}</b>
        <span className="muted">{t('onlineStore.design.sectionsHint')}</span>
        <ol className="os-sections">
          {shown.map((k, i) => (
            <li key={k}>
              <span>{t(`onlineStore.design.section.${k}`)}</span>
              <span className="os-sections-tools">
                <Button size="sm" variant="ghost" disabled={i === 0} aria-label={t('onlineStore.design.moveUp')} onClick={() => move(k, -1)}>
                  ↑
                </Button>
                <Button size="sm" variant="ghost" disabled={i === shown.length - 1} aria-label={t('onlineStore.design.moveDown')} onClick={() => move(k, 1)}>
                  ↓
                </Button>
                {k !== 'catalog' && (
                  <Button size="sm" variant="ghost" onClick={() => toggle(k, false)}>
                    {t('onlineStore.design.hide')}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ol>
        {hidden.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {hidden.map((k) => (
              <Button key={k} size="sm" variant="secondary" onClick={() => toggle(k, true)}>
                {t('onlineStore.design.show', { name: t(`onlineStore.design.section.${k}`) })}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
