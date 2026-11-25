import { useEffect, useRef } from 'react';

/**
 * Publishes the live heights of the app top bar and of an optional sticky bar inside the screen
 * as CSS variables (--topbar-h, --sticky-bar-h) so scroll boxes can be sized to the visible area.
 */
export const useStickyOffsets = <T extends HTMLElement>(barSelector?: string) => {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return undefined;
    const topbar = document.querySelector<HTMLElement>('.topbar');
    const update = () => {
      const bar = barSelector ? host.querySelector<HTMLElement>(barSelector) : null;
      host.style.setProperty('--topbar-h', `${topbar?.offsetHeight ?? 0}px`);
      host.style.setProperty('--sticky-bar-h', `${bar?.offsetHeight ?? 0}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    if (topbar) observer.observe(topbar);
    const bar = barSelector ? host.querySelector<HTMLElement>(barSelector) : null;
    if (bar) observer.observe(bar);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [barSelector]);
  return ref;
};
