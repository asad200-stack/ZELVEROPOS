import { useEffect, useEffectEvent, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/i18n/i18n';
import { Icon } from './Icon';

interface ModalProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Prevent closing via backdrop/Escape while an operation is running. */
  busy?: boolean;
  /** Called first on Escape; return true when it was handled (e.g. a nested panel closed) to keep the modal open. */
  onEscapeKey?: () => boolean;
}

export function Modal({ open, title, onClose, children, footer, size = 'md', busy = false, onEscapeKey }: ModalProps) {
  const { t } = useI18n();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onEscape = useEffectEvent(() => {
    if (onEscapeKey?.()) return;
    if (!busy) onClose();
  });

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onEscape();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    const el = dialogRef.current;
    const focusable = el?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button:not(.modal__close)');
    (focusable ?? el)?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      if (!document.querySelector('.modal')) document.body.classList.remove('modal-open');
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="modal__header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="modal__close" onClick={onClose} disabled={busy} aria-label={t('common.close')}>
            <Icon name="x" />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
