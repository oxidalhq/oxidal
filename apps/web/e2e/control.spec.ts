import { test, expect } from '@playwright/test';
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
  await page.goto('/');
  await expect(page.getByText('Device connected')).toBeVisible();
  await expect(
    page.getByText('Audio unavailable.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Serial rig' })).toBeVisible();
  await expect(page.getByRole('complementary')).toHaveCount(0);
  await page.getByRole('button', { name: 'Parallel', exact: true }).click();
  await expect(page.getByTestId('block-nam-b')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Custom routing' }),
  ).toBeVisible();
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
  await second.goto('/');
  await expect(second.getByText('Device connected')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('MIDI value', { exact: true }).fill('127');
  await page.getByRole('button', { name: 'Send MIDI CC' }).click();
  await expect(second.getByTestId('value-nam-a.level')).toHaveText('100%');
  await expect(second.getByTestId('last-origin')).toHaveText('midi');
  await second.getByRole('slider', { name: 'NAM A level' }).fill('0.25');
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

test('MIDI continues with browsers closed; simulator feedback cannot loop into input', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.getByText('Device connected')).toBeVisible();
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
  await page.goto('/');
  await expect(page.getByText('Device connected')).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText('Reconnecting…', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('slider', { name: 'NAM A level' }),
  ).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByText('Device connected')).toBeVisible();
  await expect(page.getByRole('slider', { name: 'NAM A level' })).toBeEnabled();
});

test('quiet interface has no detected WCAG AA violations', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(page.getByText('Device connected')).toBeVisible();
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

test('MIDI learn persists a bypass mapping and preset controls reflect both ways', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.getByText('Device connected')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Target', { exact: true }).selectOption('rig.bypass');
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
  await page.getByRole('button', { name: 'Back to rig' }).click();
  await expect(
    page.getByRole('button', { name: 'Bypass on', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Bypass on', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Bypass off', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await page
    .getByLabel('Example preset', { exact: true })
    .selectOption('parallel');
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
  await expect(page.getByText('Device connected')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('CC number', { exact: true })).toHaveValue('99');
  await expect(page.getByLabel('Target', { exact: true })).toHaveValue(
    'rig.bypass',
  );
});

test('owned previews cancel, commit exactly, and preserve independent client changes', async ({
  page,
  context,
  request,
}) => {
  await page.goto('/');
  const second = await context.newPage();
  await second.goto('/');
  await page
    .getByRole('button', { name: 'Edit NAM A level', exact: true })
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
  await page.getByLabel('Draft NAM A level (%)', { exact: true }).fill('81');
  await expect(second.getByTestId('value-nam-a.level')).toHaveText('81%');
  await expect(
    second.getByRole('slider', { name: 'NAM A level' }),
  ).toBeDisabled();
  await expect(
    second.getByRole('button', { name: 'Edit Delay mix' }),
  ).toBeDisabled();
  await second
    .getByRole('slider', { name: 'Delay mix', exact: true })
    .fill('0.62');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(second.getByTestId('value-nam-a.level')).toHaveText('50%');
  await expect(second.getByTestId('value-delay.mix')).toHaveText('62%');
  await page
    .getByRole('button', { name: 'Edit NAM A level', exact: true })
    .click();
  await page.getByLabel('Draft NAM A level (%)', { exact: true }).fill('73');
  await page.getByRole('button', { name: 'Commit', exact: true }).click();
  await expect(
    page.getByRole('group', { name: 'Preview NAM A level' }),
  ).toHaveCount(0);
  await expect(second.getByTestId('value-nam-a.level')).toHaveText('73%');
  await page.reload();
  await expect(page.getByTestId('value-nam-a.level')).toHaveText('73%');
  // Navigation cancels after any in-flight preview, rather than leaving its value behind.
  await page
    .getByRole('button', { name: 'Edit NAM A level', exact: true })
    .click();
  await page.getByLabel('Draft NAM A level (%)', { exact: true }).fill('90');
  await expect(second.getByTestId('value-nam-a.level')).toHaveText('90%');
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
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Edit NAM A level', exact: true })
    .click();
  await page.getByLabel('Draft NAM A level (%)', { exact: true }).fill('91');
  await expect(page.getByTestId('value-nam-a.level')).toHaveText('91%');
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(
    page.getByRole('button', { name: 'Commit', exact: true }),
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
  await expect(page.getByText('Device connected')).toBeVisible();
  await expect(page.getByTestId('value-nam-a.level')).toHaveText('50%');
  await expect(
    page.getByLabel('Draft NAM A level (%)', { exact: true }),
  ).toHaveValue('91');
  await expect(
    page.getByRole('button', { name: 'Commit', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Edit NAM A level', exact: true }),
  ).toBeEnabled();
});
