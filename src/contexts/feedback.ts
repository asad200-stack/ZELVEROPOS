import { createContext, useCallback, useContext } from 'react';
import { useI18n } from '@/i18n/i18n';
import { logError, toUserMessage } from '@/services/errors';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface FeedbackValue {
  notify: (type: ToastType, message: string) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

export const FeedbackContext = createContext<FeedbackValue | null>(null);

export function useFeedback(): FeedbackValue {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useFeedback must be used inside FeedbackProvider');
  return ctx;
}

/** Returns a handler that logs an error and shows its translated message as a toast. */
export function useErrorHandler(context: string) {
  const { notify } = useFeedback();
  const { t } = useI18n();
  return useCallback(
    (error: unknown) => {
      logError(context, error);
      const msg = toUserMessage(error);
      notify('error', t(msg.key, msg.params));
    },
    [context, notify, t],
  );
}
