// Runs axe over every story in the built Storybook (storybook-static), in
// the default display mode, and fails on any violation. `pnpm build` first.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

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
  (entry) => entry.type === 'story',
);
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1024, height: 768 },
});
const page = await context.newPage();
const failures = [];
for (const story of stories) {
  await page.goto(`${origin}/iframe.html?id=${story.id}&viewMode=story`, {
    waitUntil: 'networkidle',
  });
  await page.waitForSelector('#storybook-root > *', { timeout: 10000 });
  const results = await new AxeBuilder({ page })
    .include('#storybook-root')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'])
    .disableRules(['region', 'landmark-one-main', 'page-has-heading-one'])
    .analyze();
  if (results.violations.length) {
    failures.push({ story: story.id, violations: results.violations });
    console.log(`✗ ${story.id}`);
    for (const violation of results.violations)
      console.log(
        `  ${violation.id}: ${violation.help} (${violation.nodes.length})\n    ${violation.nodes
          .slice(0, 3)
          .map((node) => node.target.join(' '))
          .join('\n    ')}`,
      );
  } else console.log(`✓ ${story.id}`);
}
await browser.close();
server.close();
console.log(
  `${stories.length - failures.length} of ${stories.length} stories pass axe`,
);
process.exit(failures.length ? 1 : 0);
