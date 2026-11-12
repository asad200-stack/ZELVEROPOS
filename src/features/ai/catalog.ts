import draft from './knowledge/draft.json' with { type: 'json' };
import review from './knowledge/review.json' with { type: 'json' };
import { publishReviewed, type KnowledgeDraft, type KnowledgeReview } from './engine';

/** Reviewed local-source cards only. Unreviewed or stale hashes never reach the chat. */
export const publishedKnowledge = publishReviewed(draft as KnowledgeDraft, review as KnowledgeReview);
