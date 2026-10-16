import '@testing-library/jest-dom';

// jsdom lacks these browser APIs that the ambient/auth layers rely on.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(Date.now()), 16);
  window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
}

// jsdom throws "Not implemented" for canvas contexts; provide a no-op 2D stub so
// the ambient background effect can run without noisy console errors.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return {
      setTransform() {},
      clearRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      arc() {},
      fill() {},
      strokeStyle: '',
      lineWidth: 1,
      fillStyle: '',
    };
  };
}
