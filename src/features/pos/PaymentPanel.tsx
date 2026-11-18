import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { MoneyInput } from '@/components/ui/Form';
import { Alert } from '@/components/ui/Layout';
import type { CartTotals } from '@/domain/cart';
import { autoFillCashTender, type CashTenderPlan, type ChangeManual, type CreditResult } from '@/domain/checkout';
import { applyTypedMoney, completeMoneyInput, formatUsdCentsInput, parseUsdInput } from '@/domain/money';
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
  tenderUsdManual: boolean;
  tenderLbpManual: boolean;
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
  previousUsdCents: number | null;
  rate: number;
  busy: boolean;
  disabled: boolean;
  onComplete: () => void;
  /** Whether this cashier may apply a checkout discount (reuses canEditPrice, same as line price overrides). */
  canDiscount: boolean;
  /** One-click: discount exactly the current shortfall so the cash already entered covers the sale. */
  onRoundDown: () => void;
  /** Cashier typed a specific discount amount (USD cents) and confirmed it. */
  onApplyFixedDiscount: (usdCents: number) => void;
  onClearDiscount: () => void;
}

const CREDIT_ERRORS: Record<string, TranslationKey> = {
  overpay: 'error.credit.overpay',
  creditLimit: 'error.credit.creditLimit',
  nothingDue: 'error.credit.nothingDue',
  invalidAmount: 'error.credit.invalidAmount',
};

