import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { allFactoryRecipes } from '../src/factoryCatalog';
import { emptyPreset } from '../src/features/library/newPreset';

/**
 * Oxidal sounds journeys (Sprint 12 WP-B): filters that survive a reload, the
 * card states, Get tones with sign-in and a removed tone, Install pack under
 * Protect, Too heavy, and Make my copy. Everything TONE3000 is mocked here; no
 * test ever reaches tone3000.com. Titles start with "library sections" so the
 * device projects run them.
 */
const lv2 = JSON.parse(
  readFileSync(
    new URL('../src/fixtures/factory-lv2.json', import.meta.url),
    'utf8',
  ),
);
const BROWN = 'Brown Crunch';
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

const source = {
  preset: {
    sha256: 'b'.repeat(64),
    name: 'Downloaded capture',
    size_bytes: 100,
    framing: 'current',
    block_count: 1,
    embedded_bytes: 20,
    parameter_count: 1,
    playback_available: true,
  },
  source: { kind: 'owned', preset: 'owned-voice-1' },
};
const tone = {
  id: 65578,
  title: 'Plexi test capture',
  user: { username: 'maker', display_name: null },
  gear: 'amp-cab',
  format: 'nam',
  license: 'cc-by',
  images: null,
  url: 'https://example.invalid/tone',
  models_count: 1,
  a1_models_count: 0,
  a2_models_count: 1,
  custom_models_count: 0,
};
const entry = (name: string, revision: string) => ({
  id: revision,
  name,
  revision,
  origin: 'oxidal_example',
  lv2_instances: 1,
  native_instances: 0,
  topology: 'scenes',
  scenes: ['Rhythm', 'Lead', 'Intro'],
});

type Unit = {
  plugins?: boolean;
  built?: string[];
  captures?: { tone_id: number; model_id: number }[];
  signedIn?: boolean;
  protect?: boolean;
  frames?: number;
  packInstalled?: boolean;
  /** Leave the preset library to the real daemon. */
  realLibrary?: boolean;
};
/** The unit's reads, mocked so each state is exact; TONE3000 is always mocked. */
async function mockUnit(page: Page, unit: Unit = {}) {
  const writes: string[] = [];
  const state = { toneRemoved: false, signedIn: unit.signedIn ?? true };
  await page.route('**/api/v1/plugins/lv2*', (r) =>
    json(r, { plugins: unit.plugins === false ? [] : lv2, sample_rate: 48000 }),
  );
  if (!unit.realLibrary)
    await page.route(/\/api\/v1\/presets\/rigs(\?.*)?$/, (r) => {
      if (r.request().method() !== 'GET') {
        writes.push(`${r.request().method()} rigs`);
        return r.continue();
      }
      return json(r, {
        native_profile: 'prof',
        next: null,
        presets: (unit.built ?? []).map((name, i) => entry(name, `rev-${i}`)),
      });
    });
  await page.route('**/api/v1/presets/details', (r) =>
    json(r, { revision: 'details-1', entries: [] }),
  );
  await page.route('**/api/v1/tone3000/voice', (r) => {
    if (r.request().method() === 'POST') {
      writes.push('POST voice');
      return json(r, { error: 'not found', code: 'not_found' }, 404);
    }
    return json(r, {
      captures: (unit.captures ?? []).map((c) => ({ ...c, source })),
    });
  });
  await page.route('**/api/v1/tone3000/tones/*', (r) =>
    state.toneRemoved
      ? json(r, { error: 'not found', code: 'not_found' }, 404)
      : json(r, tone),
  );
  await page.route('**/api/v1/tone3000/models*', (r) =>
    json(r, {
      data: [
        {
          id: 418470,
          name: 'A2',
          size: '18 MB',
          tone_id: 65578,
          architecture_version: '2',
        },
      ],
      page: 1,
      total_pages: 1,
    }),
  );
  await page.route('**/api/v1/packs', (r) =>
    json(r, {
      audio_running: false,
      available: true,
      message: '',
      storage_writable: true,
      packs: [
        'guitarix',
        'dragonfly',
        'invada',
        'x42',
        'mda',
        'fomp',
        'calf',
        'swh',
      ].map((id) => ({
        id,
        name: id,
        package: id,
        qualification: 'qualified',
        size_mib: 4,
        usable_plugins: 3,
        website: 'https://example.invalid',
        installed: unit.packInstalled ?? true,
      })),
    }),
  );
  await page.route('**/api/v1/packs/*/install', (r) => {
    writes.push('POST pack install');
    return json(r, { error: 'unexpected', code: 'internal' }, 500);
  });
  await page.route('**/api/v1/protect', (r) =>
    json(r, { on: unit.protect ?? false }),
  );
  await page.route('**/api/v1/account/tone3000', (r) =>
    json(r, {
      session: 's',
      revision: 1,
      phase: state.signedIn ? 'connected' : 'disconnected',
    }),
  );
  if (unit.frames)
    await page.route('**/api/v1/rig-audio', async (r) => {
      if (r.request().method() !== 'GET') return r.continue();
      const real = await (await r.fetch()).json();
      const side = (direction: string) => ({
        channels: 2,
        direction,
        endpoint: 'hw:test',
        format: 'float',
        period_frames: unit.frames,
        periods: 2,
        sample_rate: 48000,
      });
      return json(r, {
        ...real,
        configured: {
          revision: 'x'.repeat(64),
          stream: {
            input: side('capture'),
            output: side('playback'),
            input_map: [0, 1],
            output_map: [0, 1],
          },
        },
      });
    });
  return { writes, state };
}

