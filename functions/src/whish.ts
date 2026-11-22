/**
 * Whish Money (Whish Business "collect") for online orders.
 *
 * Each shop connects its OWN Whish Business account (channel + secret + website URL that Whish
 * gives the merchant), so the customer's money goes straight to the shop. The credentials live
 * in onlinePaymentConfigs/{tenantId}, a collection no client can read (no Firestore rule), and the
 * secret is never sent back to the browser.
 *
 *   onlineStoreGetPayments   owner: what is configured (never the secret)
 *   onlineStoreSetWhish      owner: save credentials; checks them against Whish first
 *
 * API (Whish Business partner API): POST /payment/whish → data.collectUrl,
 * POST /payment/collect/status → data.collectStatus / data.payerPhoneNumber,
 * GET /payment/account/balance. Every response is HTTP 200 with { status, code, dialog, data };
 * code "500" means "still pending, check again later", never a failure.
 */
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from './admin.js';
import { REGION } from './config.js';
import { fail } from './errors.js';
import { ownerCall } from './onlineStore.js';
import { parse } from './validate.js';

export const WHISH_HOSTS = {
  sandbox: 'https://partner.api.sbx.whish.money/itel-service/api',
  live: 'https://api.whish.money/itel-service/api',
} as const;

export interface WhishCreds {
  sandbox: boolean;
  channel: string;
  secret: string;
  websiteUrl: string;
}

export class WhishError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
/** Whish answered "pending": the outcome is not known yet. Safe to check again later. */
export class WhishPendingError extends WhishError {}

const configRef = (tenantId: string) => db.doc(`onlinePaymentConfigs/${tenantId}`);
const TIMEOUT_MS = 15_000;

/** True inside the local emulator with the special "fake" channel: lets the checkout be tried offline. */
export function isFakeWhish(c: WhishCreds): boolean {
  return process.env.FUNCTIONS_EMULATOR === 'true' && c.channel === 'fake';
}

/** The shop's Whish credentials when Whish is switched on and complete, else null. */
export async function loadWhish(tenantId: string): Promise<WhishCreds | null> {
  const w = (await configRef(tenantId).get()).get('whish') as Partial<WhishCreds & { enabled: boolean }> | undefined;
  if (!w || w.enabled !== true || !w.channel || !w.secret || !w.websiteUrl) return null;
  return { sandbox: w.sandbox === true, channel: w.channel, secret: w.secret, websiteUrl: w.websiteUrl };
}

