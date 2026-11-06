import { expect, test } from '@playwright/test';
import { openSounds } from './display';

/**
 * Sprint 07 Library journeys against the real daemon: sections with their own
 * links, Discover as a page, an empty preset from New preset, protected sound
 * deletion and the device-wide Protect lock.
 */
test('library sections have their own links and Discover is a page', async ({
  page,
}) => {
  await page.goto('/#library/discover');
  await expect(
    page.getByRole('tab', { name: 'Discover', selected: true }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Discover' })).toBeVisible();
  await expect(page.getByPlaceholder('Find a sound or genre…')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Sounds', exact: true }).click();
  await expect(page).toHaveURL(/#library\/sounds$/);
  await page.reload();
  await expect(
    page.getByRole('tab', { name: 'Sounds', selected: true }),
  ).toBeVisible();
  // The old Sound Check link still opens the renamed Levels workspace.
  await page.goto('/#monitor');
  await expect(
    page
      .getByRole('navigation', { name: 'Instrument navigation' })
      .getByRole('button', { name: 'Levels', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
});

test('new preset creates an empty preset of your own without hardware', async ({
  page,
}, info) => {
  const name = `Empty ${info.project.name} ${Date.now()}`;
  await page.goto('/#library/presets');
  await page.getByRole('button', { name: 'New preset' }).click();
  const dialog = page.getByRole('dialog', { name: 'New preset' });
  await dialog.getByRole('button', { name: 'Create preset' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Give the preset a name.');
  await dialog.getByLabel('Name').fill(name);
  await expect(
    dialog.getByRole('button', { name: 'Create preset' }),
  ).toBeEnabled();
  await dialog.getByRole('button', { name: 'Create preset' }).click();
  await expect(dialog).toHaveCount(0);
  // Whether or not audio can start here, the preset exists in Mine.
  const listed = await page.request.get('/api/v1/presets/rigs');
  const presets = (await listed.json()).presets as {
    name: string;
    origin: string;
    native_instances: number;
    lv2_instances: number;
  }[];
  expect(presets.find((p) => p.name === name)).toMatchObject({
    origin: 'mine',
    native_instances: 0,
    lv2_instances: 0,
  });
});

test('sounds deletes an unused NAM file after reviewing its uses', async ({
  page,
}, info) => {
  const name = `Delete me ${info.project.name} ${Date.now()}`;
  const upload = await page.request.post(
    `/api/v1/models/local?name=${encodeURIComponent(`${name}.nam`)}`,
    {
      data: Buffer.from('{"architecture":"Linear","weights":[1]}'),
      headers: { 'Content-Type': 'application/octet-stream' },
    },
  );
  expect(upload.status()).toBe(201);
  await page.goto('/#library/sounds');
  await openSounds(page, 'nam');
  await page.getByRole('searchbox', { name: 'Search NAM models' }).fill(name);
  await page.getByRole('button', { name: `Delete ${name}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete sound' });
  await expect(dialog.getByText(/Nothing uses it/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(dialog.getByText('File deleted.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText('No matching files')).toBeVisible();
});

test('protect refuses edits from any client until turned off', async ({
  request,
}) => {
  expect((await request.get('/api/v1/protect')).ok()).toBe(true);
  expect(
    await (
      await request.post('/api/v1/protect', { data: { on: true } })
    ).json(),
  ).toEqual({ on: true });
  try {
    const refused = await request.post('/api/v1/presets/keep-ready', {
      data: { revisions: [] },
    });
    expect(refused.status()).toBe(423);
    expect((await refused.json()).error).toMatch(/Protect is on/);
    // Reading stays available while protected.
    expect((await request.get('/api/v1/presets/keep-ready')).ok()).toBe(true);
  } finally {
    await request.post('/api/v1/protect', { data: { on: false } });
  }
  expect(
    (
      await request.post('/api/v1/presets/keep-ready', {
        data: { revisions: [] },
      })
    ).ok(),
  ).toBe(true);
});
