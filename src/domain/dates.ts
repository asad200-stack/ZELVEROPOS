/** Local business date helpers. Dates are stored as local "YYYY-MM-DD" strings for grouping. */
const pad = (n: number) => String(n).padStart(2, '0');

export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseLocalDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addDays(date: string, days: number): string {
  const d = parseLocalDate(date) ?? new Date();
  d.setDate(d.getDate() + days);
  return localDate(d);
}

export function startOfMonth(d: Date = new Date()): string {
  return localDate(new Date(d.getFullYear(), d.getMonth(), 1));
}

/** Whole days from today until `date` (negative when in the past). */
export function daysUntil(date: string, today: Date = new Date()): number | null {
  const target = parseLocalDate(date);
  if (!target) return null;
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - base.getTime()) / 86_400_000);
}

export type ExpiryState = 'none' | 'expired' | 'soon' | 'ok';

export function expiryState(date: string | null, soonDays: number, today: Date = new Date()): ExpiryState {
  if (!date) return 'none';
  const days = daysUntil(date, today);
  if (days === null) return 'none';
  if (days < 0) return 'expired';
  if (days <= soonDays) return 'soon';
  return 'ok';
}

export type DatePreset = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'year' | 'custom';

export interface DateRange {
  preset: DatePreset;
  from: string;
  to: string;
}

export function initialRange(preset: DatePreset = 'today'): DateRange {
  return { preset, ...presetRange(preset) };
}

export function presetRange(preset: DatePreset, now: Date = new Date()): { from: string; to: string } {
  const today = localDate(now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case 'week':
      return { from: addDays(today, -6), to: today };
    case 'month':
      return { from: startOfMonth(now), to: today };
    case 'lastMonth': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: localDate(first), to: localDate(last) };
    }
    case 'year':
      return { from: `${now.getFullYear()}-01-01`, to: today };
    default:
      return { from: today, to: today };
  }
}
