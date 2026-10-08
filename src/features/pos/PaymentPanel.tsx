import { useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { MoneyInput } from '@/components/ui/Form';
import { Alert } from '@/components/ui/Layout';
import type { CartTotals } from '@/domain/cart';
import type { CashTenderPlan, ChangeManual, CreditResult } from '@/domain/checkout';
import { centsToInput } from '@/domain/money';
import { useI18n, type TranslationKey } from '@/i18n/i18n';
import type { Customer, SaleKind } from '@/types/models';
import { formatLbp, formatUsd } from '@/utils/format';
import { FitAmount } from './FitAmount';

export interface PaymentDraft {
  kind: SaleKind;
  receivedUsd: string;
  receivedLbp: string;
  changeUsd: string;
  changeLbp: string;
  /** Which return field the cashier is typing. Null lets both follow the drawer suggestion. */
  changeManual: ChangeManual;
  creditUsd: string;
  creditLbp: string;
}

interface Props {
  draft: PaymentDraft;
  onDraft: (patch: Partial<PaymentDraft>) => void;
  note: string;
  onNote: (note: string) => void;
  totals: CartTotals;
  customer: Customer | null;
  cash: CashTenderPlan;
  credit: CreditResult | null;
  busy: boolean;
  disabled: boolean;
  onComplete: () => void;
}

const CREDIT_ERRORS: Record<string, TranslationKey> = {
  overpay: 'error.credit.overpay',
  creditLimit: 'error.credit.creditLimit',
  nothingDue: 'error.credit.nothingDue',
  invalidAmount: 'error.credit.invalidAmount',
};

export function PaymentPanel({ draft, onDraft, note, onNote, totals, customer, cash, credit, busy, disabled, onComplete }: Props) {
  const { t, lang } = useI18n();
  const receivedUsdRef = useRef<HTMLInputElement>(null);
  const receivedLbpRef = useRef<HTMLInputElement>(null);
  const changeUsdRef = useRef<HTMLInputElement>(null);
  const changeLbpRef = useRef<HTMLInputElement>(null);

  const creditError = !customer
    ? 'error.creditNeedsCustomer'
    : credit && !credit.ok && credit.error
      ? CREDIT_ERRORS[credit.error]
      : null;
  const blocked = draft.kind === 'cash' ? !cash.ok : !!creditError;

  const focusNext = (event: KeyboardEvent<HTMLInputElement>, id: string | null) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    requestAnimationFrame(() => {
      if (id) document.getElementById(id)?.focus();
    });
  };

  const phase =
    draft.kind !== 'cash' || cash.error === 'nothingDue'
      ? 'idle'
      : cash.error === 'invalidAmount'
        ? 'invalid'
        : cash.error === 'underpaid'
          ? 'due'
          : cash.ok && cash.changeUsdCents === 0 && cash.changeLbp === 0
            ? 'exact'
            : 'change';
  const status =
    phase !== 'change'
      ? null
      : cash.error === 'exceeds'
        ? { tone: 'bad' as const, text: t('pos.changeExceeds') }
        : cash.error === 'remaining'
          ? { tone: 'warn' as const, text: t('pos.changeRemaining', { usd: formatUsd(cash.remainingUsdCents), lbp: formatLbp(cash.remainingLbp, lang) }) }
          : cash.error === 'drawer'
            ? { tone: 'warn' as const, text: t('pos.changeDrawer') }
            : null;

  const changeUsdShown = draft.changeManual === 'usd' ? draft.changeUsd : cash.changeUsdCents ? centsToInput(cash.changeUsdCents) : '0.00';
  const changeLbpShown = draft.changeManual === 'lbp' ? draft.changeLbp : cash.changeLbp ? cash.changeLbp.toLocaleString('en-US') : '0';
  const fieldSize = (value: string, fallback: string): CSSProperties => ({ '--chars': Math.max((value || fallback).length, 4) }) as CSSProperties;

  return (
    <div className="payment" data-payment-panel>
      <div className="payment__totals">
        {totals.discountUsdCents > 0 && (
          <div className="payment__row">
            <span>{t('pos.discount')}</span>
            <span className="text-success">−{formatUsd(totals.discountUsdCents)}</span>
          </div>
        )}
        <div className="payment__kicker">{t('pos.total')}</div>
        <div className="payment__total-line">
          <FitAmount value={formatUsd(totals.dueUsdCents)} />
          <FitAmount value={formatLbp(totals.dueLbp, lang)} className="fit-amount--sub" />
        </div>
      </div>

      <div className="segmented" role="radiogroup" aria-label={t('pos.paymentMethod')}>
        {(['cash', 'credit'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={draft.kind === k}
            className={draft.kind === k ? 'segmented__item segmented__item--active' : 'segmented__item'}
            onClick={() => onDraft({ kind: k })}
          >
            {t(k === 'cash' ? 'pos.cash' : 'pos.credit')}
          </button>
        ))}
      </div>

      {draft.kind === 'cash' ? (
        <>
          <div className="payment__block">
            <div className="payment__kicker">{t('pos.cashReceived')}</div>
            <div className="payment__pair">
              <label className="payment__money">
                <span>USD</span>
                <input
                  ref={receivedUsdRef}
                  id="received-usd"
                  className="input"
                  inputMode="decimal"
                  dir="ltr"
                  autoComplete="off"
                  placeholder="0.00"
                  aria-label={t('pos.receivedUsd')}
                  style={fieldSize(draft.receivedUsd, '0.00')}
                  value={draft.receivedUsd}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => onDraft({ receivedUsd: e.target.value })}
                  onKeyDown={(e) => focusNext(e, 'received-lbp')}
                />
              </label>
              <label className="payment__money">
                <span>LBP</span>
                <input
                  ref={receivedLbpRef}
                  id="received-lbp"
                  className="input"
                  inputMode="numeric"
                  dir="ltr"
                  autoComplete="off"
                  placeholder="0"
                  aria-label={t('pos.receivedLbp')}
                  style={fieldSize(draft.receivedLbp, '0')}
                  value={draft.receivedLbp}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => onDraft({ receivedLbp: e.target.value })}
                  onKeyDown={(e) => focusNext(e, phase === 'change' ? 'change-usd' : 'sale-note')}
                />
              </label>
            </div>
          </div>

          {phase === 'due' && (
            <div className="payment__block payment__block--due">
              <div className="payment__kicker">{t('pos.remainingDue')}</div>
              <div className="payment__total-line">
                <FitAmount value={formatUsd(cash.remainingUsdCents)} />
                <FitAmount value={formatLbp(cash.remainingLbp, lang)} className="fit-amount--sub" />
              </div>
            </div>
          )}
          {phase === 'exact' && (
            <p className="payment__status payment__status--ok" role="status">
              {t('pos.paidExactly')} · {t('pos.noChange')}
            </p>
          )}
          {phase === 'change' && (
          <div className="payment__block payment__block--change">
            <div className="payment__change-head">
              <div className="payment__kicker">{t('pos.change')}</div>
              <div className="payment__quick">
                <button
                  type="button"
                  disabled={!cash.allUsdOk}
                  aria-label={t('pos.allUsdHint')}
                  title={cash.allUsdOk ? t('pos.allUsdHint') : t('pos.changeDrawer')}
                  onClick={() => onDraft({ changeManual: 'usd', changeUsd: centsToInput(cash.allUsdCents) })}
                >
                  {t('pos.allUsd')}
                </button>
                <button
                  type="button"
                  disabled={!cash.allLbpOk}
                  aria-label={t('pos.allLbpHint')}
                  title={cash.allLbpOk ? t('pos.allLbpHint') : t('pos.changeDrawer')}
                  onClick={() => onDraft({ changeManual: 'lbp', changeLbp: cash.allLbp.toLocaleString('en-US') })}
                >
                  {t('pos.allLbp')}
                </button>
              </div>
            </div>
            <div className="payment__change-eq">
              <FitAmount value={formatUsd(cash.allUsdCents)} className="fit-amount--good" />
              <FitAmount value={formatLbp(cash.allLbp, lang)} className="fit-amount--sub" />
            </div>
            <div className="payment__pair">
              <label className="payment__money">
                <span>USD</span>
                <input
                  ref={changeUsdRef}
                  id="change-usd"
                  className="input"
                  inputMode="decimal"
                  dir="ltr"
                  autoComplete="off"
                  placeholder="0.00"
                  aria-label={t('pos.returnUsd')}
                  style={fieldSize(changeUsdShown, '0.00')}
                  value={changeUsdShown}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => onDraft({ changeManual: 'usd', changeUsd: e.target.value })}
                  onKeyDown={(e) => focusNext(e, 'change-lbp')}
                />
              </label>
              <label className="payment__money">
                <span>LBP</span>
                <input
                  ref={changeLbpRef}
                  id="change-lbp"
                  className="input"
                  inputMode="numeric"
                  dir="ltr"
                  autoComplete="off"
                  placeholder="0"
                  aria-label={t('pos.returnLbp')}
                  style={fieldSize(changeLbpShown, '0')}
                  value={changeLbpShown}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => onDraft({ changeManual: 'lbp', changeLbp: e.target.value })}
                  onKeyDown={(e) => focusNext(e, 'sale-note')}
                />
              </label>
            </div>
          </div>
          )}

          {status && (
            <p className={`payment__status payment__status--${status.tone}`} role="status">
              {status.text}
            </p>
          )}
          {phase === 'invalid' && <p className="payment__status payment__status--bad">{t('pos.changeInvalid')}</p>}
        </>
      ) : (
        <div className="payment__fields">
          <div className="payment__pair">
            <MoneyInput label={t('pos.paidUsd')} placeholder="0" value={draft.creditUsd} onChange={(e) => onDraft({ creditUsd: e.target.value })} />
            <MoneyInput label={t('pos.paidLbp')} placeholder="0" value={draft.creditLbp} onChange={(e) => onDraft({ creditLbp: e.target.value })} />
          </div>
          {customer && credit && (
            <div className="payment__summary">
              <div className="payment__row">
                <span>{t('pos.currentDebt')}</span>
                <FitAmount value={formatUsd(customer.debtUsdCents)} />
              </div>
              <div className="payment__row">
                <span>{t('pos.totalDue')}</span>
                <FitAmount value={formatUsd(credit.totalDueUsdCents)} />
              </div>
              <div className="payment__row">
                <span>{t('pos.paidTotal')}</span>
                <FitAmount value={formatUsd(credit.paidTotalUsdCents)} />
              </div>
              <div className="payment__row payment__row--strong">
                <span>{t('pos.newDebt')}</span>
                <FitAmount value={formatUsd(credit.newTotalDebtUsdCents)} />
              </div>
            </div>
          )}
        </div>
      )}

      {draft.kind === 'credit' && creditError && <Alert tone="error">{t(creditError)}</Alert>}

      <div className="payment__finish">
      <label className="payment__note">
        <span>{t('pos.noteOptional')}</span>
        <input
          id="sale-note"
          className="input"
          maxLength={200}
          autoComplete="off"
          placeholder={t('pos.notePlaceholder')}
          aria-label={t('pos.note')}
          value={note}
          onChange={(e) => onNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        />
      </label>

      <Button id="complete-sale" size="lg" block variant="success" icon="check" loading={busy} disabled={disabled || blocked} onClick={onComplete}>
        {t('pos.completeSale')} <kbd>F9</kbd>
      </Button>
      </div>
    </div>
  );
}
