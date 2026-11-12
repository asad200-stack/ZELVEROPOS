import { describe, expect, it } from 'vitest';
import { CHAT_STICK_THRESHOLD_PX, distanceFromBottom, scrollTopForLatest, shouldFollowLatest, shouldStickToBottom } from './chatScroll';

describe('chat stick-to-bottom helpers', () => {
  it('treats near-bottom scroll as sticky', () => {
    expect(shouldStickToBottom({ scrollHeight: 1000, scrollTop: 920, clientHeight: 80 })).toBe(true);
    expect(distanceFromBottom({ scrollHeight: 1000, scrollTop: 920, clientHeight: 80 })).toBe(0);
  });

  it('does not force stick when the user has scrolled upward', () => {
    expect(shouldStickToBottom({ scrollHeight: 1000, scrollTop: 100, clientHeight: 80 })).toBe(false);
    expect(distanceFromBottom({ scrollHeight: 1000, scrollTop: 100, clientHeight: 80 })).toBeGreaterThan(CHAT_STICK_THRESHOLD_PX);
  });

  it('follows the latest message when the panel opens or the reader is already at the end', () => {
    expect(shouldFollowLatest({ opening: true, nearBottom: false })).toBe(true);
    expect(shouldFollowLatest({ opening: false, nearBottom: true })).toBe(true);
    expect(shouldFollowLatest({ opening: false, nearBottom: false })).toBe(false);
    expect(scrollTopForLatest({ scrollHeight: 1400 })).toBe(1400);
  });

  it('uses the shared threshold at the boundary', () => {
    expect(shouldStickToBottom({ scrollHeight: 200, scrollTop: 40, clientHeight: 80 }, 80)).toBe(true);
    expect(shouldStickToBottom({ scrollHeight: 200, scrollTop: 39, clientHeight: 80 }, 80)).toBe(false);
  });
});