async function whishCall<T>(c: WhishCreds, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${c.sandbox ? WHISH_HOSTS.sandbox : WHISH_HOSTS.live}${path}`, {
    method,
    headers: {
      channel: c.channel,
      secret: c.secret,
      websiteUrl: c.websiteUrl,
      'User-Agent': 'ZelveroPOS/1.0',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let json: { status?: unknown; code?: unknown; dialog?: { message?: string; title?: string } | null; data?: unknown };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    // Whish answers non-JSON (often HTML 403) when callback/redirect URLs aren't public HTTPS.
    throw new WhishError('BAD_RESPONSE', `whish: HTTP ${res.status}, not JSON`);
  }
  if (json.status === true) return json.data as T;
  const code = String(json.code ?? res.status);
  const message = json.dialog?.message || json.dialog?.title || code;
  if (code === '500') throw new WhishPendingError(code, message);
  throw new WhishError(code, message);
}

export interface CreatePayment {
  amount: string;
  currency: 'USD' | 'LBP';
  invoice: string;
  externalId: string;
  callbackUrl: string;
  redirectUrl: string;
}

/** Starts a Whish checkout and returns the page the customer pays on. */
export async function createWhishPayment(c: WhishCreds, p: CreatePayment): Promise<string> {
  if (isFakeWhish(c)) return `${p.redirectUrl}${p.redirectUrl.includes('?') ? '&' : '?'}fakeWhish=${p.externalId}`;
  const data = await whishCall<{ collectUrl?: string }>(c, 'POST', '/payment/whish', {
    amount: p.amount,
    currency: p.currency,
    invoice: p.invoice.slice(0, 120),
    externalId: Number(p.externalId),
    successCallbackUrl: p.callbackUrl,
    failureCallbackUrl: p.callbackUrl,
    successRedirectUrl: p.redirectUrl,
    failureRedirectUrl: p.redirectUrl,
  });
  if (!data?.collectUrl || !/^https:\/\//.test(data.collectUrl)) throw new WhishError('NO_URL', 'whish: no collectUrl');
  return data.collectUrl;
}

/** Whish's view of one payment attempt. Pending answers come back as status 'pending'. */
export async function whishStatus(c: WhishCreds, currency: 'USD' | 'LBP', externalId: string): Promise<{ status: string; payerPhone: string }> {
  if (isFakeWhish(c)) return { status: 'success', payerPhone: '96170123456' };
  try {
    const data = await whishCall<{ collectStatus?: string; payerPhoneNumber?: string }>(c, 'POST', '/payment/collect/status', {
      currency,
      externalId: Number(externalId),
    });
    return { status: String(data?.collectStatus ?? 'unknown'), payerPhone: String(data?.payerPhoneNumber ?? '') };
  } catch (err) {
    if (err instanceof WhishPendingError) return { status: 'pending', payerPhone: '' };
    throw err;
  }
}

async function whishBalance(c: WhishCreds): Promise<number> {
  if (isFakeWhish(c)) return 0;
  const data = await whishCall<{ balance?: number }>(c, 'GET', '/payment/account/balance?currency=USD');
  return Number(data?.balance ?? 0);
}

/* ------------------------------------------------------------------ owner settings */

export interface PaymentsView {
  whish: { enabled: boolean; sandbox: boolean; channel: string; websiteUrl: string; hasSecret: boolean };
}

async function viewOf(tenantId: string): Promise<PaymentsView> {
  const w = ((await configRef(tenantId).get()).get('whish') ?? {}) as Partial<WhishCreds & { enabled: boolean }>;
  return {
    whish: {
      enabled: w.enabled === true,
      sandbox: w.sandbox !== false,
      channel: typeof w.channel === 'string' ? w.channel : '',
      websiteUrl: typeof w.websiteUrl === 'string' ? w.websiteUrl : '',
      hasSecret: typeof w.secret === 'string' && w.secret.length > 0,
    },
  };
}

export const onlineStoreGetPayments = onCall({ region: REGION }, (request) =>
  ownerCall(request, async ({ tenantId }) => viewOf(tenantId)),
);

const setWhishSchema = z.strictObject({
  enabled: z.boolean(),
  sandbox: z.boolean(),
  channel: z.string().trim().max(120),
  // Empty keeps the stored secret (the browser never receives it, so it can't send it back).
  secret: z.string().trim().max(500),
  websiteUrl: z.string().trim().max(300),
});

export const onlineStoreSetWhish = onCall({ region: REGION }, (request) =>
  ownerCall(request, async ({ tenantId }, data): Promise<PaymentsView> => {
    const input = parse(setWhishSchema, data);
    const stored = ((await configRef(tenantId).get()).get('whish') ?? {}) as Partial<WhishCreds>;
    const creds: WhishCreds = {
      sandbox: input.sandbox,
      channel: input.channel,
      secret: input.secret || stored.secret || '',
      websiteUrl: input.websiteUrl,
    };
    if (input.enabled) {
      if (!creds.channel || !creds.secret || !creds.websiteUrl) fail('invalid-argument', 'error.whish.missing');
      try {
        await whishBalance(creds);
      } catch (err) {
        console.warn('[whish] credential check failed', tenantId, err instanceof Error ? err.message : err);
        fail('failed-precondition', 'error.whish.connect');
      }
    }
    await configRef(tenantId).set({ whish: { ...creds, enabled: input.enabled, updatedAt: Date.now() } }, { merge: true });
    return viewOf(tenantId);
  }),
);
