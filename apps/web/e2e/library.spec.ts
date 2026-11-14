import { expect, test, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openSounds } from './display';

/**
 * Library journeys against the real daemon: two groups of sections with their
 * own links, old links that land on the new sections, one Mine list, an empty
 * preset from New preset, protected sound deletion and the device-wide Protect
 * lock.
 */
test('library sections have their own links and old links redirect', async ({
  page,
}) => {
  // an old Discover link lands on Oxidal sounds.
  await page.goto('/#library/discover');
  await expect(
    page.getByRole('tab', { name: 'Oxidal sounds', selected: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#library\/oxidal$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/#library/presets');
  await expect(
    page.getByRole('tab', { name: 'Mine', selected: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#library\/mine$/);
  await page.goto('/#library/sounds');
  await expect(
    page.getByRole('tab', { name: 'Tones and IRs', selected: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#library\/tones$/);
  await page.getByRole('tab', { name: 'TONE3000', exact: true }).click();
  await expect(page).toHaveURL(/#library\/tone3000$/);
  await page.reload();
  await expect(
    page.getByRole('tab', { name: 'TONE3000', selected: true }),
  ).toBeVisible();
  await expect(page.getByLabel('TONE3000 preset file')).toBeVisible();
  // Two groups; on a phone a Sounds | Media switch shows one at a time.
  const phone = (page.viewportSize()?.width ?? 1000) < 600;
  const groups = page.getByRole('radiogroup', { name: 'Library group' });
  if (phone) {
    await expect(page.getByRole('tab', { name: 'Backing tracks' })).toHaveCount(
      0,
    );
    await groups.getByRole('radio', { name: 'Media', exact: true }).click();
    await expect(
      page.getByRole('tab', { name: 'Backing tracks', selected: true }),
    ).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Mine' })).toHaveCount(0);
  } else {
    await expect(groups).toBeHidden();
    await page.getByRole('tab', { name: 'DI and reamps', exact: true }).click();
    await expect(page).toHaveURL(/#library\/di$/);
    await expect(page.getByRole('tab', { name: 'Mine' })).toBeVisible();
  }
  // The old Sound Check link still opens the renamed Levels workspace.
  await page.goto('/#monitor');
  await expect(
    page
      .getByRole('navigation', { name: 'Instrument navigation' })
      .getByRole('button', { name: 'Levels', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
});

test('library sections keep the Mine search after a reload', async ({
  page,
}) => {
  await page.goto('/#library/mine');
  const search = page.getByRole('searchbox', { name: 'Search presets' });
  await search.fill('no-such-preset-unique');
  await page.reload();
  await expect(search).toHaveValue('no-such-preset-unique');
  await page.getByRole('button', { name: 'Clear preset search' }).click();
  await expect(search).toHaveValue('');
});

test('Settings sections have links and Effects shows which presets need a pack', async ({
  page,
}) => {
  await page.goto('/#settings/effects');
  await expect(
    page.getByRole('tab', { name: 'Effects', selected: true }),
  ).toBeVisible();
  const effects = page.getByRole('region', { name: 'Effects' });
  await expect(
    effects.getByRole('list', { name: 'Curated packs' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'About', exact: true }).click();
  await expect(page).toHaveURL(/#settings\/about$/);
  await page.reload();
  await expect(
    page.getByRole('tab', { name: 'About', selected: true }),
  ).toBeVisible();
});

type RigEntry = {
  name: string;
  origin: string;
  native_instances: number;
  lv2_instances: number;
};
/** Every saved rig: the daemon lists them a page at a time. */
async function allRigs(request: APIRequestContext) {
  const rigs: RigEntry[] = [];
  let after: string | null = null;
  do {
    const page: { presets: RigEntry[]; next?: string | null } = await (
      await request.get(`/api/v1/presets/rigs${after ? `?after=${after}` : ''}`)
    ).json();
    rigs.push(...page.presets);
    after = page.next ?? null;
  } while (after);
  return rigs;
}

test('new preset creates an empty preset of your own without hardware', async ({
  page,
}, info) => {
  const name = `Empty ${info.project.name} ${Date.now()}`;
  const audioWrites: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      /\/api\/v1\/(audio|rig-audio|graph-audio)$/.test(
        new URL(request.url()).pathname,
      )
    )
      audioWrites.push(request.url());
  });
  await page.goto('/#library/mine');
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
  await expect(
    page.getByRole('button', { name: 'Play to edit…' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#library\/mine$/);
  // Edit without playing (7.3): a draft, saved in place, with no audio change.
  await page.getByRole('button', { name: 'Edit without playing' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit without playing' });
  await expect(editor.getByText('Input straight to output.')).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Save' })).toBeDisabled();
  await editor.getByLabel('Name').fill(`${name} edited`);
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toHaveCount(0);
  // Mine is paged: on a device that ran many tests the row can be on a later page.
  const edited = page.getByText(`${name} edited`, { exact: true });
  // Only an enabled button can be clicked: it is disabled while a page loads
  // and gone after the last page.
  const more = page.getByRole('button', {
    name: 'Load more',
    exact: true,
    disabled: false,
  });
  await page.getByRole('searchbox', { name: 'Search presets' }).fill(name);
  while ((await edited.count()) === 0) {
    await expect(edited.or(more).first()).toBeVisible();
    if ((await edited.count()) === 0) await more.click();
  }
  await expect(edited).toBeVisible();
  const afterEdit = await allRigs(page.request);
  expect(afterEdit.some((p) => p.name === `${name} edited`)).toBe(true);
  expect(afterEdit.some((p) => p.name === name)).toBe(false);
  expect(audioWrites).toEqual([]);
  // Reopening the edited preset offline shows the saved name.
  await page.getByRole('button', { name: `More for ${name} edited` }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await expect(
    page
      .getByRole('dialog', { name: 'Edit without playing' })
      .getByLabel('Name'),
  ).toHaveValue(`${name} edited`);
  await page
    .getByRole('dialog', { name: 'Edit without playing' })
    .getByRole('button', { name: 'Cancel' })
    .click();
  expect(audioWrites).toEqual([]);
  // Creation publishes to Mine without any audio mutation.
  const presets = afterEdit;
  expect(presets.find((p) => p.name === `${name} edited`)).toMatchObject({
    origin: 'mine',
    native_instances: 0,
    lv2_instances: 0,
  });
  // Remove the preset this test made, so Mine stays short for later journeys.
  const items = (
    await (await page.request.get('/api/v1/presets/catalog')).json()
  ).items as { id: string; name: string; kind: string }[];
  for (const item of items.filter(
    (i) => i.kind === 'rig' && [name, `${name} edited`].includes(i.name),
  )) {
    const preview = await page.request.get(
      `/api/v1/presets/removal?kind=rig&id=${item.id}`,
    );
    if (!preview.ok()) continue;
    const { token, blocked } = await preview.json();
    if (blocked) continue;
    await page.request.post('/api/v1/presets/removal', {
      data: {
        entry_kind: 'rig',
        id: item.id,
        expected_preview: token,
        delete_models: false,
      },
    });
  }
});

test('the same TONE3000 tone added twice saves as two NAM blocks (7.16)', async ({
  page,
}, info) => {
  const bytes = readFileSync(
    new URL(
      '../../../crates/oxidal-presets/tests/fixtures/authored-current.t3kpreset',
      import.meta.url,
    ),
  );
  const imported = await (
    await page.request.post('/api/v1/presets', {
      data: bytes,
      headers: { 'Content-Type': 'application/octet-stream' },
    })
  ).json();
  const name = `Two NAM ${info.project.name} ${Date.now()}`;
  await page.goto('/#library/mine');
  await page.getByRole('button', { name: 'New preset' }).click();
  const create = page.getByRole('dialog', { name: 'New preset' });
  await create.getByLabel('Name').fill(name);
  await create.getByRole('button', { name: 'Create preset' }).click();
  await expect(create).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit without playing' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit without playing' });
  for (let i = 0; i < 2; i += 1) {
    await editor
      .getByRole('combobox', { name: 'Add a block at the end' })
      .click();
    // By file hash: another test may import a preset with the same name.
    await page
      .locator(`[role="option"][data-value="tone:original:${imported.sha256}"]`)
      .click();
  }
  await expect(editor.getByText('TONE3000', { exact: true })).toHaveCount(2);
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toHaveCount(0);
  const presets = (
    await (await page.request.get('/api/v1/presets/rigs')).json()
  ).presets as { name: string; revision: string; native_instances: number }[];
  const saved = presets.find((p) => p.name === name)!;
  expect(saved.native_instances).toBe(2);
  // Both blocks share one stored file; the original stays unchanged.
  const document = await (
    await page.request.get(`/api/v1/presets/rigs/${saved.revision}`)
  ).json();
  expect(document.manifest.resources).toHaveLength(1);
  expect(document.manifest.resources[0].sha256).toBe(imported.sha256);
  const original = await page.request.get(
    `/api/v1/presets/${imported.sha256}/original`,
  );
  expect(Buffer.from(await original.body())).toEqual(bytes);
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
  await page.goto('/#library/tones');
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

test('the daemon stores and reopens a four-voice route with a dry path and nested split', async ({
  request,
}) => {
  const { buildRoute } = await import('../src/rigRoute');
  const { chainLanes } = await import('../src/rigChain');
  const { lv2Effect } = await import('../src/rigDraft');
  const port = (index: number, symbol: string, input: boolean) => ({
    index,
    symbol,
    audio: true,
    control: false,
    atom: false,
    input,
    output: !input,
    integer: false,
    toggled: false,
    logarithmic: false,
    latency: false,
    minimum: null,
    maximum: null,
    default: null,
  });
  const plugin = {
    name: 'Route test',
    uri: 'urn:example:route-test',
    unsupported: null,
    ports: [
      port(0, 'in_l', true),
      port(1, 'out_l', false),
      port(2, 'in_r', true),
      port(3, 'out_r', false),
    ],
  };
  const fx = (id: string) => ({ ...lv2Effect(plugin), id, name: id });
  const split = (tag: string, branches: unknown[][], gains?: number[]) => ({
    kind: 'split' as const,
    split: `split-${tag}`,
    merge: `merge-${tag}`,
    gains: gains ?? branches.map(() => 1),
    branches,
  });
  const route = [
    fx('input-fx'),
    split(
      'voices',
      [
        [fx('clean')],
        [fx('rhythm'), split('inner', [[fx('octave')], [fx('fuzz')]])],
        [fx('lead')],
        [],
      ],
      [1, 0.8, 0.5, 0.25],
    ),
    fx('room'),
  ];
  const publish = buildRoute(
    crypto.randomUUID(),
    'Four voices',
    route as never,
    'prof',
  );
  const published = await request.post('/api/v1/presets/rigs', {
    data: publish,
  });
  expect(published.ok(), await published.text()).toBe(true);
  const { revision } = await published.json();
  const reopened = await (
    await request.get(`/api/v1/presets/rigs/${revision}`)
  ).json();
  const graph = reopened.manifest.oxidal.graph;
  expect(chainLanes(graph)).toEqual([
    ['input-fx', 'clean', 'room'],
    ['input-fx', 'rhythm', 'octave', 'room'],
    ['input-fx', 'rhythm', 'fuzz', 'room'],
    ['input-fx', 'lead', 'room'],
    ['input-fx', 'room'],
  ]);
  const node = (id: string) =>
    graph.nodes.find((n: { id: string }) => n.id === id);
  expect(node('merge-voices-right').inputGains).toEqual([1, 0.8, 0.5, 0.25]);
  expect(node('split-inner-left').audioOutputs).toBe(2);
  expect(JSON.parse(publish.manifest_json).oxidal.graph.edges.length).toBe(
    graph.edges.length,
  );
});
