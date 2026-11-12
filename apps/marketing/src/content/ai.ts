import { FEATURES, type FeatureId } from './features';
import { INDUSTRIES } from './industries';

export const AI_UNKNOWN = "I don't have confirmed information about that ZELVERO feature yet.";
export const AI_UNSUPPORTED = "That feature isn't currently confirmed as part of ZELVERO.";

export const SUGGESTED_PROMPTS = [
  'I own a mobile shop',
  'I own a supermarket',
  'How does customer credit work?',
  'Can ZELVERO work offline?',
  'How does USD/LBP work?',
  'What reports are available?',
  'Help me choose the right setup',
] as const;

export type AiIntent =
  | 'WELCOME'
  | 'FEATURE_QUESTION'
  | 'HOW_TO'
  | 'BUSINESS_RECOMMENDATION'
  | 'CUSTOMER_CREDIT'
  | 'INVENTORY'
  | 'SUPPLIERS'
  | 'REPORTS'
  | 'OFFLINE'
  | 'CURRENCY'
  | 'TRIAL'
  | 'QUOTE'
  | 'DEMO'
  | 'PARTNER'
  | 'PRICING'
  | 'POS'
  | 'PURCHASES'
  | 'DRAWER'
  | 'RETURNS'
  | 'USERS'
  | 'DEVICES'
  | 'UNSUPPORTED'
  | 'UNKNOWN';

export interface AiAction {
  id: 'trial' | 'demo' | 'quote' | 'pos' | 'contact' | 'credit' | 'feature';
  label: string;
  to: string;
}

export interface AiReply {
  text: string;
  bullets?: string[];
  steps?: string[];
  chips?: string[];
  actions: AiAction[];
  unknown?: boolean;
  unsupported?: boolean;
  intent?: AiIntent;
  confidence?: number;
}

export interface AiSession {
  industrySlug?: string;
  industryName?: string;
}

export const ACTIONS: Record<AiAction['id'], AiAction> = {
  trial: { id: 'trial', label: 'Start Free Trial', to: '/trial' },
  demo: { id: 'demo', label: 'Explore Demo', to: '/demo' },
  quote: { id: 'quote', label: 'Get a Quote', to: '/quote' },
  pos: { id: 'pos', label: 'Preview POS', to: '/product#pos' },
  credit: { id: 'credit', label: 'See Customer Credit', to: '/#credit' },
  contact: { id: 'contact', label: 'Talk to Sales', to: '/contact' },
  feature: { id: 'feature', label: 'Request Feature', to: '/contact' },
};

export function normalizeQuery(message: string): string {
  return message
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9$]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandSynonyms(n: string): string {
  return n
    .replace(/\bclients?\b/g, 'customer')
    .replace(/\bowes?\b/g, 'debt')
    .replace(/\bowing\b/g, 'debt')
    .replace(/\bsell on debt\b/g, 'customer credit')
    .replace(/\bold debt\b/g, 'previous balance')
    .replace(/\bprevious customer debt\b/g, 'previous balance')
    .replace(/\bwithout internet\b/g, 'offline')
    .replace(/\binternet is down\b/g, 'offline')
    .replace(/\binternet down\b/g, 'offline')
    .replace(/\bconnection lost\b/g, 'offline')
    .replace(/\bno internet\b/g, 'offline')
    .replace(/\bconnectivity\b/g, 'offline')
    .replace(/\bdollar\b/g, 'usd')
    .replace(/\blira\b/g, 'lbp')
    .replace(/\bcash register\b/g, 'drawer')
    .replace(/\btill\b/g, 'drawer')
    .replace(/\bvendors?\b/g, 'supplier')
    .replace(/\bstock\b/g, 'inventory')
    .replace(/\bbarcode\b/g, 'barcode pos')
    .replace(/\bphone shop\b/g, 'mobile shop')
    .replace(/\belectronics store\b/g, 'mobile shop')
    .replace(/\bcellphone\b/g, 'mobile')
    .replace(/\bclothing store\b/g, 'fashion shop')
    .replace(/\bboutique\b/g, 'fashion shop')
    .replace(/\bgrocery\b/g, 'supermarket');
}

interface Rule {
  intent: AiIntent;
  phrases: string[];
  words: string[];
}

