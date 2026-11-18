/**
 * Conversational renderings for planner results: profit, one product's stock, stock lists,
 * expiry, best sellers and period comparisons (including "why"). Same reads, same permission
 * rules as the canonical answers — only the wording and the extra context differ.
 */
import { daysUntil } from '@/domain/dates';
import { nameNormalized } from '@/domain/searchKey';
import type { AiLang } from '../engine';
import type { ReadRequest } from '../readIntent';
import type { ReadSession } from '../readSnapshot';
import type { CatalogItem, CostedSale, InsightSource } from '../serverReadSource';
import type { CompareSpec, PeriodSpec } from '../copilot/memory';
import { aggregateSales } from '../copilot/insights';
import type { BrainAnswer } from './briefing';
import { daysOf, invoicesOf, joinList, L, money, name, percentChange, periodPhrase, productsOf, unitsOf } from './format';
import { canProfit, canSales, EXPIRY_WARN_DAYS, loadTotals } from './storeFacts';

const UNREADABLE = (lang: AiLang): BrainAnswer => ({ text: L(lang, "I couldn't read the store just now. Please try again in a moment.", 'ما قدرت اقرا المحل هلّق. جرّب كمان شوي.'), suggestions: [] });

function periodOf(request: ReadRequest): PeriodSpec {
  return { from: request.range.from, to: request.range.to, label: request.range.label };
}

/** Names of products sold in the period whose sale lines carry no recorded cost. */
async function soldWithoutCost(src: InsightSource, period: PeriodSpec): Promise<string[]> {
  const { sales } = await src.costedSales(period.from, period.to);
  const names = new Set<string>();
  for (const s of sales) for (const l of s.lines) if (l.costUsdCents === null && l.name) names.add(l.name);
  return [...names];
}

/* ------------------------------------------------------------------ profit */

