import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from '@playwright/test';

import { expectWorkspaceSection, setDisplayMode } from './display';

/**
 * Sprint 09 backing player against the real daemon (its own temporary media
 * store): import through chunked upload, the mini-player on every page, the
 * full player, rename and delete, and refusals. States the test device cannot
 * reach without audio (Playing) use a mocked player stream.
 */
const fixture =
  '../../crates/oxidal-api/tests/fixtures/media/tone-44k-mono-vbr.mp3';
const title = 'tone-44k-mono-vbr';

async function expectBottomPlayerClear(page: Page) {
  const chrome = page.locator('[data-slot=app-bottom]');
  const player = chrome.getByRole('region', { name: 'Now playing' });
  if (!(await player.isVisible())) return;
  await expect
    .poll(async () =>
      chrome.evaluate((element) => {
        const content = document.querySelector('[data-slot=app-content]');
        return content
          ? Number.parseFloat(getComputedStyle(content).paddingBottom) -
              element.getBoundingClientRect().height
          : -1;
      }),
    )
    .toBeGreaterThanOrEqual(0);
  const area = (await chrome.boundingBox())!;
  const viewport = page.viewportSize()!;
  const viewportDetails = await page.evaluate(
    (width) => ({
      innerWidth,
      innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      over: [...document.querySelectorAll('body *')]
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.right > width + 1;
        })
        .slice(0, 12)
        .map((element) => ({
          tag: element.tagName,
          slot: element.getAttribute('data-slot'),
          class: element.className,
          right: element.getBoundingClientRect().right,
        })),
    }),
    viewport.width,
  );
  expect(area.y + area.height, JSON.stringify(viewportDetails)).toBeCloseTo(
    viewport.height,
    0,
  );
  const navigation = chrome.getByRole('navigation', {
    name: 'Instrument navigation',
  });
  if (await navigation.isVisible()) {
    // Read both edges in one frame while the responsive navigation settles.
    const overlap = await navigation.evaluate((nav) => {
      const player = nav.parentElement!.querySelector(
        '[role="region"][aria-label="Now playing"]',
      )!;
      return (
        player.getBoundingClientRect().bottom - nav.getBoundingClientRect().top
      );
    });
    expect(overlap).toBeLessThanOrEqual(0.5);
    const rig = navigation.getByRole('button', { name: 'Rig', exact: true });
    expect(
      await rig.evaluate((button) => {
        const box = button.getBoundingClientRect();
        return button.contains(
          document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          ),
        );
      }),
    ).toBe(true);
  }
}

type Snapshot = {
  state: string;
  track: { id: string } | null;
  order: string[];
};

async function resetMedia(request: APIRequestContext) {
  await request.post('/api/v1/protect', { data: { on: false } });
  const player = (await (
    await request.get('/api/v1/player')
  ).json()) as Snapshot;
  if (player.track)
    await request.post('/api/v1/player/commands', {
      data: {
        requestId: `reset-${Date.now()}`,
        origin: 'api',
        command: { kind: 'stop' },
      },
    });
  const media = (await (await request.get('/api/v1/media')).json()) as {
    assets: { id: string }[];
  };
  for (const asset of media.assets)
    expect(
      (await request.delete(`/api/v1/media/assets/${asset.id}`)).status(),
    ).toBe(204);
}

async function importFixture(page: Page) {
  await page.goto('/#library/backing');
  await expectWorkspaceSection(page, 'Library', 'Backing tracks');
  await page.getByLabel('Choose WAV or MP3 files').setInputFiles(fixture);
  const list = page.getByRole('list', { name: 'Backing list' });
  await expect(list.getByRole('listitem', { name: title })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByRole('region', { name: 'Importing' })).toHaveCount(0);
  return list;
}

/** The mini-player that fits this width (chip, strip or phone bar). */
const nowPlaying = (page: Page) =>
  page.getByRole('region', { name: 'Now playing' });

test.beforeEach(async ({ request }) => {
  await resetMedia(request);
});
// Later specs share the daemon: leave no cued track (and no mini-player) behind.
test.afterEach(async ({ request }) => {
  await resetMedia(request);
});

