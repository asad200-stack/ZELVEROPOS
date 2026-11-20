import { useState } from 'react';
import { normalizeOrderRef, REVIEW_TEXT_MAX } from '@/domain/onlineOrders';
import type { StoreLocale } from '@/domain/onlineStore';
import { useAsyncData } from '@/hooks/useAsyncData';
import type { TranslationKey, TParams } from '@/i18n/i18n';
import { toUserMessage, type UserMessage } from '@/services/errors';
import { api } from '@/services/functionsClient';
import { formatDate } from '@/utils/format';

type T = (key: TranslationKey, params?: TParams) => string;

export function Stars({ value, label }: { value: number; label: string }) {
  const full = Math.round(value);
  return (
    <span className="sf-stars" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} aria-hidden="true" className={i <= full ? 'on' : undefined}>
          ★
        </span>
      ))}
    </span>
  );
}

interface Props {
  slug: string;
  productId: string;
  t: T;
  lang: StoreLocale;
}

export default function StorefrontReviews({ slug, productId, t, lang }: Props) {
  const data = useAsyncData(`reviews:${slug}:${productId}`, () => api.publicProductReviews({ slug, productId }));
  const [formOpen, setFormOpen] = useState(false);
  const [ref, setRef] = useState('');
  const [phone, setPhone] = useState('');
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UserMessage | null>(null);
  const [sent, setSent] = useState(false);

  const reviews = data.data?.reviews ?? [];
  const summary = data.data?.summary ?? { count: 0, average: 0 };
  const normRef = normalizeOrderRef(ref);
  const localProblem: TranslationKey | null = !normRef
    ? 'storefront.reviews.needRef'
    : phone.trim().length < 6
      ? 'storefront.reviews.needPhone'
      : rating < 1
        ? 'storefront.reviews.needRating'
        : null;

  async function submit() {
    if (localProblem || !normRef) {
      setError({ key: localProblem ?? 'storefront.reviews.needRef' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.publicSubmitReview({ slug, ref: normRef, phone, productId, rating, text: text.trim() });
      setSent(true);
      setFormOpen(false);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sf-reviews" aria-label={t('storefront.reviews.title')}>
      <div className="sf-reviews-head">
        <h3>{t('storefront.reviews.title')}</h3>
        {summary.count > 0 && (
          <span className="sf-reviews-sum">
            <Stars value={summary.average} label={t('storefront.reviews.average', { avg: summary.average })} />
            <span className="sf-muted">
              {summary.average} · {t('storefront.reviews.count', { count: summary.count })}
            </span>
          </span>
        )}
      </div>

      {data.loading && <p className="sf-muted">{t('storefront.loading')}</p>}
      {!data.loading && reviews.length === 0 && <p className="sf-muted">{t('storefront.reviews.none')}</p>}
      {reviews.length > 0 && (
        <ul className="sf-review-list">
          {reviews.map((r, i) => (
            <li key={`${r.createdAtMs}-${i}`}>
              <div className="sf-review-top">
                <strong>{r.name}</strong>
                <Stars value={r.rating} label={t('storefront.reviews.rated', { rating: r.rating })} />
                <span className="sf-muted">{formatDate(r.createdAtMs, lang)}</span>
              </div>
              {r.text && <p>{r.text}</p>}
            </li>
          ))}
        </ul>
      )}

      {sent && (
        <p className="sf-msg" role="status">
          {t('storefront.reviews.thanks')}
        </p>
      )}

      {!formOpen && !sent && (
        <button type="button" className="sf-link" onClick={() => setFormOpen(true)}>
          {t('storefront.reviews.write')}
        </button>
      )}

      {formOpen && (
        <form
          className="sf-review-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="sf-muted">{t('storefront.reviews.verifiedOnly')}</p>
          <label className="sf-field">
            <span>{t('storefront.track.ref')}</span>
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="ZV-000123" autoComplete="off" />
          </label>
          <label className="sf-field">
            <span>{t('storefront.track.phone')}</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" />
          </label>
          <fieldset className="sf-rate">
            <legend>{t('storefront.reviews.yourRating')}</legend>
            {[1, 2, 3, 4, 5].map((i) => (
              <button
                key={i}
                type="button"
                className={i <= rating ? 'on' : undefined}
                aria-pressed={i === rating}
                aria-label={t('storefront.reviews.rated', { rating: i })}
                onClick={() => setRating(i)}
              >
                ★
              </button>
            ))}
          </fieldset>
          <label className="sf-field">
            <span>{t('storefront.reviews.text')}</span>
            <textarea value={text} maxLength={REVIEW_TEXT_MAX} rows={3} onChange={(e) => setText(e.target.value)} />
          </label>
          {error && (
            <p className="sf-msg sf-msg-err" role="alert">
              {t(error.key, error.params)}
            </p>
          )}
          <div className="sf-review-actions">
            <button type="button" className="sf-ghost" onClick={() => setFormOpen(false)}>
              {t('storefront.reviews.cancel')}
            </button>
            <button type="submit" className="sf-primary" disabled={busy}>
              {busy ? t('storefront.reviews.sending') : t('storefront.reviews.submit')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
