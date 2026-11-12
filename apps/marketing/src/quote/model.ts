export const QUOTE_STEPS = [
  'Tell us about your business',
  'How do you work?',
  'What do you need?',
  'Your contact details',
  'Your recommended ZELVERO setup',
] as const;
export type QuoteStep = (typeof QUOTE_STEPS)[number];

export interface QuoteDraft {
  businessType: string;
  branches: number;
  users: number;
  posDevices: number;
  specialRequirements: string;
  customerCredit: boolean;
  imei: boolean;
  offline: boolean;
  name: string;
  email: string;
  phone: string;
  company: string;
}

export const EMPTY_QUOTE: QuoteDraft = {
  businessType: 'general-retail',
  branches: 1,
  users: 2,
  posDevices: 1,
  specialRequirements: '',
  customerCredit: true,
  imei: false,
  offline: true,
  name: '',
  email: '',
  phone: '',
  company: '',
};

const TYPE_LABEL: Record<string, string> = {
  'mobile-electronics': 'Mobile & Electronics',
  supermarkets: 'Supermarkets',
  'fashion-retail': 'Fashion & Retail',
  wholesale: 'Wholesale',
  beauty: 'Beauty',
  'general-retail': 'General Retail',
};

export function businessLabel(type: string): string {
  return TYPE_LABEL[type] ?? type;
}

export function recommendedSetup(d: QuoteDraft): string[] {
  const items = ['POS', 'Inventory', 'Customers', 'Reports'];
  if (d.customerCredit) items.push('Customer credit');
  if (d.imei || d.businessType === 'mobile-electronics') items.push('IMEI / serial');
  if (d.offline) items.push('Offline selling');
  if (d.businessType === 'wholesale' || d.businessType === 'mobile-electronics') items.push('Suppliers');
  return [...new Set(items)];
}

export function quoteSummaryLines(d: QuoteDraft): string[] {
  return [
    `Business: ${businessLabel(d.businessType)}`,
    `Branches: ${d.branches}`,
    `Team size: ${d.users} users`,
    ...recommendedSetup(d).map((item) => `Setup: ${item}`),
  ];
}

export function quoteReadyCopy(): string {
  return 'Your recommended ZELVERO setup';
}

export function contactComplete(d: QuoteDraft): boolean {
  return Boolean(d.name.trim() && d.company.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email) && d.phone.trim());
}

export function canAdvance(step: QuoteStep, d: QuoteDraft): boolean {
  if (step === 'Your contact details') return contactComplete(d);
  return true;
}
