import { expect, type Page, test } from '@playwright/test';

import { openTool } from './display';

async function openSheet(page: Page, title: string) {
  await page.goto('/#library/songbook');
  await page.getByRole('button', { name: new RegExp(`^${title}`) }).click();
  await expect(
    page.getByRole('heading', { name: title, exact: true }),
  ).toBeVisible();
}

test('songbook imports exact UTF-8, renders text safely and stays usable in both orientations', async ({
  page,
  request,
}, info) => {
  await request.post('/api/v1/protect', { data: { on: false } });
  const title = `Sheet-${info.project.name}-${Date.now()}`;
  const literal = 'Literal <img src=x onerror="window.songbookHtmlRan=true">';
  const source = `\ufeff{title: ${title}}\r\n{key: G}\r\n[G]Words and chords\r\n${literal}\r\n`;
  await page.goto('/#library/songbook');
  await expect(
    page.getByRole('button', { name: 'New song', exact: true }),
  ).toBeEnabled();
  await page.getByLabel('Import chord sheet', { exact: true }).setInputFiles({
    name: 'rehearsal.cho',
    mimeType: 'text/plain',
    buffer: Buffer.from(source, 'utf8'),
  });
  await expect(
    page.getByRole('textbox', { name: 'Title', exact: true }),
  ).toHaveValue(title);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Words and chords' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: title, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(literal, { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="sheet-viewer"] img')).toHaveCount(0);
  const saved = await (
    await request.get('/api/v1/media/sheets?limit=50')
  ).json();
  const sheet = saved.sheets.find(
    (item: { title: string }) => item.title === title,
  );
  expect(sheet).toBeTruthy();
  const exported = await request.get(`/api/v1/media/sheets/${sheet.id}/export`);
  expect(exported.ok()).toBe(true);
  expect(await exported.body()).toEqual(Buffer.from(source, 'utf8'));
  await page.reload();
  await expect(
    page.getByRole('heading', { name: title, exact: true }),
  ).toBeVisible();
  const original = page.viewportSize()!;
  for (const viewport of [
    original,
    { width: original.height, height: original.width },
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      page.getByRole('button', { name: 'Edit', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
});

test('songbook two viewers retain a stale draft and explicitly replace the reviewed saved revision', async ({
  page,
  context,
  request,
}, info) => {
  await request.post('/api/v1/protect', { data: { on: false } });
  const title = `Conflict-${info.project.name}-${Date.now()}`;
  const list = await (await request.get('/api/v1/media/sheets')).json();
  const created = await request.post('/api/v1/media/sheets', {
    data: {
      expected: list.registry_revision,
      title,
      format: 'text',
      source: 'Original words',
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  await openSheet(page, title);
  const other = await context.newPage();
  await openSheet(other, title);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Words and chords' })
    .fill('My retained words');
  await other.getByRole('button', { name: 'Edit', exact: true }).click();
  await other
    .getByRole('textbox', { name: 'Words and chords' })
    .fill('Other viewer saved words');
  await other.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    other.getByRole('textbox', { name: 'Words and chords' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByText('The saved version changed. Your text has been kept.'),
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Words and chords' }),
  ).toHaveValue('My retained words');
  await page.getByRole('button', { name: 'Read latest saved text' }).click();
  await expect(
    page.getByText('Other viewer saved words', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Replace latest with my draft' })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Words and chords' }),
  ).toHaveCount(0);
  await other.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(
    other.getByText('My retained words', { exact: true }),
  ).toBeVisible();
  await other.close();
});

test('songbook dock remembers placement through close, rotation and reload without audio commands', async ({
  page,
}) => {
  await page.goto('/#library/songbook');
  // The tools are in the capsule's ☰ menu.
  await expect(
    page.getByRole('button', { name: 'Menu', exact: true }),
  ).toBeVisible();
  const writes: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      /\/api\/v1\/(audio|rig\/audio|graph\/audio|media\/player)(?:\/|$)/.test(
        new URL(request.url()).pathname,
      )
    )
      writes.push(request.url());
  });
  const original = page.viewportSize()!;
  await page.setViewportSize({ width: 1280, height: 800 });
  await openTool(page, 'Sheet');
  // A wide screen docks it at the right, as a tab.
  const dock = page.getByRole('region', { name: 'Right dock', exact: true });
  await expect(dock.getByRole('tab', { name: 'Sheet' })).toBeVisible();
  await dock.getByRole('button', { name: 'Sheet: where to keep it' }).click();
  await page.getByRole('menuitem', { name: 'Float', exact: true }).click();
  const panel = page.getByRole('region', {
    name: 'Sheet, floating',
    exact: true,
  });
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1280);
  // A phone shows the same tool in its one bottom sheet.
  await page.setViewportSize({ width: 393, height: 852 });
  await openTool(page, 'Sheet');
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('tab', { name: 'Sheet' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 800 });
  // This browser keeps where the tool is.
  await expect(panel).toBeVisible();
  await page.reload();
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Close Sheet', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.setViewportSize(original);
  expect(writes).toEqual([]);
});

test('opening and moving the player, tuner and venue tools leaves the device controls alone', async ({
  page,
}) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() !== 'GET' &&
      /\/api\/v1\/(player\/commands|tuner|venues)(?:\/|$)/.test(
        new URL(request.url()).pathname,
      )
    )
      writes.push(request.url());
  });
  await page.goto('/#library/songbook');
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const title of ['Player', 'Tuner', 'Venue EQ']) {
    await openTool(page, title);
    const dock = page.getByRole('region', { name: 'Right dock', exact: true });
    await expect(dock.getByRole('tab', { name: title })).toBeVisible();
    await dock
      .getByRole('button', { name: `${title}: where to keep it` })
      .click();
    await page.getByRole('menuitem', { name: 'Float', exact: true }).click();
    const panel = page.getByRole('region', {
      name: `${title}, floating`,
      exact: true,
    });
    await expect(panel).toBeVisible();
    await panel
      .getByRole('button', { name: 'Close ' + title, exact: true })
      .click();
    await expect(panel).toHaveCount(0);
  }
  expect(writes).toEqual([]);
});
