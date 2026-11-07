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

test('Discover keeps its search and source on refresh and returns after TONE3000 sign-in', async ({
  page,
}) => {
  await page.goto('/#library/discover');
  const search = page.getByPlaceholder('Find a sound or genre…');
  await expect(search).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 600 }));
  await page.waitForTimeout(200);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(400);
  await search.fill('doom');
  await page.reload();
  await expect(search).toHaveValue('doom');
  await page.getByRole('radio', { name: 'TONE3000' }).click();
  const remote = page.getByRole('region', { name: 'TONE3000 sounds' });
  // No account on the test device: remote content asks for sign-in, local stays usable.
  await expect(
    remote.getByText(/already on this device still work/),
  ).toBeVisible();
  await remote.getByRole('button', { name: 'Connect TONE3000' }).click();
  await expect(page).toHaveURL(/#settings\/accounts$/);
  await expect(
    page.getByRole('tab', { name: 'Accounts', selected: true }),
  ).toBeVisible();
  await expect(
    page.getByText('After connecting, you can go back to Discover.'),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#library\/discover$/);
  await expect(page.getByRole('radio', { name: 'TONE3000' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

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
  await expect(
    page.getByRole('button', { name: 'Play to edit…' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#library\/presets$/);
  // Edit without playing (7.3): a draft, saved in place, with no audio change.
  await page.getByRole('button', { name: 'Edit without playing' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit without playing' });
  await expect(editor.getByText('Input straight to output.')).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Save' })).toBeDisabled();
  await editor.getByLabel('Name').fill(`${name} edited`);
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByText(`${name} edited`)).toBeVisible();
  const afterEdit = (
    await (await page.request.get('/api/v1/presets/rigs')).json()
  ).presets as { name: string }[];
  expect(afterEdit.some((p) => p.name === `${name} edited`)).toBe(true);
  expect(afterEdit.some((p) => p.name === name)).toBe(false);
  expect(audioWrites).toEqual([]);
  // Reopening the edited preset offline shows the saved name.
  await page.getByRole('button', { name: `More for ${name} edited` }).click();
  await page.getByRole('menuitem', { name: 'Edit without playing…' }).click();
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
  const listed = await page.request.get('/api/v1/presets/rigs');
  const presets = (await listed.json()).presets as {
    name: string;
    origin: string;
    native_instances: number;
    lv2_instances: number;
  }[];
  expect(presets.find((p) => p.name === `${name} edited`)).toMatchObject({
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
