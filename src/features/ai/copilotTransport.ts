/**
 * The only server calls Zelvero AI makes: the internal-only access check and read-only data.
 * Kept separate from AiPanel so the panel itself never imports the POS functions client
 * (no business actions are reachable from the assistant through this module).
 */
import { api } from '@/services/functionsClient';

export const copilotRead = (input: Record<string, unknown>): Promise<unknown> => api.aiCopilotRead(input);

export const copilotAccess = (): Promise<unknown> => api.aiCopilotAccess({});
