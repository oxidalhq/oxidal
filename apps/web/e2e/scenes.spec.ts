import { createHash, randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

/**
 * Set list, Duplicate and scene management against the real daemon (FR-8,
 * FR-9): Duplicate leaves "Name copy" outside the set list and opens it
 * stopped (S-10), the starter set list appends (S-20) and is offered once on
 * a fresh unit (S-1), and the scene menu reorders with MIDI bindings following
 * the scene (S-13), refuses to delete the last scene (S-12) and shows what
 * Copy to preset… skips before copying (S-11). Rig audio is a transport
 * fixture; publishing, the library catalog and the MIDI map are real.
 */
type Scene = { id: string; name: string; value: number };
function manifest(
  name: string,
  scenes: Scene[],
  {
    id = randomUUID(),
    origin = 'mine',
    gain = 'scene-gain',
  }: { id?: string; origin?: string; gain?: string } = {},
) {
  return {
    format: 'oxidal.preset',
    formatVersion: 1,
    id,
    name,
    tone3000: { instances: [] },
    oxidal: {
      graph: {
        nodes: [
          { id: 'in', kind: 'input', audioInputs: 0, audioOutputs: 1 },
          {
            id: gain,
            kind: 'gain',
            audioInputs: 1,
            audioOutputs: 1,
            inputGains: [scenes[0]!.value],
          },
          { id: 'out', kind: 'output', audioInputs: 1, audioOutputs: 0 },
        ],
        edges: [
          { from: { node: 'in', port: 0 }, to: { node: gain, port: 0 } },
          { from: { node: gain, port: 0 }, to: { node: 'out', port: 0 } },
        ],
      },
      lv2: [],
      recall: { tails: 'cut' },
    },
    resources: [],
    extensions: {
      'urn:oxidal:gain:1': {},
      'urn:oxidal:authoring': { origin },
      'urn:oxidal:scenes:1': {
        fade_ms: 10,
        scenes: scenes.map((s) => ({
          id: s.id,
          name: s.name,
          gains: [{ node: gain, port: 0, value: s.value }],
        })),
      },
    },
    requiredExtensions: ['urn:oxidal:gain:1', 'urn:oxidal:scenes:1'],
  };
}
async function publish(
  request: APIRequestContext,
  document: ReturnType<typeof manifest>,
): Promise<string> {
  const response = await request.post('/api/v1/presets/rigs', {
    data: { manifest_json: JSON.stringify(document), resources: {} },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).revision;
}
type Item = {
  kind: string;
  id: string;
  name: string;
  origin: string;
  in_set_list?: boolean;
};
async function catalog(request: APIRequestContext) {
  return (await (await request.get('/api/v1/presets/catalog')).json()) as {
    revision: string;
    items: Item[];
  };
}
async function edit(
  request: APIRequestContext,
  id: string,
  action: Record<string, unknown>,
) {
  const current = await catalog(request);
  const response = await request.post('/api/v1/presets/catalog', {
    data: {
      expected_revision: current.revision,
      entry_kind: 'rig',
      id,
      action,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
}
/** Delete what a journey published, so the shared unit's Mine stays short
 * for the paged journeys that run after this one. */
async function remove(request: APIRequestContext, ids: string[]) {
  for (const id of ids) {
    const preview = await request.get(
      `/api/v1/presets/removal?kind=rig&id=${id}`,
    );
    if (!preview.ok()) continue;
    const { token, blocked } = await preview.json();
    if (blocked) continue;
    await request.post('/api/v1/presets/removal', {
      data: {
        entry_kind: 'rig',
        id,
        expected_preview: token,
        delete_models: false,
      },
    });
  }
}
/** The current revision of each preset named here (saves replace revisions). */
async function current(request: APIRequestContext, names: string[]) {
  return (await catalog(request)).items
    .filter(
      (i) =>
        names.includes(i.name) && !(i as { superseded?: boolean }).superseded,
    )
    .map((i) => i.id);
}
const members = async (request: APIRequestContext) =>
  (await catalog(request)).items.filter((i) => i.in_set_list).map((i) => i.id);
/** Audio commands the page sends, which these journeys must not need. */
function audioWrites(page: Page) {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      /\/api\/v1\/(audio|rig-audio|graph-audio)$/.test(
        new URL(request.url()).pathname,
      )
    )
      writes.push(request.url());
  });
  return writes;
}

test('library sections: Duplicate makes "Name copy" in Mine outside the set list and opens it stopped (S-10)', async ({
  page,
  request,
}, info) => {
  // Publishing, duplicating and cleaning up are real daemon writes.
  test.slow();
  const name = `Dup ${info.project.name} ${Date.now()}`;
  const source = await publish(
    request,
    manifest(name, [
      { id: 'clean', name: 'Clean', value: 1 },
      { id: 'lead', name: 'Lead', value: 0.5 },
    ]),
  );
  const writes = audioWrites(page);
  try {
    await page.goto('/#library/mine');
    await page.getByRole('searchbox', { name: 'Search presets' }).fill(name);
    // Mine is paged: on a unit that ran many journeys the row can be later.
    const row = page.getByRole('button', { name: `More for ${name}` });
    // Disabled while a page loads, gone after the last page.
    const more = page.getByRole('button', {
      name: 'Load more',
      exact: true,
      disabled: false,
    });
    while ((await row.count()) === 0) {
      await expect(row.or(more).first()).toBeVisible();
      if ((await row.count()) === 0) await more.click();
    }
    await row.click();
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    // Opened stopped: the editor that never changes audio.
    const editor = page.getByRole('dialog', { name: 'Edit without playing' });
    await expect(editor.getByLabel('Name')).toHaveValue(`${name} copy`);
    await editor.getByRole('button', { name: 'Cancel' }).click();
    await expect(
      page.getByText(`"${name} copy" is in Mine. It is not in the set list.`),
    ).toBeVisible();
    const items = (await catalog(request)).items;
    const copy = items.find((i) => i.name === `${name} copy`)!;
    expect(copy).toMatchObject({ kind: 'rig', origin: 'mine' });
    expect(copy.in_set_list).toBe(false);
    expect(items.find((i) => i.id === source)!.in_set_list).toBe(true);
    // Scenes came with it.
    const document = await (
      await request.get(`/api/v1/presets/rigs/${copy.id}`)
    ).json();
    expect(
      document.manifest.extensions['urn:oxidal:scenes:1'].scenes.map(
        (s: { name: string }) => s.name,
      ),
    ).toEqual(['Clean', 'Lead']);
    // The Set list shows it under "Not in the set list", ready to add.
    await page.getByRole('tab', { name: 'Set list', exact: true }).click();
    const outside = page.getByRole('region', { name: 'Not in the set list' });
    await outside.getByRole('button', { name: 'Show', exact: true }).click();
    await outside
      .getByRole('button', { name: `Add ${name} copy to the set list` })
      .click();
    await expect(
      page.getByText(/^Added to the set list as #\d+\.$/),
    ).toBeVisible();
    expect(await members(request)).toContain(copy.id);
    expect(writes).toEqual([]);
  } finally {
    await remove(request, await current(request, [name, `${name} copy`]));
  }
});

/** The starter Oxidal sounds as read-only examples (D-8), in starter order. */
const STARTER = [
  'Two Rooms',
  'Pocket Wire',
  'Dust Road',
  'Offbeat',
  'Ducked Lead',
  'Slow Weather',
  'Reed Circuit',
  'Low Lantern',
  'Broken Radio',
];
async function installStarter(request: APIRequestContext) {
  const ids: string[] = [];
  for (const name of STARTER) {
    const hex = createHash('sha256')
      .update(`e2e-starter:${name}`)
      .digest('hex');
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    ids.push(
      await publish(
        request,
        manifest(name, [{ id: 'bed', name: 'Bed', value: 1 }], {
          id,
          origin: 'oxidal_example',
        }),
      ),
    );
  }
  return ids;
}

test('library sections: Add starter set list appends after the existing entries (S-20)', async ({
  page,
  request,
}, info) => {
  test.slow();
  const starter = await installStarter(request);
  // Start from a set list that holds entries but none of the starter.
  for (const id of starter)
    if ((await members(request)).includes(id))
      await edit(request, id, { kind: 'set_list', member: false });
  const existing = await publish(
    request,
    manifest(`Existing ${info.project.name} ${Date.now()}`, [
      { id: 'clean', name: 'Clean', value: 1 },
    ]),
  );
  const before = await members(request);
  expect(before.length).toBeGreaterThan(0);
  try {
    await page.goto('/#library/setlist');
    const list = page.getByRole('region', { name: 'Set list', exact: true });
    await list.getByRole('button', { name: 'Add starter set list' }).click();
    await expect(list.getByRole('status')).toHaveText(
      `Added 9 after your ${before.length} existing entries. Nothing was replaced.`,
    );
    const after = await members(request);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length)).toEqual(starter);
    // The first starter preset is numbered after the existing entries.
    await expect(
      list
        .locator(`[data-library-entry="${starter[0]}"]`)
        .getByLabel(`Set-list position ${before.length + 1}`),
    ).toBeVisible();
    // Adding again replaces nothing and adds nothing.
    await list.getByRole('button', { name: 'Add starter set list' }).click();
    await expect(list.getByRole('status')).toHaveText(
      'The starter set list is already in your set list.',
    );
    expect(await members(request)).toEqual(after);
  } finally {
    // Leave the shared unit's set list and Mine as other journeys expect them.
    await remove(request, [existing, ...starter]);
  }
});

test('library sections: a fresh unit offers the starter set list once (S-1)', async ({
  page,
}) => {
  const example = (name: string, i: number) => ({
    kind: 'rig',
    id: String(i).repeat(64).slice(0, 64),
    name,
    source_name: name,
    origin: 'oxidal_example',
    archived: false,
    in_set_list: false,
  });
  let fresh = {
    revision: 'fresh',
    starter_offered: false,
    items: STARTER.map((name, i) => example(name, (i + 1) % 10)),
  };
  const posts: unknown[] = [];
  await page.route('**/api/v1/presets/catalog', async (route) => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      fresh = {
        revision: 'added',
        starter_offered: true,
        items: fresh.items.map((i) => ({ ...i, in_set_list: true })),
      };
    }
    await route.fulfill({ json: fresh });
  });
  await page.goto('/#library/oxidal');
  const offer = page.getByRole('region', { name: 'Starter set list' });
  await expect(offer).toContainText('Start with a set list?');
  await offer.getByRole('button', { name: 'Add starter set list' }).click();
  await expect(
    page.getByText('Starter set list added: 9 presets.'),
  ).toBeVisible();
  await expect(offer).toHaveCount(0);
  expect(posts).toEqual([
    {
      expected_revision: 'fresh',
      action: {
        kind: 'starter',
        entries: fresh.items.map(({ kind, id }) => ({ kind, id })),
      },
    },
  ]);
  // Offered once: it does not come back.
  await page.reload();
  await expect(
    page.getByRole('tab', { name: 'Oxidal sounds', selected: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Starter set list' }),
  ).toHaveCount(0);
});

/** A running rig transport fixture that follows Stop and Start of real revisions. */
async function mockRig(
  page: Page,
  request: APIRequestContext,
  revision: string,
) {
  const baseline = await (await request.get('/api/v1/rig-audio')).json();
  const input = {
    endpoint: 'default',
    direction: 'capture',
    sample_rate: 48000,
    channels: 2,
    format: 's16',
    period_frames: 128,
    periods: 3,
  };
  let count = 0;
  const running = async (rev: string) => {
    const document = await (
      await request.get(`/api/v1/presets/rigs/${rev}`)
    ).json();
    const scenes = document.manifest.extensions['urn:oxidal:scenes:1'];
    count++;
    return {
      ...baseline,
      phase: 'running',
      device_owned: true,
      configured: {
        revision: rev,
        stream: {
          input,
          output: { ...input, direction: 'playback' },
          input_map: [0, 1],
          output_map: [0, 1],
        },
      },
      control: {
        session: `scenes-${count}`,
        revision: 1,
        source_revision: rev,
        modified: false,
        buffer_bytes: 1024,
        latency_frames: 0,
        controls: [],
        scenes,
        scene: scenes.scenes[0].id,
      },
    };
  };
  let state = await running(revision);
  // These presets hold no effects; the unit's effect scan is not needed.
  await page.route('**/api/v1/plugins/lv2?*', (route) =>
    route.fulfill({ json: { sample_rate: 48000, plugins: [] } }),
  );
  await page.route('**/api/v1/rig-audio', async (route) => {
    if (route.request().method() === 'POST') {
      const action = route.request().postDataJSON().action;
      if (action.kind === 'stop')
        state = { ...state, phase: 'stopped', device_owned: false };
      else if (action.kind === 'start')
        state = await running(action.settings.revision);
      else if (action.kind === 'scene')
        state = {
          ...state,
          control: {
            ...state.control,
            scene: action.command.scene,
            revision: state.control.revision + 1,
          },
        };
    }
    await route.fulfill({ json: state });
  });
  return () => state.configured.revision as string;
}
async function bind(
  request: APIRequestContext,
  revision: string,
  scenes: [string, number][],
) {
  const { revision: expected, ...map } = await (
    await request.get('/api/v1/midi/map')
  ).json();
  const response = await request.post('/api/v1/midi/map', {
    data: {
      ...map,
      expected_revision: expected,
      entries: [
        ...map.entries,
        {
          entry: { kind: 'rig', id: revision },
          bindings: scenes.map(([scene, controller]) => ({
            scene,
            program: null,
            controller,
          })),
          branch_bindings: [],
          parameter_bindings: [],
        },
      ],
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
}
async function bindings(request: APIRequestContext, revision: string) {
  const map = await (await request.get('/api/v1/midi/map')).json();
  return (
    map.entries.find((e: { entry: { id: string } }) => e.entry.id === revision)
      ?.bindings ?? []
  ).map((b: { scene: string; controller: number }) => [b.scene, b.controller]);
}

test('mixed rig authoring: scenes move with their MIDI bindings and the last scene cannot be deleted (S-12, S-13)', async ({
  page,
  request,
}, info) => {
  const name = `Scenes ${info.project.name} ${Date.now()}`;
  const first = await publish(
    request,
    manifest(name, [
      { id: 'clean', name: 'Clean', value: 1 },
      { id: 'lead', name: 'Lead', value: 0.5 },
    ]),
  );
  await bind(request, first, [
    ['clean', 70],
    ['lead', 71],
  ]);
  const playing = await mockRig(page, request, first);
  try {
    await page.goto('/');
    const pads = page.getByRole('group', { name: 'Scenes' });
    await expect(
      pads.getByRole('button', { name: 'Scene 2: Lead' }),
    ).toBeVisible();
    // S-13: Move left from the pad's menu. The binding follows the scene.
    await page.getByRole('button', { name: 'More for scene Lead' }).click();
    const menu = page.getByRole('dialog', { name: 'Scene 2: Lead' });
    await expect(
      menu.getByRole('menuitem', { name: 'Move right' }),
    ).toBeDisabled();
    await menu.getByRole('menuitem', { name: 'Move left' }).click();
    await expect(
      page.getByText(
        'Moved. MIDI bindings follow the scene, not its position.',
      ),
    ).toBeVisible();
    await expect(
      pads.getByRole('button', { name: 'Scene 1: Lead' }),
    ).toBeVisible();
    const moved = playing();
    expect(moved).not.toBe(first);
    expect((await bindings(request, moved)).sort()).toEqual([
      ['clean', 70],
      ['lead', 71],
    ]);
    // The saved preset kept its place and name: one preset in Mine.
    const items = (await catalog(request)).items;
    expect(items.find((i) => i.id === moved)!.name).toBe(name);
    // Delete Clean, then the last scene is refused with the reason (S-12).
    await page.getByRole('button', { name: 'More for scene Clean' }).click();
    await page
      .getByRole('dialog', { name: 'Scene 2: Clean' })
      .getByRole('menuitem', { name: 'Delete…' })
      .click();
    const confirm = page.getByRole('dialog', { name: 'Delete scene "Clean"?' });
    await expect(confirm).toContainText('Its MIDI binding is removed too.');
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('Scene Clean deleted.')).toBeVisible();
    await expect(pads.getByRole('button')).toHaveCount(2);
    expect(await bindings(request, playing())).toEqual([['lead', 71]]);
    const last = playing();
    await page.getByRole('button', { name: 'Scene menu for Lead' }).click();
    await page
      .getByRole('dialog', { name: 'Scene 1: Lead' })
      .getByRole('menuitem', { name: 'Delete…' })
      .click();
    const refused = page.getByRole('dialog', { name: 'Cannot delete' });
    await expect(refused.getByRole('alert')).toHaveText(
      'A preset needs one scene.',
    );
    await refused.getByRole('button', { name: 'OK' }).click();
    expect(playing()).toBe(last);
  } finally {
    await remove(request, await current(request, [name]));
  }
});

test('mixed rig authoring: Copy to preset lists what is skipped before copying (S-11)', async ({
  page,
  request,
}, info) => {
  const stamp = `${info.project.name} ${Date.now()}`;
  const source = await publish(
    request,
    manifest(`Lead ${stamp}`, [
      { id: 'clean', name: 'Clean', value: 1 },
      { id: 'lead', name: 'Lead', value: 0.5 },
    ]),
  );
  const crunchName = `Crunch ${stamp}`;
  const crunch = await publish(
    request,
    manifest(crunchName, [{ id: 'rhythm', name: 'Rhythm', value: 0.8 }], {
      gain: 'mix-gain',
    }),
  );
  await mockRig(page, request, source);
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'More for scene Lead' }).click();
    await page
      .getByRole('dialog', { name: 'Scene 2: Lead' })
      .getByRole('menuitem', { name: 'Copy to preset…' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Copy to preset' });
    await dialog
      .getByLabel("Copy 'Lead' to")
      .selectOption({ label: crunchName });
    const plan = dialog.getByRole('list', { name: 'What copies' });
    await expect(plan).toContainText(
      `⚠ ${crunchName} has no path 1 at 'scene-gain': its level is skipped.`,
    );
    await expect(plan).toContainText(
      `Path 1 at 'mix-gain' keeps ${crunchName}'s own level.`,
    );
    // Nothing is copied until confirmed.
    const unchanged = (await catalog(request)).items.find(
      (i) => i.name === crunchName,
    )!;
    expect(unchanged.id).toBe(crunch);
    await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(
      page.getByText(`"Lead" copied to ${crunchName} as scene 2.`),
    ).toBeVisible();
    const saved = (await catalog(request)).items.find(
      (i) => i.name === crunchName && i.id !== crunch,
    )!;
    const document = await (
      await request.get(`/api/v1/presets/rigs/${saved.id}`)
    ).json();
    expect(
      document.manifest.extensions['urn:oxidal:scenes:1'].scenes.map(
        (s: { name: string; gains: { value: number }[] }) => [
          s.name,
          s.gains[0]!.value,
        ],
      ),
    ).toEqual([
      ['Rhythm', 0.8],
      ['Lead', 0.8],
    ]);
  } finally {
    await remove(
      request,
      await current(request, [`Lead ${stamp}`, crunchName]),
    );
  }
});
