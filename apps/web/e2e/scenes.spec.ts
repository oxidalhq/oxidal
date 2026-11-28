import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { MidiMap, Preset, RigControl } from '../src/api';
import type { RigPublish } from '../src/generated/contract';
import { sceneRig } from '../src/rigDraft';
import {
  chooseBoard,
  expectWorkspaceSection,
  minePresetAction,
  openCapsule,
  selectWorkspaceSection,
  useTreeChain,
} from './display';

/**
 * Set list, Duplicate and scene management against the real daemon: Duplicate leaves "Name copy" outside the set list and opens it
 * stopped, the starter set list appends and is offered once on
 * a fresh unit, and the scene menu reorders with MIDI bindings following
 * the scene, refuses to delete the last scene and shows what
 * Copy to preset… skips before copying. Rig audio is a transport
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
  document: object,
  resources: RigPublish['resources'] = {},
): Promise<string> {
  const response = await request.post('/api/v1/presets/rigs', {
    data: { manifest_json: JSON.stringify(document), resources },
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
/**
 * A scene's own menu: its ⋯ on a wide screen; a phone shows the ⋯ only on
 * the playing tab, so the menu opens by holding (here, right-clicking) the tab.
 */
async function sceneMenu(page: Page, name: string) {
  const tab = page.getByRole('button', {
    name: new RegExp(`^Scene \\d+: ${name}$`),
  });
  await expect(tab).toBeVisible();
  const more = page.getByRole('button', { name: `More for scene ${name}` });
  if (await more.isVisible()) await more.click();
  // Held at its start, clear of the playing tab's own ⋯.
  else await tab.click({ button: 'right', position: { x: 6, y: 10 } });
}

/** Edit scenes is behind the scene row's ⋯ (C2). */
async function openEditScenes(page: Page) {
  await page
    .getByRole('button', { name: 'Scene options', exact: true })
    .click();
  await page.getByRole('button', { name: 'Edit scenes', exact: true }).click();
}

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

test('library sections: Duplicate makes "Name copy" in Mine outside the set list and opens it stopped', async ({
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
    const row = page.getByRole('button', {
      name: `Favourite ${name}`,
      exact: true,
    });
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
    await minePresetAction(page, name, 'Duplicate');
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
      (
        document.manifest.extensions['urn:oxidal:scenes:2'] ??
        document.manifest.extensions['urn:oxidal:scenes:1']
      ).scenes.map((s: { name: string }) => s.name),
    ).toEqual(['Clean', 'Lead']);
    // The Set list shows it under "Not in the set list", ready to add.
    await selectWorkspaceSection(page, 'Library', 'Set list');
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

/** The starter Oxidal sounds as read-only examples, in starter order. */
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

test('library sections: Add starter set list appends after the existing entries', async ({
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
    await expect(
      list.getByRole('status').filter({ hasText: 'Added 9 after' }),
    ).toHaveText(
      `Added 9 after your ${before.length} existing entries. Nothing was replaced.`,
    );
    const after = await members(request);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length)).toEqual(starter);
    // Manage presets exposes each catalog entry and its set position.
    await list
      .getByRole('button', { name: 'Manage presets', exact: true })
      .click();
    // The first starter preset is numbered after the existing entries.
    await expect(
      list
        .locator(`[data-library-entry="${starter[0]}"]`)
        .getByLabel(`Set-list position ${before.length + 1}`),
    ).toBeVisible();
    // Adding again replaces nothing and adds nothing.
    await list.getByRole('button', { name: 'Add starter set list' }).click();
    await expect(
      list.getByRole('status').filter({ hasText: 'already in your set list' }),
    ).toHaveText('The starter set list is already in your set list.');
    expect(await members(request)).toEqual(after);
  } finally {
    // Leave the shared unit's set list and Mine as other journeys expect them.
    await remove(request, [existing, ...starter]);
  }
});