export async function profitAnswer(request: ReadRequest, session: ReadSession, src: InsightSource, lang: AiLang): Promise<BrainAnswer> {
  if (!canProfit(session)) {
    return { text: L(lang, 'Profit needs permission to view reports and costs, so I can\'t show it.', 'الربح بدّه صلاحية تشوف التقارير والكلفة، فما فيني فرجيك ياه.'), suggestions: [] };
  }
  const period = periodOf(request);
  const t = await loadTotals(session, src, period);
  if (!t) return UNREADABLE(lang);
  const when = periodPhrase(period, lang);
  if (t.invoices === 0 && t.returnsCount === 0 && t.expenses === 0) {
    return { text: L(lang, `No sales recorded ${when}, so there's no profit yet.`, `ما في مبيعات مسجّلة ${when}، فما في ربح لهلّق.`), suggestions: [] };
  }
  if (t.netProfit === null || t.grossProfit === null) {
    let missing: string[];
    try {
      missing = await soldWithoutCost(src, period);
    } catch {
      missing = [];
    }
    const list = joinList(missing.slice(0, 4).map(name), lang);
    const text = missing.length > 0
      ? L(
          lang,
          `I can't give an exact profit ${when}: ${list} ${missing.length === 1 ? 'was' : 'were'} sold without a recorded cost, and I won't guess it as zero. Add the cost on the Products page — note that sales already made keep the cost they were sold with.`,
          `ما فيني اعطيك ربح دقيق ${when}: ${list} ${missing.length === 1 ? 'انباع' : 'انباعوا'} بلا كلفة مسجّلة، وما بحسبها صفر من عندي. سجّل الكلفة بصفحة المنتجات — بس انتبه إنو المبيعات يلي صارت بتضل بالكلفة يلي انباعت فيها.`,
        )
      : L(lang, `I can't give an exact profit ${when} because some recorded cost is missing, and I won't guess it as zero.`, `ما فيني اعطيك ربح دقيق ${when} لأنو في كلفة ناقصة بالسجلات، وما بحسبها صفر من عندي.`);
    return { text: `${text}\n${L(lang, `Sales ${when}: ${money(t.netSales, lang)} from ${invoicesOf(t.invoices, lang)}.`, `المبيعات ${when}: ${money(t.netSales, lang)} من ${invoicesOf(t.invoices, lang)}.`)}`, suggestions: [] };
  }
  const margin = t.netSales > 0 ? Math.round((100 * t.grossProfit) / t.netSales) : null;
  const lines: string[] = [];
  if (request.profitAnswer === 'detail') {
    lines.push(L(lang, `**Profit ${when}, step by step:**`, `**الربح ${when}، خطوة بخطوة:**`));
    lines.push(L(lang, `• Sales after discounts and returns: ${money(t.netSales, lang)}`, `• المبيعات بعد الخصومات والمرتجعات: ${money(t.netSales, lang)}`));
    lines.push(L(lang, `• Cost of the goods sold: ${money(t.netSales - t.grossProfit, lang)}`, `• كلفة البضاعة يلي انباعت: ${money(t.netSales - t.grossProfit, lang)}`));
    lines.push(L(lang, `• Gross profit: ${money(t.grossProfit, lang)}${margin !== null ? ` (${margin}%)` : ''}`, `• الربح الإجمالي: ${money(t.grossProfit, lang)}${margin !== null ? ` (${margin}%)` : ''}`));
    lines.push(L(lang, `• Expenses: ${money(t.expenses, lang)}`, `• المصاريف: ${money(t.expenses, lang)}`));
    lines.push(L(lang, `• **Net profit: ${money(t.netProfit, lang)}**`, `• **الربح الصافي: ${money(t.netProfit, lang)}**`));
    return { text: lines.join('\n'), suggestions: lang === 'ar' ? ['شو أكتر منتج بيربحني؟'] : ['Which products make the most profit?'] };
  }
  if (request.profitAnswer === 'gross') {
    lines.push(L(lang, `Gross profit ${when}: **${money(t.grossProfit, lang)}**${margin !== null ? ` (${margin}% of ${money(t.netSales, lang)} sales)` : ''}.`, `الربح الإجمالي ${when}: **${money(t.grossProfit, lang)}**${margin !== null ? ` (${margin}% من مبيعات ${money(t.netSales, lang)})` : ''}.`));
  } else {
    lines.push(L(lang, `Net profit ${when}${period.label === 'today' ? ' so far' : ''}: **${money(t.netProfit, lang)}**.`, `الربح الصافي ${when}${period.label === 'today' ? ' لهلّق' : ''}: **${money(t.netProfit, lang)}**.`));
    const detail: string[] = [L(lang, `sales ${money(t.netSales, lang)}`, `مبيعات ${money(t.netSales, lang)}`), L(lang, `gross profit ${money(t.grossProfit, lang)}${margin !== null ? ` (${margin}%)` : ''}`, `ربح إجمالي ${money(t.grossProfit, lang)}${margin !== null ? ` (${margin}%)` : ''}`)];
    if (t.expenses > 0) detail.push(L(lang, `minus ${money(t.expenses, lang)} expenses`, `ناقص مصاريف ${money(t.expenses, lang)}`));
    lines.push(L(lang, `That's ${detail.join(', ')}.`, `يعني ${detail.join('، ')}.`));
  }
  const suggestions = lang === 'ar' ? ['شو أكتر منتج بيربحني؟', 'قارن الربح بالجمعة الماضية'] : ['Which products make the most profit?', 'Compare profit with last week'];
  return { text: lines.join(' '), suggestions };
}

/* ------------------------------------------------------------------ one product's stock */

function matches(items: CatalogItem[], query: string): CatalogItem[] {
  const q = nameNormalized(query);
  if (!q) return [];
  const exact = items.filter((p) => nameNormalized(p.name) === q || (p.barcode && p.barcode.trim() === query.trim()));
  if (exact.length > 0) return exact;
  const words = q.split(/\s+/).filter((w) => w.length >= 2);
  return items.filter((p) => {
    const n = nameNormalized(p.name);
    return words.length > 0 && words.every((w) => n.includes(w));
  });
}

