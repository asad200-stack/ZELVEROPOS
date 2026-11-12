/**
 * Chat stick-to-bottom helpers. No timers — callers scroll via a bottom sentinel
 * when the user is already near the bottom or explicitly sends a message.
 */

export const CHAT_STICK_THRESHOLD_PX = 80;

export function distanceFromBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

/** True when the scroller is close enough to the end that new content should auto-follow. */
export function shouldStickToBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }, threshold = CHAT_STICK_THRESHOLD_PX): boolean {
  return distanceFromBottom(el) <= threshold;
}

/** Opening the panel, or a reader already at the latest message, should stay at the end. */
export function shouldFollowLatest(options: { opening: boolean; nearBottom: boolean }): boolean {
  return options.opening || options.nearBottom;
}

/** Scroll offset that reveals the newest message inside the conversation container. */
export function scrollTopForLatest(el: { scrollHeight: number }): number {
  return el.scrollHeight;
}
