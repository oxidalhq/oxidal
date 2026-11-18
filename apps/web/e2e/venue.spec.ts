import {
  type APIRequestContext,
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test';

import { setDisplayMode } from './display';

/**
 * Sprint 09 venue EQ against the real daemon: profiles, an owned preview,
 * Save as, Revert, Bypass, a real revision conflict and Protect. Conflicts and
 * refusals are made by changing the device from the test while the screen's
 * own command is on its way, so the daemon answers 409 and 423 itself.
 */
type Venue = {
  revision: number;
  active: string;
  bypass: boolean;
  preview: { eq: { bands: { gainDb: number }[] } } | null;
  profiles: { id: string; name: string; builtin?: boolean }[];
};

async function venue(request: APIRequestContext): Promise<Venue> {
  return (await (await request.get('/api/v1/venues')).json()) as Venue;
}
/** One venue command as another client would send it. */
async function command(
  request: APIRequestContext,
  body: Record<string, unknown>,
) {
  const { revision } = await venue(request);
  const response = await request.post('/api/v1/venues/commands', {
    data: { expectedRevision: revision, command: body },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as Venue;
}
async function resetVenue(request: APIRequestContext) {
  await request.post('/api/v1/protect', { data: { on: false } });
  let state = await venue(request);
  if (state.preview) state = await command(request, { kind: 'revert' });
  if (state.bypass)
    state = await command(request, { kind: 'set_bypass', bypass: false });
  for (const profile of state.profiles.filter((p) => !p.builtin))
    state = await command(request, { kind: 'delete', profile: profile.id });
  if (state.active !== 'builtin-flat')
    await command(request, { kind: 'activate', profile: 'builtin-flat' });
}

async function openVenue(page: Page) {
  await page.goto('/#settings/audio');
  await page
    .getByRole('tablist', { name: 'Audio sections' })
    .getByRole('tab', { name: 'Output', exact: true })
    .click();
  const panel = page.getByRole('region', { name: 'Venue EQ' });
  await expect(
    panel.getByRole('combobox', { name: 'Venue profile' }),
  ).toBeVisible();
  return panel;
}
async function chooseProfile(page: Page, panel: Locator, name: string) {
  await panel.getByRole('combobox', { name: 'Venue profile' }).click();
  await page.getByRole('option', { name, exact: true }).click();
  await expect(
    panel.getByRole('combobox', { name: 'Venue profile' }),
  ).toHaveText(name);
}
const edited = (panel: Locator) => panel.getByText('Edited · unsaved');

test.beforeEach(async ({ request }) => {
  await resetVenue(request);
});
test.afterEach(async ({ request }) => {
  await resetVenue(request);
});

test('venue EQ edits a starting point, saves it as a profile, reverts and bypasses', async ({
  page,
  request,
}) => {
  const panel = await openVenue(page);
  await expect(panel).toContainText(
    'Applies to: Main outputs (and headphones on this interface).',
  );
  await chooseProfile(page, panel, 'Boomy room');
  await expect(panel).toContainText('is a starting point to tune by ear');
  await expect(panel.getByText(/^Peak boost 0\.0 dB/)).toBeVisible();

  // A step is audible at once as an owned, unsaved preview.
  await panel.getByRole('button', { name: 'Raise Gain' }).click();
  await expect(edited(panel)).toBeVisible();
  await expect(panel.getByLabel('Gain value')).toHaveText('−2.5 dB');
  await expect
    .poll(async () => (await venue(request)).preview !== null)
    .toBe(true);

  await panel.getByRole('button', { name: 'Save as…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save venue profile as' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill('E2E room');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    panel.getByRole('combobox', { name: 'Venue profile' }),
  ).toHaveText('E2E room');
  await expect(edited(panel)).toHaveCount(0);
  const saved = await venue(request);
  expect(saved.profiles.find((p) => p.id === saved.active)?.name).toBe(
    'E2E room',
  );
  expect(saved.preview).toBeNull();

  // Drag the Mid handle up: the graph previews it, Revert drops it.
  await panel.getByRole('button', { name: 'Mid', exact: true }).click();
  const handle = panel.getByRole('slider', {
    name: 'Mid handle',
    exact: true,
  });
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 6, y - 20, { steps: 6 });
  await page.mouse.move(x + 8, y - 40, { steps: 6 });
  await page.mouse.up();
  await expect(edited(panel)).toBeVisible();
  await expect(panel.getByLabel('Gain value')).toHaveText(/^\+\d+\.\d dB$/);
  await expect
    .poll(async () => (await venue(request)).preview?.eq.bands[3]?.gainDb ?? 0)
    .toBeGreaterThan(0);
  await panel.getByRole('button', { name: 'Revert' }).click();
  await expect(edited(panel)).toHaveCount(0);
  await expect(panel.getByLabel('Gain value')).toHaveText('0.0 dB');
  expect((await venue(request)).preview).toBeNull();

  await panel.getByRole('button', { name: 'Bypass: Off' }).click();
  await expect(
    panel.getByRole('button', { name: 'Bypass: On' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(panel).toContainText('Bypassed: you hear the outputs flat');
  expect((await venue(request)).bypass).toBe(true);
  await panel.getByRole('button', { name: 'Bypass: On' }).click();
  await expect(
    panel.getByRole('button', { name: 'Bypass: Off' }),
  ).toBeVisible();
});

test('venue EQ asks before leaving an unsaved edit', async ({
  page,
  request,
}) => {
  const panel = await openVenue(page);
  await panel.getByRole('button', { name: 'Raise Gain' }).click();
  await expect(edited(panel)).toBeVisible();
  await page
    .getByRole('tablist', { name: 'Audio sections' })
    .getByRole('tab', { name: 'Audio device', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Unsaved venue edit' });
  await expect(dialog).toContainText("You're hearing them now.");
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(edited(panel)).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Instrument navigation' })
    .getByRole('button', { name: 'Library', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Unsaved venue edit' })
    .getByRole('button', { name: 'Revert and leave' })
    .click();
  await expect(page).toHaveURL(/#library/);
  await expect.poll(async () => (await venue(request)).preview).toBeNull();
});

test('venue EQ guards browser Back and manual section hashes without losing the preview', async ({
  page,
  request,
}) => {
  await page.goto('/#library/mine');
  await page
    .getByRole('navigation', { name: 'Instrument navigation' })
    .getByRole('button', { name: 'Settings', exact: true })
    .click();
  await page
    .getByRole('tablist', { name: 'Audio sections' })
    .getByRole('tab', { name: 'Output', exact: true })
    .click();
  const panel = page.getByRole('region', { name: 'Venue EQ' });
  await panel.getByRole('button', { name: 'Raise Gain' }).click();
  await expect(edited(panel)).toBeVisible();
  await expect.poll(async () => (await venue(request)).preview).not.toBeNull();
  const preview = (await venue(request)).preview;
  const settingsUrl = page.url();
  expect(preview).not.toBeNull();
  await page.evaluate(() => window.history.back());
  const decision = page.getByRole('dialog', { name: 'Unsaved venue edit' });
  await expect(decision).toBeVisible();
  await expect(page).toHaveURL(settingsUrl);
  await decision.getByRole('button', { name: 'Keep editing' }).click();
  await expect(edited(panel)).toBeVisible();
  expect((await venue(request)).preview).toEqual(preview);
  await page.evaluate(() => {
    window.location.hash = 'settings/device';
  });
  await expect(decision).toBeVisible();
  await expect(page).toHaveURL(settingsUrl);
  await decision.getByRole('button', { name: 'Keep editing' }).click();
  await expect(edited(panel)).toBeVisible();
  expect((await venue(request)).preview).toEqual(preview);
  // The canceled manual fragment remains a Forward entry; Back still returns
  // to Library rather than silently skipping the guarded entry.
  await page.evaluate(() => window.history.back());
  await expect(decision).toBeVisible();
  await decision.getByRole('button', { name: 'Revert and leave' }).click();
  await expect(page).toHaveURL(/#library\/mine$/);
  await expect.poll(async () => (await venue(request)).preview).toBeNull();
  await page.evaluate(() => window.history.forward());
  await expect(page).toHaveURL(settingsUrl);
});

test('venue EQ shows another client’s change after a revision conflict', async ({
  page,
  browser,
  request,
}) => {
  const panel = await openVenue(page);
  // A second screen follows every change through the event stream.
  const other = await browser.newPage();
  const second = await openVenue(other);
  await panel.getByRole('button', { name: 'Bypass: Off' }).click();
  await expect(
    second.getByRole('button', { name: 'Bypass: On' }),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Bypass: On' }).click();
  await expect(
    second.getByRole('button', { name: 'Bypass: Off' }),
  ).toBeVisible();
  await other.close();

  // Another client switches profile while this screen's edit is on its way.
  let interfered = false;
  await page.route('**/api/v1/venues/commands', async (route) => {
    if (!interfered) {
      interfered = true;
      await command(request, {
        kind: 'activate',
        profile: 'builtin-harsh-room',
      });
    }
    await route.continue();
  });
  await panel.getByRole('button', { name: 'Raise Gain' }).click();
  await expect(panel.getByRole('alert')).toContainText(
    'Someone else changed the venue EQ. You are seeing their change now.',
  );
  await expect(
    panel.getByRole('combobox', { name: 'Venue profile' }),
  ).toHaveText('Harsh room');
  await expect(edited(panel)).toHaveCount(0);
  expect((await venue(request)).preview).toBeNull();
  await page.unroute('**/api/v1/venues/commands');
});

test('venue EQ protect refuses edits, bypass and profile changes', async ({
  page,
  request,
}) => {
  const panel = await openVenue(page);
  // Protect turned on elsewhere: the device refuses this screen's command.
  let locked = false;
  await page.route('**/api/v1/venues/commands', async (route) => {
    if (!locked) {
      locked = true;
      await request.post('/api/v1/protect', { data: { on: true } });
    }
    await route.continue();
  });
  await panel.getByRole('button', { name: 'Bypass: Off' }).click();
  const reason =
    'Protect is on. Venue EQ is locked: no edits, bypass or profile changes.';
  await expect(panel.getByText(reason)).toBeVisible();
  await page.unroute('**/api/v1/venues/commands');
  expect((await venue(request)).bypass).toBe(false);

  // Opened under Protect, every control is locked with the reason shown.
  await page.reload();
  await page
    .getByRole('tablist', { name: 'Audio sections' })
    .getByRole('tab', { name: 'Output', exact: true })
    .click();
  await expect(panel.getByText(reason)).toBeVisible();
  for (const name of ['Bypass: Off', 'Save as…', 'Raise Gain'])
    await expect(
      panel.getByRole('button', { name, exact: true }),
    ).toBeDisabled();
  await expect(
    panel.getByRole('combobox', { name: 'Venue profile' }),
  ).toBeDisabled();
  const refused = await request.post('/api/v1/venues/commands', {
    data: {
      expectedRevision: (await venue(request)).revision,
      command: { kind: 'set_bypass', bypass: true },
    },
  });
  expect(refused.status()).toBe(423);
});

test('venue EQ on e-paper edits with step buttons', async ({
  page,
  request,
}) => {
  await openVenue(page);
  await setDisplayMode(page, 'epaper');
  const panel = page.getByRole('region', { name: 'Venue EQ' });
  await panel.getByRole('button', { name: 'High-pass, off' }).click();
  await panel.getByRole('button', { name: 'High-pass on' }).click();
  await expect(edited(panel)).toBeVisible();
  await panel.getByRole('button', { name: 'Raise Frequency' }).click();
  await expect(panel.getByLabel('Frequency value')).toHaveText('90 Hz');
  await expect
    .poll(async () => (await venue(request)).preview !== null)
    .toBe(true);
  await panel.getByRole('button', { name: 'Revert' }).click();
  await expect(edited(panel)).toHaveCount(0);
  await setDisplayMode(page, 'default');
});
