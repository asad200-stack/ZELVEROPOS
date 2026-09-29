import { Button } from '@/components/ui/Button';
import { MoneyInput, SelectInput } from '@/components/ui/Form';
import { Alert } from '@/components/ui/Layout';
import type { CartTotals } from '@/domain/cart';
import type { CashPaymentResult, CreditResult } from '@/domain/checkout';
import { useI18n, type TranslationKey } from '@/i18n/i18n';
import type { Currency, Customer, SaleKind } from '@/types/models';
import { formatLbp, formatUsd } from '@/utils/format';

export interface PaymentDraft {
  kind: SaleKind;
  payCurrency: Currency;
  amount: string;
  creditUsd: string;
  creditLbp: string;
}

interface Props {
  draft: PaymentDraft;
  onDraft: (patch: Partial<PaymentDraft>) => void;
  currency: Currency;
  totals: CartTotals;
  customer: Customer | null;
  cash: CashPaymentResult;
  credit: CreditResult | null;
  busy: boolean;
  disabled: boolean;
  onComplete: () => void;
}

const CASH_ERRORS: Record<string, TranslationKey> = {
  overpay: 'pos.error.overpay',
  invalidAmount: 'pos.error.invalidAmount',
  nothingDue: 'pos.error.nothingDue',
};

const CREDIT_ERRORS: Record<string, TranslationKey> = {
  overpay: 'error.credit.overpay',
  creditLimit: 'error.credit.creditLimit',
  nothingDue: 'error.credit.nothingDue',
  invalidAmount: 'error.credit.invalidAmount',
};

export function PaymentPanel({ draft, onDraft, currency, totals, customer, cash, credit, busy, disabled, onComplete }: Props) {
  const { t, lang } = useI18n();
  const dueLabel = currency === 'USD' ? formatUsd(totals.dueUsdCents) : formatLbp(totals.dueLbp, lang);
  const equivalent = currency === 'USD' ? formatLbp(totals.dueLbp, lang) : formatUsd(totals.dueUsdCents);

  const error =
    draft.kind === 'cash'
      ? !cash.ok && totals.itemCount + totals.debtLineUsdCents > 0
        ? CASH_ERRORS[cash.error]
        : null
      : !customer
        ? 'error.creditNeedsCustomer'
        : credit && !credit.ok && credit.error
          ? CREDIT_ERRORS[credit.error]
          : null;

  return (
    <div className="payment">
      <div className="payment__totals">
        {totals.discountUsdCents > 0 && (
          <div className="payment__row">
            <span>{t('pos.discount')}</span>
            <span className="text-success">−{formatUsd(totals.discountUsdCents)}</span>
          </div>
        )}
        <div className="payment__row payment__row--grand">
          <span>{t('pos.total')}</span>
          <span>{dueLabel}</span>
        </div>
        <div className="payment__row muted small">
          <span>≈</span>
          <span>{equivalent}</span>
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
        <div className="payment__fields">
          <SelectInput
            label={t('pos.payCurrency')}
            value={draft.payCurrency}
            onChange={(e) => onDraft({ payCurrency: e.target.value as Currency, amount: '' })}
            options={[
              { value: 'USD', label: 'USD $' },
              { value: 'LBP', label: lang === 'ar' ? 'ليرة ل.ل' : 'LBP' },
            ]}
          />
          <MoneyInput
            label={t('pos.amountPaid')}
            placeholder={t('pos.amountPaidPlaceholder')}
            value={draft.amount}
            onChange={(e) => onDraft({ amount: e.target.value })}
          />
          {cash.ok && cash.remainderLbp > 0 && (
            <div className="payment__remainder">
              {t('pos.remainderLbp')}: <strong>{formatLbp(cash.remainderLbp, lang)}</strong>
            </div>
          )}
        </div>
      ) : (
        <div className="payment__fields">
          <div className="form-grid form-grid--2">
            <MoneyInput label={t('pos.paidUsd')} placeholder="0" value={draft.creditUsd} onChange={(e) => onDraft({ creditUsd: e.target.value })} />
            <MoneyInput label={t('pos.paidLbp')} placeholder="0" value={draft.creditLbp} onChange={(e) => onDraft({ creditLbp: e.target.value })} />
          </div>
          {customer && credit && (
            <div className="payment__summary">
              <div className="payment__row">
                <span>{t('pos.currentDebt')}</span>
                <span>{formatUsd(customer.debtUsdCents)}</span>
              </div>
              <div className="payment__row">
                <span>{t('pos.totalDue')}</span>
                <span>{formatUsd(credit.totalDueUsdCents)}</span>
              </div>
              <div className="payment__row">
                <span>{t('pos.paidTotal')}</span>
                <span>{formatUsd(credit.paidTotalUsdCents)}</span>
              </div>
              <div className="payment__row payment__row--strong">
                <span>{t('pos.newDebt')}</span>
                <span>{formatUsd(credit.newTotalDebtUsdCents)}</span>
              </div>
              <div className="payment__row muted small">
                <span>{t('customers.creditLimit')}</span>
                <span>{formatUsd(customer.creditLimitUsdCents)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <Alert tone="error">{t(error)}</Alert>}

      <Button size="lg" block variant="success" icon="check" loading={busy} disabled={disabled || !!error} onClick={onComplete}>
        {t('pos.completeSale')} <kbd>F9</kbd>
      </Button>
    </div>
  );
}
