import { useEffect, useState } from 'react';

/**
 * Detects whether the user has enabled reduced motion in their OS/browser.
 * Returns true when motion should be minimized.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      setReduced(false);
      return;
    }
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = () => setReduced(mediaQuery.matches);
    handleChange();
    // Older Safari uses addListener/removeListener
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    } else {
      // @ts-ignore - legacy fallback
      mediaQuery.addListener(handleChange);
      // @ts-ignore - legacy fallback
      return () => mediaQuery.removeListener(handleChange);
    }
  }, []);

  return reduced;
}

