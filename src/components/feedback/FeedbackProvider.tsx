import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { FeedbackContext, type ConfirmOptions, type ToastType } from '@/contexts/feedback';
import { useI18n } from '@/i18n/i18n';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Icon, type IconName } from '@/components/ui/Icon';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

const TOAST_ICON: Record<ToastType, IconName> = {
  success: 'check',
  error: 'alert',
  info: 'info',
  warning: 'alert',
};

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((x) => x.id !== id)), []);

  const notify = useCallback(
    (type: ToastType, message: string) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-3), { id, type, message }]);
      window.setTimeout(() => dismiss(id), type === 'error' ? 6000 : 3500);
    },
    [dismiss],
  );

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...options, resolve });
      }),
    [],
  );

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const value = useMemo(() => ({ notify, confirm }), [notify, confirm]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.type}`}>
            <Icon name={TOAST_ICON[toast.type]} />
            <span>{toast.message}</span>
            <button type="button" className="toast__close" onClick={() => dismiss(toast.id)} aria-label={t('common.close')}>
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
      {pending && (
        <Modal
          open
          title={pending.title}
          onClose={() => close(false)}
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => close(false)}>
                {pending.cancelLabel ?? t('common.cancel')}
              </Button>
              <Button variant={pending.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
                {pending.confirmLabel ?? t('common.confirm')}
              </Button>
            </>
          }
        >
          {pending.message && <p className="confirm-message">{pending.message}</p>}
        </Modal>
      )}
    </FeedbackContext.Provider>
  );
}
