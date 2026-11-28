import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
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
vi.mock('./MasterLevel', () => ({
  MasterLevel: () => null,
  OutLevelButton: () => null,
}));
vi.mock('./GuitarSettings', () => ({
  GuitarSettings: () => null,
  GuitarLane: () => null,
}));
beforeEach(() => {
  try {
    sessionStorage.clear();
  } catch {
    /* no storage */
  }
  // The Rig draws its chain as a map by default; most tests were written for the
  // tree, so each starts with the tree chosen. Map tests set the choice themselves.
  try {
    localStorage.setItem('oxidal.rig.chain-view.2', JSON.stringify('tree'));
  } catch {
    /* no storage */
  }
});
window.scrollTo = () => {};

// Finds wait a little longer on a busy host; a missing element still fails.
configure({ asyncUtilTimeout: 3000 });
