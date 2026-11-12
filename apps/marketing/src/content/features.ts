export type FeatureId =
  | 'pos'
  | 'inventory'
  | 'customers'
  | 'credit'
  | 'suppliers'
  | 'purchases'
  | 'drawer'
  | 'reports'
  | 'offline'
  | 'multicurrency'
  | 'imei'
  | 'users'
  | 'returns';

export interface Feature {
  id: FeatureId;
  name: string;
  summary: string;
  implemented: true;
  points: string[];
}

/** Grounded product facts only. AI and copy must not claim anything outside this list. */
export const FEATURES: Feature[] = [
  {
    id: 'pos',
    name: 'Point of Sale',
    summary: 'Check out faster — products, cart and payment in one place.',
    implemented: true,
    points: [
      'Product grid and search',
      'Barcode lookup',
      'Multiple named carts',
      'Customer on the ticket',
      'Full payment and credit sale',
      'Returns',
    ],
  },
  {
    id: 'inventory',
    name: 'Inventory',
    summary: 'Know exactly what is in stock before you lose a sale.',
    implemented: true,
    points: ['On-hand stock', 'Low-stock visibility', 'Categories', 'Product images', 'Stock adjustments'],
  },
  {
    id: 'customers',
    name: 'Customers',
    summary: 'Keep every customer on the ticket — with their balance in view.',
    implemented: true,
    points: ['Customer selection at POS', 'Customer list', 'Balance on the account'],
  },
  {
    id: 'credit',
    name: 'Customer credit',
    summary: 'Sell on credit without losing track of what customers owe.',
    implemented: true,
    points: ['Credit sale', 'Previous balance on the ticket', 'Add Previous at checkout', 'Debt is separate from new sales'],
  },
  {
    id: 'suppliers',
    name: 'Suppliers',
    summary: 'Know what you owe suppliers before you place the next order.',
    implemented: true,
    points: ['Supplier list', 'Supplier balances'],
  },
  {
    id: 'purchases',
    name: 'Purchases',
    summary: 'Receive stock from suppliers without losing the paper trail.',
    implemented: true,
    points: ['Purchase invoices', 'Stock in from purchases', 'Returns to supplier'],
  },
  {
    id: 'drawer',
    name: 'Cash drawer',
    summary: 'Open/close drawer, cash moves, and USD/LBP amounts in the till.',
    implemented: true,
    points: ['Open session', 'Cash in/out', 'USD and LBP in the drawer'],
  },
  {
    id: 'reports',
    name: 'Reports',
    summary: 'See sales, profit and business performance without spreadsheets.',
    implemented: true,
    points: ['Sales', 'Revenue', 'Profit and expenses views', 'Customer debt', 'Inventory'],
  },
  {
    id: 'offline',
    name: 'Offline operation',
    summary: 'Keep selling when the internet drops, then sync safely when it returns.',
    implemented: true,
    points: ['Sell while offline', 'Queue financial operations', 'Sync when back online'],
  },
  {
    id: 'multicurrency',
    name: 'Multi-currency',
    summary: 'USD and LBP together on the same ticket, with a store exchange rate.',
    implemented: true,
    points: ['USD pricing', 'LBP tender', 'Mixed payments', 'Store rate'],
  },
  {
    id: 'imei',
    name: 'IMEI / serial tracking',
    summary: 'Track serialized units (for example phones) where the product is marked for IMEI.',
    implemented: true,
    points: ['IMEI on serialized products', 'IMEI on the cart line'],
  },
  {
    id: 'users',
    name: 'Users and roles',
    summary: 'Owner and staff users with role-based permissions inside one store.',
    implemented: true,
    points: ['Staff users', 'Permissions', 'Everyone in a store runs the same application version'],
  },
  {
    id: 'returns',
    name: 'Returns',
    summary: 'Return sold items through the POS return flow.',
    implemented: true,
    points: ['Sale returns', 'Inventory and drawer follow the return'],
  },
];

export const VALUE_STRIP = [
  'ONLINE + OFFLINE',
  'MULTI-CURRENCY',
  'REAL-TIME INVENTORY',
  'CUSTOMER CREDIT',
  'SECURE CLOUD',
  'FAST CHECKOUT',
  'RESPONSIVE',
] as const;

export function featureById(id: FeatureId): Feature {
  const hit = FEATURES.find((f) => f.id === id);
  if (!hit) throw new Error(`Unknown feature ${id}`);
  return hit;
}
