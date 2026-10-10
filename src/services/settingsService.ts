import { getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { StoreSettings } from '@/types/models';
import { paths } from './db';
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

