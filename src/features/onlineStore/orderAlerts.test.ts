import { describe, expect, it } from 'vitest';
import { newOrderIds } from './orderAlerts';

describe('new online order alerts', () => {
  it('stays quiet on the first poll', () => {
    expect(newOrderIds(null, ['a', 'b'])).toEqual([]);
  });

  it('reports only ids that were not seen before', () => {
    expect(newOrderIds(new Set(['a', 'b']), ['c', 'a', 'd'])).toEqual(['c', 'd']);
    expect(newOrderIds(new Set(['a']), ['a'])).toEqual([]);
  });
});
