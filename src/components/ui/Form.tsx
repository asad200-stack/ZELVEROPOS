import { useId, useRef, useState, type ChangeEvent, type FocusEvent, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { applyTypedMoney, completeMoneyInput, type MoneyKind } from '@/domain/money';

interface FieldProps {
  label?: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: (id: string) => ReactNode;
}

export function Field({ label, error, hint, required, className, children }: FieldProps) {
  const id = useId();
  return (
    <div className={['field', error && 'field--error', className].filter(Boolean).join(' ')}>
      {label && (
        <label htmlFor={id} className="field__label">
          {label}
          {required && <span className="field__required"> *</span>}
        </label>
      )}
      {children(id)}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field__hint">{hint}</p>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  fieldClassName?: string;
};

const LTR_INPUT_TYPES = new Set(['number', 'tel', 'email', 'url', 'password', 'date', 'time', 'datetime-local']);

/** Codes and amounts stay left-to-right even when the surrounding page is Arabic. */
function ltrDir(rest: InputHTMLAttributes<HTMLInputElement>): 'ltr' | undefined {
  if (rest.inputMode === 'numeric' || rest.inputMode === 'decimal' || (rest.type && LTR_INPUT_TYPES.has(rest.type))) return 'ltr';
  return undefined;
}

export function TextInput({ label, error, hint, required, fieldClassName, className, ...rest }: InputProps) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={fieldClassName}>
      {(id) => (
        <input
          id={id}
          className={['input', className].filter(Boolean).join(' ')}
          aria-invalid={error ? true : undefined}
          required={required}
          {...rest}
          dir={ltrDir(rest) ?? rest.dir}
        />
      )}
    </Field>
  );
}

type MoneyInputProps = InputProps & { currency?: MoneyKind };

/** Shared USD/LBP amount field. Display is grouped; parseUsdInput/parseLbpInput remain the source of truth. */
export function MoneyInput({
  currency = 'usd',
  label,
  error,
  hint,
  required,
  fieldClassName,
  className,
  onChange,
  onBlur,
  value,
  ...rest
}: MoneyInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const raw = value == null ? '' : String(value);
  const display = focused ? raw : completeMoneyInput(currency, raw) || raw;

  const emit = (event: ChangeEvent<HTMLInputElement>, next: string) => {
    onChange?.({
      ...event,
      target: { ...event.target, value: next, name: event.target.name },
      currentTarget: { ...event.currentTarget, value: next, name: event.currentTarget.name },
    } as ChangeEvent<HTMLInputElement>);
  };

  return (
    <Field label={label} error={error} hint={hint} required={required} className={fieldClassName}>
      {(id) => (
        <input
          {...rest}
          ref={inputRef}
          id={id}
          dir="ltr"
          inputMode={currency === 'lbp' ? 'numeric' : 'decimal'}
          autoComplete="off"
          className={['input', className].filter(Boolean).join(' ')}
          aria-invalid={error ? true : undefined}
          required={required}
          value={display}
          onFocus={(event) => {
            setFocused(true);
            event.currentTarget.select();
            rest.onFocus?.(event);
          }}
          onChange={(event) => {
            const next = applyTypedMoney(currency, event.target.value, event.target.selectionStart ?? event.target.value.length);
            emit(event, next.value);
            requestAnimationFrame(() => inputRef.current?.setSelectionRange(next.caret, next.caret));
          }}
          onBlur={(event) => {
            setFocused(false);
            const completed = completeMoneyInput(currency, event.target.value);
            if (completed !== event.target.value) {
              emit(event as unknown as ChangeEvent<HTMLInputElement>, completed);
            }
            onBlur?.(event as FocusEvent<HTMLInputElement>);
          }}
        />
      )}
    </Field>
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  fieldClassName?: string;
  options: { value: string; label: string }[];
  ref?: Ref<HTMLSelectElement>;
};

export function SelectInput({ label, error, hint, required, fieldClassName, className, options, ...rest }: SelectProps) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={fieldClassName}>
      {(id) => (
        <select id={id} className={['input', className].filter(Boolean).join(' ')} required={required} {...rest}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: ReactNode;
  error?: string | null;
  fieldClassName?: string;
};

export function TextArea({ label, error, required, fieldClassName, className, ...rest }: TextAreaProps) {
  return (
    <Field label={label} error={error} required={required} className={fieldClassName}>
      {(id) => (
        <textarea id={id} className={['input', 'input--textarea', className].filter(Boolean).join(' ')} required={required} {...rest} />
      )}
    </Field>
  );
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
}

export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={['checkbox', className].filter(Boolean).join(' ')}>
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}

export function FormGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 | 4 }) {
  return <div className={`form-grid form-grid--${cols}`}>{children}</div>;
}
