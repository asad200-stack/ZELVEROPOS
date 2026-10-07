import { useId, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

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
        />
      )}
    </Field>
  );
}

/** Decimal money input: keeps the raw string so users can type freely; parse on submit. */
export function MoneyInput(props: InputProps) {
  return <TextInput inputMode="decimal" autoComplete="off" {...props} />;
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