const RULES: Rule[] = [
  { intent: 'CUSTOMER_CREDIT', phrases: ['customer credit', 'previous balance', 'credit sale', 'sell on credit', 'collect old', 'already owes', 'owe me', 'owes me'], words: ['credit', 'debt', 'owe', 'owes', 'balance'] },
  { intent: 'OFFLINE', phrases: ['work offline', 'without internet', 'internet down', 'connection lost', 'keep selling'], words: ['offline', 'internet', 'sync', 'queue'] },
  { intent: 'CURRENCY', phrases: ['usd and lbp', 'multi currency', 'mixed payment'], words: ['usd', 'lbp', 'currency', 'currencies'] },
  { intent: 'INVENTORY', phrases: ['track inventory', 'low stock', 'in stock'], words: ['inventory', 'stock', 'barcode', 'imei', 'serial'] },
  { intent: 'SUPPLIERS', phrases: ['manage suppliers', 'supplier balance'], words: ['supplier', 'suppliers'] },
  { intent: 'PURCHASES', phrases: ['create purchases', 'buy from supplier'], words: ['purchase', 'purchases'] },
  { intent: 'REPORTS', phrases: ['see profit', 'what reports', 'business performance'], words: ['report', 'reports', 'profit', 'revenue'] },
  { intent: 'DRAWER', phrases: ['cash drawer', 'usd in drawer'], words: ['drawer', 'cash'] },
  { intent: 'RETURNS', phrases: ['return a sale', 'sale return'], words: ['return', 'returns', 'refund'] },
  { intent: 'USERS', phrases: ['multiple employees', 'staff users'], words: ['employee', 'employees', 'users', 'roles', 'cashier', 'staff'] },
  { intent: 'TRIAL', phrases: ['free trial', '15 day', '15-day', 'no credit card', 'the trial', 'how long'], words: ['trial', 'subscribe'] },
  { intent: 'QUOTE', phrases: ['get a quote', 'custom quote'], words: ['quote', 'quotation'] },
  { intent: 'DEMO', phrases: ['live demo', 'interactive demo'], words: ['demo', 'preview'] },
  { intent: 'PARTNER', phrases: ['partner program', 'become a partner'], words: ['partner', 'referral', 'commission'] },
  { intent: 'PRICING', phrases: ['how much', 'price list'], words: ['price', 'pricing', 'cost'] },
  { intent: 'POS', phrases: ['point of sale', 'fast checkout', 'scan barcodes'], words: ['pos', 'checkout', 'cart', 'barcode', 'sell'] },
  { intent: 'DEVICES', phrases: ['on mobile', 'on pc', 'on phone'], words: ['mobile', 'phone', 'pc', 'computer', 'tablet', 'browser'] },
  { intent: 'FEATURE_QUESTION', phrases: ['what does zelvero', 'what can zelvero', 'zelvero manage'], words: ['features', 'manage'] },
  { intent: 'BUSINESS_RECOMMENDATION', phrases: ['right setup', 'help me choose', 'what do i need'], words: ['recommend', 'setup'] },
];

const UNSUPPORTED = /\b(payroll|drone|drones|delivery app|ecommerce website|shopify|amazon|crypto wallet|nft|hr system|hrm|accounting suite|quickbooks clone)\b/;

const INDUSTRY_HINTS: { slug: string; keys: string[] }[] = [
  { slug: 'mobile-electronics', keys: ['mobile shop', 'phone shop', 'electronics', 'cell phone', 'mobile and electronics'] },
  { slug: 'supermarkets', keys: ['supermarket', 'grocery', 'mini market'] },
  { slug: 'fashion-retail', keys: ['fashion', 'clothing', 'boutique', 'apparel'] },
  { slug: 'wholesale', keys: ['wholesale', 'distributor'] },
  { slug: 'beauty', keys: ['beauty', 'salon', 'cosmetics'] },
  { slug: 'general-retail', keys: ['general retail', 'retail store', 'my store', 'my shop'] },
];

function scoreRule(norm: string, rule: Rule): number {
  let s = 0;
  for (const p of rule.phrases) if (norm.includes(p)) s += 8;
  for (const w of rule.words) {
    if (w.includes(' ')) {
      if (norm.includes(w)) s += 5;
    } else if (new RegExp(`\\b${w}\\b`).test(norm)) s += 2;
  }
  return s;
}

