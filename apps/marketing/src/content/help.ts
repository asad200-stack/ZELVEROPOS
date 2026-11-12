export const HELP_CATEGORIES = [
  { slug: 'getting-started', title: 'Getting Started' },
  { slug: 'pos', title: 'POS' },
  { slug: 'products', title: 'Products' },
  { slug: 'customers', title: 'Customers' },
  { slug: 'credit', title: 'Credit' },
  { slug: 'purchases', title: 'Purchases' },
  { slug: 'suppliers', title: 'Suppliers' },
  { slug: 'reports', title: 'Reports' },
  { slug: 'offline', title: 'Offline' },
  { slug: 'settings', title: 'Settings' },
] as const;

export interface Article {
  slug: string;
  category: (typeof HELP_CATEGORIES)[number]['slug'];
  title: string;
  steps: string[];
}

export const ARTICLES: Article[] = [
  {
    slug: 'open-your-store',
    category: 'getting-started',
    title: 'Open your store for the day',
    steps: ['Sign in to ZELVERO POS.', 'Confirm the cash drawer is open if you take cash.', 'Start a cart and sell.'],
  },
  {
    slug: 'take-a-sale',
    category: 'pos',
    title: 'Take a sale',
    steps: ['Find the product on the grid or by barcode.', 'Set quantity.', 'Choose the customer if needed.', 'Take Full Payment or Credit Sale.'],
  },
  {
    slug: 'add-previous-debt',
    category: 'credit',
    title: 'Collect previous debt with a new sale',
    steps: [
      'Select the customer who has a balance.',
      'Add the new items.',
      'Use Add Previous so the ticket includes outstanding debt.',
      'Collect the combined amount. Previous debt collected is not new sales revenue.',
    ],
  },
  {
    slug: 'sell-offline',
    category: 'offline',
    title: 'Keep selling offline',
    steps: ['If the network drops, continue checkout as usual.', 'Operations wait in a local queue.', 'When the connection returns, ZELVERO syncs the queue. Do not force-refresh during an active sync.'],
  },
  {
    slug: 'receive-stock',
    category: 'purchases',
    title: 'Receive stock from a supplier',
    steps: ['Open Purchases.', 'Create a purchase with supplier and lines.', 'Stock increases when the purchase is recorded.'],
  },
];

export function articleBySlug(slug: string): Article | undefined {
  return ARTICLES.find((a) => a.slug === slug);
}