test('backing tracks import an MP3 through the device and play needs running audio', async ({
  page,
}) => {
  const list = await importFixture(page);
  const row = list.getByRole('listitem', { name: title });
  await expect(row).toContainText('Mono · MP3');
  // Nothing is cued yet, so no mini-player.
  await expect(nowPlaying(page)).toHaveCount(0);
  await row.getByRole('button', { name: `Play ${title}` }).click();
  // Play cues the track, then the device refuses to start it without audio.
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Start the audio to play the track.' }),
  ).toBeVisible();
  await expect(row.getByText('Cued')).toBeVisible();
  await expect(nowPlaying(page)).toContainText(title);
  await expect(nowPlaying(page)).toContainText('Ready');
});

test('backing mini-player stays on every page and opens the full player', async ({
  page,
}, testInfo) => {
  const duplicateKeys: string[] = [];
  page.on('console', (entry) => {
    if (entry.type() === 'error' && entry.text().includes('same key'))
      duplicateKeys.push(entry.text());
  });
  const list = await importFixture(page);
  await list
    .getByRole('listitem', { name: title })
    .getByRole('button', { name: `More for ${title}` })
    .click();
  await page.getByRole('menuitem', { name: 'Cue' }).click();
  await expect(nowPlaying(page)).toContainText(title);
  const navigation = page.getByRole('navigation', {
    name: 'Instrument navigation',
  });
  for (const destination of [
    'Rig',
    'Guitars',
    'Library',
    'Levels',
    'Settings',
  ]) {
    await navigation
      .getByRole('button', { name: destination, exact: true })
      .click();
    await expect(nowPlaying(page)).toBeVisible();
    await expect(nowPlaying(page)).toContainText(title);
    await expectBottomPlayerClear(page);
  }
  for (const mode of ['stage', 'sunlight', 'epaper', 'default'] as const) {
    await setDisplayMode(page, mode);
    await expectBottomPlayerClear(page);
    await page.screenshot({
      path: testInfo.outputPath(`bottom-player-${mode}.png`),
    });
  }
  const original = page.viewportSize()!;
  await setDisplayMode(page, 'epaper');
  await page.setViewportSize({
    width: original.height,
    height: original.width,
  });
  await expectBottomPlayerClear(page);
  await page.screenshot({
    path: testInfo.outputPath('bottom-player-rotated.png'),
  });
  await page.setViewportSize(original);
  await setDisplayMode(page, 'default');
  await page.reload();
  await expect(nowPlaying(page)).toContainText(title);
  const before = page.url();
  await nowPlaying(page)
    .getByRole('button', { name: new RegExp(`Open backing player: ${title}`) })
    .click();
  const sheet = page.getByRole('dialog', { name: 'Backing player' });
  await expect(sheet).toBeVisible();
  for (const viewport of [
    original,
    { width: original.height, height: original.width },
  ]) {
    await page.setViewportSize(viewport);
    if (viewport.width < 600 || viewport.width >= 1024) {
      await expect
        .poll(async () => {
          const box = await sheet.boundingBox();
          return (
            !!box &&
            Math.abs(box.y) < 2 &&
            Math.abs(box.height - viewport.height) < 2 &&
            Math.abs(box.x + box.width - viewport.width) < 2
          );
        })
        .toBe(true);
    }
  }
  await page.setViewportSize(original);
  expect(duplicateKeys).toEqual([]);

  const note = sheet.getByRole('combobox', { name: 'Echo repeats per tap' });
  await expect(note).toHaveText('Preset division');
  await note.click();
  await page.getByRole('option', { name: 'Dotted eighth' }).click();
  await expect(note).toHaveText('Dotted eighth');
  const tempo = await (await page.request.get('/api/v1/tempo')).json();
  expect(tempo.tap_note).toBe('dotted_eighth');
  await note.click();
  await page.getByRole('option', { name: 'Preset division' }).click();
  await expect(note).toHaveText('Preset division');
  await expect(sheet).toContainText('Mono · MP3');
  await expect(
    sheet.getByRole('button', { name: 'Stop track' }),
  ).toBeDisabled();
  await sheet.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(sheet.getByRole('alert')).toHaveText(
    'Start the audio to play the track.',
  );
  await sheet.getByRole('button', { name: 'Backing list' }).click();
  const picker = page.getByRole('dialog', { name: 'Backing list' });
  await expect(picker.getByText('Cued')).toBeVisible();
  await picker.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(page.url()).toBe(before);
});

