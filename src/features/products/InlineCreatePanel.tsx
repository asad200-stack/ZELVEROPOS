import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Layout';
import { useI18n } from '@/i18n/i18n';

interface Props {
  title: string;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
  children: ReactNode;
}

/**
 * Compact "create new …" panel rendered inside another form (no nested <form>). Enter saves this panel
 * only, Escape closes this panel only (the surrounding modal stays open), focus starts on the first field.
 */
export function InlineCreatePanel({ title, saving, error, onSave, onCancel, children }: Props) {
  const { t } = useI18n();
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  // On open, and after a failed save (the disabled Save button drops focus), focus goes back to the first field.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input, select, textarea')?.focus();
  }, [error]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!saving) onCancel();
    } else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault();
      e.stopPropagation();
      if (!saving) onSave();
    }
  };

  return (
    <div ref={ref} className="inline-create" role="group" aria-labelledby={titleId} aria-busy={saving || undefined} onKeyDown={onKeyDown}>
      <p id={titleId} className="inline-create__title">
        {title}
      </p>
      <div className="inline-create__fields">{children}</div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="inline-create__actions">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button size="sm" loading={saving} onClick={onSave}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}
