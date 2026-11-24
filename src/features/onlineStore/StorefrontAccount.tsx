import { useEffect, useState } from 'react';
import type { StoreLocale } from '@/domain/onlineStore';
import { cleanShopperProfile, type ShopperAccountView, type ShopperOrder, type ShopperProfile } from '@/domain/shopperAccount';
import type { TranslationKey, TParams } from '@/i18n/i18n';
import { toUserMessage } from '@/services/errors';
import { formatDateTime, formatLbp, formatUsd } from '@/utils/format';
import { shopperApi, shopperAuthError, signInShopperWithGoogle, signOutShopper, type Shopper } from './shopperAuth';

type T = (key: TranslationKey, params?: TParams) => string;

interface Props {
  t: T;
  lang: StoreLocale;
  shopper: Shopper | null;
  account: ShopperAccountView | null;
  accountLoading: boolean;
  accountError: boolean;
  onReload: () => void;
  /** Puts a past order back in the bag; returns how many products could be added. */
  onOrderAgain: (order: ShopperOrder) => number;
  onProfileSaved: (profile: ShopperProfile) => void;
  onTrack: (ref: string) => void;
  onClose: () => void;
}

const statusKey = (s: string) => `onlineOrders.status.${s}` as TranslationKey;

const IconGoogle = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);

/** "My account" on the shop website: sign in, saved details, past orders, order again. */
export default function StorefrontAccount(props: Props) {
  const { t, shopper, onClose } = props;
  return (
    <>
      <div className="sf-scrim" onClick={onClose} />
      <aside className="sf-drawer sf-account" role="dialog" aria-modal="true" aria-label={t('storefront.account.title')}>
        <div className="sf-drawer-head">
          <h2>{t('storefront.account.title')}</h2>
          <button type="button" className="sf-x" onClick={onClose} aria-label={t('storefront.track.close')}>
            ×
          </button>
        </div>
        <div className="sf-drawer-body">{shopper ? <SignedIn {...props} shopper={shopper} /> : <SignIn t={t} />}</div>
      </aside>
    </>
  );
}

function SignIn({ t }: { t: T }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function google() {
    setBusy(true);
    setError(null);
    try {
      await signInShopperWithGoogle();
    } catch (e) {
      setError(shopperAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sf-account-signin">
      <p className="sf-account-lead">{t('storefront.account.why')}</p>
      <button type="button" className="sf-google" onClick={() => void google()} disabled={busy}>
        <IconGoogle />
        {busy ? t('storefront.account.wait') : t('storefront.account.google')}
      </button>
      {error && (
        <p className="sf-msg sf-msg-err" role="alert">
          {t(error as TranslationKey)}
        </p>
      )}
      <p className="sf-muted">{t('storefront.account.guestOk')}</p>
    </div>
  );
}

function SignedIn({ t, lang, shopper, account, accountLoading, accountError, onReload, onOrderAgain, onProfileSaved, onTrack }: Props & { shopper: Shopper }) {
  const [form, setForm] = useState<ShopperProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; key: TranslationKey; params?: TParams } | null>(null);
  const shown = form ?? account?.profile ?? { name: shopper.name, phone: shopper.phone, address: '' };
  const who = shopper.name || shopper.email || shopper.phone;

  useEffect(() => {
    if (!note || note.tone === 'err') return;
    const id = window.setTimeout(() => setNote(null), 3500);
    return () => window.clearTimeout(id);
  }, [note]);

  async function save() {
    setSaving(true);
    try {
      const res = await shopperApi.saveProfile(cleanShopperProfile(shown));
      setForm(null);
      onProfileSaved(res.profile);
      setNote({ tone: 'ok', key: 'storefront.account.saved' });
    } catch (e) {
      const m = toUserMessage(e);
      setNote({ tone: 'err', key: m.key, params: m.params });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sf-account-in">
      <div className="sf-account-who">
        <span className="sf-mark" aria-hidden="true">
          {(who.trim()[0] ?? '?').toUpperCase()}
        </span>
        <div>
          <b dir="auto">{who}</b>
          {shopper.email && shopper.name ? <span className="sf-muted">{shopper.email}</span> : null}
        </div>
        <button type="button" className="sf-link" onClick={() => void signOutShopper()}>
          {t('storefront.account.signOut')}
        </button>
      </div>

      <section className="sf-account-sec">
        <h3>{t('storefront.account.orders')}</h3>
        {accountLoading && !account ? (
          <p className="sf-muted">{t('storefront.account.wait')}</p>
        ) : accountError && !account ? (
          <p className="sf-msg sf-msg-err">
            {t('storefront.account.loadFailed')}{' '}
            <button type="button" className="sf-link" onClick={onReload}>
              {t('common.retry')}
            </button>
          </p>
        ) : !account || account.orders.length === 0 ? (
          <p className="sf-muted">{t('storefront.account.noOrders')}</p>
        ) : (
          <ul className="sf-account-orders">
            {account.orders.map((o) => (
              <li key={o.ref}>
                <div className="sf-track-top">
                  <b className="sf-account-ref" dir="ltr">
                    {o.ref}
                  </b>
                  <span className={`sf-track-badge s-${o.status}`}>{t(statusKey(o.status))}</span>
                </div>
                <span className="sf-muted">{formatDateTime(o.createdAtMs, lang)}</span>
                <p className="sf-account-items" dir="auto">
                  {o.lines.map((l) => `${l.qty} × ${l.name}`).join(' · ')}
                </p>
                <div className="sf-account-row">
                  <strong>{o.totalUsdCents > 0 ? formatUsd(o.totalUsdCents) : formatLbp(o.totalLbp, lang)}</strong>
                  <span className="sf-account-btns">
                    <button type="button" className="sf-link" onClick={() => onTrack(o.ref)}>
                      {t('storefront.account.track')}
                    </button>
                    <button
                      type="button"
                      className="sf-again"
                      onClick={() => {
                        if (onOrderAgain(o) === 0) setNote({ tone: 'err', key: 'storefront.account.againNone' });
                      }}
                    >
                      {t('storefront.account.again')}
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sf-account-sec">
        <h3>{t('storefront.account.details')}</h3>
        <p className="sf-muted">{t('storefront.account.detailsHint')}</p>
        <form
          className="sf-track-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="sf-field">
            <span>{t('storefront.name')}</span>
            <input value={shown.name} autoComplete="name" onChange={(e) => setForm({ ...shown, name: e.target.value })} />
          </label>
          <label className="sf-field">
            <span>{t('storefront.phone')}</span>
            <input value={shown.phone} inputMode="tel" autoComplete="tel" dir="ltr" onChange={(e) => setForm({ ...shown, phone: e.target.value })} />
          </label>
          <label className="sf-field">
            <span>{t('storefront.address')}</span>
            <textarea rows={2} value={shown.address} autoComplete="street-address" onChange={(e) => setForm({ ...shown, address: e.target.value })} />
          </label>
          <button type="submit" className="sf-ghost" disabled={saving || form === null}>
            {saving ? t('storefront.account.wait') : t('storefront.account.save')}
          </button>
        </form>
      </section>
      {note && (
        <p className={note.tone === 'ok' ? 'sf-msg' : 'sf-msg sf-msg-err'} role="status">
          {t(note.key, note.params)}
        </p>
      )}
    </div>
  );
}
