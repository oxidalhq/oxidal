import '@testing-library/jest-dom/vitest';

// jsdom has no matchMedia; components that adapt to phones ask it. Tests run as a laptop.
if (!window.matchMedia)
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
