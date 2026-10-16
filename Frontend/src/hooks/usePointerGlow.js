import { useEffect } from 'react';

function supportsFinePointer() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

/**
 * Per-element pointer reaction. Writes CSS custom properties straight to the
 * node inside a single animation frame, so hovering never triggers a re-render.
 *
 *   --iq-glow-x / --iq-glow-y : pointer position inside the element, in %
 *   --iq-tilt-x / --iq-tilt-y : 3D rotation, eases back to 0 when the pointer leaves
 *   --iq-magnet-x / --iq-magnet-y : small translation for magnetic buttons
 */
export default function usePointerGlow(ref, { tilt = 0, magnet = 0, magnetRadius = 2.2 } = {}) {
  useEffect(() => {
    const element = ref.current;
    if (!element || !supportsFinePointer()) return undefined;

    let frame = 0;
    let clientX = 0;
    let clientY = 0;
    let hasPointer = false;

    const update = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const centreX = rect.left + rect.width / 2;
      const centreY = rect.top + rect.height / 2;
      const dx = clientX - centreX;
      const dy = clientY - centreY;

      const glowX = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
      const glowY = Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100));
      element.style.setProperty('--iq-glow-x', `${glowX.toFixed(2)}%`);
      element.style.setProperty('--iq-glow-y', `${glowY.toFixed(2)}%`);

      if (tilt) {
        const marginX = rect.width * 0.45;
        const marginY = rect.height * 0.45;
        const nearCard =
          hasPointer &&
          clientX > rect.left - marginX &&
          clientX < rect.right + marginX &&
          clientY > rect.top - marginY &&
          clientY < rect.bottom + marginY;

        const nx = nearCard ? Math.max(-1, Math.min(1, dx / (rect.width / 2))) : 0;
        const ny = nearCard ? Math.max(-1, Math.min(1, dy / (rect.height / 2))) : 0;

        element.style.setProperty('--iq-tilt-y', `${(nx * tilt).toFixed(3)}deg`);
        element.style.setProperty('--iq-tilt-x', `${(-ny * tilt * 0.68).toFixed(3)}deg`);
      }

      if (magnet) {
        const reach = Math.max(rect.width, rect.height) * magnetRadius;
        const distance = Math.hypot(dx, dy);
        const pull = !hasPointer || distance > reach ? 0 : 1 - distance / reach;
        element.style.setProperty('--iq-magnet-x', `${((dx / (rect.width / 2)) * pull * magnet).toFixed(2)}px`);
        element.style.setProperty('--iq-magnet-y', `${((dy / (rect.height / 2)) * pull * magnet).toFixed(2)}px`);
      }
    };

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    const onMove = (event) => {
      hasPointer = true;
      clientX = event.clientX;
      clientY = event.clientY;
      schedule();
    };

    const onLeave = () => {
      hasPointer = false;
      schedule();
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ref, tilt, magnet, magnetRadius]);
}
