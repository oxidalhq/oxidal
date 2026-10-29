import { setDisplayMode } from './display';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readFileSync } from 'node:fs';

// CSS viewports are representative: Android density, browser chrome and zoom vary.
// Hardware resolution is not the browser viewport. See README.md for the matrix.
async function fits(page: Page) {
  const failures = await page.evaluate(() => {
    const problems: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1)
      problems.push('Page has horizontal overflow');
    for (const element of document.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, summary, .chain-tile',
    )) {
      // WebKit can retain native select geometry inside a closed disclosure.
      // Such controls are neither rendered nor reachable until it opens.
      if (!element.checkVisibility()) continue;
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
        element.matches('.chain-tile') &&
        element.scrollWidth > element.clientWidth + 1
      )
        problems.push(`${name}: effect content overflows`);
    }
    const navigation = Array.from(
      document.querySelectorAll<HTMLElement>('.masthead nav > button'),
    );
    for (const [index, button] of navigation.entries()) {
      const rect = button.getBoundingClientRect();
      if (button.scrollWidth > button.clientWidth + 1)
        problems.push(`${button.textContent}: navigation label overflows`);
      if (rect.width < 43.5)
        problems.push(`${button.textContent}: navigation target too narrow`);
      if (
        index &&
        rect.left - navigation[index - 1]!.getBoundingClientRect().right < 7.5
      )
        problems.push('Navigation targets need visible separation');
    }
    // Visible separation is essential even when controls technically fit the viewport.
    for (const group of document.querySelectorAll('.action-row, .form-grid')) {
      const controls = Array.from(group.children)
        .map((child) => ({
          name: child.textContent?.trim().slice(0, 45),
          rect: child.getBoundingClientRect(),
        }))
        .filter(({ rect }) => rect.width && rect.height);
      for (let i = 0; i < controls.length; i++) {
        for (const other of controls.slice(i + 1)) {
          const first = controls[i]!;
          const xGap = Math.max(
            other.rect.left - first.rect.right,
            first.rect.left - other.rect.right,
          );
          const yGap = Math.max(
            other.rect.top - first.rect.bottom,
            first.rect.top - other.rect.bottom,
          );
          if ((xGap < 7.5 && yGap < 0) || (yGap < 7.5 && xGap < 0))
            problems.push(
              `${first.name} / ${other.name}: controls touch or have insufficient separation`,
            );
        }
      }
    }
    const display = document.querySelector(
      '[aria-label="Display preferences"]',
    );
    if (display) {
      const selector = display
        .querySelector('.display-mode')
        ?.getBoundingClientRect();
      const actions = display
        .querySelector('.action-row')
        ?.getBoundingClientRect();
      if (selector && actions && selector.bottom > actions.top)
        problems.push(
          'Display preference was visually reordered after screen actions',
        );
    }
    for (const dialog of document.querySelectorAll<HTMLDialogElement>(
      'dialog[open]',
    )) {
      const rect = dialog.getBoundingClientRect();
      const bottom =
        (visualViewport?.offsetTop ?? 0) +
        (visualViewport?.height ?? innerHeight);
      if (
        rect.bottom > bottom + 1 ||
        rect.height > (visualViewport?.height ?? innerHeight) + 1
      )
        problems.push(
          `Adjustment panel extends beyond visible viewport: ${JSON.stringify({ top: rect.top, bottom: rect.bottom, height: rect.height, viewportBottom: bottom, viewportHeight: visualViewport?.height, innerHeight })}`,
        );
    }
    return problems;
  });
  expect(failures).toEqual([]);
  const effects = page.locator('.chain-effects .chain-tile');
  if (await effects.count()) {
    const boxes = await effects.evaluateAll((tiles) =>
      tiles.map((tile) => {
        const { top, height } = tile.getBoundingClientRect();
        return { top, height };
      }),
    );
    for (const box of boxes) {
      expect(Math.abs(box.top - boxes[0]!.top)).toBeLessThan(1);
      expect(Math.abs(box.height - boxes[0]!.height)).toBeLessThan(1);
    }
  }
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
  await page.goto('/?development=simulator');
  await expect(
    page.getByRole('complementary', { name: 'DSP and system resources' }),
  ).toHaveAttribute('data-connected', 'true');
});

