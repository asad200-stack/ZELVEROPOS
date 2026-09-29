import { getDoc, getDocs, limit, query, serverTimestamp, setDoc } from 'firebase/firestore';
import type { StoreSettings } from '@/types/models';
import { paths, type TenantCollection } from './db';
import { AppError } from './errors';
import { requireOnline } from './ops';

export type SettingsPatch = Partial<Omit<StoreSettings, 'updatedAt'>>;

export async function saveSettings(tenantId: string, patch: SettingsPatch): Promise<void> {
  if (patch.exchangeRate !== undefined && !(Number.isInteger(patch.exchangeRate) && patch.exchangeRate > 0)) {
    throw new AppError('error.invalidRate');
  }
  const p = setDoc(paths.settings(tenantId), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
  if (navigator.onLine) await p;
  else p.catch((e) => console.error('[settings] offline write rejected', e));
}

export interface TelegramSecrets {
  botToken: string;
  chatId: string;
}

/** Telegram credentials live in an owner-only private document, never in the public settings. */
export async function loadTelegramSecrets(tenantId: string): Promise<TelegramSecrets> {
  const snap = await getDoc(paths.telegram(tenantId));
  const d = snap.data() ?? {};
  return { botToken: typeof d.botToken === 'string' ? d.botToken : '', chatId: typeof d.chatId === 'string' ? d.chatId : '' };
}

export async function saveTelegramSecrets(tenantId: string, secrets: TelegramSecrets): Promise<void> {
  requireOnline();
  const botToken = secrets.botToken.trim();
  const chatId = secrets.chatId.trim();
  if (botToken && !/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(botToken)) throw new AppError('error.telegramToken');
  if (chatId && !/^-?\d{3,}$|^@[A-Za-z0-9_]{4,}$/.test(chatId)) throw new AppError('error.telegramChat');
  await setDoc(paths.telegram(tenantId), { botToken, chatId, updatedAt: serverTimestamp() });
}

const BACKUP_COLLECTIONS: TenantCollection[] = [
  'products',
  'customers',
  'customerLedger',
  'suppliers',
  'purchases',
  'purchaseReturns',
  'supplierPayments',
  'sales',
  'returns',
  'stockMovements',
  'cashTransactions',
  'dailyStats',
];

/** Exports the tenant's business data as JSON (read-only backup; timestamps as ISO strings). */
export async function exportBackup(tenantId: string, onProgress?: (label: string) => void): Promise<Blob> {
  requireOnline();
  const serialize = (value: unknown): unknown => {
    if (value && typeof value === 'object') {
      if (typeof (value as { toDate?: unknown }).toDate === 'function') return (value as { toDate: () => Date }).toDate().toISOString();
      if (Array.isArray(value)) return value.map(serialize);
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)]));
    }
    return value;
  };
  const out: Record<string, unknown> = { format: 'zelvero-backup', version: 1, exportedAt: new Date().toISOString() };
  const settings = await getDoc(paths.settings(tenantId));
  out.settings = serialize(settings.data() ?? {});
  const cats = await getDoc(paths.categories(tenantId));
  out.categories = cats.data()?.names ?? [];
  const cash = await getDoc(paths.cashbox(tenantId));
  out.cashbox = serialize(cash.data() ?? {});
  for (const name of BACKUP_COLLECTIONS) {
    onProgress?.(name);
    const snap = await getDocs(query(paths.col(tenantId, name), limit(50_000)));
    out[name] = snap.docs.map((d) => ({ id: d.id, ...(serialize(d.data()) as object) }));
  }
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}
