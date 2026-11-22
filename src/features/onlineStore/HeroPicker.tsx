import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useTenant } from '@/contexts/session';
import { useFeedback } from '@/contexts/feedback';
import { HERO_PRODUCTS_MAX, type OnlineStoreConfig, type PublicProduct } from '@/domain/onlineStore';
import { useI18n } from '@/i18n/i18n';
import { clearCutout, makeCutout } from './cutouts';

interface Props {
  /** Products currently shown online (only these can go in the showcase). */
  products: PublicProduct[];
  picked: string[];
  onPick: (ids: string[]) => void;
  config: OnlineStoreConfig;
  onConfig: (next: OnlineStoreConfig) => void;
}

/**
 * The owner picks the pieces for the 3D showcase and can turn their photos into cut-outs
 * (background removed on this device) in one go.
 */
export function HeroPicker({ products, picked, onPick, config, onConfig }: Props) {
  const { t } = useI18n();
  const { tenantId } = useTenant();
  const { notify } = useFeedback();
  const [job, setJob] = useState<{ done: number; total: number; model: number | null } | null>(null);

  const withPhoto = products.filter((p) => p.imageUrl);
  const cutoutOf = (id: string) => config.listings[id]?.cutoutUrl ?? '';
  const toggle = (id: string) =>
    onPick(picked.includes(id) ? picked.filter((x) => x !== id) : picked.length >= HERO_PRODUCTS_MAX ? picked : [...picked, id]);
  const missing = picked.filter((id) => !cutoutOf(id) && withPhoto.some((p) => p.id === id));
  const missingAll = withPhoto.filter((p) => !cutoutOf(p.id)).map((p) => p.id);

  /** Redo or drop one piece's 3D photo (e.g. when the cut kept part of the background). */
  const redo = async (p: PublicProduct) => {
    setJob({ done: 0, total: 1, model: null });
    try {
      onConfig(
        await makeCutout(tenantId, p, config.listings[p.id], (pr) =>
          setJob({ done: 0, total: 1, model: pr.phase === 'loading-model' ? (pr.progress ?? 0) : null }),
        ),
      );
      notify('success', t('onlineStore.hero.cutoutDone'));
    } catch (err) {
      console.warn('[cutout]', p.id, err);
      notify('error', t('onlineStore.hero.cutoutSomeFailed', { count: 1 }));
    } finally {
      setJob(null);
    }
  };
  const drop = async (p: PublicProduct) => {
    setJob({ done: 0, total: 1, model: null });
    try {
      onConfig(await clearCutout(tenantId, p.id, config.listings[p.id]));
      notify('success', t('onlineStore.hero.cutoutRemoved'));
    } catch (err) {
      console.warn('[cutout]', p.id, err);
      notify('error', t('onlineStore.hero.cutoutRemoveFailed'));
    } finally {
      setJob(null);
    }
  };
  const pickedWithCut = picked
    .map((id) => withPhoto.find((p) => p.id === id))
    .filter((p): p is PublicProduct => !!p && !!cutoutOf(p.id));

  const prepare = async (ids: string[]) => {
    let cfg = config;
    let failed = 0;
    setJob({ done: 0, total: ids.length, model: null });
    for (let i = 0; i < ids.length; i++) {
      const p = withPhoto.find((x) => x.id === ids[i]);
      if (!p) continue;
      try {
        cfg = await makeCutout(tenantId, p, cfg.listings[p.id], (pr) =>
          setJob({ done: i, total: ids.length, model: pr.phase === 'loading-model' ? (pr.progress ?? 0) : null }),
        );
        onConfig(cfg);
      } catch (err) {
        console.warn('[cutout]', p.id, err);
        failed++;
      }
      setJob({ done: i + 1, total: ids.length, model: null });
    }
    setJob(null);
    notify(failed ? 'warning' : 'success', failed ? t('onlineStore.hero.cutoutSomeFailed', { count: failed }) : t('onlineStore.hero.cutoutDone'));
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <b>{t('onlineStore.hero.title')}</b>
      <span className="muted">{t('onlineStore.hero.hint', { max: HERO_PRODUCTS_MAX })}</span>
      {withPhoto.length === 0 ? (
        <span className="muted">{t('onlineStore.hero.noPhotos')}</span>
      ) : (
        <div className="os-hero-pick" role="group" aria-label={t('onlineStore.hero.title')}>
          {withPhoto.map((p) => {
            const n = picked.indexOf(p.id);
            const cut = cutoutOf(p.id);
            return (
              <button key={p.id} type="button" className="os-hero-item" aria-pressed={n >= 0} onClick={() => toggle(p.id)} disabled={!!job}>
                <span className={cut ? 'os-hero-item-img is-cut' : 'os-hero-item-img'}>
                  <img src={cut || p.imageUrl || ''} alt="" loading="lazy" />
                  {n >= 0 && <b className="os-hero-item-n">{n + 1}</b>}
                </span>
                <span className="os-hero-item-name">{p.name}</span>
                <small>{cut ? t('onlineStore.hero.has3d') : t('onlineStore.hero.no3d')}</small>
              </button>
            );
          })}
        </div>
      )}
      {pickedWithCut.length > 0 && (
        <ul className="os-cut-list">
          {pickedWithCut.map((p) => (
            <li key={p.id}>
              <span className="os-cut-thumb">
                <img src={cutoutOf(p.id)} alt="" loading="lazy" />
              </span>
              <span className="os-cut-name">{p.name}</span>
              <Button size="sm" variant="ghost" disabled={!!job} onClick={() => void redo(p)}>
                {t('onlineStore.hero.redo')}
              </Button>
              <Button size="sm" variant="ghost" disabled={!!job} onClick={() => void drop(p)}>
                {t('onlineStore.hero.useNormal')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {job ? (
        <p className="muted" role="status">
          {job.model !== null
            ? t('onlineStore.hero.downloading', { pct: Math.round(job.model * 100) })
            : t('onlineStore.hero.working', { done: job.done, total: job.total })}
        </p>
      ) : missingAll.length > 0 ? (
        <div className="stack" style={{ gap: 6 }}>
          {missingAll.length > missing.length && <span className="muted">{t('onlineStore.hero.mixed', { count: missingAll.length })}</span>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {missing.length > 0 && (
              <Button variant="secondary" onClick={() => void prepare(missing)}>
                {t('onlineStore.hero.prepare', { count: missing.length })}
              </Button>
            )}
            {missingAll.length > missing.length && (
              <Button variant="ghost" onClick={() => void prepare(missingAll)}>
                {t('onlineStore.hero.prepareAll', { count: missingAll.length })}
              </Button>
            )}
          </div>
          <p className="muted" style={{ margin: 0 }}>
            {t('onlineStore.hero.prepareHint')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
