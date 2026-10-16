import { useEffect, useRef } from 'react';
import './InteractiveBackground.css';
import backdrop from '../assets/auth-backdrop.jpg';

/**
 * Ambient environment for the auth screen:
 *   1. cinematic backdrop image with scroll parallax
 *   2. slow aurora gradient fields
 *   3. interactive neural network on a throttled 2D canvas
 *   4. perspective light grid
 *   5. cursor spotlight, bokeh, film grain and vignette
 *
 * Every layer is pointer-transparent, so the form is never blocked.
 */
export default function InteractiveBackground({ reducedMotion = false, compact = false }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let ctx;
    try {
      ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    } catch {
      ctx = null;
    }
    if (!ctx) return undefined;

    const linkDistance = compact ? 112 : 140;
    const interactRadius = compact ? 108 : 168;
    const maxNodes = compact ? 30 : 86;
    const areaPerNode = compact ? 15000 : 9200;

    let width = 0;
    let height = 0;
    let nodes = [];
    let frame = 0;
    let last = 0;
    const animate = !reducedMotion;

    const pointer = { x: -9999, y: -9999, active: false };

    const build = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width || window.innerWidth;
      height = rect.height || window.innerHeight;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.max(14, Math.min(maxNodes, Math.round((width * height) / areaPerNode)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.26 || 0.08,
        vy: (Math.random() - 0.5) * 0.26 || 0.08,
        r: Math.random() * 1.5 + 0.8,
        phase: Math.random() * Math.PI * 2,
      }));
    };

    const drawLinks = () => {
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distSq = dx * dx + dy * dy;
          if (distSq > linkDistance * linkDistance) continue;

          const alpha = (1 - Math.sqrt(distSq) / linkDistance) * 0.28;
          ctx.strokeStyle = `rgba(129, 178, 255, ${alpha.toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    };

    const drawCursorLinks = () => {
      if (!pointer.active) return;
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        const dx = node.x - pointer.x;
        const dy = node.y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance > interactRadius) continue;

        const alpha = (1 - distance / interactRadius) * 0.42;
        ctx.strokeStyle = `rgba(34, 211, 238, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(node.x, node.y);
        ctx.lineTo(pointer.x, pointer.y);
        ctx.stroke();
      }
    };

    const drawNodes = (time, dt) => {
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];

        if (pointer.active) {
          const dx = node.x - pointer.x;
          const dy = node.y - pointer.y;
          const distance = Math.hypot(dx, dy) || 1;
          if (distance < interactRadius) {
            const push = (1 - distance / interactRadius) * 0.085;
            node.vx += (dx / distance) * push * dt;
            node.vy += (dy / distance) * push * dt;
          }
        }

        node.vx *= 0.994;
        node.vy *= 0.994;

        const speed = Math.hypot(node.vx, node.vy);
        if (speed > 0 && speed < 0.05) {
          const scale = 0.05 / speed;
          node.vx *= scale;
          node.vy *= scale;
        } else if (speed > 0.85) {
          const scale = 0.85 / speed;
          node.vx *= scale;
          node.vy *= scale;
        }

        node.x += node.vx * dt;
        node.y += node.vy * dt;

        if (node.x < -24) node.x = width + 24;
        else if (node.x > width + 24) node.x = -24;
        if (node.y < -24) node.y = height + 24;
        else if (node.y > height + 24) node.y = -24;

        const pulse = 0.5 + (Math.sin(time * 0.0013 + node.phase) + 1) / 2;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r * (0.85 + pulse * 0.6), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(191, 219, 254, ${(0.3 + pulse * 0.5).toFixed(3)})`;
        ctx.fill();
      }
    };

    const step = (time) => {
      frame = 0;
      const dt = last ? Math.min(2.4, (time - last) / 16.67) : 1;
      last = time;

      ctx.clearRect(0, 0, width, height);
      drawLinks();
      drawCursorLinks();
      drawNodes(time, dt);

      if (animate && !document.hidden) {
        frame = window.requestAnimationFrame(step);
      }
    };

    const schedule = () => {
      if (!animate) {
        step(0);
        return;
      }
      if (!frame) frame = window.requestAnimationFrame(step);
    };

    const onPointerMove = (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
    };

    const onPointerLeave = () => {
      pointer.active = false;
      pointer.x = -9999;
      pointer.y = -9999;
    };

    const onVisibility = () => {
      if (!animate) return;
      if (document.hidden) {
        if (frame) window.cancelAnimationFrame(frame);
        frame = 0;
      } else {
        last = 0;
        schedule();
      }
    };

    const onResize = () => {
      build();
      if (!animate) step(0);
    };

    build();
    schedule();

    let observer;
    if (typeof window.ResizeObserver === 'function') {
      observer = new window.ResizeObserver(onResize);
      observer.observe(canvas);
    } else {
      window.addEventListener('resize', onResize);
    }

    if (animate) {
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('pointerleave', onPointerLeave);
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (observer) observer.disconnect();
      else window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reducedMotion, compact]);

  return (
    <div className={`iq-bg${compact ? ' iq-bg--compact' : ''}`} aria-hidden="true">
      <div className="iq-bg__image" style={{ backgroundImage: `url(${backdrop})` }} />

      <div className="iq-bg__aurora">
        <span className="iq-bg__blob iq-bg__blob--1" />
        <span className="iq-bg__blob iq-bg__blob--2" />
        <span className="iq-bg__blob iq-bg__blob--3" />
      </div>

      <canvas ref={canvasRef} className="iq-bg__canvas" />

      <div className="iq-bg__grid" />
      <div className="iq-bg__spotlight" />

      <span className="iq-bg__bokeh iq-bg__bokeh--1" />
      <span className="iq-bg__bokeh iq-bg__bokeh--2" />
      <span className="iq-bg__bokeh iq-bg__bokeh--3" />

      <div className="iq-bg__noise" />
      <div className="iq-bg__vignette" />
    </div>
  );
}
