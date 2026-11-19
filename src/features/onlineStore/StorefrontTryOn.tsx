import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { PublicProduct } from '@/domain/onlineStore';
import type { TranslationKey, TParams } from '@/i18n/i18n';
import type { FitKind as Kind, FitPref } from './sizeAdvisor';
import { clamp, garmentPlacement, measureBody, type Placement, type Pt } from './tryOnMeasure';

type T = (key: TranslationKey, params?: TParams) => string;

interface Props {
  product: PublicProduct;
  kind: Kind;
  t: T;
  onSize: (size: string) => void;
  onClose: () => void;
}

const FITS: { id: FitPref; key: TranslationKey }[] = [
  { id: 'snug', key: 'storefront.fitSnug' },
  { id: 'regular', key: 'storefront.fitRegular' },
  { id: 'loose', key: 'storefront.fitLoose' },
];

const STEPS: TranslationKey[] = [
  'storefront.tryOnStepHead',
  'storefront.tryOnStepFeet',
  'storefront.tryOnStepShoulderA',
  'storefront.tryOnStepShoulderB',
];

function defaultPlacement(kind: Kind): Placement {
  return kind === 'shoes' ? { cx: 0.5, cy: 0.88, w: 0.35, rot: 0 } : { cx: 0.5, cy: 0.45, w: 0.5, rot: 0 };
}

/**
 * On-device try-on: the customer's photo is read with an object URL and never
 * leaves the browser. The product image is layered on top and can be moved,
 * scaled and rotated; apparel can also be measured with four taps.
 */
