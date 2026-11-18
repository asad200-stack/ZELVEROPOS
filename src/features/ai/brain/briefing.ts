/**
 * "How is business?" — a short store briefing written like a person would say it:
 * the headline numbers first, then only what needs attention, then one concrete next step.
 * Every figure comes from storeFacts (server-enforced, permission-checked reads).
 */
import type { AiLang } from '../engine';
import type { ReadSession } from '../readSnapshot';
import type { InsightSource } from '../serverReadSource';
import type { PeriodSpec } from '../copilot/memory';
import { previousPeriod, resolvePeriod } from '../copilot/tools';
import { customersOf, daysOf, invoicesOf, joinList, L, lbp, longDate, money, name, percentChange, periodWords, rate } from './format';
import { alertsFrom, canSales, canStock, loadCash, loadDebts, loadPace, loadTotals, type Alerts, type Totals } from './storeFacts';

export interface BrainAnswer {
  text: string;
  /** Short follow-up questions offered as tappable suggestions. */
  suggestions: string[];
}

function changeNote(cur: number, prev: number, lang: AiLang, prevLabel: string): string {
  const pct = percentChange(cur, prev);
  if (pct === null) return '';
  if (pct === 0) return L(lang, ` — same as ${prevLabel}`, ` — متل ${prevLabel}`);
  return pct > 0
    ? L(lang, ` — up ${pct}% on ${prevLabel}`, ` — أعلى بـ ${pct}% من ${prevLabel}`)
    : L(lang, ` — down ${Math.abs(pct)}% on ${prevLabel}`, ` — أقل بـ ${Math.abs(pct)}% من ${prevLabel}`);
}

function headline(t: Totals, prev: Totals | null, period: PeriodSpec, lang: AiLang): string[] {
  const out: string[] = [];
  if (t.invoices === 0 && t.netSales === 0) {
    out.push(L(lang, `• No sales recorded ${periodWords(period.label, lang)} yet.`, `• ما في مبيعات مسجّلة ${periodWords(period.label, lang)} لهلّق.`));
  } else {
    const isToday = period.label === 'today';
    const compare =
      prev && !isToday ? changeNote(t.netSales, prev.netSales, lang, L(lang, 'the period before', 'الفترة يلي قبلها')) : '';
    out.push(
      L(
        lang,
        `• **Sales:** ${money(t.netSales, lang)} from ${invoicesOf(t.invoices, lang)}${compare}.`,
        `• **المبيعات:** ${money(t.netSales, lang)} من ${invoicesOf(t.invoices, lang)}${compare}.`,
      ),
    );
    if (isToday && prev && prev.invoices > 0) {
      out.push(L(lang, `• Yesterday (full day): ${money(prev.netSales, lang)} from ${invoicesOf(prev.invoices, lang)}.`, `• مبارح (كل النهار): ${money(prev.netSales, lang)} من ${invoicesOf(prev.invoices, lang)}.`));
    }
  }
  if (t.netProfit !== null && t.invoices > 0) {
    const exp = t.expenses > 0 ? L(lang, ` after ${money(t.expenses, lang)} expenses`, ` بعد مصاريف ${money(t.expenses, lang)}`) : '';
    out.push(L(lang, `• **Net profit:** ${money(t.netProfit, lang)}${exp}.`, `• **الربح الصافي:** ${money(t.netProfit, lang)}${exp}.`));
  }
  if (t.returnsCount > 0) {
    out.push(L(lang, `• Returns: ${t.returnsCount} (${money(t.returnsUsd, lang)}).`, `• مرتجعات: ${t.returnsCount} (${money(t.returnsUsd, lang)}).`));
  }
  return out;
}

function attention(a: Alerts, debts: Awaited<ReturnType<typeof loadDebts>>, lang: AiLang): string[] {
  const out: string[] = [];
  if (a.outButSelling.length > 0) {
    const list = a.outButSelling.slice(0, 3).map((r) => `${name(r.item.name)} (~${rate(r.perDay)}${L(lang, '/day', ' باليوم')})`);
    out.push(L(lang, `• **Out of stock but in demand:** ${joinList(list, lang)}.`, `• **${a.outButSelling.length === 1 ? 'خالص وعليه طلب' : 'خالصين وعليهن طلب'}:** ${joinList(list, lang)}.`));
  }
  if (a.runningOut.length > 0) {
    const list = a.runningOut.slice(0, 3).map((r) => `${name(r.item.name)} (${L(lang, `${r.item.stock} left`, `باقي ${r.item.stock}`)})`);
    out.push(L(lang, `• **Will run out within 3 days:** ${joinList(list, lang)}.`, `• **${a.runningOut.length === 1 ? 'رح يخلص' : 'رح يخلصوا'} خلال 3 أيام:** ${joinList(list, lang)}.`));
  }
  if (a.expired.length > 0) {
    const list = a.expired.slice(0, 3).map((p) => `${name(p.name)} (${L(lang, `${p.stock} in stock`, `باقي ${p.stock}`)})`);
    out.push(L(lang, `• **Expired, still on the shelf:** ${joinList(list, lang)}.`, `• **${a.expired.length === 1 ? 'صلاحيته خالصة وبعده عالرف' : 'صلاحيتهن خالصة وبعدهن عالرف'}:** ${joinList(list, lang)}.`));
  }
  if (a.expiringSoon.length > 0) {
    const list = a.expiringSoon.slice(0, 3).map(({ item, days }) =>
      `${name(item.name)} (${days === 0 ? L(lang, 'today', 'اليوم') : L(lang, `in ${daysOf(days, lang)}`, `بعد ${daysOf(days, lang)}`)})`,
    );
    out.push(L(lang, `• **Expiring soon:** ${joinList(list, lang)}.`, `• **${a.expiringSoon.length === 1 ? 'صلاحيته قرّبت تخلص' : 'صلاحيتهن قرّبت تخلص'}:** ${joinList(list, lang)}.`));
  }
  if (debts && debts.items.length > 0) {
    const total = debts.items.reduce((s, d) => s + d.debtUsdCents, 0);
    const top = debts.items[0]!;
    out.push(
      L(
        lang,
        `• **Customer debts:** ${customersOf(debts.items.length, lang)}${debts.hasMore ? '+' : ''} owe ${money(total, lang)}${debts.hasMore ? '+' : ''}; the largest is ${name(top.name)} (${money(top.debtUsdCents, lang)}).`,
        `• **ديون الزباين:** ${customersOf(debts.items.length, lang)}${debts.hasMore ? '+' : ''} عليهن ${money(total, lang)}${debts.hasMore ? '+' : ''}، أكبرهن ${name(top.name)} (${money(top.debtUsdCents, lang)}).`,
      ),
    );
  }
  return out;
}

