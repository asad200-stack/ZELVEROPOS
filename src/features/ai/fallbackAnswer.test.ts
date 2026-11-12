import { describe, expect, it } from 'vitest';
import { publishedKnowledge } from './catalog';
import { answerQuestion } from './engine';
import { greetingReply, isGenericUnsupportedAnswer, replyLanguage, resolveKnowledgeMiss } from './fallbackAnswer';
import { classifyRead } from './readIntent';

const ctx = {
  question: '',
  lang: 'en' as const,
  route: '/pos',
  isOwner: true,
  isSuperAdmin: false,
  can: () => true,
};

describe('reply language follows the utterance', () => {
  it('answers an Arabic greeting in Arabic even when the UI is English', () => {
    expect(replyLanguage('مرحبا زيلفيرو', 'en')).toBe('ar');
    expect(greetingReply('مرحبا زيلفيرو', 'ar')).toMatch(/أهلاً/);
    expect(replyLanguage('open products', 'en')).toBe('en');
  });
});

describe('knowledge miss fallback resolution', () => {
  it('how-to with an existing workflow does not use the generic unsupported answer', () => {
    const answered = answerQuestion(publishedKnowledge, {
      ...ctx,
      question: 'How do I add a product?',
    });
    expect(isGenericUnsupportedAnswer(answered.text)).toBe(false);
    expect(answered.text).toMatch(/Products|Add product|المنتجات|إضافة منتج/i);
  });

  it('knowledge retrieval miss uses guide / app context or a specific clarification', () => {
    const miss = resolveKnowledgeMiss(publishedKnowledge, { ...ctx, question: 'How do I add a customer?' }, 'en');
    expect(isGenericUnsupportedAnswer(miss.text)).toBe(false);
    expect(miss.text).toMatch(/Customers|Add customer|1\./i);
  });

  it('unknown functionality is described honestly rather than fabricated', () => {
    const result = answerQuestion(publishedKnowledge, {
      ...ctx,
      question: 'How do I enable the loyalty rewards program?',
    });
    expect(isGenericUnsupportedAnswer(result.text)).toBe(false);
    expect(result.text).toMatch(/not part of this system|مش موجود/i);
    expect(result.text).not.toMatch(/successfully enabled|points balance/i);
  });

  it('off-topic questions get scoped POS help instead of documented-answer failure', () => {
    const unknown = answerQuestion(publishedKnowledge, { ...ctx, question: 'What is the weather on Mars?' });
    expect(unknown.status).toBe('unknown');
    expect(isGenericUnsupportedAnswer(unknown.text)).toBe(false);
    expect(unknown.text).toMatch(/Zelvero POS|how-to steps|شاشات|خطوات/i);
  });

  it('capability asks list allowlisted help without claiming finance execution', () => {
    const caps = answerQuestion(publishedKnowledge, { ...ctx, question: 'What can you do?' });
    expect(caps.status).toBe('answered');
    expect(caps.text).toMatch(/navigate|page|cart|product|how-to|شاشات|سلة|منتج/i);
    expect(caps.text).not.toMatch(/I will checkout|أكمل الدفع من الدردشة/i);
  });

  it('live-data questions still classify to authorized live readers', () => {
    expect(classifyRead('How much did we sell today?', 'en')?.topics).toEqual(['sales']);
    expect(classifyRead('How much cash do we have?', 'en')?.topics).toContain('cashbox');
  });
});
