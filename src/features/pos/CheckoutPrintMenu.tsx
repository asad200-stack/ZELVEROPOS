import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Alert } from '@/components/ui/Layout';
import { claimAutoPrint, shouldAutoPrintInvoice } from '@/features/sales/autoPrint';
import { printOfflineReceipt, printSaleReceipt } from '@/features/sales/receipt';
import { useI18n } from '@/i18n/i18n';
import type { CheckoutResult } from '@/services/salesService';
import type { PrintFormat, StoreSettings } from '@/types/models';
import { formatLbp, formatUsd } from '@/utils/format';

const autoPrintedSales = new Set<string>();

interface Props {
  result: CheckoutResult;
  settings: StoreSettings;
  onClose: () => void;
}

export function CheckoutPrintMenu({ result, settings, onClose }: Props) {
  const { t, lang } = useI18n();
  const [printing, setPrinting] = useState<PrintFormat | null>(null);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sheetRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || lock.current) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const close = () => {
    if (lock.current) return;
    onClose();
  };

  const print = async (format: PrintFormat) => {
    if (lock.current) return;
    lock.current = true;
    setFailed(false);
    setPrinting(format);
    const ctx = { settings, lang, t, format };
    const ok =
      result.mode === 'online'
        ? await printSaleReceipt(result.sale, ctx)
        : await printOfflineReceipt(result.operation, ctx);
    if (!ok) {
      lock.current = false;
      setPrinting(null);
      setFailed(true);
      return;
    }
    onClose();
  };

  useEffect(() => {
    if (!shouldAutoPrintInvoice(result, settings)) return;
    if (result.mode !== 'online') return;
    if (!claimAutoPrint(autoPrintedSales, result.sale.id)) return;
    void print(settings.printFormat);
  }, [result, settings, print]);

  const reference = result.mode === 'online' ? result.sale.invoiceNumber : result.operation.offlineRef;
  const snapshot = result.mode === 'queued' ? result.operation.snapshot : null;
  const cashTaken = snapshot ? snapshot.received.usdCents > 0 || snapshot.received.lbp > 0 : false;
  const received = snapshot
    ? [snapshot.received.usdCents > 0 && formatUsd(snapshot.received.usdCents), snapshot.received.lbp > 0 && formatLbp(snapshot.received.lbp, lang)]
        .filter(Boolean)
        .join(' + ')
    : '';

  return (
    <div className="print-menu">
      <button type="button" className="print-menu__backdrop" aria-label={t('common.cancel')} onClick={close} />
      <div
        ref={sheetRef}
        className="print-menu__sheet"
        role="menu"
        tabIndex={-1}
        aria-label={t('pos.printInvoice')}
      >
        <div className="print-menu__title">{reference}</div>
        {result.mode === 'queued' && (
          <Alert tone="warning">{t(result.cause === 'network' ? 'offline.savedAfterNetworkError' : 'offline.savedNotInvoice')}</Alert>
        )}
        {cashTaken && <Alert tone="error">{t('offline.cashWarning', { amount: received })}</Alert>}
        <button type="button" className="print-menu__item" role="menuitem" disabled={printing !== null} onClick={() => void print('thermal80')}>
          <Icon name="receipt" size={18} />
          <span>{t('pos.print80')}</span>
          {printing === 'thermal80' && <span className="print-menu__wait">{t('pos.printPreparing')}</span>}
        </button>
        <button type="button" className="print-menu__item" role="menuitem" disabled={printing !== null} onClick={() => void print('a4')}>
          <Icon name="printer" size={18} />
          <span>{t('pos.printA4')}</span>
          {printing === 'a4' && <span className="print-menu__wait">{t('pos.printPreparing')}</span>}
        </button>
        <button type="button" className="print-menu__item print-menu__item--quiet" role="menuitem" disabled={printing !== null} onClick={close}>
          <Icon name="x" size={18} />
          <span>{t('common.cancel')}</span>
        </button>
        {failed && (
          <p className="print-menu__error" role="alert">
            {t('pos.printFailed')}
          </p>
        )}
      </div>
    </div>
  );
}