export async function stockItemAnswer(query: string, wanted: number | null, session: ReadSession, src: InsightSource, lang: AiLang): Promise<BrainAnswer> {
  if (!session.can('canViewProducts') && !session.can('canSell')) {
    return { text: L(lang, 'Stock levels need permission to view products or to sell.', 'الكميات بدها صلاحية تشوف المنتجات أو تبيع.'), suggestions: [] };
  }
  let catalog: { items: CatalogItem[]; complete: boolean };
  try {
    catalog = await src.catalog();
  } catch {
    return UNREADABLE(lang);
  }
  const found = matches(catalog.items, query);
  if (found.length === 0) {
    const arabicName = /[؀-ۿ]/.test(query);
    return {
      text: L(
        lang,
        `I couldn't find a product called ${name(query)}.${catalog.complete ? '' : ' (Your catalog is large, so not every product was checked.)'} Try the name as it's written on the Products page.`,
        `ما لقيت منتج اسمه ${name(query)}.${catalog.complete ? '' : ' (لايحة المنتجات كبيرة، فما انفحصوا كلّهن.)'} ${arabicName ? 'إذا الاسم مسجّل بالإنكليزي، اكتبه متل ما هو مسجّل.' : 'جرّب الاسم متل ما هو مكتوب بصفحة المنتجات.'}`,
      ),
      suggestions: [],
    };
  }
  if (found.length === 1) {
    const p = found[0]!;
    let text =
      p.stock <= 0
        ? L(lang, `${name(p.name)} is **out of stock**.`, `${name(p.name)} **خالص**، ما باقي منه شي.`)
        : L(lang, `You have **${unitsOf(p.stock, lang)}** of ${name(p.name)} left.`, `باقي **${unitsOf(p.stock, lang)}** من ${name(p.name)}.`);
    if (wanted !== null && wanted > 0) {
      text += p.stock >= wanted
        ? L(lang, ` That's enough for ${wanted}.`, ` يعني بيكفّوا لـ ${wanted}.`)
        : L(lang, ` That's not enough for ${wanted} — you're short ${wanted - Math.max(0, p.stock)}.`, ` ما بيكفّوا لـ ${wanted} — ناقصك ${wanted - Math.max(0, p.stock)}.`);
    }
    if (p.expiryDate) {
      const d = daysUntil(p.expiryDate);
      if (d !== null && d < 0) text += L(lang, ` Note: it expired on ${p.expiryDate}.`, ` انتبه: صلاحيته خلصت بـ ${p.expiryDate}.`);
      else if (d !== null && d <= EXPIRY_WARN_DAYS) text += L(lang, ` It expires in ${daysOf(d, lang)}.`, ` صلاحيته بتخلص بعد ${daysOf(d, lang)}.`);
    }
    return { text, suggestions: lang === 'ar' ? ['شو لازم اطلب؟'] : ['What should I reorder?'] };
  }
  const lines = [L(lang, `I found ${productsOf(found.length, lang)} matching ${name(query)}:`, `لقيت ${productsOf(found.length, lang)} بهالاسم ${name(query)}:`)];
  for (const p of found.slice(0, 8)) lines.push(`• ${name(p.name)} — ${p.stock <= 0 ? L(lang, 'out of stock', 'خالص') : L(lang, `${p.stock} left`, `باقي ${p.stock}`)}`);
  if (found.length > 8) lines.push(L(lang, `…and ${found.length - 8} more.`, `…و${found.length - 8} غيرهن.`));
  return { text: lines.join('\n'), suggestions: [] };
}

/* ------------------------------------------------------------------ stock lists */

