import { useEffect } from 'react';

/**
 * Writes the global pointer position to CSS custom properties on <html>,
 * throttled to one write per animation frame so React never re-renders on move.
 *
 *   --iq-mx / --iq-my : pointer position in viewport percentages
 *   --iq-px / --iq-py : pointer position normalised to -1..1
 */
export default function usePointer(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;

    const root = document.documentElement;
    let frame = 0;
    let clientX = window.innerWidth / 2;
    let clientY = window.innerHeight / 2;

    const apply = () => {
      frame = 0;
      const width = window.innerWidth || 1;
      const height = window.innerHeight || 1;
      root.style.setProperty('--iq-mx', `${((clientX / width) * 100).toFixed(3)}%`);
      root.style.setProperty('--iq-my', `${((clientY / height) * 100).toFixed(3)}%`);
      root.style.setProperty('--iq-px', ((clientX / width) * 2 - 1).toFixed(4));
      root.style.setProperty('--iq-py', ((clientY / height) * 2 - 1).toFixed(4));
    };

    const onMove = (event) => {
      clientX = event.clientX;
      clientY = event.clientY;
      if (!frame) frame = window.requestAnimationFrame(apply);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onMove, { passive: true });
    apply();

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [enabled]);
}
