import { describe, expect, it } from 'vitest';
import { AI_CORPUS, AI_UNSUPPORTED, SUGGESTED_PROMPTS, answerZelvero, fallbackRate, type AiSession } from './ai';
import { mediaForFeature } from './screenshots';

describe('ZELVERO AI grounding', () => {
  it('recommends a mobile shop setup without inventing modules', () => {
    const reply = answerZelvero('I have a mobile shop with 3 employees.');
    expect(reply.unknown).toBeUndefined();
    expect(reply.text).toMatch(/mobile|electronics/i);
    expect(reply.bullets?.some((b) => b.includes('IMEI') || b.includes('POS'))).toBe(true);
    expect(reply.actions.map((a) => a.id)).toEqual(['pos', 'trial', 'quote']);
  });

  it('answers the phone-shop recommendation with useful tools', () => {
    const reply = answerZelvero('I have a phone shop');
    expect(reply.unknown).toBeUndefined();
    expect(reply.bullets?.join(' ')).toMatch(/POS/);
    expect(reply.bullets?.join(' ')).toMatch(/Credit|Inventory|Suppliers/);
    expect(reply.actions.map((a) => a.label)).toEqual(['Preview POS', 'Start Free Trial', 'Get a Quote']);
  });

  it('explains how to collect previous debt instead of contacting sales', () => {
    const reply = answerZelvero('How do I sell to someone who already owes me money?');
    expect(reply.unknown).toBeUndefined();
    expect(reply.text).toMatch(/previous balance/i);
    expect(reply.steps?.length).toBeGreaterThan(2);
    expect(reply.actions.some((a) => a.id === 'credit' || a.id === 'trial')).toBe(true);
  });

  it('remembers industry context in session memory only', () => {
    const session: AiSession = {};
    answerZelvero('I have an electronics store.', session);
    const follow = answerZelvero('Do I need suppliers?', session);
    expect(session.industrySlug).toBe('mobile-electronics');
    expect(follow.unknown).toBeUndefined();
    expect(follow.text).toMatch(/supplier/i);
  });

  it('answers approved POS and credit questions', () => {
    expect(answerZelvero('How does customer credit work?').text).toMatch(/credit|owe|balance/i);
    expect(answerZelvero('Can ZELVERO work offline?').text).toMatch(/offline|internet|connectivity/i);
  });

  it('builds conversion CTAs on welcome', () => {
    expect(answerZelvero('').actions.map((a) => a.label)).toEqual(['Start Free Trial', 'Explore Demo', 'Get a Quote']);
  });

  it('exposes the approved suggested prompts', () => {
    expect([...SUGGESTED_PROMPTS]).toEqual([
      'I own a mobile shop',
      'I own a supermarket',
      'How does customer credit work?',
      'Can ZELVERO work offline?',
      'How does USD/LBP work?',
      'What reports are available?',
      'Help me choose the right setup',
    ]);
  });

  it('refuses unknown features instead of inventing them', () => {
    const reply = answerZelvero('Does ZELVERO do payroll and delivery drones?');
    expect(reply.unknown).toBe(true);
    expect(reply.unsupported).toBe(true);
    expect(reply.text).toBe(AI_UNSUPPORTED);
    expect(reply.actions.map((a) => a.id)).toEqual(['feature', 'contact']);
  });

  it('does not invent a price', () => {
    const reply = answerZelvero('How much does it cost?');
    expect(reply.text).toMatch(/custom quote/i);
    expect(reply.text).not.toMatch(/\$\d/);
  });

  it('only exposes reconstructions that are currently valid', () => {
    const media = mediaForFeature('pos');
    expect(media.length).toBeGreaterThan(0);
    expect(media.every((m) => m.visual === 'reconstruction' || m.imageUrl)).toBe(true);
    expect(mediaForFeature('payroll')).toEqual([]);
  });

  it('answers a 50-question product corpus with rare contact fallback', () => {
    expect(AI_CORPUS.length).toBeGreaterThanOrEqual(50);
    const rate = fallbackRate(AI_CORPUS);
    expect(rate).toBeLessThan(0.08);
    for (const q of AI_CORPUS) {
      const reply = answerZelvero(q);
      expect(reply.text.length).toBeGreaterThan(20);
      expect(reply.actions.length).toBeGreaterThan(0);
    }
  });
});
