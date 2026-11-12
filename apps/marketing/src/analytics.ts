export type MarketingEvent =
  | 'hero_trial_click'
  | 'demo_open'
  | 'quote_start'
  | 'quote_complete'
  | 'ai_open'
  | 'ai_lead'
  | 'partner_apply';

const buffer: { event: MarketingEvent; at: number; meta?: Record<string, string> }[] = [];

/** Architecture only — no third-party trackers until approved. */
export function track(event: MarketingEvent, meta?: Record<string, string>): void {
  buffer.push({ event, at: Date.now(), meta });
}

export function readEvents() {
  return buffer.slice();
}
