// Layout check over the built Storybook: every Screens and Patterns story
// at the widths the owner plays from, failing when the page or an element
// runs off the side of the screen. (Accessibility and interactions are
// covered by `pnpm test:stories`; this checks what they cannot: overflow.)
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const WIDTHS = [
  ['Z Fold 4 cover', 344, 882],
  ['iPhone 16', 393, 852],
  ['iPhone XR', 414, 896],
  ['BOOX portrait', 768, 1024],
  ['Z Fold 4 open', 882, 1104],
  ['Laptop', 1280, 800],
];
// Regions that scroll sideways on purpose.
const SCROLLERS =
  '[data-slot=route],[data-slot=chain],[data-slot=tabs-list],[data-slot=stem-mixer],[data-slot=scroll-area],[data-slot=sheet-viewer]';

const root = resolve(process.argv[2] ?? 'storybook-static');
if (!existsSync(join(root, 'index.json'))) {
  console.error(`No Storybook build at ${root}; run \`pnpm build\` first.`);
  process.exit(2);
}
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
  const file = join(root, path === '/' ? 'index.html' : path);
  try {
    const body = readFileSync(file);
    response.writeHead(200, {
      'content-type': types[extname(file)] ?? 'application/octet-stream',
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
const origin = `http://127.0.0.1:${server.address().port}`;
const index = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'));
const stories = Object.values(index.entries).filter(
  (e) => e.type === 'story' && /^(screens|patterns)-/.test(e.id),
);

const browser = await chromium.launch();
const failures = [];
for (const [device, width, height] of WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  for (const story of stories) {
    await page.goto(`${origin}/iframe.html?id=${story.id}&viewMode=story`, {
      waitUntil: 'networkidle',
    });
    await page.waitForSelector('#storybook-root > *', { timeout: 10000 });
    const result = await page.evaluate((scrollers) => {
      const doc = document.documentElement;
      const over = [...document.querySelectorAll('#storybook-root *')]
        .filter((el) => {
          if (el.closest(scrollers)) return false;
          const style = getComputedStyle(el);
          if (
            style.position === 'fixed' ||
            style.display === 'none' ||
            style.visibility === 'hidden'
          )
            return false;
          const box = el.getBoundingClientRect();
          return box.width > 0 && box.right > window.innerWidth + 1;
        })
        .slice(0, 3)
        .map(
          (el) =>
            `${el.getAttribute('data-slot') ?? el.tagName.toLowerCase()} (${Math.round(el.getBoundingClientRect().right)}px)`,
        );
      return { scroll: doc.scrollWidth - doc.clientWidth, over };
    }, SCROLLERS);
    if (result.scroll > 1 || result.over.length)
      failures.push(
        `${device} ${width}px · ${story.id}: page ${result.scroll}px wider; ${result.over.join(', ')}`,
      );
  }
  await context.close();
  console.log(`${device} (${width}px): checked ${stories.length} stories`);
}
await browser.close();
server.close();
for (const failure of failures) console.log(`✗ ${failure}`);
console.log(
  failures.length
    ? `${failures.length} overflow problems`
    : `No overflow at ${WIDTHS.length} widths`,
);
process.exit(failures.length ? 1 : 0);
