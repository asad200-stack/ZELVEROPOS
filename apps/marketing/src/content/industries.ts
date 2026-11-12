import type { FeatureId } from './features';

export interface Industry {
  slug: string;
  name: string;
  summary: string;
  features: FeatureId[];
}

export const INDUSTRIES: Industry[] = [
  {
    slug: 'mobile-electronics',
    name: 'Mobile & Electronics',
    summary: 'Stock, serial/IMEI workflows, customer credit and supplier purchases.',
    features: ['pos', 'inventory', 'imei', 'credit', 'suppliers', 'purchases', 'multicurrency', 'reports'],
  },
  {
    slug: 'supermarkets',
    name: 'Supermarkets',
    summary: 'Fast checkout, barcode workflows, inventory and low-stock visibility.',
    features: ['pos', 'inventory', 'multicurrency', 'drawer', 'reports', 'offline'],
  },
  {
    slug: 'fashion-retail',
    name: 'Fashion & Retail',
    summary: 'Products, categories, stock and customer management.',
    features: ['pos', 'inventory', 'customers', 'returns', 'users', 'reports'],
  },
  {
    slug: 'wholesale',
    name: 'Wholesale',
    summary: 'Customer credit, supplier balances, purchases and inventory.',
    features: ['pos', 'customers', 'credit', 'suppliers', 'purchases', 'reports'],
  },
  {
    slug: 'beauty',
    name: 'Beauty',
    summary: 'Products, customers, sales and business reporting.',
    features: ['pos', 'inventory', 'customers', 'drawer', 'reports'],
  },
  {
    slug: 'general-retail',
    name: 'General Retail',
    summary: 'Flexible POS and inventory for everyday business operations.',
    features: ['pos', 'inventory', 'customers', 'credit', 'suppliers', 'drawer', 'reports', 'offline', 'multicurrency'],
  },
];

export function industryBySlug(slug: string): Industry | undefined {
  return INDUSTRIES.find((i) => i.slug === slug);
}