test('device portrait and landscape keep controls accessible and preserve a rotating edit', async ({
  page,
}, testInfo) => {
  test.setTimeout(180000);
  const portrait = page.viewportSize()!;
  const landscape = { width: portrait.height, height: portrait.width };
  const epaper = testInfo.project.name === 'boox-air3c';
  if (epaper) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await setDisplayMode(page, 'epaper');
    await page.getByRole('button', { name: 'Rig', exact: true }).click();
  }
  await expect(page.locator('.masthead select')).toHaveCount(0);
  await page.getByRole('button', { name: 'Parallel', exact: true }).click();
  const before = await page.getByTestId('value-nam-a.level').textContent();
  await page
    .getByRole('button', { name: 'Adjust NAM A level value', exact: true })
    .click();
  await enterValue(page, 'Draft NAM A level (%)', '45');
  await expect(page.getByTestId('value-nam-a.level')).toHaveText('45%');
  // Repeat rotation and a keyboard-sized viewport without remounting the edit.
  // A single orientation snapshot misses stale fixed widths and text enlargement.
  for (const viewport of [
    landscape,
    portrait,
    { width: landscape.width, height: Math.min(280, landscape.height) },
    landscape,
    portrait,
    landscape,
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByLabel('Draft NAM A level (%)')).toHaveValue('45');
    await fits(page);
    const navigation = page.getByRole('navigation', {
      name: 'Instrument navigation',
    });
    const positions = await navigation
      .getByRole('button')
      .evaluateAll((buttons) =>
        buttons.map((button) => ({
          top: button.getBoundingClientRect().top,
          height: button.getBoundingClientRect().height,
        })),
      );
    for (const position of positions) {
      expect(Math.abs(position.top - positions[0]!.top)).toBeLessThan(1);
      expect(Math.abs(position.height - positions[0]!.height)).toBeLessThan(1);
    }
  }
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
      for (const section of [
        'Audio',
        'Connections',
        'MIDI',
        'Display',
        'Maintenance',
      ]) {
        await page
          .getByRole('navigation', { name: 'Settings sections' })
          .getByRole('button', { name: section, exact: true })
          .click();
        await fits(page);
        await accessible(page);
        await page.screenshot({
          path: testInfo.outputPath(
            `${orientation}-${section.toLowerCase()}.png`,
          ),
          fullPage: true,
        });
        if (section === 'Maintenance') {
          await expect(
            page.getByRole('heading', { name: 'MIDI mapping', exact: true }),
          ).toHaveCount(0);
          await expect(
            page.getByRole('region', { name: 'Wi-Fi and hotspot' }),
          ).toHaveCount(0);
          await page.screenshot({
            path: `../../.local/previews/devices/${testInfo.project.name}-${orientation}-maintenance.png`,
            fullPage: true,
          });
        }
      }
      await page.getByRole('button', { name: 'Library', exact: true }).click();
      await fits(page);
      await accessible(page);
      await page.getByRole('button', { name: 'Rig', exact: true }).click();
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
    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('button', { name: 'Display', exact: true })
      .click();
    await expect(page.getByLabel('Display mode')).toHaveValue('epaper');
    await setDisplayMode(page, 'orchid');
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
    .getByRole('button', { name: 'Adjust NAM A level value', exact: true })
    .click();
  await enterValue(page, 'Draft NAM A level (%)', '37');
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
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByTestId('value-nam-a.level')).toHaveText('37%');
});

test('stage display modes persist and stay accessible in both orientations', async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  const portrait = page.viewportSize()!;
  mkdirSync('../../.local/previews/stage', { recursive: true });
  for (const mode of ['sunlight', 'stage'] as const) {
    await setDisplayMode(page, mode);
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
      for (const section of [
        'Audio',
        'Connections',
        'MIDI',
        'Display',
        'Maintenance',
      ]) {
        await page
          .getByRole('navigation', { name: 'Settings sections' })
          .getByRole('button', { name: section, exact: true })
          .click();
        await fits(page);
        await accessible(page);
        if (section === 'Maintenance') {
          await expect(
            page.getByRole('heading', { name: 'MIDI mapping', exact: true }),
          ).toHaveCount(0);
          await expect(
            page.getByRole('region', { name: 'Wi-Fi and hotspot' }),
          ).toHaveCount(0);
          await page.screenshot({
            path: `../../.local/previews/devices/${testInfo.project.name}-${orientation}-maintenance.png`,
            fullPage: true,
          });
        }
      }
      await page.getByRole('button', { name: 'Library', exact: true }).click();
      await fits(page);
      await accessible(page);
      await page.getByRole('button', { name: 'Rig', exact: true }).click();
    }
  }
});