export function detectIndustry(norm: string): { slug: string; name: string } | null {
  for (const row of INDUSTRY_HINTS) {
    if (row.keys.some((k) => norm.includes(k))) {
      const ind = INDUSTRIES.find((i) => i.slug === row.slug);
      return ind ? { slug: ind.slug, name: ind.name } : null;
    }
  }
  return null;
}

export function classifyIntent(message: string, session: AiSession = {}): { intent: AiIntent; confidence: number; industry?: { slug: string; name: string } } {
  const norm = expandSynonyms(normalizeQuery(message));
  if (!norm) return { intent: 'WELCOME', confidence: 1 };
  if (UNSUPPORTED.test(norm)) return { intent: 'UNSUPPORTED', confidence: 1 };

  const industry = detectIndustry(norm);
  const howTo = /\b(how do i|how to|how does|steps|walk me)\b/.test(norm);
  let best: { intent: AiIntent; confidence: number } = { intent: 'UNKNOWN', confidence: 0 };
  for (const rule of RULES) {
    let s = scoreRule(norm, rule);
    if (howTo && (rule.intent === 'CUSTOMER_CREDIT' || rule.intent === 'OFFLINE' || rule.intent === 'POS') && s > 0) s += 4;
    if (s > best.confidence) best = { intent: rule.intent, confidence: s };
  }

  if (industry && (best.confidence < 10 || best.intent === 'DEVICES' || best.intent === 'UNKNOWN' || best.intent === 'BUSINESS_RECOMMENDATION')) {
    return { intent: 'BUSINESS_RECOMMENDATION', confidence: Math.max(best.confidence, 12), industry };
  }
  if (best.confidence < 3 && session.industrySlug && /\b(suppliers?|credit|inventory|need)\b/.test(norm)) {
    return { intent: best.intent === 'UNKNOWN' ? 'BUSINESS_RECOMMENDATION' : best.intent, confidence: 6, industry: { slug: session.industrySlug, name: session.industryName || '' } };
  }
  if (best.confidence < 2) return { intent: 'UNKNOWN', confidence: best.confidence, industry: industry ?? undefined };
  return { intent: best.intent, confidence: best.confidence / 20, industry: industry ?? undefined };
}

export function recommendForMessage(message: string): { industry?: string; features: FeatureId[]; users?: number } | null {
  const q = expandSynonyms(normalizeQuery(message));
  const industry = detectIndustry(q);
  const users = /\b(\d+)\s+(employees|users|cashiers|staff)\b/.exec(q);
  if (!industry && !users) return null;
  const ind = INDUSTRIES.find((i) => i.slug === industry?.slug);
  return {
    industry: ind?.name,
    features: ind?.features ?? ['pos', 'inventory', 'reports'],
    users: users ? Number(users[1]) : undefined,
  };
}

function featureReply(id: FeatureId, extra: Partial<AiReply> = {}): AiReply {
  const feature = FEATURES.find((f) => f.id === id)!;
  return {
    text: feature.summary,
    chips: [feature.name],
    bullets: feature.points.slice(0, 5).map((n) => `✓ ${n}`),
    actions: [ACTIONS.pos, ACTIONS.trial, ACTIONS.quote],
    intent: 'FEATURE_QUESTION',
    ...extra,
  };
}

function industryReply(slug: string, users?: number): AiReply {
  const ind = INDUSTRIES.find((i) => i.slug === slug)!;
  const names = ['POS', 'Inventory', 'Customer Credit', 'Suppliers', 'Purchases', 'USD / LBP', 'Reports', 'IMEI / serial'];
  const tools =
    slug === 'mobile-electronics'
      ? names
      : ind.features.map((id) => FEATURES.find((f) => f.id === id)?.name).filter(Boolean) as string[];
  return {
    text: `ZELVERO is a strong fit for a ${ind.name.toLowerCase()} shop${users ? ` with ${users} users` : ''}.\n\nYou can manage sales, stock and customer balances from one system.`,
    chips: [ind.name],
    bullets: tools.map((n) => `✓ ${n}`),
    actions: [ACTIONS.pos, ACTIONS.trial, ACTIONS.quote],
    intent: 'BUSINESS_RECOMMENDATION',
  };
}