async function findBrown(page: Page) {
  await page.goto('/#library/oxidal');
  await page
    .getByRole('searchbox', { name: 'Search Oxidal sounds' })
    .fill(BROWN);
  const card = page.getByRole('article', { name: BROWN });
  await expect(card).toBeVisible();
  await expect(card).not.toHaveAttribute('data-state', 'loading');
  return card;
}
async function showFilters(page: Page) {
  const toggle = page.getByRole('button', { name: /^Filters/ });
  if (await toggle.isVisible()) await toggle.click();
}

test('library sections: Oxidal sounds filters and search survive a reload (S-2)', async ({
  page,
}) => {
  await mockUnit(page);
  await page.goto('/#library/oxidal');
  const search = page.getByRole('searchbox', { name: 'Search Oxidal sounds' });
  await expect(
    page.getByText(/^Showing \d+ of \d+ · \d+ ready to play/),
  ).toBeVisible();
  await showFilters(page);
  await page.getByRole('combobox', { name: 'Genre' }).click();
  await page.getByRole('option', { name: 'Funk', exact: true }).click();
  await page.getByRole('combobox', { name: 'Engine' }).click();
  await page.getByRole('option', { name: 'LV2 only', exact: true }).click();
  await search.fill('a');
  await page.reload();
  await expect(search).toHaveValue('a');
  await showFilters(page);
  await expect(page.getByRole('combobox', { name: 'Genre' })).toContainText(
    'Funk',
  );
  await expect(page.getByRole('combobox', { name: 'Engine' })).toContainText(
    'LV2 only',
  );
  const cards = page.getByRole('article');
  // Whatever the current content offers, every card obeys the filters.
  for (const text of await cards.allInnerTexts()) {
    expect(text).toContain('Funk');
    expect(text).toContain('LV2 only');
  }
});

test('library sections: a fresh unit shows the LV2-only set as Ready (S-1)', async ({
  page,
}) => {
  const lv2Only = allFactoryRecipes.filter((r) => r.engine === 'lv2');
  await mockUnit(page, {
    built: lv2Only.map((r) => (r.era ? r.name : `Oxidal · ${r.name}`)),
  });
  await page.goto('/#library/oxidal');
  await expect(
    page.getByText(new RegExp(`${lv2Only.length} ready to play`)),
  ).toBeVisible();
  const first = lv2Only[0]!;
  const card = page.getByRole('article', { name: first.name, exact: true });
  await page
    .getByRole('searchbox', { name: 'Search Oxidal sounds' })
    .fill(first.name);
  await expect(card).toHaveAttribute('data-state', 'ready');
  await expect(
    card.getByRole('button', { name: `Play: ${first.name}` }),
  ).toBeVisible();
});

