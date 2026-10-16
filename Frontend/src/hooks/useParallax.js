import { useEffect } from 'react';

/**
 * Writes the normalised pointer position (-1..1) to --ax-px / --ax-py on :root.
 * Updates are throttled with requestAnimationFrame and go straight to CSS
 * custom properties, so moving the mouse never re-renders React.
 */
export default function useParallax(enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof window.matchMedia === 'function' && !window.matchMedia('(hover: hover)').matches) {
      return undefined;
    }

    const root = document.documentElement;
    let frame = 0;
    let x = 0;
    let y = 0;

    const commit = () => {
      frame = 0;
      root.style.setProperty('--ax-px', x.toFixed(3));
      root.style.setProperty('--ax-py', y.toFixed(3));
    };

    const onMove = (event) => {
      x = (event.clientX / window.innerWidth) * 2 - 1;
      y = (event.clientY / window.innerHeight) * 2 - 1;
      if (!frame) frame = window.requestAnimationFrame(commit);
    };

    window.addEventListener('pointermove', onMove, { passive: true });

    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [enabled]);
}
