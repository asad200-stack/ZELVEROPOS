import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { DAY_MS } from './config.js';

export const WEBSITE_TRIAL_DAYS = 15;
export const LEAD_SOURCES = ['trial', 'quote', 'demo_request', 'contact', 'AI', 'partner_referral'] as const;
/** Sources a public marketing form may send. `trial` is not one of them. */
export const publicLeadSourceSchema = z.enum(['quote', 'demo_request', 'contact', 'AI', 'partner_referral']);
export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'DEMO', 'TRIAL', 'QUOTE', 'WON', 'LOST'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const CLIENT_OP_RE = /^[A-Za-z0-9_-]{8,80}$/;
export const REF_CODE_RE = /^[A-Za-z0-9_-]{2,40}$/;
export const TEST_TRIAL_EMAIL = /@zelvero\.test$/i;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function phoneKey(phone: string): string {
  return phone.replace(/\D+/g, '').slice(-15);
}

export function emailKey(email: string): string {
  return normalizeEmail(email).replace(/[^a-z0-9.@_+-]/g, '');
}

export function slugify(name: string): string {
  const ascii = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 18);
  return ascii.length >= 3 ? ascii : `store-${randomBytes(2).toString('hex')}`;
}

export function newTenantId(): string {
  return `t${randomBytes(12).toString('hex')}`;
}

export function newSubdomain(businessName: string): string {
  return `${slugify(businessName)}-${randomBytes(2).toString('hex')}`.slice(0, 30);
}

export function trialWindow(nowMs: number): { startsAtMs: number; endsAtMs: number } {
  return { startsAtMs: nowMs, endsAtMs: nowMs + WEBSITE_TRIAL_DAYS * DAY_MS };
}

export function daysLeftFloor(endsAtMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((endsAtMs - nowMs) / DAY_MS));
}

export function isTestTrialEmail(email: string): boolean {
  return TEST_TRIAL_EMAIL.test(normalizeEmail(email));
}

export function ipSignal(ip: string): string {
  return createHash('sha256').update(`zelvero-ip:${ip || 'unknown'}`).digest('hex').slice(0, 24);
}

export function mergeLeadStatus(current: LeadStatus | undefined, incoming: LeadStatus): LeadStatus {
  if (!current) return incoming;
  if (current === 'WON' || current === 'LOST') return current;
  const rank: Record<LeadStatus, number> = {
    NEW: 0,
    CONTACTED: 1,
    DEMO: 2,
    QUOTE: 3,
    TRIAL: 4,
    WON: 5,
    LOST: 5,
  };
  return rank[incoming] >= rank[current] ? incoming : current;
}

export const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const contactSchema = z.object({
  name: trimmed(80),
  businessName: trimmed(80),
  email: z.string().trim().email().max(200),
  phone: trimmed(30),
  businessType: z.string().trim().min(1).max(60).default('general-retail'),
  country: z.string().trim().max(80).optional().default(''),
  note: z.string().trim().max(1000).optional().default(''),
  referralCode: z.string().trim().max(40).optional().default(''),
  interestedFeatures: z.array(z.string().trim().max(40)).max(20).optional().default([]),
  preferredContact: z.enum(['phone', 'email', 'whatsapp']).optional(),
  clientOperationId: z.string().regex(CLIENT_OP_RE),
  formStartedAt: z.number().int().positive(),
  website: z.string().max(200).optional().default(''),
});

export const quoteSchema = contactSchema.extend({
  branches: z.number().int().min(1).max(50),
  users: z.number().int().min(1).max(200),
  posDevices: z.number().int().min(0).max(200).optional().default(1),
  features: z.array(z.string().trim().max(40)).max(30).optional().default([]),
  specialRequirements: z.string().trim().max(2000).optional().default(''),
});

export const trialSchema = contactSchema.extend({
  ownerName: trimmed(80),
  primaryCurrency: trimmed(20),
  password: z.string().min(8).max(128),
});

export type ContactInput = z.infer<typeof contactSchema>;
export type QuoteInput = z.infer<typeof quoteSchema>;
export type TrialInput = z.infer<typeof trialSchema>;
