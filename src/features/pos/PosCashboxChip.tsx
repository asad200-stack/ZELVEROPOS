import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Button } from '@/components/ui/Button';
import { MoneyInput, SelectInput, TextInput } from '@/components/ui/Form';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { useFeedback } from '@/contexts/feedback';
import { useTenant } from '@/contexts/session';
import { parseLbpInput, parseUsdInput } from '@/domain/money';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useCashbox } from '@/hooks/useTenantData';
import { useI18n } from '@/i18n/i18n';
import { recordCashMove, type CashMoveType } from '@/services/cashboxService';
import type { Currency } from '@/types/models';
import { formatNumber, formatUsd } from '@/utils/format';

/** Live view of the store cash drawer, with the same movements the Cash Drawer page records. */
export function PosCashboxChip() {
  const { t } = useI18n();
  const { can } = useTenant();
  const cashbox = useCashbox();
  const ready = cashbox.status === 'ready';
  const usd = ready ? formatUsd(cashbox.data.usdCents) : '…';
  const lbp = ready ? formatNumber(cashbox.data.lbp) : '…';
  const canMove = can('canManageCashDrawer');
  const [open, setOpen] = useState(false);
  const [move, setMove] = useState<Extract<CashMoveType, 'deposit' | 'withdrawal'> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="cash-chip" ref={rootRef}>
      <Icon name="wallet" size={14} />
      <span className="cash-chip__name">{t('cash.chip')}</span>
      <span className="cash-chip__money">
        <Amount label="USD" value={usd} />
        <Amount label="LBP" value={lbp} />
      </span>
      {canMove && (
        <button
          type="button"
          className="cash-chip__more"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={t('cash.actions')}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="more" size={14} />
        </button>
      )}
      {open && canMove && (
        <div className="cash-chip__menu" id={menuId} role="menu">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); setMove('deposit'); }}>
            {t('cash.cashIn')}
          </button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); setMove('withdrawal'); }}>
            {t('cash.cashOut')}
          </button>
        </div>
      )}
      {move && <CashMoveDialog type={move} usdCents={cashbox.data.usdCents} lbp={cashbox.data.lbp} onClose={() => setMove(null)} />}
    </div>
  );
}

function Amount({ label, value }: { label: string; value: string }) {
  const text = `${label} ${value}`;
  return (
    <span className="cash-chip__amt" title={text} style={{ '--chars': Math.max(text.length, 6) } as CSSProperties}>
      <span>{label}</span>
      <b>{value}</b>
    </span>
  );
}

function CashMoveDialog({
  type,
  usdCents,
  lbp,
  onClose,
}: {
  type: 'deposit' | 'withdrawal';
  usdCents: number;
  lbp: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { notify } = useFeedback();
  const [currency, setCurrency] = useState<Currency>('USD');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const { busy, run } = useAsyncAction('pos-cash-move');
  const parsed = currency === 'USD' ? parseUsdInput(amount || '0') : parseLbpInput(amount || '0');
  const value = parsed ?? 0;
  const overDrawer = type === 'withdrawal' && (currency === 'USD' ? value > usdCents : value > lbp);
  const valid = parsed !== null && value > 0 && note.trim().length > 0 && !overDrawer;

  return (
    <Modal
      open
      size="sm"
      title={t(type === 'deposit' ? 'cash.cashIn' : 'cash.cashOut')}
      onClose={onClose}
      busy={busy}
      footer={
        <Button
          loading={busy}
          disabled={!valid}
          onClick={() =>
            void run(async () => {
              if (!valid) return;
              await recordCashMove({
                type,
                usdCents: currency === 'USD' ? value : 0,
                lbp: currency === 'LBP' ? value : 0,
                category: '',
                note: note.trim(),
              });
              notify('success', t('common.saved'));
              onClose();
            })
          }
        >
          {t('common.confirm')}
        </Button>
      }
    >
      <div className="stack">
        <SelectInput
          label={t('pos.currency')}
          value={currency}
          onChange={(e) => {
            setCurrency(e.target.value as Currency);
            setAmount('');
          }}
          options={[
            { value: 'USD', label: 'USD' },
            { value: 'LBP', label: 'LBP' },
          ]}
        />
        <MoneyInput
          label={t('cash.amount')}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault();
          }}
        />
        <TextInput
          label={t('common.note')}
          required
          value={note}
          maxLength={300}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault();
          }}
        />
        {overDrawer && <p className="payment__status payment__status--bad">{t('error.drawerInsufficient')}</p>}
      </div>
    </Modal>
  );
}
