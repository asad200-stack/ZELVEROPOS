/**
 * Focused, conversational answers for one figure ("sales today", "average sale", "expenses this
 * month", "how much is in the drawer", "who owes money"). Figures come from storeFacts only.
 */
import type { AiLang } from '../engine';
import type { ReadSession } from '../readSnapshot';
import type { InsightSource } from '../serverReadSource';
import type { PeriodSpec } from '../copilot/memory';
import { previousPeriod, resolvePeriod } from '../copilot/tools';
import type { BrainAnswer } from './briefing';
import { customersOf, invoicesOf, L, lbp, money, name, percentChange, periodPhrase, previousWords } from './format';
import { canSales, loadCash, loadDebts, loadTotals, type Totals } from './storeFacts';

export type Metric = 'sales' | 'average' | 'expenses' | 'returns' | 'invoices' | 'discounts' | 'credit' | 'collected';

function noPermission(lang: AiLang): BrainAnswer {
  return { text: L(lang, 'Sales figures need the "View reports" permission, so I can\'t show this one.', 'هالرقم بدّه صلاحية "عرض التقارير"، فما فيني فرجيك ياه.'), suggestions: [] };
}
function unreadable(lang: AiLang): BrainAnswer {
  return { text: L(lang, "I couldn't read the store's sales just now. Please try again in a moment.", 'ما قدرت اقرا مبيعات المحل هلّق. جرّب كمان شوي.'), suggestions: [] };
}

function previousFor(period: PeriodSpec, now: Date): PeriodSpec {
  return period.label === 'today' ? resolvePeriod({ preset: 'yesterday' }, now) : previousPeriod(period);
}

function salesLine(t: Totals, prev: Totals | null, period: PeriodSpec, lang: AiLang): string {
  const when = periodPhrase(period, lang);
  if (t.invoices === 0 && t.netSales === 0) {
    return L(lang, `No sales recorded ${when}${period.label === 'today' ? ' yet' : ''}.`, `ما في مبيعات مسجّلة ${when}${period.label === 'today' ? ' لهلّق' : ''}.`);
  }
  const avg = t.invoices > 0 ? Math.round(t.netSales / t.invoices) : null;
  const parts = [
    L(
      lang,
      `Sales ${when}${period.label === 'today' ? ' so far' : ''}: **${money(t.netSales, lang)}** from ${invoicesOf(t.invoices, lang)}${avg !== null ? ` (average ${money(avg, lang)})` : ''}.`,
      `المبيعات ${when}${period.label === 'today' ? ' لهلّق' : ''}: **${money(t.netSales, lang)}** من ${invoicesOf(t.invoices, lang)}${avg !== null ? ` (معدّل ${money(avg, lang)} للفاتورة)` : ''}.`,
    ),
  ];
  if (prev && prev.netSales > 0) {
    if (period.label === 'today') {
      parts.push(L(lang, `Yesterday's full day was ${money(prev.netSales, lang)}.`, `مبارح كل النهار كان ${money(prev.netSales, lang)}.`));
    } else {
      const pct = percentChange(t.netSales, prev.netSales);
      if (pct !== null) {
        parts.push(
          pct >= 0
            ? L(lang, `That's ${pct}% more than ${previousWords(period.label, lang)} (${money(prev.netSales, lang)}).`, `يعني أكتر بـ ${pct}% من ${previousWords(period.label, lang)} (${money(prev.netSales, lang)}).`)
            : L(lang, `That's ${Math.abs(pct)}% less than ${previousWords(period.label, lang)} (${money(prev.netSales, lang)}).`, `يعني أقل بـ ${Math.abs(pct)}% من ${previousWords(period.label, lang)} (${money(prev.netSales, lang)}).`),
        );
      }
    }
  }
  if (t.netProfit !== null) parts.push(L(lang, `Net profit: ${money(t.netProfit, lang)}.`, `الربح الصافي: ${money(t.netProfit, lang)}.`));
  if (t.returnsCount > 0) parts.push(L(lang, `Includes ${t.returnsCount} return${t.returnsCount === 1 ? '' : 's'} (${money(t.returnsUsd, lang)}).`, `محسوب منها ${t.returnsCount} مرتجع (${money(t.returnsUsd, lang)}).`));
  return parts.join(' ');
}

