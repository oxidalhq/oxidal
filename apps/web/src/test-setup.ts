import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
// Page memory (search, scroll, return target) is per tab; start each test clean.
import { beforeEach } from 'vitest';

// jsdom does not implement pointer capture or layout scrolling. Radix uses both
// for the same Select interactions that real browsers provide natively.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};
// Radix Slider and Switch measure their thumbs; jsdom has no layout.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// The master level reads unit state over its own request; views that embed it
// are tested without it. MasterLevel.test.tsx covers the real component.
vi.mock('./MasterLevel', () => ({ MasterLevel: () => null }));
vi.mock('./GuitarSettings', () => ({
  GuitarSettings: () => null,
  GuitarSwitch: () => null,
}));
beforeEach(() => {
  try {
    sessionStorage.clear();
  } catch {
    /* no storage */
  }
});
window.scrollTo = () => {};
