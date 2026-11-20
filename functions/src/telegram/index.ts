import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { db } from '../admin.js';
import { REGION, TELEGRAM_TIMEZONE } from '../config.js';
import { fail } from '../errors.js';
import { assertLiveTenantUser } from '../liveUser.js';
import { caller } from '../validate.js';
import { cashMessage, crossedLowStock, lowStockMessage, NOTIFIED_CASH_TYPES, onlineOrderMessage, returnMessage, saleMessage } from './format.js';

type TelegramEvent = 'sales' | 'returns' | 'cash' | 'lowStock' | 'onlineOrders';

const DEFAULT_EVENTS: Record<TelegramEvent, boolean> = { sales: true, returns: true, cash: true, lowStock: false, onlineOrders: true };
const DEFAULT_LOW_STOCK_THRESHOLD = 10;
const TRIGGER_OPTIONS = { region: REGION, maxInstances: 10, timeoutSeconds: 30 } as const;

interface Secrets {
  botToken: string;
  chatId: string;
}

async function loadSecrets(tenantId: string): Promise<Secrets | null> {
  const d = (await db.doc(`tenants/${tenantId}/private/telegram`).get()).data();
  const botToken = typeof d?.botToken === 'string' ? d.botToken.trim() : '';
  const chatId = typeof d?.chatId === 'string' ? d.chatId.trim() : '';
  return botToken && chatId ? { botToken, chatId } : null;
}

/** Returns credentials when Telegram is enabled for this event, otherwise null. */
async function channelFor(tenantId: string, event: TelegramEvent) {
  const settings = (await db.doc(`tenants/${tenantId}/settings/main`).get()).data() ?? {};
  const tg = (settings.telegram ?? {}) as { enabled?: boolean; events?: Partial<Record<TelegramEvent, boolean>> };
  if (tg.enabled !== true) return null;
  const enabled = typeof tg.events?.[event] === 'boolean' ? tg.events[event] : DEFAULT_EVENTS[event];
  if (!enabled) return null;
  const secrets = await loadSecrets(tenantId);
  return secrets ? { secrets, settings } : null;
}

export async function sendTelegram(secrets: Secrets, text: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${secrets.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: secrets.chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.warn('[telegram] send failed', res.status, (await res.text()).slice(0, 300));
    return res.ok;
  } catch (e) {
    console.warn('[telegram] send error', e);
    return false;
  }
}

async function notify(tenantId: string, event: TelegramEvent, build: (tz: string) => string): Promise<void> {
  const channel = await channelFor(tenantId, event);
  if (!channel) return;
  await sendTelegram(channel.secrets, build(TELEGRAM_TIMEZONE.value()));
}

export const onSaleCreated = onDocumentCreated({ ...TRIGGER_OPTIONS, document: 'tenants/{tenantId}/sales/{saleId}' }, async (event) => {
  const data = event.data?.data();
  if (data) await notify(event.params.tenantId, 'sales', (tz) => saleMessage(data, tz));
});

export const onReturnCreated = onDocumentCreated({ ...TRIGGER_OPTIONS, document: 'tenants/{tenantId}/returns/{returnId}' }, async (event) => {
  const data = event.data?.data();
  if (data) await notify(event.params.tenantId, 'returns', (tz) => returnMessage(data, tz));
});

/** A guest placed an order on the online store: tell the owner right away. */
export const onOnlineOrderCreated = onDocumentCreated(
  { ...TRIGGER_OPTIONS, document: 'onlineStores/{tenantId}/orders/{orderId}' },
  async (event) => {
    const data = event.data?.data();
    if (data) await notify(event.params.tenantId, 'onlineOrders', (tz) => onlineOrderMessage(data, tz));
  },
);

export const onCashTransactionCreated = onDocumentCreated(
  { ...TRIGGER_OPTIONS, document: 'tenants/{tenantId}/cashTransactions/{txId}' },
  async (event) => {
    const data = event.data?.data();
    if (!data || !NOTIFIED_CASH_TYPES.includes(String(data.type))) return;
    await notify(event.params.tenantId, 'cash', (tz) => cashMessage(data, tz));
  },
);

export const onProductStockChanged = onDocumentUpdated(
  { ...TRIGGER_OPTIONS, document: 'tenants/{tenantId}/products/{productId}' },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after || before.stock === after.stock) return;
    const beforeStock = Number(before.stock) || 0;
    const afterStock = Number(after.stock) || 0;
    if (afterStock >= beforeStock) return;
    const channel = await channelFor(event.params.tenantId, 'lowStock');
    if (!channel) return;
    const storeDefault = Number(channel.settings.lowStockThreshold);
    const threshold =
      typeof after.minStock === 'number' ? after.minStock : Number.isFinite(storeDefault) ? storeDefault : DEFAULT_LOW_STOCK_THRESHOLD;
    if (!crossedLowStock(beforeStock, afterStock, threshold)) return;
    await sendTelegram(channel.secrets, lowStockMessage(String(after.name ?? ''), afterStock, threshold));
  },
);

/** Sends a test message with the stored credentials (the bot token never reaches the browser). */
export const testTelegram = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  await assertLiveTenantUser(c);
  const allowed = c.tenantId && c.active && (c.role === 'owner' || c.perms.canEditSettings === true);
  if (!allowed || !c.tenantId) fail('permission-denied', 'error.fn.notAllowed');
  const secrets = await loadSecrets(c.tenantId);
  if (!secrets) fail('failed-precondition', 'error.fn.telegramNotConfigured');
  const settings = (await db.doc(`tenants/${c.tenantId}/settings/main`).get()).data() ?? {};
  const ok = await sendTelegram(secrets, `✅ ZELVERO POS\n${String(settings.storeName ?? '')}\nTelegram notifications are working.`);
  if (!ok) fail('failed-precondition', 'error.fn.telegramFailed');
  return { ok: true as const };
});
