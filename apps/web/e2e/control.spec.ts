import { setDisplayMode } from './display';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';

test.beforeEach(async ({ request }) => {
  let state = (await (await request.get('/api/v1/state')).json()) as {
    session: string;
    revision: number;
  };
  const actions = [
    {
      type: 'mappings',
      file: {
        version: 1,
        mappings: [
          {
            id: 'knob-1',
            device: 'simulator',
            channel: 1,
            cc: 21,
            target: 'nam-a.level',
            mode: 'absolute',
            pickup: false,
            feedback: true,
            min: 0,
            max: 1,
            curve: 'linear',
          },
        ],
      },
    },
    { type: 'set', target: 'rig.preset', value: 0 },
    { type: 'set', target: 'rig.bypass', value: 0 },
  ];
  for (const action of actions) {
    const result = await request.post('/api/v1/commands', {
      data: {
        protocol: 1,
        session: state.session,
        request_id: crypto.randomUUID(),
        expected_revision: state.revision,
        action,
      },
    });
    expect(result.ok()).toBe(true);
    state = (await result.json()) as typeof state;
  }
});

test('parallel rig validation and MIDI/web state converge across browsers', async ({
  page,
  context,
}) => {
  await page.goto('/?development=simulator');
  await expect(
    page.getByRole('complementary', { name: 'DSP and system resources' }),
  ).toHaveAttribute('data-connected', 'true');
  await expect(
    page.getByText('Development simulator · no audio.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Serial rig' })).toBeVisible();
  await expect(page.getByRole('complementary')).toHaveCount(1);
  await expect(
    page.getByRole('complementary', { name: 'DSP and system resources' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Parallel', exact: true }).click();
  await expect(page.getByTestId('block-nam-b')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Custom routing' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('tablist', { name: 'Settings sections' })
    .getByRole('tab', { name: 'Maintenance', exact: true })
    .click();
  await page.getByText('Rig validation inspector').click();
  await page.getByRole('button', { name: 'Validate rig', exact: true }).click();
  await expect(page.getByText('Rig is valid', { exact: true })).toBeVisible();
  await page
    .getByLabel('Rig JSON')
    .fill(JSON.stringify({ nodes: [], edges: [] }));
  await page.getByRole('button', { name: 'Validate rig', exact: true }).click();
  await expect(
    page.getByText('A rig needs 1–64 nodes and at most 128 edges'),
  ).toBeVisible();
  const second = await context.newPage();
  await second.goto('/?development=simulator');
  await expect(
    second.getByRole('complementary', { name: 'DSP and system resources' }),
  ).toHaveAttribute('data-connected', 'true');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('tablist', { name: 'Settings sections' })
    .getByRole('tab', { name: 'MIDI', exact: true })
    .click();
  await page.getByLabel('MIDI value', { exact: true }).fill('127');
  await page.getByRole('button', { name: 'Send MIDI CC' }).click();
  await expect(second.getByTestId('value-nam-a.level')).toHaveText('100%');
  await expect(second.getByTestId('last-origin')).toHaveText('midi');
  await second
    .getByRole('button', { name: 'Adjust NAM A level value' })
    .click();
  await enterValue(second, 'Draft NAM A level (%)', '25');
  await second.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByTestId('feedback-value')).toHaveText('32');
  await second.reload();
  await expect(second.getByTestId('value-nam-a.level')).toHaveText('25%');
  const live = (await (await page.request.get('/api/v1/state')).json()) as {
    session: string;
  };
  const stale = await page.request.post('/api/v1/commands', {
    data: {
      protocol: 1,
      session: live.session,
      request_id: 'stale',
      expected_revision: 0,
      action: { type: 'set', target: 'nam-a.level', value: 0.1 },
    },
  });
  expect(stale.status()).toBe(409);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('three tabs retain API capacity with one event stream per tab', async ({
  page,
  context,
}) => {
  const second = await context.newPage();
  const third = await context.newPage();
  const pages = [page, second, third];
  const monitorStreams = pages.map(() => 0);
  pages.forEach((candidate, index) => {
    candidate.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/v1/monitor/events')
        monitorStreams[index]! += 1;
    });
  });

  await Promise.all(pages.map((candidate) => candidate.goto('/')));
  for (const candidate of pages)
    await expect(
      candidate.getByRole('complementary', {
        name: 'DSP and system resources',
      }),
    ).toHaveAttribute('data-connected', 'true');

  const capabilities = await Promise.all(
    pages.map((candidate) =>
      candidate.evaluate(async () => {
        const response = await fetch('/api/v1/health');
        return { ok: response.ok, body: await response.json() };
      }),
    ),
  );
  expect(capabilities.every((result) => result.ok)).toBe(true);
  expect(capabilities.every((result) => result.body.protocol === 1)).toBe(true);
  expect(monitorStreams).toEqual([0, 0, 0]);

  await third.close();
  await expect(
    page.getByRole('complementary', { name: 'DSP and system resources' }),
  ).toHaveAttribute('data-connected', 'true');
});

test('MIDI continues with browsers closed; simulator feedback cannot loop into input', async ({
  page,
  request,
}) => {
  await page.goto('/?development=simulator');
  await expect(
    page.getByRole('complementary', { name: 'DSP and system resources' }),
  ).toHaveAttribute('data-connected', 'true');
  await page.close();
  const live = (await (await request.get('/api/v1/state')).json()) as {
    session: string;
  };
  const command = {
    session: live.session,
    protocol: 1,
    request_id: 'headless-midi',
    expected_revision: null,
    action: {
      type: 'midi',
      input: { device: 'simulator', channel: 1, cc: 21, value: 0 },
    },
  };
  const response = await request.post('/api/v1/commands', { data: command });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    parameters: { value: number }[];
    feedback: { device: string }[];
  };
  expect(body.parameters[0]?.value).toBe(0);
  command.action.input.device = body.feedback[0]?.device ?? '';
  expect(
    (await request.post('/api/v1/commands', { data: command })).status(),
  ).toBe(422);
});

test('disconnect disables edits and reconnect restores the authoritative snapshot', async ({
  page,
  context,
}) => {
  await page.goto('/?development=simulator');
  await expect(
    page.getByRole('complementary', { name: 'DSP and system resources' }),
  ).toHaveAttribute('data-connected', 'true');
  const namLevel = page.getByRole('button', {
    name: 'Adjust NAM A level value',
  });
  await expect(namLevel).toBeEnabled();
  await context.setOffline(true);
  await expect(
    page.getByText('Connection lost · reconnecting', { exact: true }),
  ).toBeVisible();
  await expect(namLevel).toBeDisabled();
  await context.setOffline(false);
  await expect(
    page.getByRole('complementary', { name: 'DSP and system resources' }),
  ).toHaveAttribute('data-connected', 'true');
  await expect(namLevel).toBeEnabled();
});

test('quiet interface has no detected WCAG AA violations', async ({
  page,
}, testInfo) => {
  await page.goto('/?development=simulator');
  await expect(
    page.getByRole('complementary', { name: 'DSP and system resources' }),
  ).toHaveAttribute('data-connected', 'true');
  await page.getByRole('button', { name: 'Parallel', exact: true }).click();
  await expect(page.getByTestId('block-nam-b')).toBeVisible();
  const delay = await page.getByTestId('block-delay').boundingBox();
  const reverb = await page.getByTestId('block-reverb').boundingBox();
  expect(delay && reverb && delay.x < reverb.x).toBe(true);
  expect(Math.abs((delay?.y ?? 0) - (reverb?.y ?? 0))).toBeLessThan(2);
  await page.getByRole('button', { name: 'Bypass off', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(
    page.getByRole('button', { name: 'Bypass on', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(
    page.getByRole('button', { name: 'Bypass off', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
  mkdirSync('../../.local/previews', { recursive: true });
  await page.screenshot({
    path: `../../.local/previews/${testInfo.project.name}-rig.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(settings.violations).toEqual([]);
  await page.screenshot({
    path: `../../.local/previews/${testInfo.project.name}-settings.png`,
    fullPage: true,
  });
});

test('guitar profiles explain automatic Levels use and guard removal', async ({
  page,
  request,
}, testInfo) => {
  const configured = await request.post('/api/v1/guitars', {
    data: {
      guitars: [
        {
          id: 'jiva',
          name: 'Ibanez Jiva',
          trim_db: 0,
          peak_dbfs: -8,
          noise_dbfs: -68,
          gate: true,
        },
        {
          id: 'steinberger',
          name: 'Steinberger',
          trim_db: 6,
          peak_dbfs: -14,
          noise_dbfs: -70,
          gate: true,
        },
      ],
      reference: 'jiva',
      active: 'steinberger',
    },
  });
  expect(configured.ok()).toBe(true);

  await page.goto('/?development=simulator');
  await page.getByRole('button', { name: 'Guitars', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your guitars', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Levels follows the selected profile automatically/),
  ).toBeVisible();
  await expect(
    page.locator('.ui-badge').filter({ hasText: /^Playing$/ }),
  ).toBeVisible();
  await expect(
    page.getByText('Level reference', { exact: true }),
  ).toBeVisible();

  await expect(
    page.getByRole('button', { name: 'Use guitar', exact: true }),
  ).toHaveCount(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('guitar-profiles-narrow.png'),
    fullPage: true,
  });

  await page
    .getByRole('button', { name: 'Manage Steinberger', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Remove profile…', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText(
    'The next guitar will become the selected profile.',
  );
  await page.getByRole('button', { name: 'Remove guitar' }).click();
  await expect
    .poll(async () => {
      const profiles = await (await request.get('/api/v1/guitars')).json();
      return [
        profiles.guitars.map((g: { id: string }) => g.id),
        profiles.active,
      ];
    })
    .toEqual([['jiva'], 'jiva']);
});

test('about opens from settings and returns to the sections', async ({
  page,
}) => {
  await page.goto('/?development=simulator');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const tabs = page.getByRole('tablist', { name: 'Settings sections' });
  // About is a normal Settings destination, not a header toggle (7.18).
  await expect(
    page.getByRole('button', { name: 'About', exact: true }),
  ).toHaveCount(0);
  await tabs.getByRole('tab', { name: 'About', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'About', level: 1, exact: true }),
  ).toBeVisible();
  await expect(page.getByText('This device')).toBeVisible();
  await tabs.getByRole('tab', { name: 'Audio', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Audio', level: 1, exact: true }),
  ).toBeVisible();
});

test('settings navigation stays coherent across narrow and rotated layouts', async ({
  page,
}, testInfo) => {
  await page.goto('/?development=simulator');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const tabs = page.getByRole('tablist', { name: 'Settings sections' });
  const sections = [
    ['Audio', 'Audio'],
    ['Network', 'Network'],
    ['Accounts', 'Accounts'],
    ['MIDI', 'MIDI'],
    ['Effects', 'Effects'],
    ['Display', 'Display'],
    ['Device', 'Device'],
    ['Maintenance', 'Maintenance'],
    ['About', 'About'],
  ] as const;

  for (const size of [
    { width: 390, height: 844 },
    { width: 690, height: 700 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    expect(
      await tabs.getByRole('tab').evaluateAll((items) => {
        const rows = new Map<number, number>();
        for (const item of items) {
          const top = Math.round(item.getBoundingClientRect().top);
          rows.set(top, (rows.get(top) ?? 0) + 1);
        }
        return [...rows.values()];
      }),
      `balanced settings rows at ${size.width}px`,
    ).toEqual(size.width <= 900 ? [3, 3, 3] : [9]);
    for (const [tab, heading] of sections) {
      await tabs.getByRole('tab', { name: tab, exact: true }).click();
      await expect(
        tabs.getByRole('tab', { name: tab, exact: true }),
      ).toHaveAttribute('data-state', 'active');
      await expect(
        page.getByRole('heading', { name: heading, level: 1, exact: true }),
      ).toBeVisible();
      const overflow = await page.evaluate(() =>
        [...document.body.querySelectorAll<HTMLElement>('*')]
          .filter((element) => {
            const box = element.getBoundingClientRect();
            return box.right > innerWidth + 1 || box.left < -1;
          })
          .slice(0, 8)
          .map((element) => ({
            tag: element.tagName,
            className: element.className,
            text: element.innerText?.slice(0, 60),
            right: Math.round(element.getBoundingClientRect().right),
          })),
      );
      expect(overflow, `${tab} at ${size.width}×${size.height}`).toEqual([]);
    }
    await page.screenshot({
      path: testInfo.outputPath(`settings-navigation-${size.width}.png`),
      fullPage: true,
    });
  }

  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test('shared surfaces retain their theme and width contracts', async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await page.goto('/?development=simulator');
  const navigation = page.getByRole('navigation', {
    name: 'Instrument navigation',
  });
  const modes = ['default', 'stage', 'sunlight', 'epaper'] as const;
  const views = ['Rig', 'Guitars', 'Library', 'Levels', 'Settings'] as const;
  const sizes = [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ];

  for (const mode of modes) {
    await setDisplayMode(page, mode);
    await expect(page.locator('html')).toHaveAttribute('data-display', mode);
    for (const size of sizes) {
      await page.setViewportSize(size);
      for (const view of views) {
        await navigation
          .getByRole('button', { name: view, exact: true })
          .click();
        await expect(
          navigation.getByRole('button', { name: view, exact: true }),
        ).toHaveAttribute('aria-current', 'page');
        const overflow = await page.evaluate(() =>
          [...document.body.querySelectorAll<HTMLElement>('*')]
            .filter((element) => {
              if (!element.checkVisibility()) return false;
              const box = element.getBoundingClientRect();
              return box.right > innerWidth + 1 || box.left < -1;
            })
            .slice(0, 8)
            .map((element) => ({
              tag: element.tagName,
              className: element.className,
              text: element.innerText?.slice(0, 60),
              left: Math.round(element.getBoundingClientRect().left),
              right: Math.round(element.getBoundingClientRect().right),
            })),
        );
        expect(
          overflow,
          `${mode} ${view} at ${size.width}×${size.height}`,
        ).toEqual([]);
        if (size.width === 390) {
          expect(
            (
              await new AxeBuilder({ page })
                .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
                .analyze()
            ).violations,
            `${mode} ${view}`,
          ).toEqual([]);
        }
      }
      await page.screenshot({
        path: testInfo.outputPath(`shared-${mode}-${size.width}.png`),
        fullPage: true,
      });
    }
  }
});

test('MIDI learn persists a bypass mapping and preset controls reflect both ways', async ({
  page,
  request,
}) => {
  await page.goto('/?development=simulator');
  await expect(
    page.getByRole('complementary', { name: 'DSP and system resources' }),
  ).toHaveAttribute('data-connected', 'true');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('tablist', { name: 'Settings sections' })
    .getByRole('tab', { name: 'MIDI', exact: true })
    .click();
  await page.setViewportSize({ width: 1280, height: 720 });
  const midiPanel = await page
    .getByRole('heading', { name: 'MIDI mapping', exact: true })
    .locator('..')
    .boundingBox();
  const pickupSwitch = await page
    .getByRole('switch', { name: 'Pickup / soft takeover' })
    .boundingBox();
  const feedbackSwitch = await page
    .getByRole('switch', { name: 'Send controller feedback' })
    .boundingBox();
  expect(midiPanel).not.toBeNull();
  expect(pickupSwitch).not.toBeNull();
  expect(feedbackSwitch).not.toBeNull();
  expect(pickupSwitch!.x + pickupSwitch!.width - midiPanel!.x).toBeLessThan(
    620,
  );
  expect(
    Math.abs(
      pickupSwitch!.x +
        pickupSwitch!.width -
        (feedbackSwitch!.x + feedbackSwitch!.width),
    ),
  ).toBeLessThan(2);
  await page.getByLabel('Target', { exact: true }).click();
  await page.getByRole('option', { name: 'Rig bypass', exact: true }).click();
  await page.getByRole('button', { name: 'Learn next MIDI message' }).click();
  await page.getByLabel('CC number', { exact: true }).fill('99');
  await page.getByLabel('MIDI value', { exact: true }).fill('127');
  await page.getByRole('button', { name: 'Send MIDI CC' }).click();
  await expect(
    page.getByText('Last input: CH 1 / CC 99 (unmapped)', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save mapping' }).click();
  await expect(
    page.getByText(/Current mapping: CC 99 → rig.bypass/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Send MIDI CC' }).click();
  await page.getByRole('button', { name: 'Rig', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Bypass on', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Bypass on', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Bypass off', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await page.getByLabel('Example preset', { exact: true }).click();
  await page.getByRole('option', { name: 'Parallel', exact: true }).click();
  await expect(page.getByTestId('block-nam-b')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Parallel rig' }),
  ).toBeVisible();
  const state = (await (await request.get('/api/v1/state')).json()) as {
    preset: string;
    feedback: { value: number }[];
  };
  expect(state.preset).toBe('parallel');
  expect(state.feedback[0]?.value).toBe(0);
  await page.reload();
  await expect(
    page.getByRole('complementary', { name: 'DSP and system resources' }),
  ).toHaveAttribute('data-connected', 'true');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('tablist', { name: 'Settings sections' })
    .getByRole('tab', { name: 'MIDI', exact: true })
    .click();
  await expect(page.getByLabel('CC number', { exact: true })).toHaveValue('99');
  await expect(page.getByLabel('Target', { exact: true })).toHaveText(
    'Rig bypass',
  );
});

test('owned previews cancel, commit exactly, and preserve independent client changes', async ({
  page,
  context,
  request,
}) => {
  await page.goto('/?development=simulator');
  const second = await context.newPage();
  await second.goto('/?development=simulator');
  await page
    .getByRole('button', { name: 'Adjust NAM A level value', exact: true })
    .click();
  await expect(
    page.getByRole('group', { name: 'Preview NAM A level' }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await enterValue(page, 'Draft NAM A level (%)', '81');
  await expect(second.getByTestId('value-nam-a.level')).toHaveText('81%');
  await expect(
    second.getByRole('button', { name: 'Adjust NAM A level value' }),
  ).toBeDisabled();
  await expect(
    second.getByRole('button', { name: 'Adjust Delay mix value' }),
  ).toBeDisabled();
  const independent = await (await request.get('/api/v1/state')).json();
  const change = await request.post('/api/v1/commands', {
    data: {
      protocol: 1,
      session: independent.session,
      request_id: crypto.randomUUID(),
      expected_revision: null,
      action: { type: 'set', target: 'delay.mix', value: 0.62 },
    },
  });
  expect(change.ok()).toBe(true);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(second.getByTestId('value-nam-a.level')).toHaveText('50%');
  await expect(second.getByTestId('value-delay.mix')).toHaveText('62%');
  await page
    .getByRole('button', { name: 'Adjust NAM A level value', exact: true })
    .click();
  await enterValue(page, 'Draft NAM A level (%)', '73');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(
    page.getByRole('group', { name: 'Preview NAM A level' }),
  ).toHaveCount(0);
  await expect(second.getByTestId('value-nam-a.level')).toHaveText('73%');
  await page.reload();
  await expect(page.getByTestId('value-nam-a.level')).toHaveText('73%');
  // Dismissal cancels after any in-flight preview, rather than leaving its value behind.
  await page
    .getByRole('button', { name: 'Adjust NAM A level value', exact: true })
    .click();
  let losePreviewReply = true;
  await page.route('**/api/v1/commands', async (route) => {
    const action = route.request().postDataJSON()?.action;
    if (
      losePreviewReply &&
      action?.type === 'edit' &&
      action.edit.phase === 'preview'
    ) {
      losePreviewReply = false;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await enterValue(page, 'Draft NAM A level (%)', '90');
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await expect(second.getByTestId('value-nam-a.level')).toHaveText('90%');
  await page.keyboard.press('Escape');
  await page.unroute('**/api/v1/commands');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(second.getByTestId('value-nam-a.level')).toHaveText('73%');
  const state = (await (await request.get('/api/v1/state')).json()) as {
    edit: unknown;
  };
  expect(state.edit).toBeNull();
});

test('an abandoned browser preview rolls back; reconnect retains draft without replay', async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(50000);
  await page.goto('/?development=simulator');
  await page
    .getByRole('button', { name: 'Adjust NAM A level value', exact: true })
    .click();
  await enterValue(page, 'Draft NAM A level (%)', '91');
  await expect(page.getByTestId('value-nam-a.level')).toHaveText('91%');
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(
    page.getByRole('button', { name: 'Done', exact: true }),
  ).toBeDisabled();
  await expect
    .poll(
      async () => {
        const state = (await (await request.get('/api/v1/state')).json()) as {
          edit: unknown;
          parameters: { value: number }[];
        };
        return state.edit === null && state.parameters[0]?.value === 0.5;
      },
      { timeout: 35000, intervals: [500, 1000] },
    )
    .toBe(true);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('value-nam-a.level')).toHaveText('50%', {
    timeout: 15000,
  });
  await expect(
    page.getByLabel('Draft NAM A level (%)', { exact: true }),
  ).toHaveValue('91');
  await expect(
    page.getByRole('button', { name: 'Done', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Adjust NAM A level value', exact: true }),
  ).toBeEnabled();
});

test('audio inspection keeps the authoring service connected', async ({
  page,
  request,
}) => {
  await page.goto('/?development=simulator');
  await expect(
    page.getByRole('complementary', { name: 'DSP and system resources' }),
  ).toHaveAttribute('data-connected', 'true');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Audio devices' });
  const setup = panel.getByRole('region', { name: 'Audio interface setup' });
  await expect(
    setup.getByRole('heading', { name: 'Audio interface setup' }),
  ).toBeVisible();
  await expect(
    setup.getByRole('button', { name: 'Refresh audio devices' }),
  ).toBeEnabled();
  await expect(setup.getByRole('status')).not.toBeEmpty();
  await expect(setup.getByRole('status')).not.toHaveText('Inspecting audio…');
  const health = await (await request.get('/api/v1/health')).json();
  expect(health.audio_available).toBe(false);
  await expect(
    page.getByRole('complementary', { name: 'DSP and system resources' }),
  ).toHaveAttribute('data-connected', 'true');
  await page.getByRole('button', { name: 'Rig', exact: true }).click();
  await expect(
    page.getByText('Development simulator · no audio.', { exact: true }),
  ).toBeVisible();
});

test('effect focus keeps quick controls reachable without changing the rig', async ({
  page,
  request,
}, testInfo) => {
  await page.goto('/?development=simulator');
  await expect(
    page.getByRole('complementary', { name: 'DSP and system resources' }),
  ).toHaveAttribute('data-connected', 'true');
  const before = await (await request.get('/api/v1/state')).json();
  const delay = page.getByRole('button', { name: 'Focus Delay controls' });
  await delay.click();
  await expect(delay).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('heading', { name: 'Delay / selected' }),
  ).toBeVisible();
  await expect(page.locator('[id="control-delay.mix"]')).toHaveAttribute(
    'data-selected',
    'true',
  );
  const after = await (await request.get('/api/v1/state')).json();
  expect(after.revision).toBe(before.revision);
  expect(after.parameters).toEqual(before.parameters);
  await page
    .getByRole('button', { name: 'Adjust Delay mix value', exact: true })
    .click();
  await enterValue(page, 'Draft Delay mix (%)', '38');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Draft Delay mix (%)')).toHaveValue('38');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('value-delay.mix')).toHaveText('25%');
  await page.getByRole('button', { name: 'Focus Reverb controls' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Reverb / selected' }),
  ).toBeVisible();
  mkdirSync('../../.local/previews/instrument', { recursive: true });
  for (const mode of ['default', 'stage'] as const) {
    await setDisplayMode(page, mode);
    await page.screenshot({
      path: `../../.local/previews/instrument/${testInfo.project.name}-${mode}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.getByRole('button', { name: 'Audio setup', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Audio', level: 1, exact: true }),
  ).toBeVisible();
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

test('audio setup recovers a late USB interface without losing its draft', async ({
  page,
}) => {
  let connected = false;
  await page.route('**/api/v1/audio/devices', (route) =>
    route.fulfill({
      json: {
        backend_available: true,
        streaming_available: true,
        warnings: [],
        endpoints: connected
          ? [
              {
                id: 'hw:CARD=Jogg,DEV=0',
                name: 'Jogg USB Audio',
                direction: 'capture',
              },
              {
                id: 'hw:CARD=Jogg,DEV=0',
                name: 'Jogg USB Audio',
                direction: 'playback',
              },
              {
                id: 'hw:CARD=HDMI,DEV=0',
                name: 'HDMI',
                direction: 'playback',
              },
            ]
          : [
              {
                id: 'hw:CARD=HDMI,DEV=0',
                name: 'HDMI',
                direction: 'playback',
              },
            ],
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const setup = page.getByRole('region', { name: 'Audio interface setup' });
  await expect(setup.getByLabel('Input', { exact: true })).toBeDisabled();
  await expect(setup).toContainText('playback-only devices');
  await setup.getByLabel('Sample rate (Hz)').fill('44100');
  await setup.getByLabel('Buffer size (samples per period)').fill('256');

  connected = true;
  await setup.getByRole('button', { name: 'Refresh audio devices' }).click();

  await expect(setup.getByLabel('Input', { exact: true })).toHaveText(
    'Jogg USB Audio · hw:CARD=Jogg,DEV=0',
  );
  await expect(setup.getByLabel('Output', { exact: true })).toHaveText(
    'Jogg USB Audio · hw:CARD=Jogg,DEV=0',
  );
  await expect(setup.getByLabel('Sample rate (Hz)')).toHaveValue('44100');
  await expect(
    setup.getByLabel('Buffer size (samples per period)'),
  ).toHaveValue('256');
  await expect(
    setup.getByRole('button', { name: 'Check input and output' }),
  ).toBeEnabled();
});

test('audio configuration exposes buffers and discards changed or failed checks', async ({
  page,
}) => {
  const probe = {
    endpoint: 'hw:USB,0',
    direction: 'capture',
    sample_rate: 48000,
    channels: 2,
    format: 's16',
    period_frames: 128,
    periods: 3,
  };
  await page.route('**/api/v1/audio/devices', (route) =>
    route.fulfill({
      json: {
        backend_available: true,
        streaming_available: false,
        warnings: [],
        endpoints: ['capture', 'playback'].map((direction) => ({
          id: probe.endpoint,
          name: 'Test interface',
          direction,
        })),
      },
    }),
  );
  let fail = false;
  await page.route('**/api/v1/audio/probe', (route) =>
    fail
      ? route.fulfill({
          status: 409,
          json: { error: 'Unsupported configuration' },
        })
      : route.fulfill({
          json: {
            configuration: route.request().postDataJSON(),
            buffer_frames: 384,
            streaming_available: false,
          },
        }),
  );
  await page.route('**/api/v1/audio', (route) =>
    route.fulfill({
      json: {
        session: 'fixture',
        revision: 1,
        phase: 'stopped',
        configured: null,
        error: null,
        device_owned: false,
        experimental: true,
        start_on_boot: false,
        controls: [],
        modified: false,
        preset_name: null,
        saved_copy: null,
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Audio devices' });
  const setup = panel.getByRole('region', { name: 'Audio interface setup' });
  await expect(
    setup.getByRole('heading', { name: 'Audio interface setup' }),
  ).toBeVisible();
  await expect(
    setup.getByRole('combobox', { name: 'Input', exact: true }),
  ).toHaveText('Test interface · hw:USB,0');
  await expect(
    setup.getByRole('combobox', { name: 'Output', exact: true }),
  ).toHaveText('Test interface · hw:USB,0');
  await expect(panel.getByLabel('Sample rate (Hz)')).toHaveValue('48000');
  await expect(panel.getByLabel('Input channels')).toHaveValue('1');
  await expect(panel.getByLabel('Output channels')).toHaveValue('2');
  await expect(
    panel.getByLabel('Buffer size (samples per period)'),
  ).toHaveValue('128');
  await expect(panel.getByLabel('Buffer periods')).toHaveValue('3');
  await panel.getByRole('button', { name: 'Check input and output' }).click();
  const checked = panel.getByLabel('Checked audio configuration');
  await expect(checked).toContainText('128 samples × 3 = 8.0 ms');
  await expect(checked).not.toContainText('Not checked');
  await expect(panel.getByLabel('Input left channel (1-based)')).toHaveValue(
    '1',
  );
  await expect(panel.getByLabel('Input right channel (1-based)')).toHaveValue(
    '1',
  );
  await expect(panel.getByLabel('Output left channel (1-based)')).toHaveValue(
    '1',
  );
  await expect(panel.getByLabel('Output right channel (1-based)')).toHaveValue(
    '2',
  );
  await expect(
    panel.getByRole('button', { name: 'Start automatically on future boots' }),
  ).toHaveCount(0);
  await panel.getByLabel('Buffer size (samples per period)').fill('256');
  await expect(checked).toContainText('Input: Not checked');
  await expect(checked).toContainText('Output: Not checked');
  fail = true;
  await panel.getByRole('button', { name: 'Check input and output' }).click();
  await expect(setup.getByRole('status')).toContainText(
    'Unsupported configuration',
  );
  await expect(checked).toContainText('Input: Not checked');
  await expect(checked).toContainText('Output: Not checked');
  await panel.getByRole('button', { name: 'Refresh audio devices' }).click();
  await expect(checked).toContainText('Input: Not checked');
});

test('native device defaults save independently of the playing tone', async ({
  page,
  request,
}) => {
  const endpoint = '/api/v1/native/defaults';
  const initial = await (await request.get(endpoint)).json();
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    // Engine settings are their own Audio tab, peer of the device (7.17).
    await page
      .getByRole('tab', { name: 'TONE3000 engine', exact: true })
      .click();
    const panel = page.getByRole('region', {
      name: 'Defaults for new NAM blocks',
    });
    await panel.getByLabel('NAM size for new models').click();
    await page.getByRole('option', { name: '75%', exact: true }).click();
    const multiCore = panel.getByRole('switch', {
      name: 'Native multi-core processing',
    });
    if (!(await multiCore.isChecked())) await multiCore.click();
    // A switch keeps its 44px target and its thumb no longer fills the track.
    const track = await multiCore.boundingBox();
    const thumb = await multiCore.locator('span').boundingBox();
    expect(track!.height).toBeGreaterThanOrEqual(44);
    expect(thumb!.width).toBeLessThan(track!.width / 2);
    await panel.getByRole('combobox', { name: 'Oversampling' }).click();
    await page.getByRole('option', { name: 'Off', exact: true }).click();
    await expect(panel.getByText(/Unsaved changes/)).toBeVisible();
    await panel.getByRole('button', { name: 'Save device defaults' }).click();
    await expect(panel.getByRole('status')).toContainText('Defaults saved');
    const saved = await (await request.get(endpoint)).json();
    expect(saved.settings.nam_size).toBe(0.75);
    expect(saved.settings.multi_core).toBe(true);
    expect(saved.settings.parameters.osEnabled).toBe(0);
    await page.reload();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page
      .getByRole('tab', { name: 'TONE3000 engine', exact: true })
      .click();
    await expect(panel.getByLabel('NAM size for new models')).toHaveText('75%');
    await expect(
      panel.getByRole('combobox', { name: 'Oversampling' }),
    ).toHaveText('Off');
    await panel
      .getByRole('button', { name: 'Reset defaults', exact: true })
      .click();
    await expect(panel.getByRole('status')).toContainText('Defaults saved');
    await expect(panel.getByLabel('NAM size for new models')).toHaveText(
      'Full',
    );
  } finally {
    const latest = await (await request.get(endpoint)).json();
    await request.post(endpoint, {
      data: { expected_revision: latest.revision, settings: initial.settings },
    });
  }
});

test('rig tuner is accessible outside preset authoring and survives rotation', async ({
  page,
}) => {
  await page.goto('/?development=simulator');
  for (const view of ['Rig']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    await page.getByRole('button', { name: 'Open tuner', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Tuner', exact: true });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/standalone input tuner is not available/),
    ).toBeVisible();
    await expect(
      dialog.getByRole('radio', { name: 'Mute', exact: true }),
    ).toBeDisabled();
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: size.height, height: size.width });
    await expect(
      dialog.getByRole('button', { name: 'Close dialog', exact: true }),
    ).toBeInViewport();
    await dialog
      .getByRole('button', { name: 'Close dialog', exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
  }
});