test('backing tracks rename and delete, and say why a playing track stays', async ({
  page,
}) => {
  const list = await importFixture(page);
  const more = (name: string) =>
    list
      .getByRole('listitem', { name })
      .getByRole('button', { name: `More for ${name}` });
  await more(title).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename track' });
  await rename.getByLabel('Name').fill('Rehearsal 01');
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(rename).toHaveCount(0);
  await expect(
    list.getByRole('listitem', { name: 'Rehearsal 01' }),
  ).toBeVisible();

  await page.route('**/api/v1/media/assets/*', async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    await route.fulfill({
      status: 409,
      json: {
        error: 'This file is in use. Stop the track or job first',
        code: 'conflict',
      },
    });
  });
  await more('Rehearsal 01').click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete “Rehearsal 01”?' });
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(confirm.getByRole('alert')).toHaveText(
    'This file is in use. Stop the track or job first.',
  );
  await page.unroute('**/api/v1/media/assets/*');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(list).toHaveCount(0);
  await expect(page.getByText('No backing tracks yet.')).toBeVisible();
});

test('backing player shows Playing with Pause and Stop track from the device stream', async ({
  page,
}) => {
  const track = {
    id: '01M00000000000000000000000',
    title: 'Rehearsal 01',
    frames: 48000 * 222,
    rate: 48000,
    channels: 2,
    trimDb: -6,
  };
  let snapshot = {
    revision: 10,
    state: 'playing',
    track,
    frame: 48000 * 72,
    repeat: false,
    levelDb: -6,
    order: [track.id],
    reason: null,
    notice: 'Track continued after a 0.6 s gap while the preset loaded',
    underruns: 0,
  };
  const commands: unknown[] = [];
  // The tab's one device stream: the real device state, then a playing track.
  const state = await (await page.request.get('/api/v1/state')).text();
  await page.route('**/api/v1/events', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: `retry: 60000\nevent: state\ndata: ${state}\n\nevent: player\ndata: ${JSON.stringify(snapshot)}\n\n`,
    }),
  );
  await page.route('**/api/v1/player/commands', async (route) => {
    const body = route.request().postDataJSON() as {
      command: { kind: string };
    };
    commands.push(body);
    snapshot = {
      ...snapshot,
      revision: snapshot.revision + 1,
      state: body.command.kind === 'pause' ? 'paused' : 'ready',
      frame: body.command.kind === 'stop' ? 0 : snapshot.frame,
      notice: null as unknown as string,
    };
    await route.fulfill({ json: snapshot });
  });
  await page.goto('/#rig');
  const bar = nowPlaying(page);
  await expect(bar).toContainText('Rehearsal 01');
  await expect(bar).toContainText(/1:1\d \/ 3:42/);
  await expect(bar).toContainText('Track continued after a 0.6 s gap');
  await expect(bar.getByRole('button', { name: 'Pause' })).toBeVisible();
  await bar.getByRole('button', { name: 'Stop track' }).click();
  await expect(bar).toContainText('0:00 / 3:42');
  await expect(bar).toContainText('Ready');
  expect(commands).toEqual([
    expect.objectContaining({
      origin: 'ui',
      command: { kind: 'stop' },
      requestId: expect.any(String),
    }),
  ]);
});

test('backing player switches learn and clear in Controller setup', async ({
  page,
}) => {
  let map = {
    revision: 'e2e-map-1',
    input: 'hw:E2E,0,0',
    channel: 1,
    entries: [],
    navigation: {
      backing: { play_pause: { controller: 20, program: null }, level: 7 },
    },
  };
  const updates: { navigation: typeof map.navigation }[] = [];
  await page.route('**/api/v1/midi/map', async (route) => {
    if (route.request().method() === 'POST') {
      const update = route.request().postDataJSON() as typeof map & {
        expected_revision: string;
      };
      updates.push(update);
      map = {
        ...map,
        revision: `e2e-map-${updates.length + 1}`,
        navigation: update.navigation,
      };
    }
    await route.fulfill({ json: map });
  });
  await page.goto('/#settings/midi');
  const group = page.getByRole('region', { name: 'Backing player' });
  await expect(group).toBeVisible();
  for (const label of [
    'Play/Pause',
    'Stop track',
    'Next track',
    'Previous track',
    'Back 10 s',
    'Forward 10 s',
    'Level knob',
  ])
    await expect(
      group.getByRole('button', { name: `Learn ${label}`, exact: true }),
    ).toBeVisible();
  await expect(group.getByText('CC 20 · press')).toBeVisible();
  await expect(group.getByText('CC 7 · any value')).toBeVisible();
  // Learning waits for a connected controller on running audio.
  await expect(
    group.getByRole('button', { name: /Learn.*Stop track/ }),
  ).toBeDisabled();
  await group.getByRole('button', { name: /Clear.*Play\/Pause/ }).click();
  await expect(group.getByText('CC 20 · press')).toHaveCount(0);
  expect(updates.at(-1)?.navigation).toEqual({
    backing: { play_pause: null, level: 7 },
  });
});

