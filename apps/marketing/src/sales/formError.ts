import { mapSalesError } from './client';

export interface OpenSalesForm<T> {
  values: T;
  error: string;
  busy: boolean;
  completed: false;
}

/** A failed send shows a generic message and leaves the entered values in place. */
export function recoverSalesForm<T>(form: OpenSalesForm<T>, err: unknown): OpenSalesForm<T> {
  return {
    values: form.values,
    error: mapSalesError(err),
    busy: false,
    completed: false,
  };
}