export function answerZelvero(message: string, session: AiSession = {}): AiReply {
  const classified = classifyIntent(message, session);
  if (classified.industry) {
    session.industrySlug = classified.industry.slug;
    session.industryName = classified.industry.name;
  }

  if (classified.intent === 'WELCOME') {
    return {
      text: 'Ask about ZELVERO or tell me what kind of business you run.',
      actions: [ACTIONS.trial, ACTIONS.demo, ACTIONS.quote],
      intent: 'WELCOME',
      confidence: 1,
    };
  }

  if (classified.intent === 'UNSUPPORTED') {
    return {
      text: AI_UNSUPPORTED,
      unknown: true,
      unsupported: true,
      actions: [ACTIONS.feature, ACTIONS.contact],
      intent: 'UNSUPPORTED',
      confidence: 1,
    };
  }

  if (classified.intent === 'BUSINESS_RECOMMENDATION') {
    const rec = recommendForMessage(message);
    const slug = classified.industry?.slug || session.industrySlug;
    if (slug) return industryReply(slug, rec?.users);
    return {
      text: 'Most stores start with POS, inventory, customers, cash drawer and reports. Credit, IMEI and offline depend on how you sell.',
      bullets: ['✓ POS', '✓ Inventory', '✓ Customers', '✓ Reports'],
      actions: [ACTIONS.quote, ACTIONS.trial, ACTIONS.demo],
      intent: 'BUSINESS_RECOMMENDATION',
    };
  }

  if (classified.intent === 'CUSTOMER_CREDIT') {
    const how = /\b(already owes|collect old|sell to someone|previous balance to checkout|add previous)\b/.test(
      expandSynonyms(normalizeQuery(message)),
    );
    if (how) {
      return {
        text: 'Select the customer in POS. ZELVERO shows the customer’s previous balance. You can add that previous balance to checkout and collect it together with the new sale while keeping the new sale and old debt payment separate in accounting.',
        chips: ['CUSTOMER CREDIT'],
        steps: ['Select customer', 'Choose Credit Sale', 'Enter received amount', 'Remaining balance is tracked'],
        actions: [ACTIONS.credit, ACTIONS.trial],
        intent: 'CUSTOMER_CREDIT',
      };
    }
    return {
      text: 'Sell on credit without losing track of what customers owe. Previous balance can be added at checkout and collected with today’s sale — recorded separately from new sales.',
      chips: ['CUSTOMER CREDIT'],
      bullets: ['✓ Credit sale', '✓ Previous balance on the ticket', '✓ Add Previous at checkout', '✓ Debt is separate from new sales'],
      actions: [ACTIONS.credit, ACTIONS.trial, ACTIONS.quote],
      intent: 'CUSTOMER_CREDIT',
    };
  }

  if (classified.intent === 'OFFLINE') {
    return {
      text: 'ZELVERO is designed to keep key POS work available during connectivity problems and synchronize safely when the connection returns.',
      chips: ['ONLINE + OFFLINE'],
      bullets: ['✓ Sell while offline', '✓ Queue financial operations', '✓ Sync when back online'],
      actions: [ACTIONS.pos, ACTIONS.trial, ACTIONS.quote],
      intent: 'OFFLINE',
    };
  }

  if (classified.intent === 'CURRENCY') return featureReply('multicurrency', { intent: 'CURRENCY', chips: ['USD / LBP'] });
  if (classified.intent === 'INVENTORY') return featureReply('inventory', { intent: 'INVENTORY' });
  if (classified.intent === 'SUPPLIERS') {
    const extra = session.industrySlug === 'mobile-electronics' ? ' For a mobile or electronics shop, suppliers and purchases are part of the recommended setup.' : '';
    return { ...featureReply('suppliers', { intent: 'SUPPLIERS' }), text: `${FEATURES.find((f) => f.id === 'suppliers')!.summary}${extra}` };
  }
  if (classified.intent === 'PURCHASES') return featureReply('purchases', { intent: 'PURCHASES' });
  if (classified.intent === 'REPORTS') return featureReply('reports', { intent: 'REPORTS' });
  if (classified.intent === 'DRAWER') return featureReply('drawer', { intent: 'DRAWER' });
  if (classified.intent === 'RETURNS') return featureReply('returns', { intent: 'RETURNS' });
  if (classified.intent === 'USERS') return featureReply('users', { intent: 'USERS' });
  if (classified.intent === 'POS') return featureReply('pos', { intent: 'POS', actions: [ACTIONS.pos, ACTIONS.trial, ACTIONS.quote] });
  if (classified.intent === 'DEVICES') {
    return {
      text: 'ZELVERO runs in the browser on phones, tablets and PCs. The same store, the same data.',
      bullets: ['✓ Mobile browser', '✓ Desktop browser', '✓ No separate native app required'],
      actions: [ACTIONS.trial, ACTIONS.demo, ACTIONS.quote],
      intent: 'DEVICES',
    };
  }
  if (classified.intent === 'TRIAL') {
    return {
      text: 'You can try ZELVERO free for 15 days. No credit card is required. Full access during the trial; cancel anytime before subscribing.',
      chips: ['15-DAY TRIAL'],
      actions: [ACTIONS.trial, ACTIONS.quote],
      intent: 'TRIAL',
    };
  }
  if (classified.intent === 'QUOTE') {
    return {
      text: 'Answer a few questions and a specialist sends your custom quotation. ZELVERO does not publish a public price list yet.',
      actions: [ACTIONS.quote, ACTIONS.trial],
      intent: 'QUOTE',
    };
  }
  if (classified.intent === 'DEMO') {
    return {
      text: 'Interactive demo access is coming soon. Preview ZELVERO now or request a guided demo.',
      actions: [ACTIONS.pos, ACTIONS.contact, ACTIONS.trial],
      intent: 'DEMO',
    };
  }
  if (classified.intent === 'PARTNER') {
    return {
      text: 'Partners introduce businesses to ZELVERO with a personal link, demo and trial tools, and commission tracking under a private agreement.',
      actions: [{ id: 'contact', label: 'Become a Partner', to: '/partners' }, ACTIONS.quote],
      intent: 'PARTNER',
    };
  }
  if (classified.intent === 'PRICING') {
    return {
      text: 'ZELVERO does not publish a public price list yet. Start a 15-day trial or request a custom quote.',
      actions: [ACTIONS.trial, ACTIONS.quote],
      intent: 'PRICING',
    };
  }
  if (classified.intent === 'FEATURE_QUESTION') {
    return {
      text: 'ZELVERO is one system for the store: selling, stock, people and money.',
      bullets: ['✓ POS and checkout', '✓ Inventory and stock', '✓ Customers and credit', '✓ Suppliers and purchases', '✓ Reports', '✓ Offline selling'],
      actions: [ACTIONS.pos, ACTIONS.trial, ACTIONS.quote],
      intent: 'FEATURE_QUESTION',
    };
  }

  return {
    text: AI_UNKNOWN,
    unknown: true,
    actions: [ACTIONS.contact],
    intent: 'UNKNOWN',
    confidence: classified.confidence,
  };
}

