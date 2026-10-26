import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { root } from './process.mjs';

// Render the checked-in vector masters; no private source checkout is needed.
const require = createRequire(join(root, 'apps/web/package.json'));
const { chromium } = require('@playwright/test');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [source, output, width, height, background, inset] of [
    ['github-avatar.svg', 'touch-icon.png', 180, 180, '#161616', 0],
    ['boot-splash.svg', 'boot-splash.png', 1600, 900, '#161616', 0],
    ['wordmark.svg', 'wordmark.png', 1280, 340, 'transparent', 0],
  ]) {
    await page.setViewportSize({ width, height });
    const svg = readFileSync(
      join(root, 'apps/web/public/brand', source),
      'utf8',
    );
    await page.setContent(
      `<style>html,body{margin:0;width:100%;height:100%;background:${background}}svg{width:100%;height:100%;box-sizing:border-box;padding:${inset}px;display:block}</style>${svg}`,
    );
    const png = await page.screenshot({
      omitBackground: background === 'transparent',
    });
    writeFileSync(join(root, 'apps/web/public/brand', output), png);
  }
} finally {
  await browser.close();
}
