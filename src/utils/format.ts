import type { Currency } from '@/types/models';
import type { Lang } from '@/i18n/i18n';

const usdFormatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Keeps digits, separators, and a currency mark in mathematical order inside an Arabic page. */
function isolateLtr(value: string): string {
  return `\u2066${value}\u2069`;
}

export function formatUsd(cents: number): string {
  const v = (Number(cents) || 0) / 100;
  const sign = v < 0 ? '-' : '';
  return isolateLtr(`${sign}$${usdFormatter.format(Math.abs(v))}`);
}

export function formatLbp(lbp: number, lang: Lang = 'en'): string {
  const suffix = lang === 'ar' ? 'ل.ل' : 'LBP';
  return isolateLtr(`${intFormatter.format(Math.round(Number(lbp) || 0))} ${suffix}`);
}

export function formatMoney(amount: number, currency: Currency, lang: Lang = 'en'): string {
  return currency === 'USD' ? formatUsd(amount) : formatLbp(amount, lang);
}

export function formatNumber(n: number): string {
  return isolateLtr(intFormatter.format(Number(n) || 0));
}

export function formatDateTime(ms: number | null | undefined, lang: Lang = 'en'): string {
  if (!ms) return '—';
  return isolateLtr(new Date(ms).toLocaleString(lang === 'ar' ? 'ar-LB-u-nu-latn' : 'en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }));
}

export function formatDate(value: string | number | null | undefined, lang: Lang = 'en'): string {
  if (!value) return '—';
  const d = typeof value === 'number' ? new Date(value) : new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return isolateLtr(d.toLocaleDateString(lang === 'ar' ? 'ar-LB-u-nu-latn' : 'en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' }));
}

export function normalizeSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .trim();
}
