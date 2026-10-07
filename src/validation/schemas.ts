import { z } from 'zod';
import { parseLbpInput, parseUsdInput } from '@/domain/money';
import type { TranslationKey } from '@/i18n/i18n';

/** Zod schemas for every form. Error messages are translation keys. */
type Key = TranslationKey;
const msg = (k: Key) => k;

const required = (max = 120) =>
  z.string().trim().min(1, msg('validation.required')).max(max, msg('validation.tooLong'));
const optional = (max = 200) => z.string().trim().max(max, msg('validation.tooLong'));

const email = z.string().trim().toLowerCase().pipe(z.email(msg('validation.email')));
const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => v === '' || z.email().safeParse(v).success, msg('validation.email'));

const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ''))
  .refine((v) => v === '' || /^\+?\d{6,15}$/.test(v), msg('validation.phone'));

/** "12.50" → 1250 cents. Empty → null (or an error when required). */
export const usdField = (isRequired: boolean) =>
  z.string().transform((v, ctx) => {
    if (!v.trim()) {
      if (isRequired) ctx.issues.push({ code: 'custom', message: msg('validation.required'), input: v });
      return null;
    }
    const cents = parseUsdInput(v);
    if (cents === null) {
      ctx.issues.push({ code: 'custom', message: msg('validation.amount'), input: v });
      return z.NEVER;
    }
    return cents;
  });

export const lbpField = () =>
  z.string().transform((v, ctx) => {
    if (!v.trim()) return null;
    const lbp = parseLbpInput(v);
    if (lbp === null) {
      ctx.issues.push({ code: 'custom', message: msg('validation.amount'), input: v });
      return z.NEVER;
    }
    return lbp;
  });

const intField = (min = 0) =>
  z.string().transform((v, ctx) => {
    if (!v.trim()) return null;
    const n = Number(v.replace(/,/g, ''));
    if (!Number.isInteger(n) || n < min) {
      ctx.issues.push({ code: 'custom', message: msg('validation.integer'), input: v });
      return z.NEVER;
    }
    return n;
  });

const dateField = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), msg('validation.date'))
  .transform((v) => v || null);

export const loginSchema = z.object({
  email,
  password: z.string().min(1, msg('validation.required')),
});

export const signupSchema = z
  .object({
    fullName: required(80),
    storeName: required(80),
    subdomain: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/, msg('validation.subdomain')),
    email,
    phone: phone.refine((v) => v !== '', msg('validation.required')),
    password: z.string().min(8, msg('validation.passwordLength')).max(128, msg('validation.tooLong')),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: msg('validation.passwordMatch') });

export const newPasswordSchema = z
  .object({
    password: z.string().min(8, msg('validation.passwordLength')).max(128, msg('validation.tooLong')),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: msg('validation.passwordMatch') });

export const setupSchema = z.object({
  fullName: required(80),
  storeName: required(80),
  subdomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/, msg('validation.subdomain')),
  phone: phone.refine((v) => v !== '', msg('validation.required')),
});

export const subUserSchema = z.object({
  fullName: required(80),
  email,
  password: z.string().min(8, msg('validation.passwordLength')).max(128, msg('validation.tooLong')),
});

export const productSchema = z.object({
  name: required(150),
  category: optional(60),
  barcode: optional(64).refine((v) => !/\s/.test(v), msg('validation.barcode')),
  retail: usdField(true),
  wholesale: usdField(false),
  vip: usdField(false),
  retailLbp: lbpField(),
  wholesaleLbp: lbpField(),
  vipLbp: lbpField(),
  cost: usdField(false),
  minStock: intField(0),
  expiryDate: dateField,
  initialStock: intField(0),
  supplierId: z.string(),
  imeiTracking: z.boolean(),
  imeis: z.string(),
});

export const customerSchema = z.object({
  name: required(100),
  phone,
  email: optionalEmail,
  address: optional(200),
  creditLimit: usdField(true),
  openingDebt: usdField(false),
});

export const supplierSchema = z.object({
  name: required(100),
  contactPerson: optional(100),
  phone,
  email: optionalEmail,
  address: optional(200),
});

export type FieldErrors = Partial<Record<string, Key>>;

/** Flattens zod issues into { field: translationKey } (first issue per field). */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_');
    if (!out[key]) out[key] = issue.message as Key;
  }
  return out;
}
