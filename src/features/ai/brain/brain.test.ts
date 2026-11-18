import { describe, expect, it } from 'vitest';
import { detectBrainIntent, fixTypos } from './intents';
import { replyLang } from './lang';
import { presentAnswer } from './present';
import { smallTalkKind } from './smallTalk';
import { invoicesOf, money } from './format';

const now = new Date(2026, 10, 18, 15, 0, 0);
const kind = (q: string) => detectBrainIntent(q, 'ar', now)?.kind ?? null;

describe('brain: understanding', () => {
  it('answers a store briefing in English, Arabic and Arabizi', () => {
    for (const q of ['how is business', 'give me a summary of today', 'كيف الشغل اليوم؟', 'عطيني ملخص عن المحل', 'kif l shoghol lyom', 'shu fi jdid']) {
      expect(kind(q), q).toBe('briefing');
    }
  });
  it('recognises advice requests', () => {
    for (const q of ['how can I increase sales', 'kif bzid l mabi3at', 'شو بتنصحني']) expect(kind(q), q).toBe('advice');
  });
  it('recognises one-figure questions with their metric', () => {
    const metric = (q: string) => {
      const i = detectBrainIntent(q, 'ar', now);
      return i?.kind === 'metric' ? i.metric : null;
    };
    expect(metric('average sale today')).toBe('average');
    expect(metric('qadeish sarafna hal shaher')).toBe('expenses');
    expect(metric('addeh fatoura 3melet lyom')).toBe('invoices');
    expect(metric('addeh 3melet discount lyom')).toBe('discounts');
  });
  it('reads a product stock question and keeps the name as written', () => {
    expect(detectBrainIntent('addeh ba2e pepsi', 'ar', now)).toEqual({ kind: 'stock', product: 'pepsi', qty: null });
    expect(detectBrainIntent('is there enough bread for 20', 'ar', now)).toEqual({ kind: 'stock', product: 'bread', qty: 20 });
  });
  it('does not treat money or debt questions as a product name', () => {
    expect(kind('addeh fi masari bl sandou2')).not.toBe('stock');
  });
  it('rewrites natural phrasings for the rule planner', () => {
    const rw = (q: string) => {
      const i = detectBrainIntent(q, 'ar', now);
      return i?.kind === 'rewrite' ? i.text : null;
    };
    expect(rw('is today better than yesterday')).toBe('compare sales today with yesterday');
    expect(rw('top 5 products')).toBe('top 5 best selling products this week');
    expect(rw('HOW MUCH SALSE TODAY')).toBe('HOW MUCH sales TODAY');
  });
  it('leaves how-to questions to the guides', () => {
    expect(kind('how do I give a discount')).not.toBe('metric');
    expect(detectBrainIntent('kif bzid mantoj jdid', 'ar', now)?.kind).toBe('operator');
  });
  it('fixes only known typos', () => {
    expect(fixTypos('waht shoud i reordr Pepsi')).toBe('what should i reorder Pepsi');
  });
});

describe('brain: language and small talk', () => {
  it('answers Arabizi in Arabic and English in English', () => {
    expect(replyLang('kifak', 'en')).toBe('ar');
    expect(replyLang('ok merci', 'en')).toBe('ar');
    expect(replyLang('HOW IS MY PROFIT TODAY', 'ar')).toBe('en');
    expect(replyLang('worst products', 'ar')).toBe('en');
  });
  it('handles greetings, thanks and how-are-you', () => {
    expect(smallTalkKind('slm')).toBe('greet');
    expect(smallTalkKind('كيفك')).toBe('howAreYou');
    expect(smallTalkKind('yslmo')).toBe('thanks');
    expect(smallTalkKind('how much profit today')).toBeNull();
  });
});

describe('brain: presentation', () => {
  it('drops reviewer notes and formats amounts without changing them', () => {
    const text = 'Scope: the signed-in store only. A store name in the question is ignored.\nCurrent screen: Point of sale (/pos). This is the signed-in session only.\nCash $1245.50 USD and 8500000 LBP.';
    expect(presentAnswer(text)).toBe('Cash $1,245.50 and 8,500,000 LBP.');
  });
  it('formats money and Arabic counts', () => {
    expect(money(124550, 'en')).toBe('$1,245.50');
    expect(invoicesOf(2, 'ar')).toBe('فاتورتين');
    expect(invoicesOf(8, 'ar')).toBe('8 فواتير');
    expect(invoicesOf(14, 'ar')).toBe('14 فاتورة');
  });
});

describe('brain: presentation of already-formatted amounts', () => {
  it('drops USD after an amount that already has thousands separators', () => {
    expect(presentAnswer('profit $500.00 on $1,000.00 USD sales')).toBe('profit $500.00 on $1,000.00 sales');
  });
});
