import { useEffect, useState, type RefObject } from 'react';

export function useInView(ref: RefObject<Element | null>, rootMargin = '80px'): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        setOn(entries.some((e) => e.isIntersecting));
      },
      { rootMargin, threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin]);
  return on;
}
