import { useState } from 'react';
import { normalizeOrderRef, type PublicOrderTracking } from '@/domain/onlineOrders';
import type { StoreLocale } from '@/domain/onlineStore';
import type { TranslationKey, TParams } from '@/i18n/i18n';
import { toUserMessage, type UserMessage } from '@/services/errors';
import { api } from '@/services/functionsClient';
import { formatDateTime, formatLbp, formatUsd } from '@/utils/format';

type T = (key: TranslationKey, params?: TParams) => string;

interface Props {
  slug: string;
  t: T;
  lang: StoreLocale;
  initialRef?: string;
  initialPhone?: string;
  onClose: () => void;
}

const statusKey = (s: string) => `onlineOrders.status.${s}` as TranslationKey;

export default function StorefrontTrackOrder({ slug, t, lang, initialRef = '', initialPhone = '', onClose }: Props) {
  const [ref, setRef] = useState(initialRef);
  const [phone, setPhone] = useState(initialPhone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UserMessage | null>(null);
  const [result, setResult] = useState<PublicOrderTracking | null>(null);

  async function submit() {
    const normRef = normalizeOrderRef(ref);
    if (!normRef) {
      setError({ key: 'storefront.reviews.needRef' });
      return;
    }
    if (phone.trim().length < 6) {
      setError({ key: 'storefront.reviews.needPhone' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await api.publicTrackOrder({ slug, ref: normRef, phone }));
    } catch (e) {
      setResult(null);
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="sf-scrim" onClick={onClose} />
      <aside className="sf-drawer sf-track" role="dialog" aria-modal="true" aria-label={t('storefront.track.title')}>
        <div className="sf-drawer-head">
          <h2>{t('storefront.track.title')}</h2>
          <button type="button" className="sf-x" onClick={onClose} aria-label={t('storefront.track.close')}>
            ×
          </button>
        </div>
        <div className="sf-drawer-body">
          <form
            className="sf-track-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <p className="sf-muted">{t('storefront.track.hint')}</p>
            <label className="sf-field">
              <span>{t('storefront.track.ref')}</span>
              <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="ZV-000123" autoComplete="off" />
            </label>
            <label className="sf-field">
              <span>{t('storefront.track.phone')}</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" />
            </label>
            {error && (
              <p className="sf-msg sf-msg-err" role="alert">
                {t(error.key, error.params)}
              </p>
            )}
            <button type="submit" className="sf-primary" disabled={busy}>
              {busy ? t('storefront.track.searching') : t('storefront.track.submit')}
            </button>
          </form>

          {result && (
            <section className="sf-track-result" aria-live="polite">
              <div className="sf-track-top">
                <span className="sf-ref">{result.ref}</span>
                <span className={`sf-track-badge s-${result.status}`}>{t(statusKey(result.status))}</span>
              </div>
              <p className="sf-muted">
                {t('storefront.track.placed', { date: formatDateTime(result.createdAtMs, lang) })}
              </p>
              <p className="sf-total">
                <span>{t('storefront.track.total')}</span>
                <strong>
                  {formatUsd(result.totalUsdCents)}
                  {result.totalLbp > 0 && <small> · {formatLbp(result.totalLbp, lang)}</small>}
                </strong>
              </p>
              {result.history.length > 0 && (
                <>
                  <h3>{t('storefront.track.history')}</h3>
                  <ol className="sf-timeline">
                    {result.history.map((h, i) => (
                      <li key={`${h.status}-${h.atMs}-${i}`} className={i === result.history.length - 1 ? 'now' : undefined}>
                        <strong>{t(statusKey(h.status))}</strong>
                        <span className="sf-muted">{formatDateTime(h.atMs, lang)}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </section>
          )}
        </div>
      </aside>
    </>
  );
}