test('library sections: a fresh unit offers the starter set list once', async ({
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
  await expectWorkspaceSection(page, 'Library', 'Oxidal sounds');
  await expect(
    page.getByRole('region', { name: 'Starter set list' }),
  ).toHaveCount(0);
});

/** A running rig transport fixture that follows Stop and Start of real revisions. */
async function mockRig(
  page: Page,
  request: APIRequestContext,
  revision: string,
  controls: RigControl[] = [],
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
  function branchStates(
    layout: {
      branches?: {
        id: string;
        name: string;
        gains: { node: string; port: number; value: number }[];
      }[];
      scenes: {
        id: string;
        gains: { node: string; port: number; value: number }[];
      }[];
    },
    sceneId: string,
  ) {
    const gains = layout.scenes.find((scene) => scene.id === sceneId)?.gains;
    return layout.branches?.map(({ id, name, gains: expected }) => ({
      id,
      name,
      enabled: expected.some(({ node, port }) =>
        gains?.some(
          (gain) =>
            gain.node === node && gain.port === port && gain.value !== 0,
        ),
      ),
      partial: false,
    }));
  }
  const wetGroup = (enabled: boolean) => ({
    id: 'wet',
    name: 'Wet',
    nodes: ['echo'],
    enabled,
    partial: false,
  });
  const running = async (rev: string) => {
    const document = await (
      await request.get(`/api/v1/presets/rigs/${rev}`)
    ).json();
    const scenes =
      document.manifest.extensions['urn:oxidal:scenes:3'] ??
      document.manifest.extensions['urn:oxidal:scenes:2'] ??
      document.manifest.extensions['urn:oxidal:scenes:1'];
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
        // The daemon's shared scene draft survives across browser tests.
        session: randomUUID(),
        revision: 1,
        source_revision: rev,
        modified: false,
        buffer_bytes: 1024,
        latency_frames: 0,
        controls,
        scenes,
        scene: scenes.scenes[0].id,
        branches: branchStates(scenes, scenes.scenes[0].id),
        stomp_scene: null as string | null,
        stomp_groups: undefined as
          { id: string; enabled: boolean; partial: boolean }[] | undefined,
      },
    };
  };
  let state = await running(revision);
  let testingWet = false;
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
      else if (
        action.kind === 'stomp_group' &&
        action.command.group === 'wet'
      ) {
        expect(action.command.session).toBe(state.control.session);
        expect(action.command.expected_revision).toBe(state.control.revision);
        testingWet = !testingWet;
        state = {
          ...state,
          control: {
            ...state.control,
            stomp_scene: state.control.scene,
            revision: state.control.revision + 1,
            stomp_groups: [wetGroup(testingWet)],
          },
        };
      } else if (action.kind === 'scene') {
        testingWet = false;
        state = {
          ...state,
          control: {
            ...state.control,
            scene: action.command.scene,
            branches: branchStates(state.control.scenes, action.command.scene),
            revision: state.control.revision + 1,
            ...(state.control.stomp_groups
              ? {
                  stomp_scene: action.command.scene,
                  stomp_groups: [wetGroup(false)],
                }
              : {}),
          },
        };
      }
    }
    await route.fulfill({ json: state });
  });
  return Object.assign(() => state.configured.revision as string, {
    changeCursor: () => {
      state.control = {
        ...state.control,
        revision: state.control.revision + 1,
      };
    },
    recall: async (next: string) => {
      state = await running(next);
    },
    addWetReadback: () => {
      state.control = {
        ...state.control,
        stomp_groups: [wetGroup(false)],
      };
    },
  });
}

