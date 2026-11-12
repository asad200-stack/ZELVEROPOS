import { fail } from './errors.js';
import { parse } from './validate.js';
import { publicLeadSourceSchema, type LeadSource } from './salesModel.js';

/** Callable `data` must be an object before any field is read. */
export function salesBody(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('invalid-argument', 'error.invalidInput');
  return data as Record<string, unknown>;
}

export function readPublicLead(data: unknown): { source: Exclude<LeadSource, 'trial'>; body: Record<string, unknown> } {
  const body = salesBody(data);
  const source = parse(publicLeadSourceSchema, body.source);
  return { source, body };
}
