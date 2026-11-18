/**
 * Which language to answer in. Arabic script → Arabic. Latin text that reads as Lebanese
 * Arabizi ("shu", "kifak", "a7san", digits inside words) → Arabic. Plain English → English.
 * Anything else follows the app's language.
 */
import type { AiLang } from '../engine';
import { readLanguage } from '../copilot/language';

const ARABIZI_HINT =
  /\b(?:shu|sho|chou|shou|kif|keef|kifak|kifik|kifkon|slm|salam|marhaba|mar7aba|ahlan|ahla|yalla|habibi|7abibi|fi|ma|3am|ba3d|ba3den|lyom|elyom|hal|yslmo|ysalmo|merci|mersi|tamam|tmm|eh|ee|la2|mnih|mni7|ktir|kteer|baddi|badde|bade|enta|enti|ana|halla2|hala2|hala|w|wle|yaane|ya3ne|ya|jdid|addeh|adde|2adde|meen|min|lesh|leh|mbere7|bukra|bokra)\b|[a-z][2-9]|[2-9][a-z]/i;

const ENGLISH_HINT =
  /\b(?:the|is|are|was|were|how|what|which|who|why|when|my|me|i|we|you|your|our|today|yesterday|this|last|week|month|year|sales|profit|stock|show|give|tell|can|could|do|does|did|much|many|thanks|thank|hello|hi|hey|good|bye|please|list|best|top|any|have|has)\b/i;

export function replyLang(raw: string, uiLang: AiLang): AiLang {
  if (/[؀-ۿ]/.test(raw)) return readLanguage(raw, uiLang).reply;
  if (!/[A-Za-z]/.test(raw)) return uiLang;
  const hits = (raw.match(new RegExp(ARABIZI_HINT.source, 'gi')) ?? []).length;
  const eng = (raw.match(new RegExp(ENGLISH_HINT.source, 'gi')) ?? []).length;
  if (hits > 0 && hits >= eng) return 'ar';
  if (eng > 0) return 'en';
  return readLanguage(raw, uiLang).reply;
}
