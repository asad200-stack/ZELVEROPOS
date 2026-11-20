/**
 * New-order alerts for the online orders inbox. Orders are server-only (clients cannot listen
 * to them), so the open inbox polls the pending list and rings when an id it has not seen shows up.
 */

/** Ids that are new since the previous poll. The first poll (no baseline yet) never alerts. */
export function newOrderIds(known: ReadonlySet<string> | null, current: readonly string[]): string[] {
  if (known === null) return [];
  return current.filter((id) => !known.has(id));
}

/** Short two-note chime. Silently does nothing where audio is blocked or unavailable. */
export function playChime(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = [880, 1318.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + i * 0.18;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
    window.setTimeout(() => void ctx.close().catch(() => undefined), 1000);
  } catch {
    // Audio is a nice-to-have; the on-screen banner still shows.
  }
}