function nextStep(a: Alerts | null, lang: AiLang): string | null {
  if (!a) return null;
  const out = a.outButSelling[0];
  if (out) {
    const lost = out.avgPriceCents !== null ? Math.round(out.perDay * out.avgPriceCents) : null;
    return lost && lost > 0
      ? L(lang, `Restock ${name(out.item.name)} first — every day without it misses about ${money(lost, lang)} in sales.`, `جيب ${name(out.item.name)} بأسرع وقت — كل يوم بلاه عم يروح عليك تقريباً ${money(lost, lang)} مبيعات.`)
      : L(lang, `Restock ${name(out.item.name)} first — customers keep asking for it.`, `جيب ${name(out.item.name)} بأسرع وقت — عليه طلب.`);
  }
  const ex = a.expired[0];
  if (ex) return L(lang, `Pull ${name(ex.name)} off the shelf — it has expired.`, `شيل ${name(ex.name)} عن الرف — صلاحيته خالصة.`);
  const soon = a.runningOut[0];
  if (soon) return L(lang, `Order ${name(soon.item.name)} today so it doesn't run out.`, `اطلب ${name(soon.item.name)} اليوم لحتى ما يخلص.`);
  const exp = a.expiringSoon[0];
  if (exp) return L(lang, `Put ${name(exp.item.name)} up front or on offer before it expires.`, `حط ${name(exp.item.name)} قدّام أو عليه عرض قبل ما تخلص صلاحيته.`);
  return null;
}

export async function briefing(session: ReadSession, src: InsightSource, lang: AiLang, now: Date, periodLabel: 'today' | 'week' | 'month' = 'today'): Promise<BrainAnswer> {
  const period = resolvePeriod({ preset: periodLabel }, now);
  const prevPeriod = periodLabel === 'today' ? resolvePeriod({ preset: 'yesterday' }, now) : previousPeriod(period);
  const [totals, prev, pace, debts, cash] = await Promise.all([
    loadTotals(session, src, period),
    loadTotals(session, src, prevPeriod),
    loadPace(session, src, now),
    loadDebts(session, src),
    periodLabel === 'today' ? loadCash(session, src) : Promise.resolve(null),
  ]);
  const alerts = pace ? alertsFrom(pace, now, session.can('canViewProducts')) : null;

  const lines: string[] = [];
  const title =
    periodLabel === 'today'
      ? L(lang, `**Today so far** · ${longDate(now, lang)}`, `**اليوم لهلّق** · ${longDate(now, lang)}`)
      : periodLabel === 'week'
        ? L(lang, '**Summary: last 7 days**', '**ملخص آخر 7 أيام**')
        : L(lang, '**Summary: this month so far**', '**ملخص هالشهر لهلّق**');
  lines.push(title);
  if (totals) lines.push(...headline(totals, prev, period, lang));
  else if (!canSales(session)) lines.push(L(lang, '• Sales figures need the "View reports" permission.', '• أرقام المبيعات بدها صلاحية "عرض التقارير".'));
  else lines.push(L(lang, '• Sales could not be read right now.', '• ما قدرت اقرا المبيعات هلّق.'));
  if (cash) lines.push(L(lang, `• **Cash drawer:** ${money(cash.usdCents, lang)} and ${lbp(cash.lbp, lang)}.`, `• **الصندوق:** ${money(cash.usdCents, lang)} و ${lbp(cash.lbp, lang)}.`));

  const watch = alerts ? attention(alerts, debts, lang) : debts ? attention({ outButSelling: [], runningOut: [], expired: [], expiringSoon: [], deadStock: [], missingCost: [], topMargin: [], catalogComplete: true }, debts, lang) : [];
  lines.push('');
  if (watch.length > 0) {
    lines.push(L(lang, '**Needs attention**', '**بدها انتباه**'));
    lines.push(...watch);
  } else if (alerts) {
    lines.push(L(lang, 'Nothing urgent: no stock-outs, expiries, or items about to run out.', 'ما في شي مستعجل: لا بضاعة خالصة، لا صلاحيات، ولا شي قرّب يخلص.'));
  } else if (!canStock(session)) {
    lines.push(L(lang, 'Stock alerts need permission to view products and sales.', 'تنبيهات البضاعة بدها صلاحية تشوف المنتجات والمبيعات.'));
  }
  const step = nextStep(alerts, lang);
  if (step) {
    lines.push('');
    lines.push(L(lang, `**Next step:** ${step}`, `**الخطوة الجاية:** ${step}`));
  }

  const suggestions =
    lang === 'ar'
      ? ['شو لازم اطلب؟', 'كيف بزيد المبيعات؟', 'قارن هالجمعة بالجمعة الماضية']
      : ['What should I reorder?', 'How can I increase sales?', 'Compare this week with last week'];
  return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), suggestions };
}