test('mixed rig authoring: preset switches persist both gestures and release Freeze on cancellation', async ({
  page,
  request,
}) => {
  const doc = manifest('Custom stage switches', [
    { id: 'clean', name: 'Clean', value: 1 },
  ]);
  const echo = {
    id: 'echo',
    kind: 'lv2',
    audioInputs: 1,
    audioOutputs: 1,
    instance: 'echo-processor',
    bypassed: false,
  };
  doc.oxidal.graph.nodes.splice(1, 0, echo);
  doc.oxidal.graph.edges[0]!.to.node = 'echo';
  doc.oxidal.graph.edges.push({
    from: { node: 'echo', port: 0 },
    to: { node: 'scene-gain', port: 0 },
  });
  Object.assign(doc.oxidal, {
    lv2: [
      {
        id: 'echo-processor',
        pluginUri: 'urn:oxidal:plugin:echo#mono',
        controls: {},
        assets: [],
        requiredFeatures: [],
      },
    ],
  });
  const revision = await publish(request, doc);
  const path = '/api/v1/presets/switch-layout/rig/' + revision;
  const hold: RigControl = {
    target: { kind: 'lv2', node: 'echo', symbol: 'hold' },
    label: 'Hold',
    toggle: true,
    value: 0,
    display: 'Off',
    minimum: 0,
    maximum: 1,
    integer: true,
    logarithmic: false,
  };
  await mockRig(page, request, revision, [hold]);
  const presses: {
    pressed: boolean;
    gesture: string;
    session: string;
    performer: string;
  }[] = [];
  await page.route('**' + path + '/action', (route) => {
    presses.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  try {
    const initial = await (await request.get(path)).json();
    const assigned = await request.post(path, {
      data: {
        expected_revision: initial.revision,
        layout: {
          version: 1,
          switches: [
            {
              profile: 'four',
              position: 1,
              gesture: 'tap',
              action: { kind: 'tap_tempo', note: 'quarter' },
            },
          ],
        },
      },
    });
    expect(assigned.ok(), await assigned.text()).toBe(true);
    await page.goto('/#rig');
    await page.getByRole('button', { name: 'Perform view' }).click();
    await chooseBoard(page, 'Four switches');
    const edit = page.getByRole('button', { name: 'Edit preset switches' });
    const dialog = page.getByRole('dialog', { name: 'Edit preset switches' });
    await edit.click();
    await dialog.getByLabel('Tap note').selectOption('dotted_eighth');
    const latest = await (await request.get(path)).json();
    const other = await request.post(path, {
      data: {
        expected_revision: latest.revision,
        layout: {
          ...latest.layout,
          switches: [
            ...latest.layout.switches,
            {
              profile: 'ten',
              position: 1,
              gesture: 'tap',
              action: { kind: 'tap_tempo', note: 'triplet' },
            },
          ],
        },
      },
    });
    expect(other.ok(), await other.text()).toBe(true);
    await dialog.getByRole('button', { name: 'Save switch' }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByRole('button', { name: 'Reload saved layout' }).click();
    await expect(dialog.getByLabel('Tap note')).toHaveValue('quarter');
    await dialog.getByLabel('Tap note').selectOption('dotted_eighth');
    await dialog.getByRole('button', { name: 'Save switch' }).click();
    await expect(dialog).toBeHidden();
    const saved = await (await request.get(path)).json();
    expect(saved.layout.switches).toHaveLength(2);
    expect(
      saved.layout.switches.find(
        (a: { profile: string }) => a.profile === 'four',
      ),
    ).toMatchObject({ action: { note: 'dotted_eighth' } });
    await edit.click();
    await expect(dialog.getByLabel('Tap note')).toHaveValue('dotted_eighth');
    await dialog.getByLabel('Gesture').selectOption('hold');
    await dialog
      .getByRole('combobox', { name: 'Action', exact: true })
      .selectOption('freeze');
    await dialog.getByLabel('Freeze behavior').selectOption('gate');
    await dialog.getByRole('button', { name: 'Save switch' }).click();
    const pad = page.getByRole('button', {
      name: /^A Tap · Dotted eighth Hold · Freeze/,
    });
    await pad.click();
    await expect.poll(() => presses.length).toBe(1);
    await pad.dispatchEvent('pointerdown', { isPrimary: true, button: 0 });
    await expect.poll(() => presses.length).toBe(2);
    await pad.dispatchEvent('pointercancel');
    await expect.poll(() => presses.length).toBe(3);
    expect(presses.map((p) => [p.gesture, p.pressed])).toEqual([
      ['tap', true],
      ['hold', true],
      ['hold', false],
    ]);
    expect(presses[1]!.session).toBeTruthy();
    expect(presses[1]!.performer).toBe(presses[2]!.performer);
    let releasedSession = '';
    await page.route('**' + path + '/release', (route) => {
      releasedSession = route.request().postDataJSON().session;
      return route.fulfill({ json: { ok: true } });
    });
    await page.getByRole('button', { name: 'Release held switches' }).click();
    await expect(page.getByText('Held switches released.')).toBeVisible();
    expect(releasedSession).toBe(presses[1]!.session);
    const beforeReset = await (await request.get(path)).json();
    const reset = await request.post(path, {
      data: {
        expected_revision: beforeReset.revision,
        layout: { version: 1, switches: [] },
      },
    });
    expect(reset.ok(), await reset.text()).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('button', { name: /^A Clean/ })).toBeVisible();
  } finally {
    await remove(request, [revision]);
  }
});

test('mixed rig authoring: four- and ten-switch Stage follows confirmed scenes and Set list', async ({
  page,
  request,
}) => {
  const set = ['Friday rhythm', 'Ambient swell', 'Lead boost', 'Brown Crunch'];
  const scenes = [
    { id: 'clean', name: 'Clean', value: 1 },
    { id: 'crunch', name: 'Crunch', value: 0.8 },
    { id: 'lead', name: 'Lead', value: 0.6 },
    { id: 'space', name: 'Space', value: 0.5 },
  ];
  const first = manifest(set[0]!, scenes);
  const wetExtension = {
    'urn:oxidal:stomp-groups:1': {
      groups: [{ id: 'wet', name: 'Wet', nodes: ['echo'] }],
    },
  };
  Object.assign(first.extensions, wetExtension);
  first.requiredExtensions.push('urn:oxidal:stomp-groups:1');
  first.oxidal.graph.nodes.splice(1, 0, {
    id: 'echo',
    kind: 'lv2',
    audioInputs: 1,
    audioOutputs: 1,
    instance: 'echo',
    bypassed: true,
  } as never);
  first.oxidal.graph.edges = [
    { from: { node: 'in', port: 0 }, to: { node: 'echo', port: 0 } },
    { from: { node: 'echo', port: 0 }, to: { node: 'scene-gain', port: 0 } },
    { from: { node: 'scene-gain', port: 0 }, to: { node: 'out', port: 0 } },
  ];
  Object.assign(first.oxidal, {
    lv2: [
      {
        id: 'echo',
        pluginUri: 'urn:oxidal:plugin:echo#mono',
        controls: {},
        assets: [],
        requiredFeatures: [],
      },
    ],
  });
  const firstScene = first.extensions['urn:oxidal:scenes:1'];
  Object.assign(first.extensions, {
    'urn:oxidal:scenes:3': {
      ...firstScene,
      scenes: firstScene.scenes.map((item) => ({
        ...item,
        bypass: [{ node: 'echo', value: true }],
      })),
    },
  });
  delete (first.extensions as Record<string, unknown>)['urn:oxidal:scenes:1'];
  first.requiredExtensions[1] = 'urn:oxidal:scenes:3';
  const revisions = [await publish(request, first)];
  for (const name of set.slice(1))
    revisions.push(await publish(request, manifest(name, scenes)));
  const playing = await mockRig(page, request, revisions[0]!);
  playing.addWetReadback();
  const order = {
    revision: 'b'.repeat(64),
    entries: set.map((name, index) => ({
      name,
      content: revisions[index],
      entry: {
        id: randomUUID(),
        preset: { kind: 'rig', id: revisions[index] },
        settings: {},
      },
    })),
  };
  let index = 0;
  let steps = 0;
  let jumps = 0;
  await page.route('**/api/v1/midi/position', (route) =>
    route.fulfill({
      json: { index, length: set.length, occurrence: order.entries[index] },
    }),
  );
  await page.route('**/api/v1/midi/navigate', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ direction: 'next' });
    steps++;
    index++;
    await playing.recall(revisions[index]!);
    await route.fulfill({ status: 204 });
  });
  await page.route('**/api/v1/presets/set-list', (route) =>
    route.fulfill({ json: order }),
  );
  await page.route('**/api/v1/presets/set-list/*/recall', async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      expected_revision: order.revision,
    });
    expect(new URL(route.request().url()).pathname).toContain(
      order.entries[3]!.entry.id,
    );
    jumps++;
    index = 3;
    await playing.recall(revisions[index]!);
    await route.fulfill({ status: 204 });
  });
  try {
    await page.goto('/#rig');
    await page.getByRole('button', { name: 'Perform view' }).click();
    const stage = page.getByRole('region', { name: 'Perform' });
    await chooseBoard(page, 'Four switches');
    const board = stage.getByRole('group', {
      name: /Footswitches.*4 switches/,
    });
    await expect(board.getByRole('button')).toHaveCount(4);
    await stage.getByRole('button', { name: 'Wet · Off' }).click();
    await expect(
      stage.getByRole('button', { name: 'Wet · On' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await board.getByRole('button', { name: /^B Crunch/ }).click();
    await expect(
      stage.getByText('Scene · Crunch', { exact: true }),
    ).toBeVisible();
    await expect(
      stage.getByRole('button', { name: 'Wet · Off' }),
    ).toHaveAttribute('aria-pressed', 'false');
    await board.getByRole('button', { name: /^D Next/ }).click();
    await expect(
      stage.getByRole('heading', { name: 'Ambient swell' }),
    ).toBeVisible();
    expect(steps).toBe(1);
    // The set-list steps sit behind the capsule's ⋯ in Perform.
    await openCapsule(page);
    await page
      .getByRole('button', { name: 'Set list and songs', exact: true })
      .click();
    await page.getByRole('button', { name: /^Set list:/ }).click();
    const list = page.getByRole('dialog', { name: 'Set list' });
    await list.getByRole('button', { name: '4 · Brown Crunch' }).click();
    await expect(
      stage.getByRole('heading', { name: 'Brown Crunch' }),
    ).toBeVisible();
    expect(jumps).toBe(1);
    // Close the capsule's set-list ⋯ again.
    await page.keyboard.press('Escape');
    await chooseBoard(page, 'Ten switches');
    const ten = stage.getByRole('group', { name: /Footswitches.*10 switches/ });
    await expect(ten.getByRole('button')).toHaveCount(10);
    await ten.getByRole('button', { name: '3 Lead' }).click();
    await expect(
      stage.getByText('Scene · Lead', { exact: true }),
    ).toBeVisible();
    await expect(ten.getByRole('button', { name: 'C —' })).toBeDisabled();
    const viewport = page.viewportSize()!;
    for (const size of [
      viewport,
      { width: viewport.height, height: viewport.width },
    ]) {
      await page.setViewportSize(size);
      await expect(ten.getByRole('button')).toHaveCount(10);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      for (const name of ['Input level', 'Output level']) {
        const rail = stage.getByRole('meter', { name, exact: true });
        const bounds = await rail.boundingBox();
        expect(bounds?.width).toBeGreaterThan(0);
        expect(bounds?.width).toBeLessThan(24);
      }
    }
  } finally {
    await remove(request, revisions);
  }
});

test('mixed rig authoring: duplicate a pedal for one saved scene with a checked cursor', async ({
  page,
  request,
}, info) => {
  const document = manifest(`Pedal copy ${info.project.name}`, [
    { id: 'verse', name: 'Verse', value: 1 },
    { id: 'chorus', name: 'Chorus', value: 0.7 },
  ]);
  document.oxidal.graph.nodes.splice(1, 0, {
    id: 'ts9',
    kind: 'lv2',
    instance: 'ts9',
    audioInputs: 1,
    audioOutputs: 1,
    bypassed: false,
  } as never);
  document.oxidal.graph.edges = [
    { from: { node: 'in', port: 0 }, to: { node: 'ts9', port: 0 } },
    { from: { node: 'ts9', port: 0 }, to: { node: 'scene-gain', port: 0 } },
    { from: { node: 'scene-gain', port: 0 }, to: { node: 'out', port: 0 } },
  ];
  Object.assign(document.oxidal, {
    lv2: [
      {
        id: 'ts9',
        pluginUri: 'urn:oxidal:plugin:drive#mono',
        controls: { drive: 0.1, tone: 0.5 },
        assets: [],
        requiredFeatures: [],
      },
    ],
  });
  Object.assign(document.extensions['urn:oxidal:authoring'], {
    labels: { ts9: 'TS9 tight' },
  });
  const old = document.extensions['urn:oxidal:scenes:1'];
  const layouts = document.extensions as Record<string, unknown>;
  layouts['urn:oxidal:scenes:2'] = {
    ...old,
    scenes: old.scenes.map((scene, index) => ({
      ...scene,
      controls: [
        { node: 'ts9', symbol: 'drive', value: index === 0 ? 0.25 : 0.75 },
      ],
    })),
  };
  delete layouts['urn:oxidal:scenes:1'];
  document.requiredExtensions[1] = 'urn:oxidal:scenes:2';
  const first = await publish(request, document);
  const playing = await mockRig(page, request, first);
  let published = 0;
  page.on('request', (incoming) => {
    if (
      incoming.method() === 'POST' &&
      new URL(incoming.url()).pathname === '/api/v1/presets/rigs'
    )
      published++;
  });
  const versionsUrl = `/api/v1/presets/catalog/rig/${first}/versions`;
  const savedVersion = async () => {
    const response = await request.get(versionsUrl);
    expect(response.ok(), await response.text()).toBe(true);
    const view = await response.json();
    return view.preset.versions.find(
      (entry: { id: string }) => entry.id === view.preset.default_version,
    ).content as string;
  };
  let saved = first;
  try {
    await page.goto('/#rig');
    await openEditScenes(page);
    const grid = page.getByRole('dialog', { name: 'Edit scenes' });
    const dialog = page.getByRole('dialog', { name: 'Duplicate TS9 tight' });
    const save = dialog.getByRole('button', { name: 'Duplicate and save' });
    const open = async () => {
      await grid
        .getByRole('button', { name: 'More for TS9 tight', exact: true })
        .click();
      await page
        .getByRole('menuitem', { name: 'Duplicate with its settings' })
        .click();
      await dialog.getByLabel('Destination scene').selectOption('chorus');
      await expect(save).toBeEnabled();
    };
    await open();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(grid).toBeVisible();
    expect(published).toBe(0);

    await open();
    playing.changeCursor();
    // Polling can disable Save before the click lands. In either order the
    // stale copy must stay unpublished; do not wait for Save to re-enable.
    await save.evaluate((button: HTMLButtonElement) => button.click());
    await expect(dialog.getByRole('alert')).toContainText('changed');
    await expect(save).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(published).toBe(0);
    await open();
    await save.click();
    await expect(grid.getByRole('status')).toContainText('on in Chorus');
    expect(published).toBe(1);
    expect(playing()).toBe(first);
    saved = await savedVersion();
    expect(saved).not.toBe(first);

    const reopened = await (
      await request.get(`/api/v1/presets/rigs/${saved}`)
    ).json();
    const split = reopened.manifest.extensions['urn:oxidal:scenes:3'];
    const copy = reopened.manifest.oxidal.lv2.find(
      (instance: { id: string }) => instance.id !== 'ts9',
    );
    expect(copy.controls).toEqual({ drive: 0.25, tone: 0.5 });
    expect(
      split.scenes.map((scene: { bypass: unknown }) => scene.bypass),
    ).toEqual([
      [{ node: copy.id, value: true }],
      [{ node: copy.id, value: false }],
    ]);
    expect(
      split.scenes.map((scene: { controls: unknown }) => scene.controls),
    ).toEqual([
      [{ node: 'ts9', symbol: 'drive', value: 0.25 }],
      [{ node: 'ts9', symbol: 'drive', value: 0.75 }],
    ]);
    expect(reopened.manifest.oxidal.graph.edges).toContainEqual({
      from: { node: 'ts9', port: 0 },
      to: { node: copy.id, port: 0 },
    });
    await playing.recall(saved);
    await page.reload();
    await openEditScenes(page);
    await expect(
      grid.getByRole('button', { name: 'TS9 tight (2) in Chorus' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      grid.getByRole('button', { name: 'TS9 tight (2) in Verse' }),
    ).toHaveAttribute('aria-pressed', 'false');
  } finally {
    await remove(request, [...new Set([first, saved])]);
  }
});

for (const count of [5, 7, 10]) {
  test(`mixed rig authoring: many scene paths (${count}) fold only confirmed silent branches`, async ({
    page,
    request,
  }) => {
    await useTreeChain(page);
    const original = await request.post('/api/v1/presets', {
      data: readFileSync(
        new URL(
          '../../../crates/oxidal-presets/tests/fixtures/authored-current.t3kpreset',
          import.meta.url,
        ),
      ),
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    expect(original.ok(), await original.text()).toBe(true);
    const preset = (await original.json()) as Preset;
    const names = [
      'Clean',
      'Chime',
      'Crunch',
      'Lead',
      'Space',
      'Glass',
      'Bright',
      'Warm',
      'Heavy',
      'Bass',
    ].slice(0, count);
    const input = sceneRig(
      randomUUID(),
      `Many amps replay ${count}`,
      names.map((name) => ({
        id: name.toLowerCase(),
        kind: 'native',
        name,
        preset,
        source: { kind: 'original', preset: preset.sha256 },
      })),
      'tone3000-plugin:' + 'a'.repeat(40),
    );
    const document = JSON.parse(input.manifest_json);
    const layout = document.extensions['urn:oxidal:scenes:1'];
    const heavy = layout.scenes.find(
      (scene: { id: string }) => scene.id === 'heavy',
    )!;
    if (heavy) {
      heavy.name = 'Heavy + bass';
      for (const gain of heavy.gains)
        if (gain.port === names.length - 1) gain.value = 0.5;
    }
    const first = await publish(request, document, input.resources);
    const playing = await mockRig(page, request, first);
    try {
      await page.goto('/#rig');
      const route = page.getByRole('group', {
        name: 'Scene lanes',
        exact: true,
      });
      const cards = page.getByRole('group', { name: 'Scenes', exact: true });
      const phone = page.viewportSize()!.width < 768;
      const paths = route.locator('.route-path');
      await expect(paths).toHaveCount(phone ? 1 : count);
      // A tall tree opens at a readable size; fit it to reach its far end.
      if (!phone)
        await page.getByRole('button', { name: 'Fit the whole chain' }).click();
      const initialFold = route.getByRole('button', {
        name: phone
          ? new RegExp(`^Show ${count - 1} silent`)
          : `Fold ${count - 1} silent branches`,
      });
      await initialFold.click();
      await expect(paths).toHaveCount(phone ? count : 1);
      await cards.getByRole('button', { name: /^Scene 3: Crunch/ }).click();
      await expect(
        route.getByRole('group', { name: 'Scene 3 Crunch, sounding' }),
      ).toBeVisible();
      if (count === 5) {
        await openEditScenes(page);
        const grid = page.getByRole('dialog', { name: 'Edit scenes' });
        const chimeInCrunch = grid.getByRole('switch', {
          name: 'Chime branch in Crunch',
        });
        const chimeInClean = grid.getByRole('switch', {
          name: 'Chime branch in Clean',
        });
        await expect(chimeInCrunch).not.toBeChecked();
        await chimeInCrunch.click();
        await expect(chimeInCrunch).toBeChecked();
        await expect(chimeInClean).not.toBeChecked();
        await grid.getByRole('button', { name: 'Save scenes' }).click();
        await expect.poll(playing).not.toBe(first);
        const saved = await (
          await request.get(`/api/v1/presets/rigs/${playing()}`)
        ).json();
        const changed = (
          saved.manifest.extensions['urn:oxidal:scenes:1'] ??
          saved.manifest.extensions['urn:oxidal:scenes:3']
        ).scenes.find((scene: { id: string }) => scene.id === 'crunch');
        expect(
          changed.gains
            .filter((gain: { port: number }) => gain.port === 1)
            .map((gain: { value: number }) => gain.value),
        ).toEqual([1, 1]);
      }
      if (count < 10) return;
      await cards.getByRole('button', { name: /^Scene 9: Heavy/ }).click();
      await expect(
        route.getByRole('group', { name: 'Scene 9 Heavy + bass, sounding' }),
      ).toBeVisible();
      await expect(
        route.getByRole('group', { name: 'Scene 10 Bass, sounding' }),
      ).toBeVisible();
      const blendFold = route.getByRole('button', {
        name: phone ? 'Fold 8 silent branches' : /^Show 8 silent/,
      });
      await blendFold.click();
      await expect(paths).toHaveCount(phone ? 2 : 10);
      expect(playing()).toBe(first);
    } finally {
      await remove(request, [...new Set([first, playing()])]);
    }
  });
}

test('mixed rig authoring: scene grid saves block On/Off in version 3 and reopens it', async ({
  page,
  request,
}, info) => {
  const document = manifest(`Grid ${info.project.name} ${Date.now()}`, [
    { id: 'clean', name: 'Clean', value: 1 },
    { id: 'lead', name: 'Lead', value: 0.5 },
  ]);
  const effect = {
    id: 'echo',
    kind: 'lv2',
    audioInputs: 1,
    audioOutputs: 1,
    instance: 'echo',
    bypassed: false,
  };
  document.oxidal.graph.nodes.splice(1, 0, effect);
  document.oxidal.graph.edges = [
    { from: { node: 'in', port: 0 }, to: { node: 'echo', port: 0 } },
    { from: { node: 'echo', port: 0 }, to: { node: 'scene-gain', port: 0 } },
    { from: { node: 'scene-gain', port: 0 }, to: { node: 'out', port: 0 } },
  ];
  Object.assign(document.oxidal, {
    lv2: [
      {
        id: 'echo',
        pluginUri: 'urn:oxidal:plugin:echo#mono',
        controls: {},
        assets: [],
        requiredFeatures: [],
      },
    ],
  });
  Object.assign(document.extensions['urn:oxidal:authoring'], {
    labels: { echo: 'Echo' },
  });
  const first = await publish(request, document);
  const playing = await mockRig(page, request, first);
  try {
    await page.goto('/#rig');
    await openEditScenes(page);
    const grid = page.getByRole('dialog', { name: 'Edit scenes' });
    const cleanEcho = grid.getByRole('button', {
      name: 'Echo in Clean',
      exact: true,
    });
    await expect(cleanEcho).toHaveAttribute('aria-pressed', 'true');
    await cleanEcho.click();
    await expect(cleanEcho).toHaveAttribute('aria-pressed', 'false');
    await expect(
      grid.getByRole('button', { name: 'Echo in Lead', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    // Edit scenes stays a sheet (the dock holds the C2 tools only).
    const saveScenes = grid.getByRole('button', {
      name: 'Save scenes',
      exact: true,
    });
    await expect(saveScenes).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath('scene-grid.png') });
    await saveScenes.click();
    await expect.poll(playing).not.toBe(first);
    const saved = await (
      await request.get(`/api/v1/presets/rigs/${playing()}`)
    ).json();
    expect(saved.manifest.requiredExtensions).toContain('urn:oxidal:scenes:3');
    const scenes = saved.manifest.extensions['urn:oxidal:scenes:3'].scenes;
    expect(scenes.map((s: { bypass: unknown }) => s.bypass)).toEqual([
      [{ node: 'echo', value: true }],
      [{ node: 'echo', value: false }],
    ]);
    await page.reload();
    await openEditScenes(page);
    await expect(
      page
        .getByRole('dialog', { name: 'Edit scenes' })
        .getByRole('button', { name: 'Echo in Clean', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');
  } finally {
    await remove(request, [first, playing()]);
  }
});
async function bind(
  request: APIRequestContext,
  revision: string,
  scenes: [string, number][],
) {
  const { revision: expected, ...map }: MidiMap = await (
    await request.get('/api/v1/midi/map')
  ).json();
  const existing = map.entries.find(
    ({ entry }) => entry.kind === 'rig' && entry.id === revision,
  );
  const response = await request.post('/api/v1/midi/map', {
    data: {
      ...map,
      expected_revision: expected,
      entries: [
        ...map.entries.filter((entry) => entry !== existing),
        {
          branch_bindings: [],
          parameter_bindings: [],
          ...existing,
          entry: { kind: 'rig', id: revision },
          bindings: scenes.map(([scene, controller]) => ({
            scene,
            program: null,
            controller,
          })),
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

test('mixed rig authoring: scenes move with their MIDI bindings and the last scene cannot be deleted', async ({
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
    await page.goto('/#rig');
    const pads = page.getByRole('group', { name: 'Scenes' });
    await expect(
      pads.getByRole('button', { name: 'Scene 2: Lead' }),
    ).toBeVisible();
    // Move left from the pad's menu. The binding follows the scene.
    await sceneMenu(page, 'Lead');
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
    // Delete Clean, then the last scene is refused with the reason.
    await sceneMenu(page, 'Clean');
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
    await sceneMenu(page, 'Lead');
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

test('mixed rig authoring: Copy to preset says what copies and refuses presets with nothing in common', async ({
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
  // Crunch sets a different level stage: nothing of the scene has a place there.
  const crunchName = `Crunch ${stamp}`;
  const crunch = await publish(
    request,
    manifest(crunchName, [{ id: 'rhythm', name: 'Rhythm', value: 0.8 }], {
      gain: 'mix-gain',
    }),
  );
  // Twin has the same level stage, so the scene copies exactly.
  const twinName = `Twin ${stamp}`;
  const twin = await publish(
    request,
    manifest(twinName, [{ id: 'rhythm', name: 'Rhythm', value: 0.8 }]),
  );
  await mockRig(page, request, source);
  try {
    await page.goto('/#rig');
    await sceneMenu(page, 'Lead');
    await page
      .getByRole('dialog', { name: 'Scene 2: Lead' })
      .getByRole('menuitem', { name: 'Copy to preset…' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Copy to preset' });
    const copy = dialog.getByRole('button', { name: 'Copy', exact: true });
    await dialog
      .getByLabel("Copy 'Lead' to")
      .selectOption({ label: crunchName });
    const plan = dialog.getByRole('list', { name: 'What copies' });
    await expect(plan).toContainText(
      `'Lead' cannot be copied to ${crunchName}: the two presets have no paths or effects in common.`,
    );
    // No block or path is shown by its internal id.
    await expect(plan).not.toContainText('mix-gain');
    await expect(copy).toBeDisabled();
    expect(
      (await catalog(request)).items.find((i) => i.name === crunchName)!.id,
    ).toBe(crunch);
    await dialog.getByLabel("Copy 'Lead' to").selectOption({ label: twinName });
    await expect(plan).toContainText('✓ Same blocks: settings copy exactly.');
    // Nothing is copied until confirmed.
    expect(
      (await catalog(request)).items.find((i) => i.name === twinName)!.id,
    ).toBe(twin);
    await copy.click();
    await expect(
      page.getByText(`"Lead" copied to ${twinName} as scene 2.`),
    ).toBeVisible();
    const saved = (await catalog(request)).items.find(
      (i) => i.name === twinName && i.id !== twin,
    )!;
    const document = await (
      await request.get(`/api/v1/presets/rigs/${saved.id}`)
    ).json();
    expect(
      (
        document.manifest.extensions['urn:oxidal:scenes:2'] ??
        document.manifest.extensions['urn:oxidal:scenes:1']
      ).scenes.map((s: { name: string; gains: { value: number }[] }) => [
        s.name,
        s.gains[0]!.value,
      ]),
    ).toEqual([
      ['Rhythm', 0.8],
      ['Lead', 0.5],
    ]);
  } finally {
    await remove(
      request,
      await current(request, [`Lead ${stamp}`, crunchName, twinName]),
    );
  }
});

test('mixed rig authoring: copy one block into a saved scene and refuse a stale version', async ({
  page,
  request,
}, info) => {
  const stamp = Date.now();
  const name = `Copy EQ ${info.project.name} ${stamp}`;
  const staleName = `${name} stale`;
  const scenesKey = 'urn:oxidal:scenes:3';
  const eqUri = 'urn:fixture:equalizer';
  const eqDocument = (label: string) => {
    const document = manifest(label, [
      { id: 'lead', name: 'Lead', value: 1 },
      { id: 'dirt', name: 'Dirt', value: 0.6 },
    ]);
    const blocks = [
      { id: 'lead-eq', instance: 'lead-instance', uri: eqUri },
      { id: 'dirt-eq', instance: 'dirt-instance', uri: eqUri },
      { id: 'other-fx', instance: 'other-fx', uri: 'urn:fixture:chorus' },
    ];
    document.oxidal.graph.nodes.splice(
      1,
      0,
      ...blocks.map(({ id, instance }) => ({
        id,
        instance,
        kind: 'lv2',
        audioInputs: 1,
        audioOutputs: 1,
        bypassed: false,
      })),
    );
    const chain = ['in', ...blocks.map(({ id }) => id), 'scene-gain', 'out'];
    document.oxidal.graph.edges = chain.slice(1).map((node, index) => ({
      from: { node: chain[index]!, port: 0 },
      to: { node, port: 0 },
    }));
    Object.assign(document.oxidal, {
      lv2: blocks.map(({ instance, uri }) => ({
        id: instance,
        pluginUri: uri,
        controls: { mid_gain: 0 },
        assets: [],
        requiredFeatures: [],
      })),
    });
    Object.assign(document.extensions['urn:oxidal:authoring'], {
      labels: {
        'lead-eq': 'Lead EQ',
        'dirt-eq': 'Dirt EQ',
        'other-fx': 'Chorus',
      },
    });
    const legacyKey = 'urn:oxidal:scenes:1';
    return {
      ...document,
      extensions: {
        'urn:oxidal:gain:1': document.extensions['urn:oxidal:gain:1'],
        'urn:oxidal:authoring': document.extensions['urn:oxidal:authoring'],
        [scenesKey]: {
          fade_ms: document.extensions[legacyKey].fade_ms,
          scenes: document.extensions[legacyKey].scenes.map((scene, i) => ({
            ...scene,
            controls: [
              { node: 'lead-eq', symbol: 'mid_gain', value: i ? 1 : 5 },
              { node: 'dirt-eq', symbol: 'mid_gain', value: i ? -2 : 0 },
            ],
            bypass: blocks.map(({ id }) => ({
              node: id,
              value: i === 1 && id === 'dirt-eq',
            })),
          })),
        },
      },
      requiredExtensions: document.requiredExtensions.map((key) =>
        key === legacyKey ? scenesKey : key,
      ),
    };
  };
  const versions = async (revision: string) =>
    (
      await request.get(`/api/v1/presets/catalog/rig/${revision}/versions`)
    ).json();
  const initial = eqDocument(name);
  const staleDocument = eqDocument(staleName);
  const first = await publish(request, initial);
  const staleFirst = await publish(request, staleDocument);
  const writes = audioWrites(page);
  const preparePage = async (revision: string, reload: boolean) => {
    const playing = await mockRig(page, request, revision);
    await page.route('**/api/v1/plugins/lv2?*', (route) =>
      route.fulfill({
        json: {
          sample_rate: 48000,
          plugins: [
            {
              uri: eqUri,
              name: 'EQ',
              ports: [
                {
                  index: 0,
                  symbol: 'mid_gain',
                  name: 'Mid gain',
                  unit: 'dB',
                  minimum: -20,
                  maximum: 20,
                  audio: false,
                  input: true,
                  output: false,
                  control: true,
                  integer: false,
                  logarithmic: false,
                  toggled: false,
                  latency: false,
                },
              ],
            },
          ],
        },
      }),
    );
    if (reload) await page.reload();
    else await page.goto('/#rig');
    return playing;
  };
  const review = async () => {
    await sceneMenu(page, 'Lead');
    await page.getByRole('menuitem', { name: 'Copy block settings…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Copy block settings' });
    await dialog.getByLabel('Destination scene').selectOption('dirt');
    return dialog;
  };
  try {
    const playing = await preparePage(first, false);
    let dialog = await review();
    await dialog.getByLabel('Destination block').selectOption('other-fx');
    await expect(
      dialog.getByRole('button', { name: 'Copy and save' }),
    ).toBeDisabled();
    await expect(dialog.getByText(/same effect plugin/)).toBeVisible();
    await dialog.getByLabel('Destination block').selectOption('dirt-eq');
    const preview = dialog.getByRole('row', { name: /Mid gain.*-2 dB.*5 dB/ });
    await expect(preview).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await versions(first)).preset.versions[0].content).toBe(first);

    dialog = await review();
    await dialog.getByLabel('Destination block').selectOption('dirt-eq');
    await dialog.getByRole('button', { name: 'Copy and save' }).click();
    await expect(page.getByText(/Copied settings to Dirt in/)).toBeVisible();
    expect(playing()).toBe(first);
    const saved = (await versions(first)).preset.versions[0].content as string;
    expect(saved).not.toBe(first);
    const reopened = await (
      await request.get(`/api/v1/presets/rigs/${saved}`)
    ).json();
    const before = initial.extensions[scenesKey].scenes;
    expect(reopened.manifest.oxidal).toEqual(initial.oxidal);
    expect(reopened.manifest.extensions[scenesKey].scenes[0]).toEqual(
      before[0],
    );
    expect(reopened.manifest.extensions[scenesKey].scenes[1]).toEqual({
      ...before[1],
      controls: [
        { node: 'lead-eq', symbol: 'mid_gain', value: 1 },
        { node: 'dirt-eq', symbol: 'mid_gain', value: 5 },
      ],
    });
    await preparePage(saved, true);
    dialog = await review();
    await dialog.getByLabel('Destination block').selectOption('dirt-eq');
    await expect(
      dialog.getByText('The destination already has these settings.'),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

    await preparePage(staleFirst, true);
    dialog = await review();
    await dialog.getByLabel('Destination block').selectOption('dirt-eq');
    const copy = dialog.getByRole('button', { name: 'Copy and save' });
    await expect(copy).toBeEnabled();
    const reviewed = await versions(staleFirst);
    const selected = reviewed.preset.versions[0];
    const competing = structuredClone(staleDocument);
    competing.extensions[scenesKey].scenes[1]!.controls[1]!.value = 9;
    const raced = await request.post('/api/v1/presets/rigs', {
      data: {
        manifest_json: JSON.stringify(competing),
        resources: {},
        source: { kind: 'rig', id: staleFirst },
        version_target: {
          first: reviewed.preset.logical_id.slice('rig:'.length),
          version: selected.id,
          expected_content: staleFirst,
          expected_revision: reviewed.catalog_revision,
          request_id: randomUUID(),
        },
      },
    });
    expect(raced.ok(), await raced.text()).toBe(true);
    const competingRevision = (await raced.json()).revision;
    await copy.click();
    await expect(dialog.getByRole('alert')).toContainText(
      'The saved version changed',
    );
    await expect(copy).toBeDisabled();
    expect((await versions(staleFirst)).preset.versions[0].content).toBe(
      competingRevision,
    );
    expect(writes).toEqual([]);
  } finally {
    await remove(request, await current(request, [name, staleName]));
  }
});
