export const WHY_ZELVERO = [
  { id: 'fast', title: 'FAST', icon: '⚡', body: 'Fast checkout and simple workflows.' },
  { id: 'connected', title: 'CONNECTED', icon: '◎', body: 'Sales, stock, customers and suppliers work together.' },
  { id: 'online', title: 'ONLINE + OFFLINE', icon: '⟳', body: 'Keep working even when internet connectivity is unstable.' },
  { id: 'currency', title: 'MULTI-CURRENCY', icon: '$', body: 'Designed for businesses operating with multiple currencies.' },
  { id: 'credit', title: 'CUSTOMER CREDIT', icon: '◇', body: 'Track customer balances and collect previous debt directly from POS.' },
  { id: 'control', title: 'REAL-TIME CONTROL', icon: '▣', body: 'Know what is happening in the business from one place.' },
] as const;

export type WhyId = (typeof WHY_ZELVERO)[number]['id'];
