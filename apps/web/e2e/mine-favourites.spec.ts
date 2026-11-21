import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

import type {
  AudioState,
  DetailsCatalog,
  LibraryCatalog,
  RigPage,
} from '../src/api';
import { selectWorkspaceSection } from './display';

test('Mine sorts saved presets with owned native rows, stars an entry and remembers its search', async ({
  page,
  request,
}, info) => {
  const suffix = `${info.project.name}-${Date.now()}`;
  const rigName = `Zebra Mine ${suffix}`;
  const ownedName = `Amber Mine ${suffix}`;
  const tag = `remember-${suffix}`;
  const imported = await request.post('/api/v1/presets', {
    data: readFileSync(
      new URL(
        '../../../crates/oxidal-presets/tests/fixtures/authored-current.t3kpreset',
        import.meta.url,
      ),
    ),
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  expect(imported.ok(), await imported.text()).toBe(true);
  const native = await imported.json();
  // Add an owned row as saved by the native worker. The rig and metadata
  // below are published by the isolated daemon.
  await page.route('**/api/v1/presets/catalog', async (route) => {
    const actual = await route.fetch();
    const catalog: LibraryCatalog = await actual.json();
    await route.fulfill({
      response: actual,
      json: {
        ...catalog,
        items: [
          ...catalog.items,
          {
            id: native.sha256,
            name: ownedName,
            kind: 'owned',
            origin: 'mine',
            source_name: native.name,
            archived: false,
          },
        ],
      },
    });
  });
  const soundingBefore: AudioState = await (
    await request.get('/api/v1/audio')
  ).json();
  await page.goto('/#library/mine');
  await page.getByRole('button', { name: 'New preset' }).click();
  const creation = page.getByRole('dialog', { name: 'New preset' });
  await creation.getByLabel('Name').fill(rigName);
  await creation.getByRole('button', { name: 'Create preset' }).click();
  await expect(creation).toHaveCount(0);
  const rigs: RigPage = await (
    await request.get('/api/v1/presets/rigs')
  ).json();
  const entry = rigs.presets.find((rig) => rig.name === rigName)!;
  const details: DetailsCatalog = await (
    await request.get('/api/v1/presets/details')
  ).json();
  const edited = await request.post('/api/v1/presets/details', {
    data: {
      expected_revision: details.revision,
      entry_kind: 'rig',
      id: entry.revision,
      categories: ['Clean'],
      description: tag,
    },
  });
  expect(edited.ok(), await edited.text()).toBe(true);
  await page.reload();

  const rows = page.getByRole('list', { name: 'presets', exact: true });
  const names = () => rows.getByRole('button', { name: /^Favourite / });
  const rigStar = rows.getByRole('button', { name: `Favourite ${rigName}` });
  const ownedStar = rows.getByRole('button', {
    name: `Favourite ${ownedName}`,
  });
  await expect(rigStar).toBeVisible();
  await expect(ownedStar).toBeVisible();
  await page
    .getByRole('button', { name: 'Library order', exact: true })
    .click();
  await page
    .getByRole('menuitemcheckbox', { name: 'Name', exact: true })
    .click();
  const labels = await names().evaluateAll((stars) =>
    stars.map((star) => star.getAttribute('aria-label')!),
  );
  expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  expect(labels.indexOf(`Favourite ${ownedName}`)).toBeLessThan(
    labels.indexOf(`Favourite ${rigName}`),
  );
  await expect(
    rows.getByRole('button', { name: `Play ${ownedName}` }),
  ).toBeVisible();
  await expect(
    rows.getByRole('button', { name: `More for ${rigName}` }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep ready' })).toBeVisible();

  await rigStar.click();
  await page.getByRole('button', { name: 'Favourites', exact: true }).click();
  await expect(rigStar).toHaveAttribute('aria-pressed', 'true');
  await expect(ownedStar).toHaveCount(0);
  const search = page.getByRole('searchbox', {
    name: 'Search presets',
    exact: true,
  });
  await search.fill(tag);
  await expect(rigStar).toBeVisible();
  await selectWorkspaceSection(page, 'Library', 'TONE3000');
  await selectWorkspaceSection(page, 'Library', 'Mine');
  await expect(search).toHaveValue(tag);
  await page.reload();
  await expect(search).toHaveValue(tag);
  await expect(rigStar).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('button', { name: 'Clear preset search', exact: true })
    .click();
  await expect(ownedStar).toHaveAttribute('aria-pressed', 'false');
  const soundingAfter: AudioState = await (
    await request.get('/api/v1/audio')
  ).json();
  expect(soundingAfter.session).toBe(soundingBefore.session);
  expect(soundingAfter.revision).toBe(soundingBefore.revision);
});
