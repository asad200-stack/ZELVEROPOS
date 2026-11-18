/**
 * "How can I sell more / make more money?" — practical advice built from this store's own
 * records. Each tip names the products and the numbers behind it, so the owner can check it.
 * Tips are suggestions, not certainties, and the answer says so once at the end.
 */
import type { AiLang } from '../engine';
import type { ReadSession } from '../readSnapshot';
import type { InsightSource } from '../serverReadSource';
import { previousPeriod, resolvePeriod } from '../copilot/tools';
import type { BrainAnswer } from './briefing';
import { customersOf, joinList, L, money, name, percentChange, productsOf } from './format';
import { alertsFrom, canStock, loadDebts, loadPace, loadTotals } from './storeFacts';

export async function advice(session: ReadSession, src: InsightSource, lang: AiLang, now: Date): Promise<BrainAnswer> {
  const week = resolvePeriod({ preset: 'week' }, now);
  const [pace, debts, thisWeek, lastWeek] = await Promise.all([
    loadPace(session, src, now),
    loadDebts(session, src),
    loadTotals(session, src, week),
    loadTotals(session, src, previousPeriod(week)),
  ]);
  const tips: string[] = [];
  const a = pace ? alertsFrom(pace, now, session.can('canViewProducts')) : null;

  if (a && a.outButSelling.length > 0) {
    const lost = a.outButSelling.reduce((s, r) => s + (r.avgPriceCents !== null ? r.perDay * r.avgPriceCents : 0), 0);
    const list = joinList(a.outButSelling.slice(0, 3).map((r) => name(r.item.name)), lang);
    tips.push(
      lost > 0
        ? L(lang, `**Restock what sells.** ${list} ${a.outButSelling.length === 1 ? 'is' : 'are'} out of stock but selling — about ${money(Math.round(lost), lang)} a day in missed sales.`, `**رجّع البضاعة يلي بتنباع.** ${list} ${a.outButSelling.length === 1 ? 'خالص وعليه طلب' : 'خالصين وعليهن طلب'} — عم يروح عليك تقريباً ${money(Math.round(lost), lang)} مبيعات باليوم.`)
        : L(lang, `**Restock what sells.** ${list} ${a.outButSelling.length === 1 ? 'is' : 'are'} out of stock but in demand.`, `**رجّع البضاعة يلي بتنباع.** ${list} ${a.outButSelling.length === 1 ? 'خالص وعليه طلب' : 'خالصين وعليهن طلب'}.`),
    );
  }
  if (a && a.runningOut.length > 0) {
    const list = joinList(a.runningOut.slice(0, 3).map((r) => name(r.item.name)), lang);
    tips.push(L(lang, `**Order before it runs out.** ${list} will run out within 3 days at the current pace.`, `**اطلب قبل ما يخلص.** ${list} ${a.runningOut.length === 1 ? 'رح يخلص' : 'رح يخلصوا'} خلال 3 أيام بهالسرعة.`));
  }
  if (a && a.topMargin.length > 0) {
    const picks = a.topMargin.slice(0, 3).map((r) => `${name(r.item.name)} (${r.marginPct}%)`);
    tips.push(L(lang, `**Push your best margins.** ${joinList(picks, lang)} earn you the most per dollar sold — keep them visible near the counter and always in stock.`, `**ركّز عالمنتجات يلي ربحها أعلى.** ${joinList(picks, lang)} بيربحوك أكتر شي عكل دولار — حطّهن قدّام قريب من الكاشير وخلّيهن دايماً موجودين.`));
  }
  if (a && a.deadStock.length > 0) {
    const withValue = a.deadStock.filter((r) => r.item.costUsdCents !== null && session.can('canViewCosts'));
    const tied = withValue.reduce((s, r) => s + r.item.stock * (r.item.costUsdCents ?? 0), 0);
    const list = joinList(a.deadStock.slice(0, 3).map((r) => `${name(r.item.name)} (${r.item.stock})`), lang);
    tips.push(
      tied > 0
        ? L(lang, `**Free up cash from stock that isn't moving.** ${list} sold nothing in 28 days. In total, ${productsOf(a.deadStock.length, lang)} with no sales hold about ${money(tied, lang)} at cost. Try an offer or a bundle with a best seller.`, `**حرّر مصاري من البضاعة الواقفة.** ${list} ما انباع منهن شي بـ 28 يوم. بالمجموع في ${productsOf(a.deadStock.length, lang)} واقفين، قيمتهن تقريباً ${money(tied, lang)} بالكلفة. جرّب عرض أو بيعهن مع منتج بينباع منيح.`)
        : L(lang, `**Move stock that isn't selling.** ${list} sold nothing in 28 days. Try an offer or a bundle with a best seller.`, `**حرّك البضاعة الواقفة.** ${list} ما انباع منهن شي بـ 28 يوم. جرّب عرض أو بيعهن مع منتج بينباع منيح.`),
    );
  }
  if (a && a.expiringSoon.length > 0) {
    const list = joinList(a.expiringSoon.slice(0, 3).map(({ item }) => name(item.name)), lang);
    tips.push(L(lang, `**Sell before it expires.** ${list} ${a.expiringSoon.length === 1 ? 'expires' : 'expire'} within a week — a small discount now beats throwing ${a.expiringSoon.length === 1 ? 'it' : 'them'} away.`, `**بيع قبل ما تخلص الصلاحية.** ${list} ${a.expiringSoon.length === 1 ? 'صلاحيته بتخلص خلال جمعة — خصم صغير هلّق أحسن من ما ترميه' : 'صلاحيتهن بتخلص خلال جمعة — خصم صغير هلّق أحسن من ما ترميهن'}.`));
  }
  if (debts && debts.items.length > 0) {
    const total = debts.items.reduce((s, d) => s + d.debtUsdCents, 0);
    tips.push(L(lang, `**Collect what you're owed.** ${customersOf(debts.items.length, lang)} owe ${money(total, lang)}${debts.hasMore ? '+' : ''} — starting with ${name(debts.items[0]!.name)}.`, `**حصّل ديونك.** ${customersOf(debts.items.length, lang)} عليهن ${money(total, lang)}${debts.hasMore ? '+' : ''} — ابدا بـ ${name(debts.items[0]!.name)}.`));
  }
  if (a && a.missingCost.length > 0 && session.can('canViewCosts')) {
    tips.push(L(lang, `**Record missing costs.** ${productsOf(a.missingCost.length, lang)} ${a.missingCost.length === 1 ? 'has' : 'have'} no cost (e.g. ${name(a.missingCost[0]!.name)}), so profit on ${a.missingCost.length === 1 ? 'it' : 'them'} can't be measured.`, `**سجّل الكلفة الناقصة.** في ${productsOf(a.missingCost.length, lang)} بلا كلفة (مثلاً ${name(a.missingCost[0]!.name)})، ف${a.missingCost.length === 1 ? 'ربحه' : 'ربحهن'} ما بينحسب.`));
  }

  const lines: string[] = [];
  if (thisWeek && lastWeek && lastWeek.netSales > 0) {
    const pct = percentChange(thisWeek.netSales, lastWeek.netSales);
    if (pct !== null) {
      lines.push(
        pct >= 0
          ? L(lang, `Sales over the last 7 days are ${money(thisWeek.netSales, lang)}, up ${pct}% on the week before. Here's how to keep it going:`, `مبيعات آخر 7 أيام ${money(thisWeek.netSales, lang)}، أعلى بـ ${pct}% من الجمعة يلي قبلها. هيك بتكمّل عالطريق الصح:`)
          : L(lang, `Sales over the last 7 days are ${money(thisWeek.netSales, lang)}, down ${Math.abs(pct)}% on the week before. Here's where I'd start:`, `مبيعات آخر 7 أيام ${money(thisWeek.netSales, lang)}، أقل بـ ${Math.abs(pct)}% من الجمعة يلي قبلها. هون من وين ببلّش:`),
      );
    }
  }
  if (lines.length === 0) lines.push(L(lang, 'Based on your store\'s records, here\'s where I\'d start:', 'حسب أرقام محلّك، هون من وين ببلّش:'));
  if (tips.length === 0) {
    if (!pace && !canStock(session)) {
      lines.push(L(lang, 'Product-level advice needs permission to view products and sales.', 'النصايح حسب المنتج بدها صلاحية تشوف المنتجات والمبيعات.'));
    } else {
      lines.push(L(lang, 'Nothing stands out right now: no stock-outs, no dead stock, and no expiring items. Keep best sellers stocked and check again next week.', 'ما في شي لافت هلّق: لا بضاعة خالصة، لا بضاعة واقفة، ولا صلاحيات قربت. خلّي الأكثر مبيعاً دايماً موجود ورجاع اسألني الجمعة الجاية.'));
    }
  } else {
    tips.slice(0, 5).forEach((tip, i) => lines.push(`${i + 1}. ${tip}`));
    lines.push('');
    lines.push(L(lang, `_These come from the last 28 days of sales — check them against what you see in the shop._`, `_هالنصايح مبنية على مبيعات آخر 28 يوم — قارنها بيلي عم تشوفه بالمحل._`));
  }
  const suggestions = lang === 'ar' ? ['شو لازم اطلب؟', 'شو الأكثر ربحاً؟', 'شو البضاعة الواقفة؟'] : ['What should I reorder?', 'Which products make the most profit?', 'What stock is not selling?'];
  return { text: lines.join('\n'), suggestions };
}
