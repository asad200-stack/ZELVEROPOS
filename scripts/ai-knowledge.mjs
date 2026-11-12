/**
 * Builds the Zelvero AI knowledge draft from verified local source.
 *
 * No network, no model download, no Firebase Admin SDK, and no tenant data.
 * Conversations are never read. A draft is not visible to the assistant until
 * `node scripts/ai-knowledge.mjs --approve` records a review of the current hashes.
 * `--check` fails when source, evidence, or the review no longer match.
 *
 * Facts describe the local working tree. They are not a production deployment check.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const draftPath = 'src/features/ai/knowledge/draft.json';
const reviewPath = 'src/features/ai/knowledge/review.json';

const POS_FILES = [
  'functions/src/pos/sales.ts',
  'functions/src/pos/cash.ts',
  'functions/src/pos/inventory.ts',
  'functions/src/pos/customers.ts',
  'functions/src/pos/suppliers.ts',
];

const TEST_FILES = [
  'src/domain/checkout.test.ts',
  'src/offline/offline.test.ts',
  'src/domain/inventory.test.ts',
  'src/domain/suppliers.test.ts',
  'src/services/clientOperation.test.ts',
];

const EXTRA_LABELS = [
  'pos.searchPlaceholder',
  'pos.checkout',
  'pos.clearCart',
  'pos.paymentMethod',
  'pos.payPrevious',
  'pos.addPreviousBalance',
  'returns.start',
  'returns.confirm',
  'returns.confirmMessage',
  'products.adjustStock',
  'products.archive',
  'products.deleteForever',
  'products.deleteConfirm',
  'customers.pay',
  'customers.adjustDebt',
  'customers.debt',
  'cash.deposit',
  'cash.expense',
  'cash.withdrawal',
  'cash.adjust',
  'cash.actions',
  'purchases.new',
  'purchases.payFromCashbox',
  'purchases.returnToSupplier',
  'purchases.confirmReturn',
  'reports.sales',
  'reports.profit',
  'reports.inventory',
  'reports.customers',
  'reports.capital',
  'reports.expenses',
  'offline.posBanner',
  'offline.savedNotInvoice',
  'offline.receiptNotInvoice',
  'common.noAccessMessage',
];

const LABEL_ROUTE = {
  pos: '/pos',
  returns: '/sales',
  products: '/products',
  expiry: '/expiry',
  customers: '/customers',
  suppliers: '/suppliers',
  purchases: '/purchases',
  cash: '/cashbox',
  reports: '/reports',
  users: '/users',
  settings: '/settings',
  dashboard: '/dashboard',
  offline: '/pos',
};

const fileCache = new Map();

function read(rel) {
  const hit = fileCache.get(rel);
  if (hit) return hit;
  const buf = fs.readFileSync(path.join(root, rel));
  let text;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) text = buf.toString('utf16le');
  else text = buf.toString('utf8');
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  fileCache.set(rel, text);
  return text;
}

function linesOf(rel) {
  return read(rel).split('\n');
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function lineNo(rel, predicate) {
  const index = linesOf(rel).findIndex(predicate);
  if (index < 0) throw new Error(`No matching line in ${rel}`);
  return index + 1;
}

function parseDict(rel) {
  const map = new Map();
  linesOf(rel).forEach((line, index) => {
    const keyMatch = line.match(/^[ ]{2}'([^']+)':\s*(.*)$/);
    if (!keyMatch) return;
    let raw = keyMatch[2].trim().replace(/,$/, '').trim();
    const quote = raw[0];
    if ((quote !== "'" && quote !== '"') || !raw.endsWith(quote)) return;
    const value = raw.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"');
    map.set(keyMatch[1], { value, line: index + 1 });
  });
  return map;
}

function keywordsOf(...parts) {
  const stop = new Set('the and for with from this that local source only not production deployment check chat will does into your role may app data screen button label text file'.split(' '));
  const out = [];
  const push = (token) => {
    const value = token.toLowerCase();
    if (value.length < 2 || stop.has(value) || out.includes(value)) return;
    out.push(value);
  };
  for (const part of parts) {
    if (!part) continue;
    for (const token of String(part).split(/[^\p{L}\p{N}]+/u)) push(token);
    for (const token of String(part).replace(/([a-z\u0600-\u06FF])([A-Z])/g, '$1 $2').split(/[^\p{L}\p{N}]+/u)) push(token);
  }
  return out.slice(0, 48);
}

function releaseOf() {
  const appVersion = JSON.parse(read('package.json')).version;
  const match = read('src/constants/app.ts').match(/VITE_APP_RELEASE_VERSION \|\| '([^']+)'/);
  if (!match) throw new Error('APP_RELEASE_VERSION fallback was not found');
  return {
    appVersion,
    releaseVersion: match[1],
    channel: 'local-working-tree',
    productionVerified: false,
  };
}

function anchorText(anchors) {
  return anchors
    .map((anchor) => linesOf(anchor.path).slice(anchor.startLine - 1, anchor.endLine).join('\n'))
    .join('\n---\n');
}

function sourced(symbol, anchors) {
  for (const anchor of anchors) {
    const lines = linesOf(anchor.path);
    if (anchor.startLine < 1 || anchor.endLine > lines.length || anchor.endLine < anchor.startLine) {
      throw new Error(`Bad range ${anchor.path}:${anchor.startLine}-${anchor.endLine}`);
    }
  }
  const primary = anchors[0];
  return {
    path: primary.path,
    symbol,
    startLine: primary.startLine,
    endLine: primary.endLine,
    sha256: sha256(anchorText(anchors)),
    anchors,
  };
}

function exportedNames(indexText) {
  const names = new Set();
  for (const block of indexText.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of block[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (/^[A-Za-z][A-Za-z0-9]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

function clientCallableNames(clientText) {
  const names = new Set();
  for (const match of clientText.matchAll(/>\(\s*'([A-Za-z][A-Za-z0-9]*)'\s*\)/g)) names.add(match[1]);
  return names;
}

function permissionKeys(permissionsText) {
  const block = permissionsText.match(/export const PERMISSION_KEYS = \[([\s\S]*?)\] as const/);
  if (!block) throw new Error('PERMISSION_KEYS was not found');
  return [...block[1].matchAll(/'([A-Za-z]+)'/g)].map((match) => match[1]);
}

function scanPos(rel) {
  const lines = linesOf(rel);
  const found = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^export const (pos[A-Za-z0-9]+) = onCall/);
    if (!match) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^export const /.test(lines[j])) {
        end = j;
        break;
      }
    }
    const chunk = lines.slice(i, end).join('\n');
    const perms = [...new Set([...chunk.matchAll(/'(can[A-Za-z]+)'/g)].map((item) => item[1]))];
    const ownerOnly = chunk.includes('error.fn.notOwner');
    if (perms.length === 0 && !ownerOnly) throw new Error(`${match[1]} has no permission gate in ${rel}`);
    const marked = [];
    for (const perm of perms) {
      const at = lines.findIndex((line, index) => index >= i && index < end && line.includes(`'${perm}'`));
      if (at < 0) throw new Error(`${match[1]} does not mention ${perm} in ${rel}`);
      marked.push(at);
    }
    if (ownerOnly) {
      const at = lines.findIndex((line, index) => index >= i && index < end && line.includes('error.fn.notOwner'));
      if (at < 0) throw new Error(`${match[1]} does not mention the owner gate in ${rel}`);
      marked.push(at);
    }
    found.push({
      name: match[1],
      permission: perms[0] ?? null,
      also: perms.slice(1),
      ownerOnly,
      startLine: i + 1,
      endLine: Math.max(...marked) + 1,
    });
  }
  return found;
}

function card(release, input) {
  return {
    id: input.id,
    kind: input.kind,
    title: input.title,
    body: input.body,
    keywords: input.keywords,
    route: input.route,
    permission: input.permission,
    audience: input.audience,
    callable: input.callable,
    executes: false,
    valid: true,
    source: input.source,
    release,
    evidence: input.evidence,
  };
}

function localNote(en, ar) {
  return {
    en: `${en} This is from the local working tree, not a production deployment check.`,
    ar: `${ar} هذه المعلومة من شجرة المصدر المحلية، وليست تأكيداً أن الميزة منشورة في الإنتاج.`,
  };
}

export function buildKnowledge() {
  fileCache.clear();
  const release = releaseOf();
  const en = parseDict('src/i18n/en.ts');
  const ar = parseDict('src/i18n/ar.ts');
  const keys = permissionKeys(read('src/constants/permissions.ts'));
  const keySet = new Set(keys);
  const indexRel = 'functions/src/index.ts';
  const clientRel = 'src/services/functionsClient.ts';
  const exports = exportedNames(read(indexRel));
  const clientNames = clientCallableNames(read(clientRel));
  for (const name of clientNames) {
    if (!exports.has(name)) throw new Error(`Client callable ${name} is not exported`);
  }

  const items = [];
  const ids = new Set();
  const add = (item) => {
    if (ids.has(item.id)) throw new Error(`Duplicate knowledge id ${item.id}`);
    ids.add(item.id);
    items.push(item);
  };

  const navRel = 'src/app/navigation.ts';
  const nav = [];
  linesOf(navRel).forEach((line, index) => {
    const match = line.match(/\{ path: '([^']+)', label: '([^']+)', icon: '[^']+'(?:, permission: '([^']+)')?(?:, ownerOnly: (true))? \}/);
    if (!match) return;
    nav.push({ path: match[1], label: match[2], permission: match[3] ?? null, ownerOnly: match[4] === 'true', line: index + 1 });
  });
  if (nav.length < 10) throw new Error('Navigation items were not parsed');

  const routeAudience = new Map();
  for (const item of nav) {
    const labelEn = en.get(item.label);
    const labelAr = ar.get(item.label);
    if (!labelEn || !labelAr) throw new Error(`Missing nav label ${item.label}`);
    if (item.permission && !keySet.has(item.permission)) throw new Error(`Unknown nav permission ${item.permission}`);
    const audience = item.ownerOnly ? 'owner' : item.permission ? 'permission' : 'member';
    routeAudience.set(item.path, { audience, permission: item.permission });
    const whoEn = item.ownerOnly
      ? 'Only the store owner can open it.'
      : item.permission
        ? `Opening it requires ${item.permission}.`
        : 'Any signed-in store member can open it.';
    const whoAr = item.ownerOnly
      ? 'مالك المتجر فقط يستطيع فتحها.'
      : item.permission
        ? `فتحها يتطلب ${item.permission}.`
        : 'أي عضو مسجّل في المتجر يستطيع فتحها.';
    const body = localNote(
      `The menu label is "${labelEn.value}". The route is ${item.path}. ${whoEn} Zelvero AI cannot open it for you.`,
      `اسم القائمة «${labelAr.value}». المسار ${item.path}. ${whoAr} Zelvero AI لا يستطيع فتحها نيابة عنك.`,
    );
    add(card(release, {
      id: `route:${item.path}`,
      kind: 'route',
      title: { en: labelEn.value, ar: labelAr.value },
      body,
      keywords: keywordsOf(labelEn.value, labelAr.value, item.path, item.label, item.permission, 'menu', 'route'),
      route: item.path,
      permission: item.permission,
      audience,
      callable: null,
      source: sourced(item.label, [
        { path: navRel, startLine: item.line, endLine: item.line },
        { path: 'src/i18n/en.ts', startLine: labelEn.line, endLine: labelEn.line },
        { path: 'src/i18n/ar.ts', startLine: labelAr.line, endLine: labelAr.line },
      ]),
      evidence: { en: [labelEn.value, item.path], ar: [labelAr.value, item.path], source: [item.path, item.label] },
    }));
  }

  const routesRel = 'src/app/AppRoutes.tsx';
  const publicRoutes = [
    ['/login', 'Sign in'],
    ['/signup', 'Create an account'],
    ['/forgot-password', 'Forgot password'],
    ['/verify-email', 'Email verification'],
    ['/auth/action', 'Email action'],
    ['/setup', 'Store setup'],
  ];
  for (const [routePath, title] of publicRoutes) {
    const line = lineNo(routesRel, (value) => value.includes(`path="${routePath}"`));
    const body = localNote(
      `${title} is the route ${routePath} in the sign-in flow. Zelvero AI cannot submit it.`,
      `${title} هو المسار ${routePath} ضمن تسجيل الدخول. Zelvero AI لا يستطيع إرساله.`,
    );
    add(card(release, {
      id: `route:${routePath}`,
      kind: 'route',
      title: { en: title, ar: title },
      body,
      keywords: keywordsOf(title, routePath, 'login', 'signup', 'auth'),
      route: routePath,
      permission: null,
      audience: 'public',
      callable: null,
      source: sourced(routePath, [{ path: routesRel, startLine: line, endLine: line }]),
      evidence: { en: [routePath], ar: [routePath], source: [`path="${routePath}"`] },
    }));
  }
  const adminLine = lineNo(routesRel, (value) => value.includes('path="/admin"'));
  const adminBody = localNote(
    'Platform admin is the route /admin. The local router wraps it in RequireSuperAdmin. Zelvero AI cannot use it.',
    'إدارة المنصة هي المسار /admin. الموجّه المحلي يغلّفها بـ RequireSuperAdmin. Zelvero AI لا يستطيع استخدامها.',
  );
  add(card(release, {
    id: 'route:/admin',
    kind: 'route',
    title: { en: en.get('nav.admin')?.value ?? 'Platform admin', ar: ar.get('nav.admin')?.value ?? 'Platform admin' },
    body: adminBody,
    keywords: keywordsOf('admin', '/admin', en.get('nav.admin')?.value, ar.get('nav.admin')?.value, 'super'),
    route: '/admin',
    permission: null,
    audience: 'superAdmin',
    callable: null,
    source: sourced('/admin', [
      { path: routesRel, startLine: adminLine, endLine: adminLine },
      { path: routesRel, startLine: lineNo(routesRel, (value) => value.includes('RequireSuperAdmin')), endLine: lineNo(routesRel, (value) => value.includes('RequireSuperAdmin')) },
    ]),
    evidence: { en: ['/admin', 'RequireSuperAdmin'], ar: ['/admin', 'RequireSuperAdmin'], source: ['path="/admin"', 'RequireSuperAdmin'] },
  }));

  const labelKeys = [...new Set([...EXTRA_LABELS, ...[...en.keys()].filter((key) => key.startsWith('nav.') || key.startsWith('perm.'))])];
  for (const key of labelKeys) {
    const labelEn = en.get(key);
    const labelAr = ar.get(key);
    if (!labelEn || !labelAr) throw new Error(`Missing locale key ${key}`);
    const prefix = key.split('.')[0];
    const route = key.startsWith('nav.') ? nav.find((item) => item.label === key)?.path ?? null : LABEL_ROUTE[prefix] ?? null;
    const meta = route ? routeAudience.get(route) : null;
    const audience = key.startsWith('perm.') ? 'member' : meta?.audience ?? 'member';
    const permission = key.startsWith('perm.') ? (keySet.has(key.slice(5)) ? key.slice(5) : null) : meta?.permission ?? null;
    if (key.startsWith('perm.') && !keySet.has(key.slice(5))) throw new Error(`Locale permission without a key: ${key}`);
    const whereEn = route ? ` It belongs to route ${route}.` : '';
    const whereAr = route ? ` تتبع المسار ${route}.` : '';
    const body = localNote(
      `The English label for ${key} is "${labelEn.value}". The Arabic label is "${labelAr.value}".${whereEn} Zelvero AI cannot press this control.`,
      `النص الإنجليزي للمفتاح ${key} هو "${labelEn.value}". النص العربي هو «${labelAr.value}».${whereAr} Zelvero AI لا يستطيع الضغط على هذا العنصر.`,
    );
    add(card(release, {
      id: `label:${key}`,
      kind: 'label',
      title: { en: labelEn.value, ar: labelAr.value },
      body,
      keywords: keywordsOf(key, labelEn.value, labelAr.value, route, permission),
      route,
      permission,
      audience,
      callable: null,
      source: sourced(key, [
        { path: 'src/i18n/en.ts', startLine: labelEn.line, endLine: labelEn.line },
        { path: 'src/i18n/ar.ts', startLine: labelAr.line, endLine: labelAr.line },
      ]),
      evidence: { en: [labelEn.value, key], ar: [labelAr.value, key], source: [`'${key}':`] },
    }));
  }

  for (const key of keys) {
    const line = lineNo('src/constants/permissions.ts', (value) => value.includes(`'${key}'`));
    const labelEn = en.get(`perm.${key}`)?.value ?? key;
    const labelAr = ar.get(`perm.${key}`)?.value ?? key;
    const body = localNote(
      `${key} is a local permission key. Its English name is "${labelEn}". Its Arabic name is "${labelAr}". Owners implicitly have it. Zelvero AI cannot grant it.`,
      `${key} مفتاح صلاحية في المصدر المحلي. اسمه بالإنجليزية "${labelEn}". واسمه بالعربية «${labelAr}». المالك يملكه ضمنياً. Zelvero AI لا يستطيع منحه.`,
    );
    add(card(release, {
      id: `permission:${key}`,
      kind: 'permission',
      title: { en: labelEn, ar: labelAr },
      body,
      keywords: keywordsOf(key, labelEn, labelAr, 'permission'),
      route: null,
      permission: key,
      audience: 'permission',
      callable: null,
      source: sourced(key, [{ path: 'src/constants/permissions.ts', startLine: line, endLine: line }]),
      evidence: { en: [key, labelEn], ar: [key, labelAr], source: [`'${key}'`] },
    }));
  }

  const posByName = new Map();
  for (const rel of POS_FILES) for (const fn of scanPos(rel)) posByName.set(fn.name, { ...fn, path: rel });

  for (const name of [...clientNames].sort()) {
    const pos = posByName.get(name);
    const indexLine = lineNo(indexRel, (value) => new RegExp(`\\b${name}\\b`).test(value));
    const clientLine = lineNo(clientRel, (value) => value.includes(`'${name}'`));
    const anchors = pos
      ? [
          { path: pos.path, startLine: pos.startLine, endLine: pos.endLine },
          { path: indexRel, startLine: indexLine, endLine: indexLine },
          { path: clientRel, startLine: clientLine, endLine: clientLine },
        ]
      : [
          { path: indexRel, startLine: indexLine, endLine: indexLine },
          { path: clientRel, startLine: clientLine, endLine: clientLine },
        ];
    const audience = pos?.ownerOnly && !pos.permission ? 'owner' : pos?.permission ? 'permission' : 'member';
    const permEn = pos?.ownerOnly && !pos.permission
      ? 'The local handler allows only the store owner.'
      : pos?.permission
        ? `The local handler asks for ${pos.permission}${pos.also.length ? ` and also checks ${pos.also.join(', ')}` : ''}.`
        : 'The role check stays inside that function. This card does not guess it.';
    const permAr = pos?.ownerOnly && !pos.permission
      ? 'المعالج المحلي يسمح لمالك المتجر فقط.'
      : pos?.permission
        ? `المعالج المحلي يطلب ${pos.permission}${pos.also.length ? ` ويتحقق أيضاً من ${pos.also.join(' و ')}` : ''}.`
        : 'فحص الدور يبقى داخل الدالة. هذه البطاقة لا تخمّنه.';
    const body = localNote(
      `${name} is a Cloud Function named in the local source and in the POS client wrapper. ${permEn} Zelvero AI cannot call this function.`,
      `${name} دالة سحابية مذكورة في المصدر المحلي وفي غلاف عميل نقطة البيع. ${permAr} Zelvero AI لا يستطيع استدعاء هذه الدالة.`,
    );
    add(card(release, {
      id: `callable:${name}`,
      kind: 'callable',
      title: { en: name, ar: name },
      body,
      keywords: keywordsOf(name, pos?.permission, ...(pos?.also ?? []), 'function', 'callable'),
      route: null,
      permission: pos?.permission ?? null,
      audience,
      callable: name,
      source: sourced(name, anchors),
      evidence: {
        en: [name, 'cannot call this function'],
        ar: [name, 'لا يستطيع استدعاء هذه الدالة'],
        source: [name, ...(pos?.permission ? [pos.permission, ...pos.also] : []), ...(pos?.ownerOnly ? ['error.fn.notOwner'] : [])],
      },
    }));
  }

  for (const rel of TEST_FILES) {
    linesOf(rel).forEach((line, index) => {
      const match = line.match(/^\s*it(?:\.(?:only|skip|todo))?\(\s*'([^']+)'/) || line.match(/^\s*it(?:\.(?:only|skip|todo))?\(\s*"([^"]+)"/);
      if (!match) return;
      const title = match[1];
      const id = `test:${rel}#${index + 1}`;
      const body = localNote(
        `The local test file ${rel} contains a case titled "${title}". This records the test name only, not a production result. Zelvero AI cannot run the test.`,
        `ملف الاختبار المحلي ${rel} يحتوي حالة بعنوان "${title}". هذا اسم الاختبار فقط، وليس نتيجة إنتاج. Zelvero AI لا يستطيع تشغيل الاختبار.`,
      );
      add(card(release, {
        id,
        kind: 'test',
        title: { en: title, ar: title },
        body,
        keywords: keywordsOf(title, rel, 'test'),
        route: null,
        permission: null,
        audience: 'member',
        callable: null,
        source: sourced(title, [{ path: rel, startLine: index + 1, endLine: index + 1 }]),
        evidence: { en: [title, rel], ar: [title, rel], source: [title] },
      }));
    });
  }

  const repoRel = 'docs/architecture/REPOSITORY.md';
  const repoLine = lineNo(repoRel, (value) => value.includes('The POS stays at the repository root.'));
  const repoSentence = 'The POS stays at the repository root.';
  const repoBody = localNote(
    `The local repository note says "${repoSentence}" Zelvero AI cannot move the project.`,
    `ملاحظة المستودع المحلية تقول "${repoSentence}" Zelvero AI لا يستطيع نقل المشروع.`,
  );
  add(card(release, {
    id: 'document:repository-root',
    kind: 'document',
    title: { en: 'Repository layout', ar: 'تخطيط المستودع' },
    body: repoBody,
    keywords: keywordsOf('repository', 'root', 'layout', 'POS', 'مستودع'),
    route: null,
    permission: null,
    audience: 'member',
    callable: null,
    source: sourced('repository-root', [{ path: repoRel, startLine: repoLine, endLine: repoLine }]),
    evidence: { en: [repoSentence], ar: [repoSentence], source: [repoSentence] },
  }));

  const saleRel = 'docs/ai/pos-sale-workflow.md';
  const saleStart = lineNo(saleRel, (value) => value.includes('Open Point of sale'));
  const saleEnd = lineNo(saleRel, (value) => value.includes('Zelvero AI remains read-only'));
  const saleBody = localNote(
    'Local POS sale workflow (from PosPage, cart, and payment code): Open Point of sale with canSell; add products to the cart (search, category, or barcode) and set quantities; review the cart and optionally edit a line price when canEditPrice (shown as a line discount — no whole-cart coupon in this source); optionally choose a customer (required for credit); open checkout and Choose cash or credit; for cash enter USD/LBP received and confirm change, for credit enter amounts paid now and confirm; completing the sale uses checkout/posCheckout so stock, drawer, and balances change only when that succeeds. Zelvero AI cannot run these steps.',
    'سير عمل البيع في نقطة البيع المحلية (من PosPage والسلة والدفع): افتح نقطة البيع مع صلاحية canSell؛ أضف منتجات إلى السلة (بحث أو فئة أو باركود) وعدّل الكميات؛ راجع السلة ويمكن تعديل سعر السطر عند canEditPrice (يظهر كخصم سطر — لا توجد قسيمة على كامل السلة في هذا المصدر)؛ اختر زبوناً اختيارياً (إلزامي للبيع بالدين)؛ افتح الدفع واختر نقداً أو دين؛ للنقد أدخل المبالغ المستلمة بالدولار/الليرة وأكّد الباقي، وللدين أدخل المدفوع الآن وأكّد؛ إتمام البيع عبر checkout/posCheckout فلا يتغير المخزون أو الصندوق أو الأرصدة إلا عند النجاح. Zelvero AI لا يستطيع تنفيذ هذه الخطوات.',
  );
  add(card(release, {
    id: 'document:pos-sale-workflow',
    kind: 'document',
    title: { en: 'How to process a POS sale', ar: 'كيف تتم عملية البيع في نقطة البيع' },
    body: saleBody,
    keywords: keywordsOf(
      'sale',
      'sales',
      'checkout',
      'cart',
      'payment',
      'workflow',
      'steps',
      'process',
      'processing',
      'POS',
      'cash',
      'credit',
      'discount',
      'quantity',
      'بيع',
      'سلة',
      'دفع',
      'خطوات',
      'نقطة البيع',
    ),
    route: '/pos',
    permission: 'canSell',
    audience: 'permission',
    callable: null,
    source: sourced('pos-sale-workflow', [{ path: saleRel, startLine: saleStart, endLine: saleEnd }]),
    evidence: {
      en: ['Open Point of sale', 'to the cart', 'Choose cash or credit', 'checkout/posCheckout'],
      ar: ['نقطة البيع', 'السلة', 'نقداً أو دين', 'checkout/posCheckout'],
      source: [
        'Open Point of sale (`/pos`).',
        'add them to the cart',
        'Choose cash or credit.',
        'checkout` / `posCheckout',
      ],
    },
  }));

  const returnRel = 'docs/ai/pos-return-workflow.md';
  const returnStart = lineNo(returnRel, (value) => value.includes('A return is planned'));
  const returnEnd = lineNo(returnRel, (value) => value.includes('Zelvero AI cannot call it'));
  const returnBody = localNote(
    'Local POS customer return workflow (from planReturn and posReturn): returns are line-based against remaining unreturned quantity; stock is restored with a return movement (deleted products skipped); a cash sale refunds the returned value from the drawer in the original payment USD/LBP mix and needs enough drawer cash; a credit sale first reduces unpaid customer debt for that sale, then refunds any remainder in cash (not both for the same portion); posReturn requires sell or cash-drawer rights plus viewing sales. Zelvero AI cannot call it.',
    'سير عمل مرتجع الزبون في نقطة البيع المحلية (من planReturn و posReturn): المرتجع حسب أسطر البيع للكمية المتبقية؛ يُعاد المخزون بحركة return (ويُتخطى المنتج المحذوف)؛ بيع نقدي يرد القيمة من الصندوق بنفس مزيج الدولار/الليرة الأصلي ويحتاج رصيد صندوق كافٍ؛ بيع بالدين يخفض أولاً الدين غير المسدد من هذه الفاتورة ثم يرد الباقي نقداً (دون صرف نفس الجزء مرتين)؛ posReturn يحتاج بيع أو صندوق مع عرض المبيعات. Zelvero AI لا يستطيع استدعاءه.',
  );
  add(card(release, {
    id: 'document:pos-return-workflow',
    kind: 'document',
    title: { en: 'How a customer return works', ar: 'كيف يعمل مرتجع الزبون' },
    body: returnBody,
    keywords: keywordsOf(
      'return',
      'returns',
      'refund',
      'stock',
      'drawer',
      'cash',
      'credit',
      'debt',
      'customer',
      'workflow',
      'versus',
      'مرتجع',
      'مخزون',
      'صندوق',
      'دين',
      'نقد',
    ),
    route: '/pos',
    permission: 'canViewSales',
    audience: 'permission',
    callable: null,
    source: sourced('pos-return-workflow', [{ path: returnRel, startLine: returnStart, endLine: returnEnd }]),
    evidence: {
      en: ['planReturn and posReturn', 'cash sale refunds', 'credit sale first reduces', 'Zelvero AI cannot call it'],
      ar: ['planReturn و posReturn', 'بيع نقدي', 'بيع بالدين', 'Zelvero AI لا يستطيع استدعاءه'],
      source: [
        'A return is planned against an existing sale',
        'Cash sale: the returned value is refunded from the cash drawer',
        'Credit sale: unpaid debt from this sale is reduced first',
        'Zelvero AI cannot call it.',
      ],
    },
  }));

  const permRel = 'src/constants/permissions.ts';
  const ownerLine = lineNo(permRel, (value) => value.includes('Owners implicitly have every permission.'));
  const uiLine = lineNo(permRel, (value) => value.includes('UI checks are for UX only.'));
  const ruleBody = localNote(
    'Local permissions.ts says owners implicitly have every permission, permissions are enforced by Firestore rules through custom claims written only by Cloud Functions, and UI checks are for experience only. Zelvero AI cannot change permissions.',
    'يقول الملف المحلي permissions.ts إن المالك يملك كل الصلاحيات ضمنياً، وإن الصلاحيات تُفرض بقواعد Firestore عبر claims يكتبها Cloud Functions فقط، وإن فحوصات الواجهة للتجربة فقط. Zelvero AI لا يستطيع تغيير الصلاحيات.',
  );
  add(card(release, {
    id: 'rule:permissions-server-side',
    kind: 'rule',
    title: { en: 'Permissions are enforced on the server', ar: 'الصلاحيات تُفرض على الخادم' },
    body: ruleBody,
    keywords: keywordsOf('permission', 'owner', 'claims', 'firestore', 'functions', 'صلاحية', 'مالك'),
    route: null,
    permission: null,
    audience: 'member',
    callable: null,
    source: sourced('PERMISSION_KEYS', [{ path: permRel, startLine: ownerLine, endLine: uiLine }]),
    evidence: {
      en: ['owners implicitly have every permission', 'UI checks are for experience only'],
      ar: ['المالك يملك كل الصلاحيات ضمنياً', 'فحوصات الواجهة للتجربة فقط'],
      source: ['Owners implicitly have every permission.', 'UI checks are for UX only.'],
    },
  }));

  items.sort((a, b) => a.id.localeCompare(b.id));
  return {
    generator: 'scripts/ai-knowledge.mjs',
    generatedFrom: 'local-working-tree',
    productionVerified: false,
    items,
  };
}

export function knowledgeProblems(draft) {
  fileCache.clear();
  const problems = [];
  const exports = exportedNames(read('functions/src/index.ts'));
  const clientNames = clientCallableNames(read('src/services/functionsClient.ts'));
  const keys = new Set(permissionKeys(read('src/constants/permissions.ts')));
  const forbidden = [/is deployed/i, /production ready/i, /منشور في الإنتاج/, /موجود في الإنتاج/];
  const seen = new Set();
  for (const item of draft.items) {
    if (seen.has(item.id)) problems.push(`duplicate ${item.id}`);
    seen.add(item.id);
    if (item.executes !== false) problems.push(`${item.id} executes`);
    if (item.valid !== true) problems.push(`${item.id} invalid`);
    if (item.release?.productionVerified !== false || item.release?.channel !== 'local-working-tree') problems.push(`${item.id} claims production`);
    if (item.permission && !keys.has(item.permission)) problems.push(`${item.id} bad permission`);
    if (item.callable && !exports.has(item.callable)) problems.push(`${item.id} missing callable`);
    for (const pattern of forbidden) {
      if (pattern.test(item.body?.en ?? '') || pattern.test(item.body?.ar ?? '')) problems.push(`${item.id} forbidden claim`);
    }
    let text;
    try {
      text = anchorText(item.source.anchors);
    } catch {
      problems.push(`${item.id} unreadable source`);
      continue;
    }
    if (sha256(text) !== item.source.sha256) problems.push(`${item.id} stale hash`);
    for (const phrase of item.evidence?.en ?? []) if (!item.body.en.includes(phrase)) problems.push(`${item.id} missing en evidence`);
    for (const phrase of item.evidence?.ar ?? []) if (!item.body.ar.includes(phrase)) problems.push(`${item.id} missing ar evidence`);
    for (const phrase of item.evidence?.source ?? []) if (!text.includes(phrase)) problems.push(`${item.id} source missing ${phrase}`);
  }
  for (const name of clientNames) {
    if (!draft.items.some((item) => item.kind === 'callable' && item.callable === name)) problems.push(`unindexed callable ${name}`);
  }
  return problems;
}

function writeJson(rel, value) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

function reviewProblems(draft, review) {
  const problems = [];
  if (review?.productionVerified !== false || review?.channel !== 'local-working-tree') problems.push('review claims production');
  const approved = new Map((review?.items ?? []).map((item) => [item.id, item.sourceHash]));
  for (const item of draft.items) {
    if (approved.get(item.id) !== item.source.sha256) problems.push(`unreviewed ${item.id}`);
  }
  for (const id of approved.keys()) {
    if (!draft.items.some((item) => item.id === id)) problems.push(`stale review ${id}`);
  }
  return problems;
}

function isMain() {
  const arg = process.argv[1];
  if (!arg) return false;
  return path.resolve(arg).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
}

if (isMain()) {
  const approve = process.argv.includes('--approve');
  const check = process.argv.includes('--check');
  const draft = buildKnowledge();
  const builtProblems = knowledgeProblems(draft);
  if (builtProblems.length) {
    console.error(builtProblems.slice(0, 20).join('\n'));
    process.exit(1);
  }
  if (approve) {
    writeJson(reviewPath, {
      channel: 'local-working-tree',
      productionVerified: false,
      reviewedBy: 'phase-1-local-review',
      note: 'Approved extracted facts from the local working tree. Not a production deployment attestation. Conversations were not used.',
      items: draft.items.map((item) => ({ id: item.id, sourceHash: item.source.sha256 })),
    });
    console.log(`reviewed ${draft.items.length} items`);
  } else if (!check) {
    writeJson(draftPath, draft);
    console.log(`draft ${draft.items.length} items`);
  }
  if (check || approve) {
    if (!fs.existsSync(path.join(root, draftPath))) {
      console.error('draft missing');
      process.exit(1);
    }
    const disk = readJson(draftPath);
    if (JSON.stringify(disk.items) !== JSON.stringify(draft.items)) {
      console.error('draft does not match the current source');
      process.exit(1);
    }
    const diskProblems = knowledgeProblems(disk);
    if (!fs.existsSync(path.join(root, reviewPath))) {
      console.error('review missing');
      process.exit(1);
    }
    const review = readJson(reviewPath);
    const pending = reviewProblems(disk, review);
    const problems = [...diskProblems, ...pending];
    if (problems.length) {
      console.error(problems.slice(0, 30).join('\n'));
      process.exit(1);
    }
    console.log(`checked ${disk.items.length} reviewed items`);
  }
}