export async function stockListAnswer(mode: 'low' | 'out', request: ReadRequest, session: ReadSession, src: InsightSource, lang: AiLang): Promise<BrainAnswer> {
  if (!session.can('canViewProducts')) return { text: L(lang, 'Stock lists need permission to view products.', 'لايحة البضاعة بدها صلاحية تشوف المنتجات.'), suggestions: [] };
  try {
    const threshold = request.stockBelow ?? (await src.threshold(session.tenantId));
    const page = await src.products(session.tenantId, mode, threshold);
    if (page.items.length === 0) {
      return {
        text: mode === 'out'
          ? L(lang, 'Good news: nothing is out of stock right now.', 'خبر منيح: ما في شي خالص هلّق.')
          : L(lang, `Nothing is running low (${threshold} or fewer left).`, `ما في شي قليل (${threshold} أو أقل).`),
        suggestions: [],
      };
    }
    const items = [...page.items].sort((a, b) => a.stock - b.stock);
    const head = mode === 'out'
      ? L(lang, `**${productsOf(items.length, lang)}${page.hasMore ? '+' : ''}** ${items.length === 1 ? 'is' : 'are'} out of stock:`, `**${productsOf(items.length, lang)}${page.hasMore ? '+' : ''}** ${items.length === 1 ? 'خالص' : 'خالصين'}:`)
      : L(lang, `**${productsOf(items.length, lang)}${page.hasMore ? '+' : ''}** ${items.length === 1 ? 'is' : 'are'} running low (${threshold} or fewer):`, `**${productsOf(items.length, lang)}${page.hasMore ? '+' : ''}** ${items.length === 1 ? 'قليل' : 'قلال'} (${threshold} أو أقل):`);
    const lines = [head, ...items.slice(0, 10).map((p) => (mode === 'out' ? `• ${name(p.name)}` : `• ${name(p.name)} — ${L(lang, `${p.stock} left`, `باقي ${p.stock}`)}`))];
    if (items.length > 10 || page.hasMore) lines.push(L(lang, 'The full list is on the Products page (filter: low / out of stock).', 'اللايحة كاملة بصفحة المنتجات (فلتر: قليل / خالص).'));
    return { text: lines.join('\n'), suggestions: lang === 'ar' ? ['شو لازم اطلب؟'] : ['What should I reorder?'] };
  } catch {
    return UNREADABLE(lang);
  }
}

/* ------------------------------------------------------------------ expiry */

export async function expiryAnswer(session: ReadSession, src: InsightSource, lang: AiLang, now: Date): Promise<BrainAnswer> {
  if (!session.can('canViewProducts')) return { text: L(lang, 'Expiry dates need permission to view products.', 'تواريخ الصلاحية بدها صلاحية تشوف المنتجات.'), suggestions: [] };
  let catalog: { items: CatalogItem[]; complete: boolean };
  try {
    catalog = await src.catalog();
  } catch {
    return UNREADABLE(lang);
  }
  const expired: CatalogItem[] = [];
  const soon: Array<{ p: CatalogItem; d: number }> = [];
  for (const p of catalog.items) {
    if (!p.expiryDate || p.stock <= 0) continue;
    const d = daysUntil(p.expiryDate, now);
    if (d === null) continue;
    if (d < 0) expired.push(p);
    else if (d <= EXPIRY_WARN_DAYS) soon.push({ p, d });
  }
  soon.sort((a, b) => a.d - b.d);
  if (expired.length === 0 && soon.length === 0) {
    return { text: L(lang, `Nothing in stock has expired or expires within ${EXPIRY_WARN_DAYS} days.`, `ما في شي بالمحل صلاحيته خالصة أو بتخلص خلال ${EXPIRY_WARN_DAYS} أيام.`), suggestions: [] };
  }
  const lines: string[] = [];
  if (expired.length > 0) {
    lines.push(L(lang, '**Already expired — take off the shelf:**', '**صلاحيتهن خالصة — شيلهن عن الرف:**'));
    for (const p of expired.slice(0, 8)) lines.push(`• ${name(p.name)} — ${L(lang, `expired ${p.expiryDate}, ${p.stock} in stock`, `خلصت ${p.expiryDate}، باقي ${p.stock}`)}`);
  }
  if (soon.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(L(lang, `**Expiring within ${EXPIRY_WARN_DAYS} days:**`, `**بتخلص خلال ${EXPIRY_WARN_DAYS} أيام:**`));
    for (const { p, d } of soon.slice(0, 8)) lines.push(`• ${name(p.name)} — ${d === 0 ? L(lang, 'today', 'اليوم') : L(lang, `in ${daysOf(d, lang)}`, `بعد ${daysOf(d, lang)}`)} (${L(lang, `${p.stock} in stock`, `باقي ${p.stock}`)})`);
  }
  if (!catalog.complete) lines.push(L(lang, '(Large catalog: not every product was checked.)', '(لايحة كبيرة: ما انفحصوا كل المنتجات.)'));
  return { text: lines.join('\n'), suggestions: lang === 'ar' ? ['كيف بزيد المبيعات؟'] : ['How can I increase sales?'] };
}

