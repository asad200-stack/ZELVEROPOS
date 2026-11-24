import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Layout';
import { useTenant } from '@/contexts/session';
import { useFeedback } from '@/contexts/feedback';
import type { OnlineStoreConfig, PublicProduct } from '@/domain/onlineStore';
import { useI18n } from '@/i18n/i18n';
import { clearLook, makeLook } from './looks';
import { FITTING_ROOM_MIN } from './roomLooks';

interface Props {
  /** Products shown online. */
  products: PublicProduct[];
  config: OnlineStoreConfig;
  onConfig: (next: OnlineStoreConfig) => void;
}

/**
 * The owner sets up the store's fitting room: one photo per piece of the model (or mannequin)
 * wearing it. The background is removed on this device, so it costs nothing.
 */
export function FittingRoomCard({ products, config, onConfig }: Props) {
  const { t } = useI18n();
  const { tenantId } = useTenant();
  const { notify } = useFeedback();
  const file = useRef<HTMLInputElement | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [job, setJob] = useState<{ done: number; total: number; model: number | null } | null>(null);

  const withPhoto = products.filter((p) => p.imageUrl);
  const lookOf = (id: string) => config.listings[id]?.lookUrl ?? '';
  const ready = withPhoto.filter((p) => lookOf(p.id));
  const missing = withPhoto.filter((p) => !lookOf(p.id));

  const run = async (items: PublicProduct[], photo: Blob | null) => {
    let cfg = config;
    let failed = 0;
    setJob({ done: 0, total: items.length, model: null });
    for (const [i, p] of items.entries()) {
      try {
        cfg = await makeLook(tenantId, p, cfg.listings[p.id], photo, (pr) =>
          setJob({ done: i, total: items.length, model: pr.phase === 'loading-model' ? (pr.progress ?? 0) : null }),
        );
        onConfig(cfg);
      } catch (err) {
        console.warn('[fitting room]', p.id, err);
        failed++;
      }
      setJob({ done: i + 1, total: items.length, model: null });
    }
    setJob(null);
    notify(failed ? 'warning' : 'success', failed ? t('onlineStore.room.someFailed', { count: failed }) : t('onlineStore.room.done'));
  };

  const drop = async (p: PublicProduct) => {
    setJob({ done: 0, total: 1, model: null });
    try {
      onConfig(await clearLook(tenantId, p.id, config.listings[p.id]));
      notify('success', t('onlineStore.room.removed'));
    } catch (err) {
      console.warn('[fitting room]', p.id, err);
      notify('error', t('onlineStore.room.removeFailed'));
    } finally {
      setJob(null);
    }
  };

  const upload = (id: string) => {
    setTarget(id);
    file.current?.click();
  };
  const picked = (input: HTMLInputElement) => {
    const f = input.files?.[0];
    input.value = '';
    const p = withPhoto.find((x) => x.id === target);
    if (!f || !p || !f.type.startsWith('image/')) return;
    void run([p], f);
  };

  return (
    <Card title={t('onlineStore.room.title')}>
      <div className="stack" style={{ gap: 10 }}>
        <p className="muted" style={{ margin: 0 }}>
          {t('onlineStore.room.hint')}
        </p>
        <p style={{ margin: 0 }}>
          <b>{t('onlineStore.room.count', { count: ready.length })}</b>{' '}
          <span className="muted">{ready.length < FITTING_ROOM_MIN ? t('onlineStore.room.needMore', { min: FITTING_ROOM_MIN }) : t('onlineStore.room.live')}</span>
        </p>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => picked(e.currentTarget)} />
        {withPhoto.length === 0 ? (
          <span className="muted">{t('onlineStore.hero.noPhotos')}</span>
        ) : (
          <ul className="os-room-list">
            {withPhoto.map((p) => {
              const look = lookOf(p.id);
              return (
                <li key={p.id} className={look ? 'os-room-item is-ready' : 'os-room-item'}>
                  <span className="os-room-img">
                    <img src={look || p.imageUrl || ''} alt="" loading="lazy" />
                  </span>
                  <span className="os-room-name">{p.name}</span>
                  <span className="os-room-actions">
                    {look ? (
                      <>
                        <Button size="sm" variant="ghost" disabled={!!job} onClick={() => upload(p.id)}>
                          {t('onlineStore.room.change')}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={!!job} onClick={() => void drop(p)}>
                          {t('onlineStore.room.remove')}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="secondary" disabled={!!job} onClick={() => void run([p], null)}>
                          {t('onlineStore.room.fromProduct')}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={!!job} onClick={() => upload(p.id)}>
                          {t('onlineStore.room.upload')}
                        </Button>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {job ? (
          <p className="muted" role="status" style={{ margin: 0 }}>
            {job.model !== null
              ? t('onlineStore.hero.downloading', { pct: Math.round(job.model * 100) })
              : t('onlineStore.hero.working', { done: job.done, total: job.total })}
          </p>
        ) : (
          missing.length > 1 && (
            <div>
              <Button variant="secondary" onClick={() => void run(missing, null)}>
                {t('onlineStore.room.allFromProducts', { count: missing.length })}
              </Button>
            </div>
          )
        )}
      </div>
    </Card>
  );
}