export function PaymentPanel({ draft, onDraft, note, onNote, totals, customer, cash, credit, previousUsdCents, rate, busy, disabled, onComplete, canDiscount, onRoundDown, onApplyFixedDiscount, onClearDiscount }: Props) {
  const { t, lang } = useI18n();
  const receivedUsdRef = useRef<HTMLInputElement>(null);
  const receivedLbpRef = useRef<HTMLInputElement>(null);
  const [discountInput, setDiscountInput] = useState('');

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

  const fieldSize = (value: string, fallback: string): CSSProperties => ({ '--chars': Math.max((value || fallback).length, 4) }) as CSSProperties;

  const onReceived = (kind: 'usd' | 'lbp', raw: string, caret: number, input: HTMLInputElement) => {
    const typed = applyTypedMoney(kind, raw, caret);
    const filled =
      draft.kind === 'cash'
        ? autoFillCashTender({
            dueUsdCents: totals.payableUsdCents,
            rate,
            receivedUsd: kind === 'usd' ? typed.value : draft.receivedUsd,
            receivedLbp: kind === 'lbp' ? typed.value : draft.receivedLbp,
            edited: kind,
            usdManual: draft.tenderUsdManual,
            lbpManual: draft.tenderLbpManual,
          })
        : {
            receivedUsd: kind === 'usd' ? typed.value : draft.receivedUsd,
            receivedLbp: kind === 'lbp' ? typed.value : draft.receivedLbp,
            usdManual: draft.tenderUsdManual,
            lbpManual: draft.tenderLbpManual,
          };
    onDraft({
      receivedUsd: filled.receivedUsd,
      receivedLbp: filled.receivedLbp,
      tenderUsdManual: filled.usdManual,
      tenderLbpManual: filled.lbpManual,
    });
    requestAnimationFrame(() => input.setSelectionRange(typed.caret, typed.caret));
  };

  const onReceivedBlur = (kind: 'usd' | 'lbp', raw: string) => {
    const completed = completeMoneyInput(kind, raw);
    const filled =
      draft.kind === 'cash'
        ? autoFillCashTender({
            dueUsdCents: totals.payableUsdCents,
            rate,
            receivedUsd: kind === 'usd' ? completed : draft.receivedUsd,
            receivedLbp: kind === 'lbp' ? completed : draft.receivedLbp,
            edited: kind,
            usdManual: draft.tenderUsdManual,
            lbpManual: draft.tenderLbpManual,
          })
        : {
            receivedUsd: kind === 'usd' ? completed : draft.receivedUsd,
            receivedLbp: kind === 'lbp' ? completed : draft.receivedLbp,
            usdManual: draft.tenderUsdManual,
            lbpManual: draft.tenderLbpManual,
          };
    onDraft({
      receivedUsd: filled.receivedUsd,
      receivedLbp: filled.receivedLbp,
      tenderUsdManual: filled.usdManual,
      tenderLbpManual: filled.lbpManual,
    });
  };

  // An empty/zero amount means "whatever is still owed" — same one-click result as Round Down,
  // so the cashier never has to compute or type the shortfall by hand.
  const applyFixedDiscount = () => {
    const trimmed = discountInput.trim();
    if (!trimmed) {
      if (phase === 'due') onRoundDown();
      return;
    }
    const cents = parseUsdInput(discountInput);
    if (cents === null || cents <= 0) return;
    onApplyFixedDiscount(cents);
    setDiscountInput('');
    if (draft.kind !== 'cash') return;
    // The discount replaces any earlier one, so take off only the change in what is payable:
    // 119.60 received + 19.60 discount → the USD cash field drops straight to 100.00.
    const nextPayable = Math.max(0, totals.dueUsdCents - Math.min(cents, totals.dueUsdCents));
    const reduction = totals.payableUsdCents - nextPayable;
    const receivedUsdCents = parseUsdInput(draft.receivedUsd) ?? 0;
    if (reduction === 0 || receivedUsdCents <= 0) return;
    const nextUsdCents = Math.max(0, receivedUsdCents - reduction);
    const filled = autoFillCashTender({
      dueUsdCents: nextPayable,
      rate,
      receivedUsd: nextUsdCents > 0 ? formatUsdCentsInput(nextUsdCents) : '',
      receivedLbp: draft.receivedLbp,
      edited: 'usd',
      usdManual: draft.tenderUsdManual,
      lbpManual: draft.tenderLbpManual,
    });
    onDraft({
      receivedUsd: filled.receivedUsd,
      receivedLbp: filled.receivedLbp,
      tenderUsdManual: filled.usdManual,
      tenderLbpManual: filled.lbpManual,
    });
  };

  return (
    <div className="payment" data-payment-panel>
      <p className="payment__mode">
        {t('pos.paymentMode')}: {t(draft.kind === 'cash' ? 'pos.fullPayment' : 'pos.creditSale')}
      </p>
      <div className="payment__totals">
        {totals.discountUsdCents > 0 && (
          <div className="payment__row">
            <span>{t('pos.discount')}</span>
            <span className="text-success">−{formatUsd(totals.discountUsdCents)}</span>
          </div>
        )}
        <div className="payment__row">
          <span>{t('pos.saleTotal')}</span>
          <FitAmount value={formatUsd(totals.productsUsdCents)} />
        </div>
        {previousUsdCents !== null && previousUsdCents > 0 && (
          <div className="payment__row">
            <span>{t('pos.previousBalance')}</span>
            <FitAmount value={formatUsd(previousUsdCents)} />
          </div>
        )}
      </div>
      {totals.checkoutDiscountUsdCents > 0 && (
        <div className="payment__discount-chip">
          <span>{t(totals.checkoutDiscountKind === 'roundDown' ? 'pos.checkoutDiscountRoundDown' : 'pos.checkoutDiscount')}</span>
          <span className="payment__discount-value">
            −{formatUsd(totals.checkoutDiscountUsdCents)}
            {totals.dueUsdCents > 0 && (
              <span className="payment__discount-percent">
                {' '}
                (−{Math.round((totals.checkoutDiscountUsdCents / totals.dueUsdCents) * 100)}%)
              </span>
            )}
            <button type="button" className="payment__discount-remove" aria-label={t('pos.removeDiscount')} title={t('pos.removeDiscount')} onClick={onClearDiscount}>
              ×
            </button>
          </span>
        </div>
      )}
      <div className="payment__total-card">
        <div className="payment__kicker">{t('pos.amountToCollect')}</div>
        <div className="payment__total-line">
          <FitAmount value={formatUsd(totals.payableUsdCents)} />
          <FitAmount value={formatLbp(totals.payableLbp, lang)} className="fit-amount--sub" />
        </div>
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
                  onChange={(e) => onReceived('usd', e.target.value, e.target.selectionStart ?? e.target.value.length, e.currentTarget)}
                  onBlur={(e) => onReceivedBlur('usd', e.target.value)}
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
                  onChange={(e) => onReceived('lbp', e.target.value, e.target.selectionStart ?? e.target.value.length, e.currentTarget)}
                  onBlur={(e) => onReceivedBlur('lbp', e.target.value)}
                  onKeyDown={(e) => focusNext(e, canDiscount ? 'checkout-discount' : 'sale-note')}
                />
              </label>
            </div>
          </div>

          {canDiscount && (
            <div className="payment__block payment__block--discount">
              <div className="payment__kicker">{t('pos.applyDiscount')}</div>
              <div className="payment__pair">
                <label className="payment__money">
                  <span>{t('pos.discountAmountUsd')}</span>
                  <input
                    id="checkout-discount"
                    className="input"
                    inputMode="decimal"
                    dir="ltr"
                    autoComplete="off"
                    placeholder="0.00"
                    aria-label={t('pos.discountAmountUsd')}
                    value={discountInput}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setDiscountInput(e.target.value)}
                    onBlur={(e) => setDiscountInput(completeMoneyInput('usd', e.target.value))}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      // Empty Enter just moves on; it must never round down the sale by surprise.
                      if (!discountInput.trim()) {
                        focusNext(e, 'sale-note');
                        return;
                      }
                      e.preventDefault();
                      e.stopPropagation();
                      applyFixedDiscount();
                    }}
                  />
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={discountInput.trim() ? parseUsdInput(discountInput) === null : phase !== 'due'}
                  onClick={applyFixedDiscount}
                >
                  {t('pos.applyDiscountAction')}
                </Button>
              </div>
            </div>
          )}

          {phase === 'due' && canDiscount && (
            <div className="payment__block payment__status-row payment__status-row--due">
              <div>
                <div className="payment__kicker">{t('pos.remainingDue')}</div>
                {/* Plain text: an auto-fit slot inside this shrink-to-fit row collapses to a tiny size. */}
                <div className="payment__status-amt">
                  <span className="payment__status-main">{formatUsd(cash.remainingUsdCents)}</span>
                  <span className="payment__status-sub">{formatLbp(cash.remainingLbp, lang)}</span>
                </div>
              </div>
              <Button type="button" className="payment__apply-btn" onClick={onRoundDown}>
                {t('pos.applyDiscountAction')}
              </Button>
            </div>
          )}
          {phase === 'due' && !canDiscount && (
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
          {phase === 'change' && totals.checkoutDiscountUsdCents === 0 && (
            <div className="payment__change-callout">
              <div className="payment__kicker">{t('pos.changeToReturn')}</div>
              <div className="payment__change-callout-amt">
                {/* Plain text, not FitAmount: the auto-fit slot shrinks to nothing in this centred box. */}
                {(cash.changeUsdCents > 0 || cash.changeLbp <= 0) && <span className="payment__change-callout-main">{formatUsd(cash.changeUsdCents)}</span>}
                {cash.changeLbp > 0 && (
                  <span className={cash.changeUsdCents > 0 ? 'payment__change-callout-sub' : 'payment__change-callout-main'}>{formatLbp(cash.changeLbp, lang)}</span>
                )}
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
            <MoneyInput currency="usd" label={t('pos.paidUsd')} placeholder="0.00" value={draft.creditUsd} onChange={(e) => onDraft({ creditUsd: e.target.value })} />
            <MoneyInput currency="lbp" label={t('pos.paidLbp')} placeholder="0" value={draft.creditLbp} onChange={(e) => onDraft({ creditLbp: e.target.value })} />
          </div>
          {customer && credit && (
            <div className="payment__summary">
              <div className="payment__row">
                <span>{t('pos.currentDebt')}</span>
                <FitAmount value={formatUsd(customer.debtUsdCents)} />
              </div>
              {credit.settledFromPreviousUsdCents > 0 && (
                <div className="payment__row">
                  <span>{t('pos.previousBalanceSettled')}</span>
                  <FitAmount value={formatUsd(credit.settledFromPreviousUsdCents)} />
                </div>
              )}
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
