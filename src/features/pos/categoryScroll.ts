/** How a browser reports scrollLeft on a horizontal RTL scroller. */
export type RtlScrollType = 'negative' | 'reverse' | 'default';

/** Distance already traveled from the start. Zero means the first category is in view. */
export function scrollFromStart(scrollLeft: number, max: number, rtl: boolean, type: RtlScrollType): number {
  if (!rtl) return scrollLeft;
  if (type === 'negative') return -scrollLeft || 0;
  if (type === 'reverse') return max - scrollLeft;
  return scrollLeft;
}

/** Sign to add to scrollLeft so the strip moves toward later categories. */
export function forwardSign(rtl: boolean, type: RtlScrollType): 1 | -1 {
  if (!rtl || type === 'default') return 1;
  return -1;
}

export function categoryEdges(scrollLeft: number, max: number, rtl: boolean, type: RtlScrollType) {
  const overflow = max > 2;
  if (!overflow) return { overflow: false, atStart: true, atEnd: true };
  const pos = scrollFromStart(scrollLeft, max, rtl, type);
  return { overflow: true, atStart: pos <= 2, atEnd: pos >= max - 2 };
}

let cachedRtlScroll: RtlScrollType | null = null;

/** Probe once. Chrome uses negative scrollLeft; Firefox stays positive; older WebKit starts at the maximum. */
export function detectRtlScrollType(): RtlScrollType {
  if (cachedRtlScroll) return cachedRtlScroll;
  if (typeof document === 'undefined') return 'negative';
  const outer = document.createElement('div');
  const inner = document.createElement('div');
  outer.dir = 'rtl';
  outer.style.width = '4px';
  outer.style.height = '1px';
  outer.style.overflow = 'scroll';
  outer.style.position = 'absolute';
  outer.style.top = '-9999px';
  inner.style.width = '8px';
  inner.style.height = '1px';
  outer.appendChild(inner);
  document.body.appendChild(outer);
  if (outer.scrollLeft > 0) cachedRtlScroll = 'default';
  else {
    outer.scrollLeft = 1;
    cachedRtlScroll = outer.scrollLeft === 0 ? 'negative' : 'reverse';
  }
  outer.remove();
  return cachedRtlScroll;
}
