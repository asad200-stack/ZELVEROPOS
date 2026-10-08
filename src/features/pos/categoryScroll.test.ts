import { describe, expect, it } from 'vitest';
import { categoryEdges, forwardSign, scrollFromStart } from './categoryScroll';

describe('category scroller', () => {
  it('hides both arrows when every category fits', () => {
    expect(categoryEdges(0, 0, false, 'default')).toEqual({ overflow: false, atStart: true, atEnd: true });
  });

  it('disables only the left side at the start of a long list', () => {
    expect(categoryEdges(0, 400, false, 'default')).toMatchObject({ overflow: true, atStart: true, atEnd: false });
    expect(categoryEdges(200, 400, false, 'default')).toMatchObject({ atStart: false, atEnd: false });
    expect(categoryEdges(400, 400, false, 'default')).toMatchObject({ atStart: false, atEnd: true });
  });

  it('treats Chrome RTL scrollLeft as distance from the start', () => {
    expect(scrollFromStart(0, 400, true, 'negative')).toBe(0);
    expect(scrollFromStart(-400, 400, true, 'negative')).toBe(400);
    expect(categoryEdges(0, 400, true, 'negative')).toMatchObject({ atStart: true, atEnd: false });
    expect(categoryEdges(-400, 400, true, 'negative')).toMatchObject({ atStart: false, atEnd: true });
    expect(forwardSign(true, 'negative')).toBe(-1);
  });

  it('keeps Firefox RTL moving forward with a positive scroll', () => {
    expect(scrollFromStart(0, 400, true, 'default')).toBe(0);
    expect(forwardSign(true, 'default')).toBe(1);
    expect(forwardSign(false, 'negative')).toBe(1);
  });
});
