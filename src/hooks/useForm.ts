import { useCallback, useState, type ChangeEvent } from 'react';
import type { z } from 'zod';
import { useI18n } from '@/i18n/i18n';
import { toFieldErrors, type FieldErrors } from '@/validation/schemas';

type Values = Record<string, string | boolean>;

/** Tiny form helper: string state + zod validation + translated field errors. */
export function useForm<V extends Values>(initial: V) {
  const { t } = useI18n();
  const [values, setValues] = useState<V>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});

  const set = useCallback(<K extends keyof V>(key: K, value: V[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => (e[key as string] ? { ...e, [key as string]: undefined } : e));
  }, []);

  const bind = <K extends keyof V>(key: K) => ({
    name: key as string,
    value: values[key] as string,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set(key, e.target.value as V[K]),
    error: errors[key as string] ? t(errors[key as string]!) : null,
  });

  const bindCheckbox = <K extends keyof V>(key: K) => ({
    name: key as string,
    checked: values[key] as boolean,
    onChange: (e: ChangeEvent<HTMLInputElement>) => set(key, e.target.checked as V[K]),
  });

  function validate<S extends z.ZodType>(schema: S): z.infer<S> | null {
    const result = schema.safeParse(values);
    if (!result.success) {
      setErrors(toFieldErrors(result.error));
      return null;
    }
    setErrors({});
    return result.data;
  }

  return { values, setValues, set, bind, bindCheckbox, errors, setErrors, validate, reset: () => setValues(initial) };
}
