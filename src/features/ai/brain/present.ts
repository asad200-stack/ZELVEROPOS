/**
 * Presentation pass for answers produced by the existing read/compare/insight code.
 *
 * The canonical text (kept for memory, tests and audits) carries technical notes meant for
 * reviewers: scope lines, the current-screen line, currency disclaimers. People at the counter
 * don't need those. This pass removes those fixed notes and formats amounts for reading.
 * It never changes a number: it only adds thousands separators and drops a redundant "USD".
 */

const DROP_LINE = [
  /^Scope: the signed-in store only\./,
  /^النطاق: المتجر المسجّل في هذه الجلسة فقط\./,
  /^Current screen: /,
  /^الشاشة الحالية: /,
];

const DROP_SENTENCE = [
  'Currency: USD only. The daily aggregate does not store LBP, so there is no LBP total and no conversion between the two.',
  'العملة USD فقط. تجميع اليوم لا يخزّن ليرة لبنانية، لذلك لا توجد حصيلة بالليرة ولا تحويل بين العملتين.',
  'Debt is USD only. No phone or address is included.',
  'الدين بالدولار فقط. لا هاتف ولا عنوان.',
  'This is the signed-in session only.',
  'هذا وصف للجلسة فقط.',
  'The two currencies are separate and were not added.',
  'العملتان منفصلتان ولم تُجمعا.',
];

const NOISE_LINE = [
  /^• Number of sales \(0\): about \$0\.00 USD\.$/,
  /^• عدد المبيعات \(0\) تقريباً ⁦?\$0\.00 USD⁩?\.$/,
];

function withCommas(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function presentAnswer(text: string): string {
  let out = text;
  for (const sentence of DROP_SENTENCE) out = out.split(sentence).join('');
  const lines = out
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, '').replace(/^[ \t]+(?=\S)/, (m) => m))
    .filter((line) => !DROP_LINE.some((re) => re.test(line.trim())))
    .filter((line) => !NOISE_LINE.some((re) => re.test(line.trim())));
  out = lines.join('\n');
  // $1245.50 USD → $1,245.50 ; 8500000 LBP → 8,500,000 LBP
  out = out.replace(/(-?)\$([\d,]+)\.(\d{2})(?: USD)?/g, (_m, sign: string, whole: string, cents: string) => `${sign}$${withCommas(whole.replace(/,/g, ''))}.${cents}`);
  out = out.replace(/\b(\d{4,})( LBP)\b/g, (_m, n: string, unit: string) => `${withCommas(n)}${unit}`);
  // "about 0 day(s)" reads as nonsense to a shop owner.
  out = out.replace(/→ about 0 day\(s\) \(around [^)]*\)/g, '→ could run out today');
  out = out.replace(/→ تقريباً 0 يوم \(حوالي [^)]*\)/g, '→ ممكن يخلص اليوم');
  out = out.replace(/about 1 day\(s\)/g, 'about 1 day').replace(/about (\d+) day\(s\)/g, 'about $1 days');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}