test('touch adjustment keeps taps steady, slows fine drags and rolls back interrupted gestures', async ({
  page,
  request,
}, testInfo) => {
  await setDisplayMode(page, 'stage');
  await page
    .getByRole('button', { name: 'Adjust NAM A level value', exact: true })
    .click();
  const track = page.getByRole('slider', {
    name: 'Adjust NAM A level',
    exact: true,
  });
  const draft = page.getByLabel('Draft NAM A level (%)');
  await expect(draft).toHaveValue('50');
  await expect(
    page.getByRole('button', { name: 'Edit', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await track.scrollIntoViewIfNeeded();
  await track.click({ position: { x: 20, y: 20 } });
  await expect(draft).toHaveValue('50');
  await track.evaluate((el) =>
    el.addEventListener('pointerdown', (event) => {
      (el as HTMLElement).dataset.pointerId = String(
        (event as PointerEvent).pointerId,
      );
    }),
  );
  async function drag(interrupt?: 'pointercancel' | 'capture') {
    await track.scrollIntoViewIfNeeded();
    const box = (await track.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 20 + (box.width - 32) * 0.2, box.y + 20, {
      steps: 8,
    });
    if (interrupt === 'pointercancel')
      await track.dispatchEvent('pointercancel', {
        pointerId: Number(await track.getAttribute('data-pointer-id')),
      });
    if (interrupt === 'capture')
      await track.evaluate((el) =>
        el.releasePointerCapture(Number((el as HTMLElement).dataset.pointerId)),
      );
    await page.mouse.up();
  }
  await drag();
  await expect(draft).toHaveValue('70');
  expect(
    (await (await request.get('/api/v1/state')).json()).edit,
  ).not.toBeNull();
  await page.getByRole('button', { name: 'Restore starting value' }).click();
  await expect(draft).toHaveValue('50');
  await page.getByRole('button', { name: 'Fine', exact: true }).click();
  await drag();
  await expect(draft).toHaveValue('52');
  await page.getByRole('button', { name: 'Restore starting value' }).click();
  await drag('pointercancel');
  await expect(draft).toHaveValue('50');
  await drag('capture');
  await expect(draft).toHaveValue('50');
  await expect(page.getByTestId('value-nam-a.level')).toHaveText('50%');
  await track.focus();
  await page.keyboard.press('ArrowRight');
  await expect(draft).toHaveValue('51');
  await accessible(page);
  await fits(page);
  mkdirSync('../../.local/previews/touch', { recursive: true });
  await page.screenshot({
    path: `../../.local/previews/touch/${testInfo.project.name}.png`,
    fullPage: false,
  });
  await enterValue(page, 'Draft NAM A level (%)', '42.37');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect
    .poll(async () => {
      const state = await (await request.get('/api/v1/state')).json();
      return state.parameters.find(
        (p: { id: string }) => p.id === 'nam-a.level',
      ).value;
    })
    .toBeCloseTo(0.4237, 5);
  await page
    .getByRole('button', { name: 'Adjust NAM A level value', exact: true })
    .click();
  await page.getByRole('button', { name: 'Increase NAM A level' }).click();
  await page.getByRole('button', { name: 'Restore starting value' }).click();
  await expect(draft).toHaveValue('42.37');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});

async function enterValue(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: true });
  if (!(await input.isVisible()))
    await page
      .getByRole('dialog')
      .getByText('Enter value', { exact: true })
      .click();
  await input.fill(value);
}

test('stage display keeps screen awake across views and exposes fullscreen availability', async ({
  page,
}, testInfo) => {
  // Browser API fixture tests app ownership; real device timeout remains a physical check.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          const lock = Object.assign(new EventTarget(), {
            released: false,
            release: async () => {
              lock.released = true;
              lock.dispatchEvent(new Event('release'));
            },
          });
          return lock;
        },
      },
    });
  });
  await page.goto('/');
  const navigation = page.getByRole('navigation', {
    name: 'Instrument navigation',
  });
  const showDisplay = async () => {
    await navigation
      .getByRole('button', { name: 'Settings', exact: true })
      .click();
    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('button', { name: 'Display', exact: true })
      .click();
  };
  await showDisplay();
  if (testInfo.project.name === 'boox-air3c')
    await page.getByLabel('Display mode').selectOption('epaper');
  const wake = page.getByRole('button', {
    name: 'Keep screen awake',
    exact: true,
  });
  await wake.click();
  await expect(
    page.getByRole('status', { name: 'Screen awake status' }),
  ).toHaveText('Screen awake: active');
  await navigation.getByRole('button', { name: 'Rig', exact: true }).click();
  await showDisplay();
  await expect(wake).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('status', { name: 'Screen awake status' }),
  ).toHaveText('Screen awake: active');
  const original = page.viewportSize()!;
  await page.setViewportSize({
    width: original.height,
    height: original.width,
  });
  await fits(page);
  await page.screenshot({
    path: testInfo.outputPath('display-session-landscape.png'),
    fullPage: true,
  });
  await page.setViewportSize(original);
  await page.reload();
  await showDisplay();
  await expect(wake).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('status', { name: 'Screen awake status' }),
  ).toHaveText('Screen awake: active');
  const enter = page.getByRole('button', {
    name: 'Enter fullscreen',
    exact: true,
  });
  if (await enter.isEnabled()) {
    await enter.click();
    const exit = page.getByRole('button', {
      name: 'Exit fullscreen',
      exact: true,
    });
    await expect(exit).toBeVisible();
    await exit.click();
    await expect(enter).toBeVisible();
  } else {
    await expect(
      page.getByText('Page fullscreen is unavailable in this browser.'),
    ).toBeVisible();
  }
  await wake.click();
  await expect(
    page.getByRole('status', { name: 'Screen awake status' }),
  ).toHaveText('Screen awake: off');
  await fits(page);
  await accessible(page);
});