export async function metricAnswer(metric: Metric, period: PeriodSpec, session: ReadSession, src: InsightSource, lang: AiLang, now: Date): Promise<BrainAnswer> {
  if (!canSales(session)) return noPermission(lang);
  const needPrev = metric === 'sales' || metric === 'average';
  const [t, prev] = await Promise.all([loadTotals(session, src, period), needPrev ? loadTotals(session, src, previousFor(period, now)) : Promise.resolve(null)]);
  if (!t) return unreadable(lang);
  const when = periodPhrase(period, lang);
  const follow = lang === 'ar' ? ['كيف الشغل اليوم؟', 'قارن هالجمعة بالجمعة الماضية'] : ['How is business today?', 'Compare this week with last week'];
  switch (metric) {
    case 'sales':
      return { text: salesLine(t, prev, period, lang), suggestions: lang === 'ar' ? ['قديش ربحت؟', 'شو أكتر شي انباع؟'] : ['How much profit?', 'What sold the most?'] };
    case 'average': {
      if (t.invoices === 0) return { text: L(lang, `No sales ${when}, so there is no average yet.`, `ما في مبيعات ${when}، فما في معدّل.`), suggestions: follow };
      const avg = Math.round(t.netSales / t.invoices);
      let text = L(lang, `The average sale ${when} is **${money(avg, lang)}** (${money(t.netSales, lang)} over ${invoicesOf(t.invoices, lang)}).`, `معدّل الفاتورة ${when} **${money(avg, lang)}** (${money(t.netSales, lang)} على ${invoicesOf(t.invoices, lang)}).`);
      if (prev && prev.invoices > 0) {
        const prevAvg = Math.round(prev.netSales / prev.invoices);
        text += L(lang, ` For ${previousWords(period.label, lang)} it was ${money(prevAvg, lang)}.`, ` ${previousWords(period.label, lang)} كان ${money(prevAvg, lang)}.`);
      }
      return { text, suggestions: follow };
    }
    case 'expenses':
      return {
        text: t.expenses > 0
          ? L(lang, `Recorded expenses ${when}: **${money(t.expenses, lang)}**.`, `المصاريف المسجّلة ${when}: **${money(t.expenses, lang)}**.`)
          : L(lang, `No expenses are recorded ${when}.`, `ما في مصاريف مسجّلة ${when}.`),
        suggestions: follow,
      };
    case 'returns':
      return {
        text: t.returnsCount > 0
          ? L(lang, `Returns ${when}: **${t.returnsCount}**, worth ${money(t.returnsUsd, lang)}.`, `المرتجعات ${when}: **${t.returnsCount}**، قيمتهن ${money(t.returnsUsd, lang)}.`)
          : L(lang, `No returns ${when}.`, `ما في مرتجعات ${when}.`),
        suggestions: follow,
      };
    case 'invoices':
      return {
        text: L(lang, `You made **${invoicesOf(t.invoices, lang)}** ${when}. (The POS counts invoices, not individual customers.)`, `عملت **${invoicesOf(t.invoices, lang)}** ${when}. (النظام بيعدّ الفواتير، مش الزباين واحد واحد.)`),
        suggestions: follow,
      };
    case 'discounts':
      return {
        text: t.discounts > 0
          ? L(lang, `Discounts given ${when}: **${money(t.discounts, lang)}**.`, `الخصومات ${when}: **${money(t.discounts, lang)}**.`)
          : L(lang, `No discounts were given ${when}.`, `ما في خصومات ${when}.`),
        suggestions: follow,
      };
    case 'credit':
      return {
        text: L(lang, `Sold on credit ${when}: **${money(t.creditSales, lang)}**. Cash sales: ${money(t.cashSales, lang)}.`, `البيع بالدين ${when}: **${money(t.creditSales, lang)}**. البيع كاش: ${money(t.cashSales, lang)}.`),
        suggestions: lang === 'ar' ? ['مين عليه ديون؟'] : ['Who owes money?'],
      };
    case 'collected':
      return {
        text: t.debtCollected > 0
          ? L(lang, `Debt collected ${when}: **${money(t.debtCollected, lang)}**.`, `الديون يلي تحصّلت ${when}: **${money(t.debtCollected, lang)}**.`)
          : L(lang, `No debt payments were recorded ${when}.`, `ما في دفعات دين مسجّلة ${when}.`),
        suggestions: lang === 'ar' ? ['مين عليه ديون؟'] : ['Who owes money?'],
      };
  }
}

export async function cashAnswer(session: ReadSession, src: InsightSource, lang: AiLang): Promise<BrainAnswer> {
  if (!session.can('canManageCashDrawer')) {
    return { text: L(lang, 'The cash drawer needs the "Cash drawer" permission.', 'الصندوق بدّه صلاحية "الصندوق".'), suggestions: [] };
  }
  const cash = await loadCash(session, src);
  if (!cash) return unreadable(lang);
  return {
    text: L(lang, `The drawer has **${money(cash.usdCents, lang)}** and **${lbp(cash.lbp, lang)}** right now. (Kept separate — dollars and lira are never added together.)`, `بالصندوق هلّق **${money(cash.usdCents, lang)}** و **${lbp(cash.lbp, lang)}**. (الدولار والليرة كل واحد لحالو، ما بينجمعوا.)`),
    suggestions: lang === 'ar' ? ['قديش بعت اليوم؟'] : ['Sales today?'],
  };
}

export async function debtsAnswer(session: ReadSession, src: InsightSource, lang: AiLang): Promise<BrainAnswer> {
  if (!session.can('canViewCustomers')) {
    return { text: L(lang, 'Customer debts need the "Customers & debts" permission.', 'ديون الزباين بدها صلاحية "الزباين والديون".'), suggestions: [] };
  }
  const debts = await loadDebts(session, src);
  if (!debts) return unreadable(lang);
  if (debts.items.length === 0) return { text: L(lang, 'Nobody owes you money right now.', 'ما حدا عليه ديون هلّق.'), suggestions: [] };
  const total = debts.items.reduce((s, d) => s + d.debtUsdCents, 0);
  const lines = [
    L(lang, `**${customersOf(debts.items.length, lang)}${debts.hasMore ? '+' : ''}** owe you **${money(total, lang)}${debts.hasMore ? '+' : ''}**:`, `في **${customersOf(debts.items.length, lang)}${debts.hasMore ? '+' : ''}** عليهن **${money(total, lang)}${debts.hasMore ? '+' : ''}**:`),
    ...debts.items.slice(0, 8).map((d) => `• ${name(d.name)} — ${money(d.debtUsdCents, lang)}`),
  ];
  if (debts.items.length > 8 || debts.hasMore) lines.push(L(lang, 'The full list is on the Customers page.', 'اللايحة كاملة بصفحة الزباين.'));
  return { text: lines.join('\n'), suggestions: lang === 'ar' ? ['قديش تحصّل ديون هالشهر؟'] : ['Debt collected this month?'] };
}
