/** Extremely short pulse. Never used for scroll or plain links. */
export function haptic(ms = 14): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(Math.min(20, Math.max(10, ms)));
    }
  } catch {
    /* unsupported */
  }
}