/* ------------------------------------------------------------------ best sellers */

export async function rankAnswer(request: ReadRequest, session: ReadSession, src: InsightSource, lang: AiLang): Promise<BrainAnswer> {
  if (!session.can('canViewSales')) return { text: L(lang, 'Best sellers need permission to view sales.', 'الأكثر مبيعاً بدها صلاحية تشوف المبيعات.'), suggestions: [] };
  const range = request.rankRange;
  if (range.limited) return { text: L(lang, 'That period is too long to rank completely. Try a shorter one, like this month.', 'هالفترة طويلة كتير لترتيب كامل. جرّب فترة أقصر، متل هالشهر.'), suggestions: [] };
  let loaded: { sales: CostedSale[]; complete: boolean };
  try {
    loaded = await src.costedSales(range.from, range.to);
  } catch {
    return UNREADABLE(lang);
  }
  const rows = [...aggregateSales(loaded.sales, new Map()).values()]
    .map((r) => ({ ...r, total: r.units + r.lbpUnits }))
    .filter((r) => r.total > 0)
    .sort((a, b) => (request.rankBy === 'revenue' ? b.usdRevenue - a.usdRevenue : b.total - a.total));
  const when = periodPhrase(range, lang);
  if (rows.length === 0) return { text: L(lang, `Nothing was sold ${when}.`, `ما انباع شي ${when}.`), suggestions: [] };
  const limit = request.rankLimit === 'all' ? 20 : Math.max(1, Math.min(20, request.rankLimit));
  const lines = [L(lang, `**Best sellers ${when}** (by ${request.rankBy === 'revenue' ? 'sales value' : 'units'}):`, `**الأكثر مبيعاً ${when}** (حسب ${request.rankBy === 'revenue' ? 'قيمة المبيع' : 'العدد'}):`)];
  rows.slice(0, limit).forEach((r, i) => {
    const value = r.usdRevenue > 0 ? ` · ${money(r.usdRevenue, lang)}` : '';
    lines.push(`${i + 1}. ${name(r.name)} — ${unitsOf(r.total, lang)}${value}`);
  });
  if (!loaded.complete) lines.push(L(lang, '(Many sales in this period — the newest may not be counted.)', '(مبيعات كتيرة بهالفترة — ممكن آخرها ما انحسب.)'));
  return { text: lines.join('\n'), suggestions: lang === 'ar' ? ['شو أكتر منتج بيربحني؟', 'شو ما عم ينباع؟'] : ['Which products make the most profit?', "What isn't selling?"] };
}

/* ------------------------------------------------------------------ comparisons */

function pctText(cur: number, prev: number, lang: AiLang): string {
  const pct = percentChange(cur, prev);
  if (pct === null) return '';
  if (pct === 0) return L(lang, 'no change', 'ما تغيّر');
  return pct > 0 ? L(lang, `up ${pct}%`, `أعلى بـ ${pct}%`) : L(lang, `down ${Math.abs(pct)}%`, `أقل بـ ${Math.abs(pct)}%`);
}

function label(p: PeriodSpec, lang: AiLang): string {
  const known: Record<string, [string, string]> = {
    today: ['today', 'اليوم'],
    yesterday: ['yesterday', 'مبارح'],
    previousDay: ['the day before', 'اليوم يلي قبل'],
    week: ['in the last 7 days', 'آخر 7 أيام'],
    lastWeek: ['last week', 'الجمعة الماضية'],
    previousPeriod: ['the period before', 'الفترة يلي قبلها'],
    month: ['this month so far', 'هالشهر لهلّق'],
    previousMonthToDate: ['the same days last month', 'نفس الأيام من الشهر الماضي'],
    lastMonth: ['last month', 'الشهر الماضي'],
    year: ['this year', 'هالسنة'],
  };
  const pair = known[p.label];
  return pair ? (lang === 'ar' ? pair[1] : pair[0]) : `${p.from} → ${p.to}`;
}