export const AI_CORPUS: string[] = [
  'Can ZELVERO work without internet?',
  'Can I sell on credit?',
  'Can I collect old debt?',
  'Can customers owe me money?',
  'Can I use LBP?',
  'Can I use USD?',
  'Can I use USD and LBP together?',
  'Can I manage suppliers?',
  'Can I create purchases?',
  'Can I return a sale?',
  'Can I see profit?',
  'Can I track inventory?',
  'Can I scan barcodes?',
  'I own a mobile shop',
  'I own a supermarket',
  'I have a clothing store',
  'Can I use it on mobile?',
  'Can I use it on PC?',
  'Can multiple employees use it?',
  'How do I get a quote?',
  'Do you have a free trial?',
  'How long is the trial?',
  'What happens when the internet goes down?',
  'How does customer credit work?',
  'Can I track previous balances?',
  'What reports can I see?',
  'How does the cash drawer work?',
  'I have a phone shop',
  'How do I sell to someone who already owes me money?',
  'Can I sell on debt?',
  'client owes me money',
  'previous balance',
  'customer owes money',
  'Can it work without internet?',
  'offline',
  'internet is down',
  'connection lost',
  'Help me choose the right setup',
  'What does ZELVERO manage?',
  'How does USD/LBP work?',
  'I have an electronics store',
  'Do I need suppliers?',
  'Can I add previous customer debt at checkout?',
  'How do returns work?',
  'Can staff have different roles?',
  'Is there a partner program?',
  'How much does it cost?',
  'Show me the demo',
  'Can I keep selling if connection is lost?',
  'Does it have a cash drawer?',
];

export function fallbackRate(questions: string[] = AI_CORPUS, session: AiSession = {}): number {
  const unknown = questions.filter((q) => answerZelvero(q, session).unknown).length;
  return unknown / questions.length;
}
