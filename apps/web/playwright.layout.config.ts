import { defineConfig } from '@playwright/test';

import product from './playwright.config';

// Representative CSS viewports shared with Storybook, not hardware dimensions.
const screens = [
  { name: 'fold-cover', width: 344, height: 882 },
  { name: 'iphone-16', width: 393, height: 852 },
  { name: 'iphone-xr', width: 414, height: 896 },
  { name: 'boox', width: 768, height: 1024 },
  { name: 'fold-open', width: 882, height: 1104 },
  { name: 'laptop', width: 1280, height: 800 },
];

/** Product viewport review using the existing isolated test services.
 * @see docs/development.md#product-layout-review
 */
export default defineConfig({
  ...product,
  testMatch: /product-layout\.spec\.ts/,
  // Layout findings are deterministic evidence; retrying could hide a transient.
  retries: 0,
  timeout: 240000,
  projects: screens.map(({ name, width, height }) => ({
    name,
    use: {
      browserName: 'chromium',
      viewport: { width, height },
      deviceScaleFactor: 1,
      hasTouch: name !== 'laptop',
    },
  })),
});