test('backing player on e-paper uses the bottom bar, words and step buttons', async ({
  page,
}) => {
  const list = await importFixture(page);
  await list
    .getByRole('listitem', { name: title })
    .getByRole('button', { name: `More for ${title}` })
    .click();
  await page.getByRole('menuitem', { name: 'Cue' }).click();
  await setDisplayMode(page, 'epaper');
  const bar = nowPlaying(page);
  await expect(bar).toContainText('Ready');
  // The shared bottom area keeps the player above phone navigation and clear
  // of scrollable content; on wide screens it contains just the player.
  await expectBottomPlayerClear(page);
  await bar.getByRole('button', { name: /Open backing player/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Backing player' });
  await expect(sheet.getByRole('slider')).toHaveCount(0);
  await expect(sheet).toContainText('READY · Position 0:00');
  for (const label of ['Previous', 'Back 10 s', 'Play', 'Fwd 10 s', 'Next'])
    await expect(
      sheet.getByRole('button', { name: label, exact: true }),
    ).toBeVisible();
  await expect(
    sheet.getByRole('button', { name: 'Raise level' }),
  ).toBeVisible();
  await sheet.getByRole('button', { name: 'Close dialog' }).click();
  await setDisplayMode(page, 'default');
});

test('backing click level follows two viewers without replacing the timing or loop', async ({
  page,
  context,
  request,
}) => {
  await importFixture(page);
  const catalog = await (await request.get('/api/v1/media')).json();
  const asset = catalog.assets.find(
    (item: { title: string }) => item.title === title,
  ).id;
  async function command(kind: string, fields: Record<string, unknown>) {
    const response = await request.post('/api/v1/player/commands', {
      data: {
        requestId: crypto.randomUUID(),
        origin: 'api',
        command: { kind, ...fields },
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
  await command('cue', { asset });
  await command('set_practice_range', { range: { a: 0, b: 6000 } });
  await command('set_speed', { percent: 75 });
  await command('set_click', {
    click: { kind: 'manual', bpm_tenths: 980, first_frame: 100, level_db: -18 },
  });
  const second = await context.newPage();
  try {
    await second.goto('/#rig');
    for (const viewer of [page, second]) {
      await nowPlaying(viewer)
        .getByRole('button', {
          name: new RegExp(`Open backing player: ${title}`),
        })
        .click();
    }
    const knob = (viewer: Page) =>
      viewer.getByRole('slider', { name: 'Click level' });
    await expect(knob(second)).toHaveAttribute('aria-valuenow', '-18');
    const before = await (await request.get('/api/v1/player')).json();
    const gestures: string[] = [];
    second.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/api/v1/player/commands'))
        gestures.push(r.postDataJSON().command.kind);
    });
    await second.getByRole('spinbutton', { name: 'BPM' }).focus();
    await knob(second).focus();
    const sent = second.waitForRequest(
      (r) =>
        r.method() === 'POST' && r.url().endsWith('/api/v1/player/commands'),
    );
    await knob(second).press('ArrowLeft');
    expect((await sent).postDataJSON()).toMatchObject({
      expectedCue: asset,
      command: { kind: 'set_click_level', level_db: -19 },
    });
    await expect(knob(page)).toHaveAttribute('aria-valuenow', '-19');
    const after = await (await request.get('/api/v1/player')).json();
    expect(gestures).toEqual(['set_click_level']);
    expect(after.click).toEqual({ ...before.click, level_db: -19 });
    expect(after).toMatchObject({
      track: before.track,
      frame: before.frame,
      range: before.range,
      speedPercent: 75,
    });
  } finally {
    await second.close();
  }
});
