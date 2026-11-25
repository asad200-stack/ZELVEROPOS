import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Layout';
import { useTenant } from '@/contexts/session';
import { useFeedback } from '@/contexts/feedback';
import { guessLookSlot, LOOK_HEM_DEFAULT, LOOK_HEM_MAX, LOOK_HEM_MIN, LOOK_SLOTS, type LookSlot, type OnlineStoreConfig, type PublicProduct } from '@/domain/onlineStore';
import { useI18n } from '@/i18n/i18n';
import { clearLook, makeLook, saveLookFit } from './looks';
import OutfitModel from './OutfitModel';
import { FITTING_ROOM_MIN } from './roomLooks';

const SLOT_KEY = {
  top: 'onlineStore.room.slot.top',
  bottom: 'onlineStore.room.slot.bottom',
  full: 'onlineStore.room.slot.full',
} as const;

/** Pieces shown at first, and added by each "Show more". */
const PAGE = 12;
/** From this many pieces the list gets a search box and filters. */
const TOOLS_FROM = 8;

type View = 'all' | 'ready' | 'missing';

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

  const [view, setView] = useState<View>('all');
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const cats = [...new Set(withPhoto.map((p) => p.category.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const q = query.trim().toLowerCase();
  const shown = (view === 'ready' ? ready : view === 'missing' ? missing : withPhoto).filter(
    (p) => (!cat || p.category.trim() === cat) && (!q || p.name.toLowerCase().includes(q)),
  );
  const visible = shown.slice(0, limit);
  const tools = withPhoto.length >= TOOLS_FROM;
  const reset = () => setLimit(PAGE);

  // Outfits: where each piece is worn, and where a top ends on its photo.
  const slotOf = (p: PublicProduct): LookSlot => config.listings[p.id]?.lookSlot || guessLookSlot(p.name, p.category);
  const tops = ready.filter((p) => slotOf(p) === 'top');
  const bottoms = ready.filter((p) => slotOf(p) === 'bottom');
  const [pairTop, setPairTop] = useState('');
  const [pairBottom, setPairBottom] = useState('');
  const top = tops.find((p) => p.id === pairTop) ?? tops[0];
  const bottom = bottoms.find((p) => p.id === pairBottom) ?? bottoms[0];
  const [hemDraft, setHemDraft] = useState<Record<string, number>>({});
  const savedHem = (id: string) => config.listings[id]?.lookHem || LOOK_HEM_DEFAULT;
  const hem = top ? (hemDraft[top.id] ?? savedHem(top.id)) : LOOK_HEM_DEFAULT;
  const [fitBusy, setFitBusy] = useState(false);
  const saveFit = async (p: PublicProduct, fit: { lookSlot?: LookSlot | ''; lookHem?: number }) => {
    setFitBusy(true);
    try {
      onConfig(await saveLookFit(p.id, config.listings[p.id], fit));
      if (fit.lookHem !== undefined) setHemDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== p.id)));
      notify('success', t('onlineStore.room.fitSaved'));
    } catch (err) {
      console.warn('[fitting room] fit', p.id, err);
      notify('error', t('onlineStore.room.fitFailed'));
    } finally {
      setFitBusy(false);
    }
  };

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
          <>
          {tools && (
            <div className="os-room-tools">
              <div className="os-room-views" role="tablist" aria-label={t('onlineStore.room.title')}>
                {(
                  [
                    ['all', t('onlineStore.room.viewAll', { count: withPhoto.length })],
                    ['ready', t('onlineStore.room.viewReady', { count: ready.length })],
                    ['missing', t('onlineStore.room.viewMissing', { count: missing.length })],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={view === k}
                    onClick={() => {
                      setView(k);
                      reset();
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                type="search"
                className="input os-room-search"
                value={query}
                placeholder={t('onlineStore.room.search')}
                aria-label={t('onlineStore.room.search')}
                onChange={(e) => {
                  setQuery(e.currentTarget.value);
                  reset();
                }}
              />
              {cats.length > 1 && (
                <select
                  className="input os-room-cat"
                  value={cat}
                  aria-label={t('onlineStore.room.category')}
                  onChange={(e) => {
                    setCat(e.currentTarget.value);
                    reset();
                  }}
                >
                  <option value="">{t('onlineStore.room.allCategories')}</option>
                  {cats.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          {shown.length === 0 ? (
            <span className="muted">{t('onlineStore.room.noMatch')}</span>
          ) : (
          <ul className={tools ? 'os-room-list is-compact' : 'os-room-list'}>
            {visible.map((p) => {
              const look = lookOf(p.id);
              return (
                <li key={p.id} className={look ? 'os-room-item is-ready' : 'os-room-item'}>
                  <span className="os-room-img">
                    <img src={look || p.imageUrl || ''} alt="" loading="lazy" />
                  </span>
                  <span className="os-room-name">{p.name}</span>
                  {look ? (
                    <select
                      className="input os-room-slot"
                      value={config.listings[p.id]?.lookSlot ?? ''}
                      disabled={!!job || fitBusy}
                      aria-label={t('onlineStore.room.slot')}
                      onChange={(e) => void saveFit(p, { lookSlot: e.currentTarget.value as LookSlot | '' })}
                    >
                      <option value="">{t('onlineStore.room.slotAuto', { slot: t(SLOT_KEY[guessLookSlot(p.name, p.category)]) })}</option>
                      {LOOK_SLOTS.map((sl) => (
                        <option key={sl} value={sl}>
                          {t(SLOT_KEY[sl])}
                        </option>
                      ))}
                    </select>
                  ) : null}
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
          {shown.length > visible.length && (
            <div>
              <Button variant="ghost" onClick={() => setLimit((n) => n + PAGE * 2)}>
                {t('onlineStore.room.showMore', { count: shown.length - visible.length })}
              </Button>
            </div>
          )}
          </>
        )}
        {top && bottom && (
          <section className="os-outfit" aria-label={t('onlineStore.room.outfitTitle')}>
            <div className="os-outfit-text">
              <b>{t('onlineStore.room.outfitTitle')}</b>
              <span className="muted">{t('onlineStore.room.outfitHint')}</span>
              <label className="os-outfit-field">
                <span>{t('onlineStore.room.slot.top')}</span>
                <select className="input" value={top.id} onChange={(e) => setPairTop(e.currentTarget.value)}>
                  {tops.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="os-outfit-field">
                <span>{t('onlineStore.room.slot.bottom')}</span>
                <select className="input" value={bottom.id} onChange={(e) => setPairBottom(e.currentTarget.value)}>
                  {bottoms.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="os-outfit-field">
                <span>{t('onlineStore.room.hem', { name: top.name })}</span>
                <input
                  type="range"
                  min={LOOK_HEM_MIN}
                  max={LOOK_HEM_MAX}
                  value={hem}
                  onChange={(e) => {
                    const v = Number(e.currentTarget.value);
                    setHemDraft((d) => ({ ...d, [top.id]: v }));
                  }}
                />
              </label>
              <div>
                <Button size="sm" variant="secondary" disabled={fitBusy || hem === savedHem(top.id)} onClick={() => void saveFit(top, { lookHem: hem })}>
                  {t('onlineStore.room.hemSave')}
                </Button>
              </div>
            </div>
            <span className="os-outfit-stage">
              <OutfitModel className="os-outfit-model" topUrl={lookOf(top.id)} bottomUrl={lookOf(bottom.id)} hem={hem} alt={`${top.name} + ${bottom.name}`} />
              <span className="os-outfit-line" style={{ top: `${hem}%` }} aria-hidden="true" />
            </span>
          </section>
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
