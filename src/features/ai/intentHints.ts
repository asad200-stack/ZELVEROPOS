/**
 * Shared how-to / live-figure cues for routing and knowledge ranking.
 * Kept free of Firestore/read imports so engine.ts can use it safely.
 */

import { GUIDE_HINT } from './actions/operatorIntent';

/** How-to / workflow wording (not a request for today's numbers). */
export const PROCEDURE_HINT = GUIDE_HINT;

export function isProcedureQuestion(text: string): boolean {
  const q = text.trim();
  return (
    PROCEDURE_HINT.test(q) ||
    /\bversus\b|\bvs\.?\b|\bprocess(?:ing)?\s+(?:a\s+|the\s+)?(?:sale|return|checkout|payment)\b|وين زر|وين لاقي|ماذا يحدث|شو بصير/i.test(q) ||
    /\bhow\s+do(?:es)?\s+.+\bwork\b|\bwhat\s+is\s+the\s+difference\b|\bdifference\s+between\b|شو\s*الفرق|ما\s*(?:هو\s*)?الفرق|كيف\s*(?:ب)?(?:ي)?شتغل|كيف\s*يعمل/i.test(q)
  );
}
