import { expect, type Page, test } from '@playwright/test';

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
  await expect(
    page.getByRole('button', { name: 'Tools', exact: true }),
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
  const open = async () => {
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page
      .getByRole('menuitemcheckbox', { name: 'Chord sheet', exact: true })
      .click();
  };
  await open();
  await expect(
    page.getByRole('heading', { name: 'Chord sheet', exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page
    .getByRole('button', { name: 'Float: Chord sheet', exact: true })
    .click();
  const panel = page.getByRole('region', {
    name: 'Chord sheet tool',
    exact: true,
  });
  await expect(panel).toHaveAttribute('data-place', 'float');
  await panel
    .getByRole('button', { name: 'Close Chord sheet', exact: true })
    .click();
  await open();
  await expect(panel).toHaveAttribute('data-place', 'float');
  const floatingLeft = await panel.evaluate(
    (element) => getComputedStyle(element).left,
  );
  const floatingWidth = await panel.evaluate(
    (element) => getComputedStyle(element).width,
  );
  await page.setViewportSize({ width: 393, height: 852 });
  await expect(
    page.getByRole('heading', { name: 'Chord sheet', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Float: Chord sheet', exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(panel).toHaveAttribute('data-place', 'float');
  await expect(panel).toHaveCSS('left', floatingLeft);
  await expect(panel).toHaveCSS('width', floatingWidth);
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Chord sheet tool', exact: true }),
  ).toHaveCount(0);
  await open();
  await expect(panel).toHaveAttribute('data-place', 'float');
  expect(writes).toEqual([]);
});

test('opening and moving backing, tuner and venue tools leaves the device controls alone', async ({
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
  const original = page.viewportSize()!;
  for (const title of ['Backing', 'Tuner', 'Venue EQ']) {
    await page.setViewportSize(original);
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page
      .getByRole('menuitemcheckbox', { name: title, exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: title, exact: true }).first(),
    ).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page
      .getByRole('button', { name: 'Float: ' + title, exact: true })
      .click();
    const panel = page.getByRole('region', {
      name: title + ' tool',
      exact: true,
    });
    await expect(panel).toBeVisible();
    await panel
      .getByRole('button', { name: 'Close ' + title, exact: true })
      .click();
    await expect(panel).toBeHidden();
  }
  expect(writes).toEqual([]);
});
