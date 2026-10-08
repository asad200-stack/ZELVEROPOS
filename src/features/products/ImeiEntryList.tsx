import { useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/i18n';
import { addSerial, replaceSerial, type SerialError } from './productFormLogic';

interface Props {
  serials: string[];
  onChange: (serials: string[]) => void;
  error: string | null;
}

/** Scanner-friendly list: Enter commits one serial and leaves the cursor in the empty box. */
export function ImeiEntryList({ serials, onChange, error }: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [localError, setLocalError] = useState<SerialError | null>(null);
  const [localSerial, setLocalSerial] = useState('');

  const focusEntry = () => requestAnimationFrame(() => inputRef.current?.focus());

  const showError = (kind: SerialError | null, serial = '') => {
    setLocalError(kind);
    setLocalSerial(serial);
  };

  const commitDraft = () => {
    const result = addSerial(serials, draft);
    if (result.error === 'empty') {
      setDraft('');
      focusEntry();
      return;
    }
    if (result.error) {
      showError(result.error, result.serial);
      focusEntry();
      return;
    }
    showError(null);
    setDraft('');
    onChange(result.list);
    focusEntry();
  };

  const commitEdit = (index: number) => {
    const result = replaceSerial(serials, index, editValue);
    if (result.error) {
      showError(result.error, editValue.trim());
      return;
    }
    showError(null);
    setEditing(null);
    onChange(result.list);
    focusEntry();
  };

  const stopEnter = (e: KeyboardEvent<HTMLInputElement>, commit: () => void) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    commit();
  };

  const localMessage =
    localError === 'duplicate' ? t('error.imeiExists', { imei: localSerial }) : localError === 'long' ? t('validation.tooLong') : null;

  return (
    <div className="imei-entry">
      <div className="imei-entry__head">
        <h3 className="section-title">{t('products.imeiSection')}</h3>
        <span className="muted">{t('products.imeiEntered', { count: serials.length })}</span>
      </div>
      {(localMessage || error) && (
        <p className="field__error" role="alert">
          {localMessage || error}
        </p>
      )}
      {serials.length > 0 && (
        <ol className="imei-entry__list">
          {serials.map((serial, index) => (
            <li key={`${index}-${serial}`} className="imei-entry__row">
              {editing === index ? (
                <input
                  className="input"
                  dir="ltr"
                  name="imeiEdit"
                  value={editValue}
                  aria-label={t('products.imeiEdit')}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => stopEnter(e, () => commitEdit(index))}
                />
              ) : (
                <span>{serial}</span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(index);
                  setEditValue(serial);
                  showError(null);
                }}
              >
                {t('products.imeiEdit')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  showError(null);
                  setEditing((current) => (current === index ? null : current));
                  onChange(serials.filter((_, i) => i !== index));
                  focusEntry();
                }}
              >
                {t('products.imeiRemove')}
              </Button>
            </li>
          ))}
        </ol>
      )}
      <input
        ref={inputRef}
        className="input"
        dir="ltr"
        name="imeiEntry"
        autoComplete="off"
        value={draft}
        placeholder={t('products.imeiPlaceholder')}
        aria-label={t('products.imeiSection')}
        onChange={(e) => {
          setDraft(e.target.value);
          showError(null);
        }}
        onKeyDown={(e) => stopEnter(e, commitDraft)}
      />
    </div>
  );
}