export default function StorefrontTryOn({ product, kind, t, onSize, onClose }: Props) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [place, setPlace] = useState<Placement>(() => defaultPlacement(kind));
  const [opacity, setOpacity] = useState(0.92);
  const [measuring, setMeasuring] = useState(false);
  const [marks, setMarks] = useState<Pt[]>([]);
  const [height, setHeight] = useState('');
  const [fit, setFit] = useState<FitPref>('regular');
  const [result, setResult] = useState<{ shoulderCm: number; size: string } | null>(null);
  const [bad, setBad] = useState(false);
  const stage = useRef<HTMLDivElement | null>(null);
  const camera = useRef<HTMLInputElement | null>(null);
  const gallery = useRef<HTMLInputElement | null>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function pick(input: HTMLInputElement) {
    const f = input.files?.[0];
    // Allow choosing the same file again later.
    input.value = '';
    if (!f || !f.type.startsWith('image/')) return;
    // A data: URL keeps the photo on the device and is allowed by the
    // production CSP (img-src 'self' data:), unlike blob: object URLs.
    const reader = new FileReader();
    reader.onload = () => {
      if (!alive.current || typeof reader.result !== 'string') return;
      setDims(null);
      setPhoto(reader.result);
      setPlace(defaultPlacement(kind));
      setMarks([]);
      setResult(null);
      setBad(false);
      setMeasuring(false);
    };
    reader.readAsDataURL(f);
  }

  function key(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    onClose();
  }

  function grab(e: PointerEvent<HTMLImageElement>) {
    if (measuring) return;
    e.preventDefault();
    drag.current = { x: e.clientX, y: e.clientY, cx: place.cx, cy: place.cy };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function slide(e: PointerEvent<HTMLImageElement>) {
    const d = drag.current;
    const r = stage.current?.getBoundingClientRect();
    if (!d || !r || r.width === 0 || r.height === 0) return;
    const cx = clamp(d.cx + (e.clientX - d.x) / r.width, 0, 1);
    const cy = clamp(d.cy + (e.clientY - d.y) / r.height, 0, 1);
    setPlace((p) => ({ ...p, cx, cy }));
  }

  function tap(e: PointerEvent<HTMLDivElement>) {
    if (!measuring || !dims || marks.length >= 4) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const pt = { x: ((e.clientX - r.left) / r.width) * dims.w, y: ((e.clientY - r.top) / r.height) * dims.h };
    setMarks((m) => [...m, pt]);
  }

  function calc() {
    if (!dims || marks.length < 4) return;
    const [head, feet, a, b] = marks as [Pt, Pt, Pt, Pt];
    const left = a.x <= b.x ? a : b;
    const right = a.x <= b.x ? b : a;
    const r = measureBody({ head, feet, leftShoulder: left, rightShoulder: right }, Number(height), fit);
    setBad(r === null);
    setResult(r);
    if (r) {
      const p = garmentPlacement(left, right, dims.w, dims.h);
      if (p) setPlace(p);
      setMeasuring(false);
    }
  }

  function startMeasure() {
    setMarks([]);
    setResult(null);
    setBad(false);
    setMeasuring(true);
  }

  const step = marks.length < 4 ? STEPS[marks.length] : null;

  return (
    <>
      <div className="sf-scrim sf-to-scrim" onClick={onClose} />
      <div className="sf-to" role="dialog" aria-modal="true" aria-labelledby="sf-to-title" onKeyDown={key}>
        <div className="sf-to-head">
          <h2 id="sf-to-title">{t('storefront.tryOnTitle')}</h2>
          <button type="button" className="sf-x" aria-label={t('storefront.close')} onClick={onClose} autoFocus>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <input ref={camera} type="file" accept="image/*" capture="user" hidden onChange={(e) => pick(e.currentTarget)} />
        <input ref={gallery} type="file" accept="image/*" hidden onChange={(e) => pick(e.currentTarget)} />

        {!photo ? (
          <div className="sf-to-intro">
            <div className="sf-to-preview">{product.imageUrl && <img src={product.imageUrl} alt="" />}</div>
            <p className="sf-to-privacy">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
              {t('storefront.tryOnPrivacy')}
            </p>
            <div className="sf-to-pick">
              <button type="button" className="sf-primary" onClick={() => camera.current?.click()}>
                {t('storefront.tryOnTake')}
              </button>
              <button type="button" className="sf-ghost" onClick={() => gallery.current?.click()}>
                {t('storefront.tryOnChoose')}
              </button>
            </div>
          </div>
        ) : (
          <div className="sf-to-body">
            <div
              ref={stage}
              className={measuring ? 'sf-to-stage is-measure' : 'sf-to-stage'}
              style={dims ? { aspectRatio: `${dims.w} / ${dims.h}` } : undefined}
              onPointerDown={tap}
            >
              <img className="sf-to-photo" src={photo} alt="" draggable={false} onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
              {dims && product.imageUrl && !measuring && (
                <img
                  className="sf-to-item"
                  src={product.imageUrl}
                  alt={product.name}
                  draggable={false}
                  style={{
                    left: `${place.cx * 100}%`,
                    top: `${place.cy * 100}%`,
                    width: `${place.w * 100}%`,
                    opacity,
                    transform: `translate(-50%, -50%) rotate(${place.rot}deg)`,
                  }}
                  onPointerDown={grab}
                  onPointerMove={slide}
                  onPointerUp={() => (drag.current = null)}
                  onPointerCancel={() => (drag.current = null)}
                />
              )}
              {dims &&
                marks.map((m, i) => (
                  <span key={i} className="sf-to-dot" style={{ left: `${(m.x / dims.w) * 100}%`, top: `${(m.y / dims.h) * 100}%` }} aria-hidden="true">
                    {i + 1}
                  </span>
                ))}
            </div>

            <div className="sf-to-panel">
              {measuring ? (
                <div className="sf-to-measure" aria-live="polite">
                  {step ? (
                    <p className="sf-to-step">
                      <b>{marks.length + 1}/4</b> {t(step)}
                    </p>
                  ) : (
                    <>
                      <label className="sf-field">
                        {t('storefront.height')}
                        <input inputMode="numeric" dir="ltr" value={height} onChange={(e) => setHeight(e.target.value)} />
                      </label>
                      <div className="sf-seg sf-seg-sm" role="radiogroup" aria-label={t('storefront.fit')}>
                        {FITS.map((f) => (
                          <label key={f.id}>
                            <input type="radio" name="sf-to-fit" checked={fit === f.id} onChange={() => setFit(f.id)} />
                            <span>{t(f.key)}</span>
                          </label>
                        ))}
                      </div>
                      <button type="button" className="sf-primary" onClick={calc}>
                        {t('storefront.tryOnCalc')}
                      </button>
                    </>
                  )}
                  {bad && (
                    <p className="sf-msg sf-msg-warn" role="alert">
                      {t('storefront.tryOnBad')}
                    </p>
                  )}
                  <div className="sf-to-row">
                    <button type="button" className="sf-link" onClick={startMeasure}>
                      {t('storefront.tryOnRedo')}
                    </button>
                    <button type="button" className="sf-link" onClick={() => setMeasuring(false)}>
                      {t('storefront.close')}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="sf-muted">{t('storefront.tryOnDrag')}</p>
                  <label className="sf-to-range">
                    <span>{t('storefront.tryOnSizeCtl')}</span>
                    <input type="range" min={10} max={150} value={Math.round(place.w * 100)} onChange={(e) => setPlace((p) => ({ ...p, w: Number(e.target.value) / 100 }))} />
                  </label>
                  <label className="sf-to-range">
                    <span>{t('storefront.tryOnRotate')}</span>
                    <input type="range" min={-45} max={45} value={Math.round(place.rot)} onChange={(e) => setPlace((p) => ({ ...p, rot: Number(e.target.value) }))} />
                  </label>
                  <label className="sf-to-range">
                    <span>{t('storefront.tryOnOpacity')}</span>
                    <input type="range" min={30} max={100} value={Math.round(opacity * 100)} onChange={(e) => setOpacity(Number(e.target.value) / 100)} />
                  </label>
                  {result && (
                    <div className="sf-advice" aria-live="polite">
                      <span>
                        {t('storefront.tryOnShoulders', { cm: result.shoulderCm })} · <b>{t('storefront.recommended', { size: result.size })}</b>
                      </span>
                      <button type="button" className="sf-link" onClick={() => onSize(result.size)}>
                        {t('storefront.useSize')}
                      </button>
                    </div>
                  )}
                  <div className="sf-to-row">
                    {kind === 'apparel' && (
                      <button type="button" className="sf-ghost" onClick={startMeasure} disabled={!dims}>
                        {t('storefront.tryOnMeasure')}
                      </button>
                    )}
                    <button type="button" className="sf-link" onClick={() => setPlace(defaultPlacement(kind))}>
                      {t('storefront.tryOnReset')}
                    </button>
                    <button type="button" className="sf-link" onClick={() => gallery.current?.click()}>
                      {t('storefront.tryOnChange')}
                    </button>
                  </div>
                  <small className="sf-muted">{t('storefront.sizeGuideNote')}</small>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