test('stage display navigation retains contrast after touch and hover', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(90000);
  // Touch emulation can suppress :hover. Also exercise a mouse-capable context.
  const mouseContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    hasTouch: false,
    isMobile: false,
    baseURL: new URL(page.url()).origin,
  });
  const mouse = await mouseContext.newPage();
  try {
    await mouse.goto('/?development=simulator');
    for (const target of [page, mouse]) {
      const pointer = target === page ? 'touch' : 'mouse';
      const navigation = target.getByRole('navigation', {
        name: 'Instrument navigation',
      });
      for (const mode of ['orchid', 'stage', 'sunlight', 'epaper'] as const) {
        await setDisplayMode(target, mode);
        await navigation
          .getByRole('button', { name: 'Rig', exact: true })
          .click();
        for (const label of ['Rig', 'Library']) {
          await navigation
            .getByRole('button', { name: label, exact: true })
            .hover();
          const result = await new AxeBuilder({ page: target })
            .include('.masthead')
            .withRules(['color-contrast'])
            .analyze();
          await navigation.screenshot({
            path: testInfo.outputPath(
              `navigation-${pointer}-${mode}-${label}.png`,
            ),
          });
          expect(result.violations, `${pointer} ${mode}: ${label}`).toEqual([]);
        }
      }
    }
  } finally {
    await mouseContext.close();
  }
});

test('device portrait and landscape: hotspot welcome uses Oxidal branding and fits', async ({
  page,
}, info) => {
  // Render shipped static bytes; the OS suite separately proves nginx/DNS routing.
  const html = readFileSync('../../os/config/oxidal-welcome.html', 'utf8');
  const logo = readFileSync('public/brand/wordmark.svg');
  await page.route('**/hotspot-welcome', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.route('**/wordmark.svg', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: logo }),
  );
  if (info.project.name === 'boox-air3c')
    await page.emulateMedia({ contrast: 'more', reducedMotion: 'reduce' });
  await page.goto('/hotspot-welcome');
  await expect(
    page.getByRole('img', { name: 'Oxidal', exact: true }),
  ).toBeVisible();
  const open = page.getByRole('link', { name: 'Open Oxidal' });
  await expect(open).toHaveAttribute('href', 'https://10.42.0.1/');
  const original = page.viewportSize()!;
  mkdirSync('../../.local/previews/portal', { recursive: true });
  for (const [name, viewport] of [
    ['portrait', original],
    ['landscape', { width: original.height, height: original.width }],
  ] as const) {
    await page.setViewportSize(viewport);
    await fits(page);
    await expect(open).toBeInViewport();
    const target = await open.boundingBox();
    expect(target!.height).toBeGreaterThanOrEqual(56);
    await expect(
      page.getByRole('link', { name: 'oxidal.local', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `../../.local/previews/portal/${info.project.name}-${name}.png`,
      fullPage: true,
    });
  }
  await page.getByText('Page not opening?', { exact: true }).click();
  await expect(
    page.getByText('This prototype uses a self-signed certificate', {
      exact: false,
    }),
  ).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});