export async function compareAnswer(spec: CompareSpec, session: ReadSession, src: InsightSource, lang: AiLang): Promise<BrainAnswer> {
  if (!canSales(session)) return { text: L(lang, 'Comparisons need the "View reports" permission.', 'المقارنة بدها صلاحية "عرض التقارير".'), suggestions: [] };
  if (spec.metric === 'profit' && !canProfit(session)) return { text: L(lang, 'Profit comparisons need permission to view costs.', 'مقارنة الربح بدها صلاحية تشوف الكلفة.'), suggestions: [] };
  const [cur, prev] = await Promise.all([loadTotals(session, src, spec.current), loadTotals(session, src, spec.previous)]);
  if (!cur || !prev) return UNREADABLE(lang);
  const a = label(spec.current, lang);
  const b = label(spec.previous, lang);
  const lines: string[] = [];
  if (cur.invoices === 0 && prev.invoices === 0) return { text: L(lang, `No sales were recorded ${a} or ${b}.`, `ما في مبيعات مسجّلة لا ${a} ولا ${b}.`), suggestions: [] };

  if (spec.metric === 'profit') {
    if (cur.netProfit === null || prev.netProfit === null) {
      let missing: string[];
      try {
        const [m1, m2] = await Promise.all([soldWithoutCost(src, spec.current), soldWithoutCost(src, spec.previous)]);
        missing = [...new Set([...m1, ...m2])];
      } catch {
        missing = [];
      }
      const list = missing.length > 0 ? joinList(missing.slice(0, 3).map(name), lang) : '';
      lines.push(
        list
          ? L(lang, `I can't compare profit exactly: ${list} ${missing.length === 1 ? 'was' : 'were'} sold without a recorded cost, and I won't count it as zero.`, `ما فيني قارن الربح بدقة: ${list} ${missing.length === 1 ? 'انباع' : 'انباعوا'} بلا كلفة مسجّلة، وما بحسبها صفر.`)
          : L(lang, "I can't compare profit exactly because some sold products have no recorded cost in one of the periods.", 'ما فيني قارن الربح بدقة لأنو في منتجات انباعت بلا كلفة مسجّلة بوحدة من الفترتين.'),
      );
    } else {
      const change = pctText(cur.netProfit, prev.netProfit, lang);
      lines.push(L(lang, `**Net profit ${a}: ${money(cur.netProfit, lang)}** vs ${money(prev.netProfit, lang)} ${b}${change ? ` — ${change}` : ''}.`, `**الربح الصافي ${a}: ${money(cur.netProfit, lang)}** مقابل ${money(prev.netProfit, lang)} ${b}${change ? ` — ${change}` : ''}.`));
    }
  }
  const salesChange = pctText(cur.netSales, prev.netSales, lang);
  lines.push(
    L(
      lang,
      `${spec.metric === 'sales' ? '**' : ''}Sales ${a}: ${money(cur.netSales, lang)}${spec.metric === 'sales' ? '**' : ''} vs ${money(prev.netSales, lang)} ${b}${salesChange ? ` — ${salesChange}` : ''}.`,
      `${spec.metric === 'sales' ? '**' : ''}المبيعات ${a}: ${money(cur.netSales, lang)}${spec.metric === 'sales' ? '**' : ''} مقابل ${money(prev.netSales, lang)} ${b}${salesChange ? ` — ${salesChange}` : ''}.`,
    ),
  );
  const avgCur = cur.invoices > 0 ? Math.round(cur.netSales / cur.invoices) : 0;
  const avgPrev = prev.invoices > 0 ? Math.round(prev.netSales / prev.invoices) : 0;
  const invoicesSame = cur.invoices === prev.invoices;
  lines.push(
    invoicesSame
      ? L(lang, `Same number of sales (${cur.invoices}), so the difference is in the average sale: ${money(avgCur, lang)} vs ${money(avgPrev, lang)}.`, `نفس عدد الفواتير (${cur.invoices})، يعني الفرق بمعدّل الفاتورة: ${money(avgCur, lang)} مقابل ${money(avgPrev, lang)}.`)
      : L(lang, `Invoices: ${cur.invoices} vs ${prev.invoices}. Average sale: ${money(avgCur, lang)} vs ${money(avgPrev, lang)}.`, `الفواتير: ${cur.invoices} مقابل ${prev.invoices}. معدّل الفاتورة: ${money(avgCur, lang)} مقابل ${money(avgPrev, lang)}.`),
  );
  if (spec.metric === 'sales' && cur.netProfit !== null && prev.netProfit !== null && !spec.explain) {
    lines.push(L(lang, `Net profit: ${money(cur.netProfit, lang)} vs ${money(prev.netProfit, lang)}.`, `الربح الصافي: ${money(cur.netProfit, lang)} مقابل ${money(prev.netProfit, lang)}.`));
  }
  if (cur.expenses !== prev.expenses && (cur.expenses > 0 || prev.expenses > 0)) {
    lines.push(L(lang, `Expenses: ${money(cur.expenses, lang)} vs ${money(prev.expenses, lang)}.`, `المصاريف: ${money(cur.expenses, lang)} مقابل ${money(prev.expenses, lang)}.`));
  }

  if (spec.explain || spec.detail) {
    try {
      const [cs, ps, catalog] = await Promise.all([src.costedSales(spec.current.from, spec.current.to), src.costedSales(spec.previous.from, spec.previous.to), session.can('canViewProducts') ? src.catalog() : Promise.resolve(null)]);
      const byId = new Map((catalog?.items ?? []).map((p) => [p.id, p]));
      const ca = aggregateSales(cs.sales, byId);
      const pa = aggregateSales(ps.sales, byId);
      const ids = new Set([...ca.keys(), ...pa.keys()]);
      const deltas = [...ids].map((id) => {
        const c = ca.get(id);
        const p = pa.get(id);
        return { id, name: c?.name ?? p?.name ?? id, cur: c?.usdRevenue ?? 0, prev: p?.usdRevenue ?? 0, stock: byId.get(id)?.stock ?? null };
      });
      const drops = deltas.filter((d) => d.cur < d.prev).sort((x, y) => (x.cur - x.prev) - (y.cur - y.prev)).slice(0, 3);
      const gains = deltas.filter((d) => d.cur > d.prev).sort((x, y) => (y.cur - y.prev) - (x.cur - x.prev)).slice(0, 2);
      if (drops.length > 0 || gains.length > 0) {
        lines.push('');
        lines.push(L(lang, '**Where the change came from:**', '**من وين إجا الفرق:**'));
        for (const d of drops) {
          const out = d.stock !== null && d.stock <= 0 ? L(lang, ' — now out of stock, which may explain it', ' — هلّق خالص، وممكن هيدا السبب') : '';
          lines.push(`• ${name(d.name)}: ${money(d.prev, lang)} → ${money(d.cur, lang)}${out}`);
        }
        for (const g of gains) lines.push(`• ${name(g.name)}: ${money(g.prev, lang)} → ${money(g.cur, lang)} ↑`);
      }
      if (spec.explain) {
        lines.push('');
        lines.push(L(lang, '_This shows where the numbers moved in your records — not a certain cause (prices, stock-outs, weather, or fewer customers can all play a part)._', '_هيدا بيبيّن وين تحرّكت الأرقام بسجلاتك — مش سبب أكيد (الأسعار، بضاعة خالصة، الطقس، أو قلّة زباين كلّها بتأثر)._'));
      }
    } catch {
      /* the totals above still stand on their own */
    }
  }
  const suggestions = spec.explain
    ? lang === 'ar' ? ['كيف بزيد المبيعات؟', 'شو لازم اطلب؟'] : ['How can I increase sales?', 'What should I reorder?']
    : lang === 'ar' ? ['ليش؟', 'قارن الربح'] : ['Why?', 'Compare profit'];
  return { text: lines.join('\n'), suggestions };
}
