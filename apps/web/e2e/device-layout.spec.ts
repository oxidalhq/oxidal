import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';

// CSS viewports are representative: Android density, browser chrome and zoom vary.
// Hardware resolution is not the browser viewport. See README.md for the matrix.
async function fits(page: Page) {
  const failures = await page.evaluate(() => {
    const problems: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1)
      problems.push('Page has horizontal overflow');
    for (const element of document.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, summary, .block',
    )) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const name =
        element.getAttribute('aria-label') ||
        element.textContent ||
        element.tagName;
      if (rect.left < -1 || rect.right > window.innerWidth + 1)
        problems.push(`${name}: clipped horizontally`);
      if (
        element.matches(
          'button, select, input:not([type="checkbox"]), summary',
        ) &&
        rect.height < 43.5
      )
        problems.push(`${name}: touch target shorter than 44px`);
      if (
        element.matches('.block') &&
        element.scrollWidth > element.clientWidth + 1
      )
        problems.push(`${name}: effect content overflows`);
    }
    return problems;
  });
  expect(failures).toEqual([]);
}

async function accessible(page: Page) {
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
}

test.beforeEach(async ({ page, request }, testInfo) => {
  test.skip(
    testInfo.title.startsWith('folding') &&
      testInfo.project.name !== 'fold4-cover',
    'Fold transition is covered once on the cover profile',
  );
  let state = await (await request.get('/api/v1/state')).json();
  for (const [target, value] of [
    ['rig.preset', 0],
    ['rig.bypass', 0],
  ] as const) {
    const response = await request.post('/api/v1/commands', {
      data: {
        protocol: 1,
        session: state.session,
        request_id: crypto.randomUUID(),
        expected_revision: state.revision,
        action: { type: 'set', target, value },
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    state = await response.json();
  }
  await page.goto('/');
  await expect(page.getByText('Device connected')).toBeVisible();
});

test('device portrait and landscape keep controls accessible and preserve a rotating edit', async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  const portrait = page.viewportSize()!;
  const landscape = { width: portrait.height, height: portrait.width };
  const epaper = testInfo.project.name === 'boox-air3c';
  if (epaper) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Display mode').selectOption('epaper');
    await page
      .getByRole('button', { name: 'Back to rig', exact: true })
      .click();
  }
  await page.getByRole('button', { name: 'Parallel', exact: true }).click();
  const before = await page.getByTestId('value-nam-a.level').textContent();
  await page
    .getByRole('button', { name: 'Edit NAM A level', exact: true })
    .click();
  await page.getByLabel('Draft NAM A level (%)').fill('45');
  await expect(page.getByTestId('value-nam-a.level')).toHaveText('45%');
  await page.setViewportSize(landscape);
  await expect(page.getByLabel('Draft NAM A level (%)')).toHaveValue('45');
  await fits(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('value-nam-a.level')).toHaveText(before!);
  mkdirSync('../../.local/previews/devices', { recursive: true });
  for (const [orientation, viewport] of [
    ['portrait', portrait],
    ['landscape', landscape],
  ] as const) {
    await page.setViewportSize(viewport);
    if (testInfo.project.name === 'iphone-xr') {
      // Synthetic safe-area stress: desktop WebKit cannot reproduce a real notch.
      await page.evaluate((landscape) => {
        for (const edge of ['left', 'right'])
          document.documentElement.style.setProperty(
            `--safe-${edge}`,
            landscape ? '44px' : '0px',
          );
      }, orientation === 'landscape');
    }
    await test.step(`${orientation}: rig, settings and library`, async () => {
      await fits(page);
      await accessible(page);
      await page.screenshot({
        path: `../../.local/previews/devices/${testInfo.project.name}-${orientation}.png`,
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await fits(page);
      await accessible(page);
      await page.getByRole('button', { name: 'Library', exact: true }).click();
      await fits(page);
      await accessible(page);
      await page
        .getByRole('button', { name: 'Back to rig', exact: true })
        .click();
    });
  }
  if (epaper) {
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute(
      'data-display',
      'epaper',
    );
    await expect(page.locator('.chain-panel')).toHaveCSS('box-shadow', 'none');
    await expect(
      page.getByRole('button', { name: 'Parallel', exact: true }),
    ).toHaveCSS('transition-duration', '0s');
    await page.setViewportSize({ width: 768, height: 1024 });
    await fits(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByLabel('Display mode')).toHaveValue('epaper');
    await page.getByLabel('Display mode').selectOption('orchid');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute(
      'data-display',
      'orchid',
    );
    await page.getByRole('button', { name: 'Parallel', exact: true }).waitFor();
  }
});

test('folding and unfolding preserves the active draft without reloading', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'fold4-cover',
    'Fold transition is covered once on the cover profile',
  );
  await page
    .getByRole('button', { name: 'Edit NAM A level', exact: true })
    .click();
  await page.getByLabel('Draft NAM A level (%)').fill('37');
  await expect(page.getByTestId('value-nam-a.level')).toHaveText('37%');
  for (const viewport of [
    { width: 690, height: 829 },
    { width: 829, height: 690 },
    { width: 345, height: 883 },
    { width: 345, height: 430 }, // Reduced visual height while typing.
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByLabel('Draft NAM A level (%)')).toHaveValue('37');
    await fits(page);
  }
  await page.getByRole('button', { name: 'Commit', exact: true }).click();
  await expect(page.getByTestId('value-nam-a.level')).toHaveText('37%');
});

test('stage display modes persist and stay accessible in both orientations', async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  const portrait = page.viewportSize()!;
  mkdirSync('../../.local/previews/stage', { recursive: true });
  for (const mode of ['sunlight', 'stage']) {
    await page.getByLabel('Display mode').selectOption(mode);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-display', mode);
    for (const [orientation, viewport] of [
      ['portrait', portrait],
      ['landscape', { width: portrait.height, height: portrait.width }],
    ] as const) {
      await page.setViewportSize(viewport);
      await fits(page);
      await accessible(page);
      expect(
        await page
          .getByRole('button', { name: 'Bypass off' })
          .evaluate((el) => el.getBoundingClientRect().height),
      ).toBeGreaterThanOrEqual(48);
      await page.screenshot({
        path: `../../.local/previews/stage/${testInfo.project.name}-${mode}-${orientation}.png`,
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await fits(page);
      await accessible(page);
      await page.getByRole('button', { name: 'Library', exact: true }).click();
      await fits(page);
      await accessible(page);
      await page
        .getByRole('button', { name: 'Back to rig', exact: true })
        .click();
    }
  }
});