test('library sections: signed out offers TONE3000 sign-in and the same Get tones dialog returns (S-4)', async ({
  page,
}) => {
  const unit = await mockUnit(page, { signedIn: false });
  const card = await findBrown(page);
  await expect(card).toHaveAttribute('data-state', 'signed-out');
  await expect(card.getByRole('button', { name: /Get tones/ })).toHaveCount(0);
  await card
    .getByRole('button', { name: `Sign in to TONE3000: ${BROWN}` })
    .click();
  await expect(page).toHaveURL(/#settings\/accounts$/);
  unit.state.signedIn = true;
  await page.goBack();
  const dialog = page.getByRole('dialog', { name: `Get tones for ${BROWN}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Plexi test capture · by maker/)).toBeVisible();
  await expect(dialog.getByText('18 MB')).toBeVisible();
  expect(unit.writes).toEqual([]);
});

test('library sections: a removed tone fails cleanly and offers another tone (S-5)', async ({
  page,
}) => {
  const unit = await mockUnit(page);
  const card = await findBrown(page);
  await expect(card).toHaveAttribute('data-state', 'tone');
  await card.getByRole('button', { name: `Get tones: ${BROWN}` }).click();
  const dialog = page.getByRole('dialog', { name: `Get tones for ${BROWN}` });
  await expect(dialog.getByText(/Plexi test capture · by maker/)).toBeVisible();
  unit.state.toneRemoved = true;
  await dialog.getByRole('button', { name: 'Download and build' }).click();
  await expect(
    dialog.getByText('"Plexi test capture" was removed from TONE3000.'),
  ).toBeVisible();
  await expect(dialog.getByText(/Nothing was built/)).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Choose another tone…' }),
  ).toBeVisible();
  expect(unit.writes).not.toContain('POST rigs');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(card.getByRole('alert')).toContainText(
    'was removed from TONE3000',
  );
});

test('library sections: Install pack is disabled with the Protect reason when Protect is on (S-6)', async ({
  page,
}) => {
  const unit = await mockUnit(page, {
    plugins: false,
    packInstalled: false,
    protect: true,
  });
  const card = await findBrown(page);
  await expect(card).toHaveAttribute('data-state', 'pack');
  const install = card.getByRole('button', { name: `Install pack: ${BROWN}` });
  await expect(install).toBeDisabled();
  await expect(
    card.getByText(/Protect is on, so packs cannot be installed/),
  ).toBeVisible();
  await expect(
    card.getByRole('button', { name: /Get tones|Build|Play/ }),
  ).toHaveCount(0);
  expect(unit.writes).toEqual([]);
});

test('library sections: a sound over the capture budget is Too heavy with no Play (S-7)', async ({
  page,
}) => {
  await mockUnit(page, { frames: 16, built: [BROWN] });
  const card = await findBrown(page);
  await expect(card).toHaveAttribute('data-state', 'heavy');
  await expect(card.getByText(/your stream fits 0\./)).toBeVisible();
  await expect(card.getByText(/Fits at a \d+-frame buffer/)).toBeVisible();
  await expect(
    card.getByRole('button', { name: /Play|Build|Get tones/ }),
  ).toHaveCount(0);
  await expect(
    card.getByRole('button', { name: `Details: ${BROWN}` }),
  ).toBeVisible();
});

test('library sections: Make my copy puts a copy in Mine and leaves the original unchanged (S-9)', async ({
  page,
  request,
}) => {
  // A built example on the real daemon: an empty preset named like the recipe
  // and marked as an Oxidal example.
  expect(allFactoryRecipes.find((r) => r.id === 'E80-01')?.name).toBe(BROWN);
  const publish = emptyPreset(BROWN, 'prof');
  const manifest = JSON.parse(publish.manifest_json);
  manifest.extensions['urn:oxidal:authoring'].origin = 'oxidal_example';
  const made = await request.post('/api/v1/presets/rigs', {
    data: { ...publish, manifest_json: JSON.stringify(manifest) },
  });
  expect(made.ok(), await made.text()).toBe(true);
  const original = (await made.json()).revision as string;
  await mockUnit(page, { realLibrary: true });
  await page.goto('/#library/oxidal');
  await page
    .getByRole('searchbox', { name: 'Search Oxidal sounds' })
    .fill(BROWN);
  const card = page.getByRole('article', { name: BROWN, exact: true });
  await expect(card).toHaveAttribute('data-state', 'ready');
  await card.getByRole('button', { name: `Details: ${BROWN}` }).click();
  const sheet = page.getByRole('dialog', { name: BROWN });
  await expect(sheet.getByText('How to play it')).toBeVisible();
  await expect(
    sheet.getByRole('button', { name: 'Add to set list' }),
  ).toBeDisabled();
  await sheet.getByRole('button', { name: 'Make my copy' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByText(/Brown Crunch copy( \d+)? is in Mine\./),
  ).toBeVisible();
  const list = (await (await request.get('/api/v1/presets/rigs')).json())
    .presets as {
    name: string;
    origin: string;
    revision: string;
  }[];
  expect(
    list.some((p) => /^Brown Crunch copy/.test(p.name) && p.origin === 'mine'),
  ).toBe(true);
  const kept = list.find((p) => p.revision === original);
  expect(kept?.origin).toBe('oxidal_example');
  expect(kept?.name).toBe(BROWN);
});
