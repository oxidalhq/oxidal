import { setDisplayMode } from './display';
import {
  test,
  expect,
  type Locator,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const fixtures = new URL(
  '../../../crates/oxidal-presets/tests/fixtures/',
  import.meta.url,
);

/** Mock provider transport only; assets and workers remain real. */
async function routeProviderModels(
  page: Page,
  modelRoot: string,
  downloadDelay = () => 0,
) {
  const fixtures = readdirSync(modelRoot)
    .filter((id) => /^[0-9a-f]{64}$/.test(id))
    .map((id) => ({
      id,
      metadata: JSON.parse(
        readFileSync(join(modelRoot, id, 'metadata.json'), 'utf8'),
      ),
    }));
  await page.route('**/api/v1/tone3000/tones?*', (route) =>
    route.fulfill({
      json: {
        data: fixtures.map(({ metadata: m }) => ({
          id: m.tone_id,
          title: m.title,
          format: m.format,
          gear: m.format === 'nam' ? 'amp' : 'cab',
          license: 'Test fixture',
          models_count: 1,
          a2_models_count: m.format === 'nam' ? 1 : 0,
          url: 'https://www.tone3000.com',
          user: { username: 'fixture' },
        })),
        page: 1,
        total_pages: 1,
      },
    }),
  );
  await page.route('**/api/v1/tone3000/models?*', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const m = fixtures.find(
      (f) => String(f.metadata.tone_id) === params.get('tone_id'),
    )!.metadata;
    expect(params.get('architecture')).toBe(m.format === 'nam' ? '2' : 'any');
    return route.fulfill({
      json: {
        data: [
          {
            id: m.model_id,
            tone_id: m.tone_id,
            name: m.name,
            size: null,
            architecture_version: m.format === 'nam' ? '2' : null,
          },
        ],
        page: 1,
        total_pages: 1,
      },
    });
  });
  await page.route('**/api/v1/tone3000/stage', async (route) => {
    const selected = route.request().postDataJSON();
    const fixture = fixtures.find(
      (f) =>
        f.metadata.tone_id === selected.tone_id &&
        f.metadata.model_id === selected.model_id,
    )!;
    expect(fixture).toBeTruthy();
    const m = fixture.metadata;
    const delay = downloadDelay();
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    await route.fulfill({
      json: {
        id: fixture.id,
        tone_id: m.tone_id,
        model_id: m.model_id,
        title: m.title,
        name: m.name,
        sha256: m.sha256,
      },
    });
  });
  return fixtures;
}

/** Exercise the real paged library instead of assuming the saved hash sorts first. */
async function playSavedRig(page: Page, name: string) {
  const library = page.getByRole('region', {
    name: 'Presets with scenes',
    exact: true,
  });
  await expect(library).toBeVisible();
  const play = library.getByRole('button', {
    name: `Load ${name}`,
    exact: true,
  });
  while ((await play.count()) === 0) {
    const more = library.getByRole('button', {
      name: 'Load more',
      exact: true,
    });
    await expect(more).toBeVisible();
    const rows = library.getByRole('button', { name: /^Load / });
    const before = await rows.count();
    await more.click();
    await expect.poll(() => rows.count()).toBeGreaterThan(before);
  }
  await play.click();
}

/** Save completion belongs to this working session and acknowledged request. */
async function saveMixedRig(
  page: Page,
  request: APIRequestContext,
  rig: Locator,
) {
  const current = await (await request.get('/api/v1/rig-audio')).json();
  const acknowledged = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/rig-audio') &&
      response.request().method() === 'POST' &&
      response.request().postDataJSON()?.action?.kind === 'save',
  );
  await rig.getByRole('button', { name: 'Save', exact: true }).click();
  const response = await acknowledged;
  expect(response.ok()).toBe(true);
  const accepted = (await response.json()).save;
  expect(accepted.source_session).toBe(current.control.session);
  let revision = '';
  await expect
    .poll(async () => {
      const state = await (await request.get('/api/v1/rig-audio')).json();
      const save = state.save;
      revision =
        save?.source_session === current.control.session &&
        save?.source_control_revision === accepted.source_control_revision
          ? (save.saved_revision ?? '')
          : '';
      return revision;
    })
    .not.toBe('');
  return revision;
}

test('rig controls follow the actual session without example effects', async ({
  page,
  request,
}, info) => {
  // Presentation contract fixture; the real worker lifecycle below verifies the same boundary.
  const baseline = await (await request.get('/api/v1/audio')).json();
  let audio = {
    ...baseline,
    phase: 'stopped',
    controls: [],
    configured: null,
    preset_name: null,
  };
  let saves = 0;
  await page.route('**/api/v1/audio', async (route) => {
    if (route.request().method() === 'POST') {
      const command = route.request().postDataJSON();
      expect(command.action.kind).toBe('save_copy');
      expect(command.action.name).toBe('My live sound');
      expect(command.session).toBe(audio.session);
      expect(command.expected_revision).toBe(audio.revision);
      saves++;
      audio = {
        ...audio,
        revision: audio.revision + 1,
        saved_copy: 'a'.repeat(64),
      };
    }
    await route.fulfill({ json: audio });
  });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Audio stopped', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Quick controls', { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByLabel('Example preset', { exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator('[data-testid^="block-"]')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Browse presets', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Library', exact: true }),
  ).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search presets' }).fill('Bogner');
  await page.getByRole('button', { name: 'Rig', exact: true }).click();
  await page.goBack();
  await expect(
    page.getByRole('searchbox', { name: 'Search presets' }),
  ).toHaveValue('Bogner');
  await page.getByRole('button', { name: 'Rig', exact: true }).click();
  audio = {
    ...audio,
    phase: 'running',
    preset_name: 'Amp only',
    controls: [
      {
        target: 'outputLevel',
        label: 'Output',
        display: '0 dB',
        value: 0.5,
        toggle: false,
      },
      {
        target: 'block:amp-one:enabled',
        label: 'My amp · enabled',
        display: 'On',
        value: 1,
        toggle: true,
      },
      {
        target: 'block:amp-one:level',
        label: 'My amp level',
        display: '-3 dB',
        value: 0.4,
        toggle: false,
      },
    ],
  };
  const rig = page.getByRole('region', { name: 'Sounding rig' });
  await expect(rig).toBeVisible();
  await expect(page.getByTestId('active-preset')).toHaveText('Amp only');
  await expect(rig.locator('.rig-tile')).toHaveCount(1);
  await rig.getByRole('button', { name: 'My amp', exact: true }).click();
  await expect(
    rig.getByRole('button', {
      name: 'Adjust sounding My amp level',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(/delay|reverb/i)).toHaveCount(0);
  const selectedControl = rig.getByRole('button', {
    name: 'Adjust sounding My amp level',
    exact: true,
  });
  await expect(selectedControl).toBeInViewport();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Display', exact: true }).click();
  await page.getByRole('button', { name: 'Rig', exact: true }).click();
  await expect(selectedControl).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Display', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Rig', exact: true }).click();
  await page.screenshot({
    path: info.outputPath('rig-selected-block.png'),
    fullPage: true,
  });
  const initialViewport = page.viewportSize()!;
  await page.setViewportSize({
    width: initialViewport.height,
    height: initialViewport.width,
  });
  await selectedControl.scrollIntoViewIfNeeded();
  await expect(selectedControl).toBeInViewport();
  if (initialViewport.height >= 760) {
    const chainBounds = (await rig.locator('.rig-chain-column').boundingBox())!;
    const inspectorBounds = (await rig
      .locator('.rig-inspector-column')
      .boundingBox())!;
    expect(inspectorBounds.x).toBeGreaterThan(
      chainBounds.x + chainBounds.width,
    );
  }
  await page.screenshot({
    path: info.outputPath('rig-selected-landscape.png'),
    fullPage: true,
  });
  await page.setViewportSize(initialViewport);
  const picker = rig.getByRole('button', { name: /^Playing preset/ });
  const retry = rig.getByRole('button', { name: 'Retry presets' });
  await expect(retry).toBeVisible();
  const pickerBox = (await picker.boundingBox())!;
  const retryBox = (await retry.boundingBox())!;
  expect(retryBox.y).toBeGreaterThanOrEqual(pickerBox.y + pickerBox.height);
  expect(pickerBox.width).toBeGreaterThan(95);
  await expect(rig.getByRole('group', { name: 'Block position' })).toHaveCount(
    0,
  );
  await rig
    .getByRole('button', { name: 'Preset actions', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Model artwork', exact: true })
    .click();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(rig.locator('.chain-view')).toHaveAttribute(
    'data-chain-view',
    'artwork',
  );
  await expect(rig.locator('.rig-tile .chain-led')).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath('rig-artwork-mobile.png'),
    fullPage: true,
  });
  await rig
    .getByRole('button', { name: 'Preset actions', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Connected icons', exact: true })
    .click();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(rig.locator('.chain-view')).toHaveAttribute(
    'data-chain-view',
    'compact',
  );
  await rig.getByRole('button', { name: 'Save copy', exact: true }).click();
  const saveDialog = page.getByRole('dialog', { name: 'Save copy' });
  await expect(saveDialog.getByLabel('Name for sounding copy')).toHaveValue(
    'Amp only',
  );
  const portrait = page.viewportSize()!;
  await page.setViewportSize({
    width: portrait.height,
    height: portrait.width,
  });
  await expect(saveDialog).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  audio = { ...audio, revision: audio.revision + 1 };
  await expect(
    saveDialog.getByRole('button', { name: 'Save sounding copy' }),
  ).toBeDisabled();
  await expect(saveDialog.getByRole('status')).toContainText('The rig changed');
  expect(saves).toBe(0);
  await saveDialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.setViewportSize(portrait);
  await rig.getByRole('button', { name: 'Save copy', exact: true }).click();
  await saveDialog.getByLabel('Name for sounding copy').fill('My live sound');
  await saveDialog.getByRole('button', { name: 'Save sounding copy' }).click();
  await expect(saveDialog).toHaveCount(0);
  await expect(rig.getByTestId('live-saved')).toBeVisible();
  expect(saves).toBe(1);
  audio = {
    ...audio,
    slots: [
      { target: 'slot-left', position: { lane: 0, index: 1 } },
      { target: 'slot-right', position: { lane: 1, index: 2 } },
    ],
  };
  await expect(rig.getByRole('button', { name: 'Add block' })).toBeVisible();
  await rig.getByRole('button', { name: 'Add block' }).click();
  await rig.getByRole('button', { name: 'Add NAM', exact: true }).click();
  const positions = page.getByRole('dialog', { name: 'Add NAM · position' });
  await expect(
    positions.getByRole('button', { name: 'Right chain · position 3' }),
  ).toBeVisible();
  audio = { ...audio, revision: audio.revision + 1 };
  await expect(
    positions.getByRole('button', { name: 'Right chain · position 3' }),
  ).toBeDisabled();
  await positions.getByRole('button', { name: 'Close dialog' }).click();
  expect(saves).toBe(1);
  // A recalled session may not contain the previously selected block.
  audio = {
    ...audio,
    session: 'replacement-session',
    preset_name: 'Output only',
    controls: [audio.controls[0]],
  };
  await expect(page.getByTestId('active-preset')).toHaveText('Output only');
  await expect(rig.locator('.rig-tile')).toHaveCount(0);
  await expect(
    rig.getByRole('button', { name: 'Adjust sounding Output', exact: true }),
  ).toBeVisible();
  await expect(
    rig.getByRole('button', {
      name: 'Adjust sounding My amp level',
      exact: true,
    }),
  ).toHaveCount(0);
  audio = { ...audio, phase: 'stopped', controls: [] };
  await expect(rig).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Audio stopped', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/delay|reverb/i)).toHaveCount(0);
  // A URL cannot enable development controls on an appliance without the capability.
  await page.route('**/api/v1/health', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: { ...(await response.json()), midi_transport: 'unavailable' },
    });
  });
  await page.goto('/?development=simulator');
  await expect(
    page.getByRole('heading', { name: 'Audio stopped', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Example preset', { exact: true })).toHaveCount(
    0,
  );
});

test('native preset upload, durable library, exact download and rejected replacement', async ({
  page,
  context,
  request,
}) => {
  const before: unknown = await (await request.get('/api/v1/state')).json();
  await page.goto('/');
  await expect(
    page.getByRole('complementary', { name: 'DSP and system resources' }),
  ).toHaveAttribute('data-connected', 'true');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByText('Import preset', { exact: true }).click();
  for (const name of [
    'authored-current.t3kpreset',
    'authored-legacy.t3kpreset',
  ]) {
    await page
      .getByLabel('TONE3000 preset file')
      .setInputFiles(fileURLToPath(new URL(name, fixtures)));
    await page
      .getByRole('button', { name: 'Import original', exact: true })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Original preserved.' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Import original', exact: true }),
    ).toBeEnabled();
  }
  const rows = page.getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await page
    .getByRole('button', { name: 'Import original', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Import original', exact: true }),
  ).toBeEnabled();
  await expect(rows).toHaveCount(2);
  // Rows mark only the exception (legacy format); the current-format row has no tag.
  const current = rows.filter({ hasNotText: 'legacy format' });
  await page
    .getByRole('searchbox', { name: 'Search presets' })
    .fill('no-matching-rig-unique');
  await expect(rows).toHaveCount(0);
  await expect(
    page.getByText('No single-chain presets match this name.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear preset search' }).click();
  await expect(rows).toHaveCount(2);
  const downloadEvent = page.waitForEvent('download');
  await current.getByRole('link', { name: /Download original/ }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.t3kpreset$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(readFileSync(path!)).toEqual(
    readFileSync(new URL('authored-current.t3kpreset', fixtures)),
  );
  const second = await context.newPage();
  await second.goto('/');
  await second.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(second.getByRole('listitem')).toHaveCount(2);
  await page.reload();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByText('Import preset', { exact: true }).click();
  await expect(rows).toHaveCount(2);
  await page.getByLabel('TONE3000 preset file').setInputFiles({
    name: 'bad.t3kpreset',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('corrupt'),
  });
  await page
    .getByRole('button', { name: 'Import original', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('Not a TONE3000 preset');
  await expect(rows).toHaveCount(2);
  expect(await (await request.get('/api/v1/state')).json()).toEqual(before);
  await page
    .getByRole('navigation', { name: 'Library sections' })
    .getByRole('button', { name: 'Author', exact: true })
    .click();
  await expect(
    page.getByText(/Playback and editing are not available/),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('native editor loads real A2, previews/cancels, commits, saves and reloads owned tone', async ({
  page,
  request,
}) => {
  test.skip(
    process.env.OXIDAL_NATIVE_EDITOR !== '1',
    'Explicit native build required; pnpm native:check runs this against the real worker',
  );
  test.setTimeout(90000);
  const path = process.env.OXIDAL_NATIVE_TEST_PRESET!;
  const bytes = readFileSync(path);
  const imported = await request.post('/api/v1/presets', {
    data: bytes,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  expect(imported.ok()).toBeTruthy();
  const preset = await imported.json();
  await page.goto('/');
  if (test.info().project.name === 'boox-air3c') {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await setDisplayMode(page, 'epaper');
  }
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Library sections' })
    .getByRole('button', { name: 'Author', exact: true })
    .click();
  const editor = page.getByRole('region', { name: 'Native preset editor' });
  await expect(editor).toBeVisible();
  if (!(await editor.getByLabel('Preset to load').isVisible()))
    await editor.getByTestId('native-preset-loader').locator('summary').click();
  await editor
    .getByLabel('Preset to load')
    .selectOption(`original:${preset.sha256}`);
  await editor.getByRole('button', { name: 'Load draft' }).click();
  await expect(editor.getByRole('status')).toHaveText('Native preset ready');
  await expect(editor.getByLabel('Preset to load')).not.toBeVisible();
  // Direct tone targets use the same owned adjustment transaction as the full browser.
  const directBass = editor.getByRole('button', {
    name: 'Adjust draft Bass',
    exact: true,
  });
  await expect(directBass).toBeVisible();
  const groups = editor.getByRole('group', { name: 'Draft control groups' });
  await groups.getByRole('button', { name: 'Pitch', exact: true }).click();
  await expect(
    editor.getByRole('button', {
      name: 'Adjust draft Pitch shift amount',
      exact: true,
    }),
  ).toBeVisible();
  await expect(directBass).toHaveCount(0);
  await groups.getByRole('button', { name: 'Stereo', exact: true }).click();
  await expect(
    editor.getByRole('button', {
      name: 'Adjust draft Alignment offset',
      exact: true,
    }),
  ).toBeVisible();
  await groups.getByRole('button', { name: 'Tone', exact: true }).click();

  await directBass.click();
  await expect(editor.getByRole('dialog')).toBeVisible();
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await editor.getByTestId('native-control-browser').locator('summary').click();
  const before = await editor.getByTestId('native-readback').textContent();
  await editor
    .getByRole('button', { name: 'Adjust native value', exact: true })
    .click();
  const touch = editor.getByRole('slider', { name: 'Adjust native value' });
  const starting = await editor
    .getByLabel('Normalized value (0–1)')
    .inputValue();
  await touch.click({ position: { x: 20, y: 20 } });
  await expect(editor.getByLabel('Normalized value (0–1)')).toHaveValue(
    starting,
  );
  await editor.getByRole('button', { name: 'Increase native value' }).click();
  await expect(editor.getByLabel('Normalized value (0–1)')).toHaveValue(
    String(Math.min(1, Number((Number(starting) + 0.01).toFixed(12)))),
  );
  await editor.getByRole('button', { name: 'Restore starting value' }).click();
  await touch.press('End');
  await expect(editor.getByTestId('native-readback')).toContainText(
    'normalized 1',
  );
  await editor.getByRole('button', { name: 'Restore starting value' }).click();
  await expect(editor.getByTestId('native-readback')).toHaveText(before!);
  await nativeValue(editor, '0.8');
  await expect(editor.getByTestId('native-readback')).not.toHaveText(before!);
  // The server applies this preview, but its reply is lost. Cancel must refresh
  // the revision and restore the baseline rather than replaying the preview.
  let loseReply = true;
  await page.route('**/api/v1/native', async (route) => {
    if (
      loseReply &&
      route.request().method() === 'POST' &&
      route.request().postDataJSON().action.kind === 'preview'
    ) {
      loseReply = false;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await nativeValue(editor, '0.9');
  await expect(editor.getByRole('alert')).toBeVisible();
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.unroute('**/api/v1/native');
  await expect(editor.getByTestId('native-readback')).toHaveText(before!);
  await editor
    .getByRole('button', { name: 'Adjust native value', exact: true })
    .click();
  await nativeValue(editor, '0.75');
  await editor.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText(
    'Unsaved tone changes',
  );
  const edited = await editor.getByTestId('native-readback').textContent();
  await editor.getByLabel('Native control').selectOption('osEnabled');
  await editor
    .getByRole('button', { name: 'Adjust native value', exact: true })
    .click();
  const stagedBefore = await editor
    .getByTestId('native-readback')
    .textContent();
  await touch.press('End');
  await expect(editor.getByLabel('Normalized value (0–1)')).toHaveValue('1');
  await expect(editor.getByTestId('native-readback')).toHaveText(stagedBefore!);

  await expect(editor.getByRole('dialog')).toContainText('Applied on Done');
  await editor.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(editor.getByTestId('native-readback')).toContainText(
    'normalized 1',
  );
  // Qualified controls come from native descriptors, including controls that
  // were previously absent from the hard-coded authoring list.
  const catalog = await (await request.get('/api/v1/native')).json();
  const writable = catalog.parameters.filter(
    (p: { writable: boolean }) => p.writable,
  );
  expect(writable).toHaveLength(39);
  expect(writable.map((p: { id: string }) => p.id)).toEqual(
    expect.arrayContaining([
      'outputBalance',
      'spreadEnabled',
      'spreadOffset',
      'spreadWobble',
      'spreadWobbleEnabled',
      'spreadCrossover',
      'spreadCrossoverEnabled',
      'spreadDiffuseEnabled',
      'alignEnabled',
      'alignOffset',
      'alignWobble',
      'alignWobbleEnabled',
      'alignCrossover',
      'alignCrossoverEnabled',
      'alignDiffuseEnabled',
      'chainPanLeft',
      'chainPanRight',
      'chainPanLinked',
      'chainInvertLeft',
      'chainInvertRight',
      'pitchEnabled',
      'pitchSemitones',
      'pitchStep',
      'pitchTonality',
      'pitchWindow',
    ]),
  );
  for (const [id, label] of [
    ['toneMid', 'Middle'],
    ['toneTreble', 'Treble'],
    ['gateThreshold', 'Gate threshold'],
    ['alignOffset', 'Alignment offset'],
    ['pitchSemitones', 'Pitch shift amount'],
  ]) {
    await editor.getByLabel('Native control').selectOption(id!);
    await expect(
      editor.getByRole('button', { name: 'Adjust native value', exact: true }),
    ).toContainText(label!);
    await editor
      .getByRole('button', { name: 'Adjust native value', exact: true })
      .click();
    await nativeValue(editor, '0.25');
    await editor.getByRole('button', { name: 'Done', exact: true }).click();
  }
  await editor.getByLabel('Native control').selectOption('gateEnabled');
  await editor
    .getByRole('button', { name: 'Adjust native value', exact: true })
    .click();
  await nativeValue(editor, '0.5');
  await expect(
    editor.getByRole('button', { name: 'Done', exact: true }),
  ).toBeDisabled();
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  // Select a native block, exercise exact toggles and cancellable mix on every
  // device project, then include the committed block change in the saved copy.
  const blockState = await (await request.get('/api/v1/native')).json();
  const blockMix = blockState.block_controls.find(
    (p: { parameter: string }) => p.parameter === 'mix',
  );
  const blockEnabled = blockState.block_controls.find(
    (p: { parameter: string }) => p.parameter === 'enabled',
  );
  expect(blockMix).toBeTruthy();
  await editor.getByLabel('Native control').selectOption(blockEnabled.id);
  await editor
    .getByRole('button', { name: 'Adjust native value', exact: true })
    .click();
  await nativeValue(editor, '0.5');
  await expect(
    editor.getByRole('button', { name: 'Done', exact: true }),
  ).toBeDisabled();
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await editor.getByLabel('Native control').selectOption(blockMix.id);
  const mixBefore = await editor.getByTestId('native-readback').textContent();
  await editor
    .getByRole('button', { name: 'Adjust native value', exact: true })
    .click();
  await touch.press('Home');
  await expect(editor.getByTestId('native-readback')).toContainText(
    'normalized 0',
  );
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor.getByTestId('native-readback')).toHaveText(mixBefore!);
  await editor
    .getByRole('button', { name: 'Adjust native value', exact: true })
    .click();
  await nativeValue(editor, '0.375');
  await editor.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(editor.getByTestId('native-readback')).toContainText(
    'normalized 0.375',
  );
  const blockSize = blockState.block_controls.find(
    (p: { parameter: string }) => p.parameter === 'slimSize',
  );
  expect(blockSize.staged).toBe(true);
  await editor.getByLabel('Native control').selectOption(blockSize.id);
  const sizeBefore = await editor.getByTestId('native-readback').textContent();
  await editor
    .getByRole('button', { name: 'Adjust native value', exact: true })
    .click();
  await touch.press('End');
  await expect(editor.getByTestId('native-readback')).toHaveText(sizeBefore!);
  await expect(editor.getByRole('dialog')).toContainText('Applied on Done');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor.getByTestId('native-readback')).toHaveText(sizeBefore!);
  await editor
    .getByRole('button', { name: 'Adjust native value', exact: true })
    .click();
  await nativeValue(editor, '0.75');
  await editor.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(editor.getByTestId('native-readback')).toContainText(
    'normalized 0.75',
  );
  await editor
    .getByLabel('Owned preset name')
    .fill(`Browser owned ${test.info().project.name}`);
  await editor.getByRole('button', { name: 'Save owned copy' }).click();
  await expect(editor.getByRole('status')).toHaveText('Native preset ready');
  const state = await (await request.get('/api/v1/native')).json();
  const owned = state.owned.find((p: { id: string }) => p.id === state.loaded);
  expect(owned.source_sha256).toBe(preset.sha256);
  expect(owned.preset.source_id).not.toBe(preset.source_id);
  if (!(await editor.getByLabel('Preset to load').isVisible()))
    await editor.getByTestId('native-preset-loader').locator('summary').click();
  await editor
    .getByLabel('Preset to load')
    .selectOption(`original:${preset.sha256}`);
  await editor.getByRole('button', { name: 'Load draft' }).click();
  await expect(editor.getByRole('status')).toHaveText('Native preset ready');
  await editor.getByLabel('Native control').selectOption('toneBass');
  await expect(editor.getByTestId('native-readback')).toHaveText(before!);
  await page.reload();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Library sections' })
    .getByRole('button', { name: 'Author', exact: true })
    .click();
  await editor.getByTestId('native-preset-loader').locator('summary').click();
  await editor.getByLabel('Preset to load').selectOption(`owned:${owned.id}`);
  await editor.getByRole('button', { name: 'Load draft' }).click();
  await expect(editor.getByRole('status')).toHaveText('Native preset ready');
  await expect(editor.getByTestId('native-readback')).toHaveText(edited!);
  const restored = await (await request.get('/api/v1/native')).json();
  expect(
    restored.block_controls.find(
      (p: { parameter: string }) => p.parameter === 'slimSize',
    ).value,
  ).toBe(0.75);
  for (const id of ['toneMid', 'toneTreble', 'gateThreshold']) {
    expect(
      restored.parameters.find((p: { id: string }) => p.id === id).normalized,
    ).toBeCloseTo(0.25, 4);
  }
  const restoredMix = restored.block_controls.find(
    (p: { parameter: string }) => p.parameter === 'mix',
  );
  await editor.getByTestId('native-control-browser').locator('summary').click();
  await editor.getByLabel('Native control').selectOption(restoredMix.id);
  await expect(editor.getByTestId('native-readback')).toContainText(
    'normalized 0.375',
  );
  await editor
    .getByRole('button', { name: 'Remove selected block', exact: true })
    .click();
  await expect(editor.getByLabel('Native control')).toHaveValue('toneBass');
  await expect(editor.getByRole('status')).toContainText(
    'Unsaved tone changes',
  );
  await editor.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(editor.getByRole('status')).toHaveText('Native preset ready');
  await editor.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText(
    'Unsaved tone changes',
  );
  await editor.getByRole('button', { name: 'Undo', exact: true }).click();
  const afterUndo = await (await request.get('/api/v1/native')).json();
  expect(afterUndo.block_controls).toEqual(restored.block_controls);
  await editor.getByLabel('Native control').selectOption('toneBass');
  await editor
    .getByRole('button', { name: 'Adjust native value', exact: true })
    .click();
  await touch.press('Home');
  await expect(editor.getByTestId('native-readback')).toContainText(
    'normalized 0',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Rig', exact: true }).click();
  await expect
    .poll(async () => (await (await request.get('/api/v1/native')).json()).edit)
    .toBeNull();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Library sections' })
    .getByRole('button', { name: 'Author', exact: true })
    .click();
  await expect(editor.getByTestId('native-readback')).toHaveText(edited!);
  const original = await request.get(
    `/api/v1/presets/${preset.sha256}/original`,
  );
  expect(await original.body()).toEqual(bytes);
  const portrait = page.viewportSize()!;
  const viewports = [portrait];
  if (
    ['iphone-xr', 'fold4-cover', 'fold4-open', 'boox-air3c'].includes(
      test.info().project.name,
    )
  )
    viewports.push({ width: portrait.height, height: portrait.width });
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(editor.getByTestId('native-readback')).toHaveText(edited!);
    const clipped = await editor
      .locator('.native-parameter-grid button')
      .evaluateAll((buttons) =>
        buttons.flatMap((button) => {
          const outer = button.getBoundingClientRect();
          return Array.from(button.children)
            .filter((child) => {
              const inner = child.getBoundingClientRect();
              return (
                inner.bottom > outer.bottom + 1 || inner.right > outer.right + 1
              );
            })
            .map((child) => child.textContent);
        }),
      );
    expect(
      clipped,
      'Every label and readout must stay inside its touch target',
    ).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath(`native-authoring-${viewport.width}.png`),
      fullPage: true,
    });
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: test.info().outputPath('native-authoring.png'),
    fullPage: true,
  });
});

test('native editor rejects stale ownership and replay then expires abandoned edits', async ({
  request,
}) => {
  test.skip(
    process.env.OXIDAL_NATIVE_EDITOR !== '1',
    'Requires the real native worker',
  );
  test.setTimeout(60000);
  const uploaded = await request.post('/api/v1/presets', {
    data: readFileSync(process.env.OXIDAL_NATIVE_TEST_PRESET!),
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  const preset = await uploaded.json();
  let state = await (await request.get('/api/v1/native')).json();
  const command = (
    action: Record<string, unknown>,
    override: Record<string, unknown> = {},
  ) => ({
    session: state.session,
    expected_revision: state.revision,
    request_id: crypto.randomUUID(),
    action,
    ...override,
  });
  async function apply(action: Record<string, unknown>) {
    const response = await request.post('/api/v1/native', {
      data: command(action),
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    state = await response.json();
  }
  await apply({ kind: 'load', id: preset.sha256, owned: false });
  const before = state.parameters.find(
    (p: { id: string }) => p.id === 'toneBass',
  ).value;
  const token = crypto.randomUUID();
  await apply({ kind: 'begin', owner: 'owner', token, target: 'toneBass' });
  const stale = command(
    { kind: 'preview', owner: 'owner', token, sequence: 1, value: 0.9 },
    { expected_revision: state.revision - 1 },
  );
  expect((await request.post('/api/v1/native', { data: stale })).status()).toBe(
    409,
  );
  expect(
    (
      await request.post('/api/v1/native', {
        data: command({
          kind: 'commit',
          owner: 'intruder',
          token,
          sequence: 1,
          value: 0.9,
        }),
      })
    ).status(),
  ).toBe(409);
  const preview = command({
    kind: 'preview',
    owner: 'owner',
    token,
    sequence: 1,
    value: 0.9,
  });
  let response = await request.post('/api/v1/native', { data: preview });
  expect(response.ok()).toBeTruthy();
  state = await response.json();
  const revision = state.revision;
  response = await request.post('/api/v1/native', { data: preview });
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).revision).toBe(revision);
  expect(
    (
      await request.post('/api/v1/native', {
        data: { ...preview, action: { ...preview.action, value: 0.7 } },
      })
    ).status(),
  ).toBe(409);
  await expect
    .poll(
      async () => {
        state = await (await request.get('/api/v1/native')).json();
        return state.edit;
      },
      { timeout: 35000, intervals: [500, 1000] },
    )
    .toBeNull();
  expect(
    state.parameters.find((p: { id: string }) => p.id === 'toneBass').value,
  ).toBe(before);
  expect(
    (
      await request.post('/api/v1/native', {
        data: command({
          kind: 'commit',
          owner: 'owner',
          token,
          sequence: 2,
          value: 0.7,
        }),
      })
    ).status(),
  ).toBe(409);
});

test('playback lifecycle clears a corrupt boot preference without a worker', async ({
  page,
  request,
}, info) => {
  // UI failure fixture; the actual HTTP suite corrupts and clears the on-disk record.
  const baseline = await (await request.get('/api/v1/audio')).json();
  let audio = {
    ...baseline,
    phase: 'unavailable',
    configured: null,
    device_owned: false,
    start_on_boot: false,
    controls: [],
    boot_error: 'Invalid boot audio configuration',
  };
  let cleared = false;
  await page.route('**/api/v1/audio', async (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON().action).toEqual({
        kind: 'set_boot',
        enabled: false,
      });
      cleared = true;
      audio = { ...audio, revision: audio.revision + 1, boot_error: null };
    }
    await route.fulfill({ json: audio });
  });
  const mixed = await (await request.get('/api/v1/rig-audio')).json();
  await page.route('**/api/v1/rig-audio', (route) =>
    route.fulfill({
      json: {
        ...mixed,
        phase: 'unavailable',
        configured: null,
        device_owned: false,
        start_on_boot: false,
      },
    }),
  );
  await page.goto('/');
  if (info.project.name === 'boox-air3c') await setDisplayMode(page, 'epaper');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Audio', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Playback controls' });
  const clear = panel.getByRole('button', {
    name: 'Clear invalid boot setup',
    exact: true,
  });
  await expect(clear).toBeEnabled();
  const initial = page.viewportSize()!;
  for (const viewport of [
    initial,
    { width: initial.height, height: initial.width },
  ]) {
    await page.setViewportSize(viewport);
    await clear.scrollIntoViewIfNeeded();
    expect((await clear.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await panel.screenshot({
      path: info.outputPath(`boot-recovery-${viewport.width}.png`),
    });
  }
  await clear.click();
  await expect.poll(() => cleared).toBe(true);
  await expect(
    panel.getByRole('button', {
      name: 'Use this session on boot',
      exact: true,
    }),
  ).toBeDisabled();
  expect(audio.phase).toBe('unavailable');
  expect(audio.device_owned).toBe(false);
});

test('playback lifecycle keeps native authoring available after stop and restart', async ({
  page,
  request,
}) => {
  test.skip(
    process.env.OXIDAL_AUDIO_QUALIFY_NULL !== '1',
    'Explicit Linux native/null qualification required',
  );
  test.setTimeout(90000);
  const bytes = readFileSync(process.env.OXIDAL_NATIVE_TEST_PRESET!);
  const imported = await request.post('/api/v1/presets', {
    data: bytes,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  expect(imported.ok()).toBe(true);
  const preset = await imported.json();
  const input = {
    endpoint: 'hw:CARD=Qualification,DEV=0',
    direction: 'capture',
    sample_rate: 48000,
    channels: 2,
    format: 's16',
    period_frames: 128,
    periods: 3,
  };
  const state = await (await request.get('/api/v1/audio')).json();
  const started = await request.post('/api/v1/audio', {
    data: {
      session: state.session,
      expected_revision: state.revision,
      action: {
        kind: 'start',
        settings: {
          stream: {
            input,
            output: { ...input, direction: 'playback' },
            input_map: [0, 1],
            output_map: [0, 1],
          },
          preset_id: preset.sha256,
          owned: false,
        },
      },
    },
  });
  expect(started.ok(), await started.text()).toBe(true);
  try {
    // One tap in Library replaces the sounding preset without audio setup.
    let running = await (await request.get('/api/v1/audio')).json();
    const recallCopy = await request.post('/api/v1/audio', {
      data: {
        session: running.session,
        expected_revision: running.revision,
        action: { kind: 'save_copy', name: 'Live recall test' },
      },
    });
    expect(recallCopy.ok()).toBe(true);
    running = await recallCopy.json();
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Instrument navigation' })
      .getByRole('button', { name: 'Library', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Load Live recall test', exact: true })
      .click();
    await expect(
      page.getByRole('region', { name: 'Sounding rig' }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/v1/audio')).json()).configured
            .preset_id,
      )
      .toBe(running.saved_copy);
    // Recall directly from Rig without returning to Library or audio settings.
    await page.getByRole('button', { name: /^Playing preset/ }).click();
    await page
      .locator(`.preset-picker-row[data-preset="original:${preset.sha256}"]`)
      .click();
    await expect(
      page.getByRole('region', { name: 'Sounding rig' }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/v1/audio')).json()).configured
            .preset_id,
      )
      .toBe(preset.sha256);
    const nativeBefore = await (await request.get('/api/v1/native')).json();
    await page.goto('/');
    if (test.info().project.name === 'boox-air3c')
      await setDisplayMode(page, 'epaper');
    const sounding = page.getByRole('region', { name: 'Sounding rig' });
    await expect(sounding).toBeVisible();
    const art = sounding.locator(
      '[data-artwork-density="compact"] [data-artwork-image]',
    );
    for (const width of await art.evaluateAll((items) =>
      items.map((item) => item.getBoundingClientRect().width),
    ))
      expect(width).toBeLessThanOrEqual(41);
    await expect(
      sounding.getByRole('button', { name: 'Save artwork offline' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Signal chain', exact: true }),
    ).toHaveCount(0);
    const liveControls = await (await request.get('/api/v1/audio')).json();
    // Real effect bypass/readback and button geometry, not just the silent preview.
    const firstBlock = liveControls.controls.find(
      (c: { target: string }) =>
        c.target.startsWith('block:') && c.target.endsWith(':enabled'),
    );
    await sounding.locator('.rig-tile').first().click();
    const power = sounding.locator('.led-toggle');
    await power.click();
    await expect
      .poll(async () => {
        const current = await (await request.get('/api/v1/audio')).json();
        return current.controls.find(
          (c: { target: string }) => c.target === firstBlock.target,
        ).value;
      })
      .toBe(firstBlock.value === 1 ? 0 : 1);
    await expect(power).toHaveAttribute(
      'aria-pressed',
      firstBlock.value === 1 ? 'false' : 'true',
    );
    await power.click();
    await expect(power).toHaveAttribute(
      'aria-pressed',
      String(firstBlock.value === 1),
    );
    const portrait = page.viewportSize()!;
    for (const viewport of [
      portrait,
      { width: portrait.height, height: portrait.width },
      portrait,
    ]) {
      await page.setViewportSize(viewport);
      const cards = await sounding.locator('.rig-tile').evaluateAll((items) =>
        items.map((item) => ({
          top: item.getBoundingClientRect().top,
          buttonBottom: item
            .querySelector('.rig-tile-face')!
            .getBoundingClientRect().bottom,
        })),
      );
      for (const card of cards)
        for (const other of cards) {
          if (Math.abs(card.top - other.top) < 1)
            expect(
              Math.abs(card.buttonBottom - other.buttonBottom),
            ).toBeLessThan(1);
        }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await sounding.locator('.rig-tile').first().click();
    const eq = sounding.getByRole('region', { name: 'Block EQ' });
    await expect(eq).toBeVisible();
    const eqBefore = (await (await request.get('/api/v1/audio')).json()).eq[0];
    await eq
      .getByRole('button', { name: 'Adjust EQ Gain', exact: true })
      .click();
    const eqDialog = eq.getByRole('dialog');
    await eqDialog
      .getByRole('slider', { name: 'Adjust EQ Gain' })
      .press('ArrowRight');
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/v1/audio')).json()).eq[0].eq.bands[1]
            .gainDb,
      )
      .not.toBe(eqBefore.eq.bands[1].gainDb);
    await eqDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/v1/audio')).json()).eq[0].eq,
      )
      .toEqual(eqBefore.eq);
    await eq
      .getByRole('button', { name: 'Adjust EQ Gain', exact: true })
      .click();
    await eq
      .getByRole('slider', { name: 'Adjust EQ Gain' })
      .press('ArrowRight');
    await eq.getByRole('button', { name: 'Done', exact: true }).click();
    const eqEdited = (await (await request.get('/api/v1/audio')).json()).eq;
    expect(eqEdited[0].eq.bands[1].gainDb).not.toBe(
      eqBefore.eq.bands[1].gainDb,
    );
    for (const viewport of [
      portrait,
      { width: portrait.height, height: portrait.width },
    ]) {
      await page.setViewportSize(viewport);
      await eq.scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await test.info().attach(`live-eq-${viewport.width}x${viewport.height}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    }
    await page.setViewportSize(portrait);
    await sounding.getByRole('button', { name: 'Tone', exact: true }).click();
    const outputControl = liveControls.controls.find(
      (c: { target: string }) => c.target === 'outputLevel',
    );
    await sounding
      .getByRole('button', {
        name: `Adjust sounding ${outputControl.label}`,
        exact: true,
      })
      .click();
    await sounding
      .getByRole('slider', { name: 'Adjust sounding value' })
      .press('ArrowLeft');
    // Hear the change while the floating control is still open, before Done or Save.
    await expect
      .poll(async () => {
        const current = await (await request.get('/api/v1/audio')).json();
        return current.controls.find(
          (p: { target: string }) => p.target === 'outputLevel',
        ).value;
      })
      .not.toBe(outputControl.value);
    await expect(sounding.getByRole('dialog')).toBeVisible();
    await sounding.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect
      .poll(async () => {
        const current = await (await request.get('/api/v1/audio')).json();
        return current.controls.find(
          (p: { target: string }) => p.target === 'outputLevel',
        ).value;
      })
      .toBe(outputControl.value);
    await sounding
      .getByRole('button', {
        name: `Adjust sounding ${outputControl.label}`,
        exact: true,
      })
      .click();
    await sounding
      .getByRole('slider', { name: 'Adjust sounding value' })
      .press('ArrowLeft');
    await sounding.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(sounding.getByTestId('live-status')).toHaveText('Edited');
    const live = await (await request.get('/api/v1/audio')).json();
    expect(live.modified).toBe(true);
    const liveLevel = live.controls.find(
      (p: { target: string }) => p.target === 'outputLevel',
    );
    await expect(sounding.getByTestId('live-readback')).toContainText(
      liveLevel.display,
    );
    // A second client changing the session invalidates rollback ownership.
    await sounding
      .getByRole('button', {
        name: `Adjust sounding ${outputControl.label}`,
        exact: true,
      })
      .click();
    await sounding
      .getByRole('slider', { name: 'Adjust sounding value' })
      .press('ArrowLeft');
    await expect
      .poll(async () => {
        const current = await (await request.get('/api/v1/audio')).json();
        return current.controls.find(
          (p: { target: string }) => p.target === 'outputLevel',
        ).value;
      })
      .not.toBe(liveLevel.value);
    const beforeOther = await (await request.get('/api/v1/audio')).json();
    const other = await request.post('/api/v1/audio', {
      data: {
        session: beforeOther.session,
        expected_revision: beforeOther.revision,
        action: { kind: 'set_control', target: 'outputLevel', value: 0.4 },
      },
    });
    expect(other.ok()).toBe(true);
    await expect(
      sounding.getByText(
        'Sounding session changed. Cancel and reopen this control.',
      ),
    ).toBeVisible();
    await sounding.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect
      .poll(async () => {
        const current = await (await request.get('/api/v1/audio')).json();
        return current.controls.find(
          (p: { target: string }) => p.target === 'outputLevel',
        ).value;
      })
      .toBeCloseTo(0.4, 5);
    await expect(
      sounding.getByRole('button', {
        name: 'Adjust sounding ' + outputControl.label,
        exact: true,
      }),
    ).toBeEnabled();
    // Stereo deck is contextual, but edits still reach the sounding worker.
    await sounding.getByRole('button', { name: 'Stereo', exact: true }).click();
    const spread = sounding.getByRole('button', {
      name: 'Adjust sounding Spread',
      exact: true,
    });
    await expect(spread).toHaveAttribute('aria-pressed', 'false');
    await spread.click();
    await expect(spread).toHaveAttribute('aria-pressed', 'true');
    const crossover = sounding.getByRole('button', {
      name: 'Adjust sounding Crossover frequency',
      exact: true,
    });
    await expect(crossover).toContainText('130 Hz');
    await crossover.click();
    await page
      .getByRole('slider', { name: 'Adjust sounding value', exact: true })
      .press('ArrowRight');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(crossover).not.toContainText('130 Hz');
    await test.info().attach('live-stereo-controls', {
      body: await sounding.screenshot(),
      contentType: 'image/png',
    });
    await sounding.getByRole('button', { name: 'Tone', exact: true }).click();
    await expect(spread).toHaveCount(0);
    // Only provider transport is a fixture. Selection, verified local asset, native
    // worker preparation, live readback and Save use the real daemon/processes.
    let holdDownload = true;
    const fixtures = await routeProviderModels(
      page,
      process.env.OXIDAL_NATIVE_TEST_MODELS!,
      () => (holdDownload ? 1500 : 0),
    );
    const irFixture = fixtures.find((f) => f.metadata.format === 'ir')!;
    expect(irFixture).toBeTruthy();
    const beforeModel = await (await request.get('/api/v1/audio')).json();
    await sounding.locator('.rig-tile').first().click();
    await sounding
      .getByRole('button', { name: 'Change model', exact: true })
      .first()
      .click();
    const picker = page.getByRole('dialog', { name: 'Choose model' });
    await picker.getByRole('button', { name: /Audition fixture/ }).click();
    for (const [name, viewport] of [
      ['portrait', portrait],
      ['landscape', { width: portrait.height, height: portrait.width }],
    ] as const) {
      await page.setViewportSize(viewport);
      await expect(
        picker.getByRole('button', { name: /Prepared A2/ }),
      ).toBeVisible();
      expect(
        await picker.evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      const back = await picker
        .getByRole('button', { name: 'Back to tones', exact: true })
        .boundingBox();
      const model = await picker
        .getByRole('button', { name: /Prepared A2/ })
        .boundingBox();
      expect(back && model && model.y - (back.y + back.height) >= 8).toBe(true);
      expect(model && model.height >= 44).toBe(true);
      await page.screenshot({
        path: test.info().outputPath(`model-picker-${name}.png`),
      });
    }
    await page.setViewportSize(portrait);
    await picker.getByRole('button', { name: /Prepared A2/ }).click();
    await picker
      .getByRole('button', { name: 'Cancel download', exact: true })
      .click();
    await expect(picker).toHaveCount(0);
    await page.waitForTimeout(1600);
    expect((await (await request.get('/api/v1/audio')).json()).models).toEqual(
      beforeModel.models,
    );
    holdDownload = false;
    await sounding
      .getByRole('button', { name: 'Change model', exact: true })
      .first()
      .click();
    await picker.getByRole('button', { name: /Audition fixture/ }).click();
    await picker.getByRole('button', { name: /Prepared A2/ }).click();
    await expect(picker.getByRole('status')).toContainText(/Auditioning/);
    await picker.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(picker).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/v1/audio')).json()).model_change
            ?.phase,
      )
      .toBe('applied');
    await expect(sounding.locator('.rig-tile').first()).toContainText(
      'Audition fixture',
    );
    const confirmedAfterOther = await (
      await request.get('/api/v1/audio')
    ).json();

    expect((await (await request.get('/api/v1/native')).json()).revision).toBe(
      nativeBefore.revision,
    );
    await expect(
      sounding.getByRole('button', { name: 'Done', exact: true }),
    ).toHaveCount(0);
    await sounding
      .getByRole('button', { name: 'Save copy', exact: true })
      .click();
    await sounding
      .getByLabel('Name for sounding copy')
      .fill(`Live ${test.info().project.name}`);
    await sounding
      .getByRole('button', { name: 'Save sounding copy', exact: true })
      .click();
    await expect(sounding.getByTestId('live-saved')).toContainText(
      'Copy saved in Library',
    );
    const savedLive = await (await request.get('/api/v1/audio')).json();
    expect(savedLive.phase).toBe('running');
    expect(savedLive.controls).toEqual(confirmedAfterOther.controls);
    expect(savedLive.saved_copy).toMatch(/^[0-9a-f]{64}$/);
    expect((await (await request.get('/api/v1/native')).json()).revision).toBe(
      nativeBefore.revision,
    );
    // Capture the instrument from the top; full-page screenshots otherwise retain
    // the sticky rail at the previous scroll offset and obscure the preset header.
    await page.evaluate(() => window.scrollTo(0, 0));
    const headingBox = await page.getByTestId('active-preset').boundingBox();
    const railBox = await page
      .getByRole('complementary', { name: 'DSP and system resources' })
      .boundingBox();
    expect(
      headingBox && railBox && headingBox.y >= railBox.y + railBox.height,
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath('sounding-rig.png'),
      fullPage: true,
    });

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const audio = page.getByRole('region', { name: 'Playback controls' });
    await expect(audio.getByRole('status')).toContainText('Audio: running');
    await audio.getByText('Current device & buffers', { exact: true }).click();
    const currentBuffers = audio.getByRole('group', {
      name: 'Adjust current session',
    });
    await currentBuffers
      .getByLabel('Session buffer (samples)')
      .selectOption('256');
    await currentBuffers.getByLabel('Session input right channel').fill('1');
    const appliedResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/audio') &&
        response.request().method() === 'POST' &&
        response.request().postDataJSON().action.kind === 'reconfigure',
    );
    await currentBuffers
      .getByRole('button', { name: 'Apply & restart audio', exact: true })
      .click();
    const applied = await appliedResponse;
    expect(applied.ok()).toBe(true);
    const reconfigured = await applied.json();
    expect(reconfigured.configured.stream.input.period_frames).toBe(256);
    expect(reconfigured.configured.stream.input_map).toEqual([0, 0]);
    expect(reconfigured.configured.preset_id).toBe(
      savedLive.configured.preset_id,
    );
    expect(reconfigured.controls).toEqual(savedLive.controls);
    await expect(audio.getByRole('status')).toContainText('Audio: running');
    await expect(
      currentBuffers.getByLabel('Session buffer (samples)'),
    ).toHaveValue('256');
    await expect(
      currentBuffers.getByRole('button', {
        name: 'Apply & restart audio',
        exact: true,
      }),
    ).toBeDisabled();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: test.info().outputPath('audio-apply.png'),
      fullPage: true,
    });
    await audio.getByText('Current device & buffers', { exact: true }).click();
    await audio
      .getByRole('button', { name: 'Use this session on boot' })
      .click();
    await expect(
      audio.getByRole('button', { name: 'Disable boot playback' }),
    ).toBeVisible();
    expect(
      (await (await request.get('/api/v1/audio')).json()).start_on_boot,
    ).toBe(true);
    await audio.getByRole('button', { name: 'Disable boot playback' }).click();
    await expect(
      audio.getByRole('button', { name: 'Use this session on boot' }),
    ).toBeVisible();
    expect(
      (await (await request.get('/api/v1/audio')).json()).start_on_boot,
    ).toBe(false);
    await audio
      .getByRole('button', { name: 'Stop audio', exact: true })
      .click();
    await expect(audio.getByRole('status')).toHaveText('Audio: stopped');
    await expect(
      page.getByRole('complementary', { name: 'DSP and system resources' }),
    ).toHaveAttribute('data-connected', 'true');
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await page
      .getByRole('navigation', { name: 'Library sections' })
      .getByRole('button', { name: 'Author', exact: true })
      .click();
    const editor = page.getByRole('region', { name: 'Native preset editor' });
    await expect(editor).toBeVisible();
    if (!(await editor.getByLabel('Preset to load').isVisible()))
      await editor
        .getByTestId('native-preset-loader')
        .locator('summary')
        .click();
    await editor
      .getByLabel('Preset to load')
      .selectOption(`original:${preset.sha256}`);
    await editor.getByRole('button', { name: 'Load draft' }).click();
    await expect(editor.getByRole('status')).toHaveText('Native preset ready');
    await editor
      .getByLabel('Owned preset name')
      .fill(`Stopped audio ${test.info().project.name}`);
    await editor.getByRole('button', { name: 'Save owned copy' }).click();
    await expect(editor.getByRole('status')).toHaveText('Native preset ready');
    const saved = await (await request.get('/api/v1/native')).json();
    expect(saved.session).toBe(nativeBefore.session);
    expect(saved.owned.some((p: { id: string }) => p.id === saved.loaded)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Rig', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Audio stopped', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Quick controls', { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByLabel('Example preset', { exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await audio.getByRole('button', { name: 'Resume session' }).click();
    await expect(audio.getByRole('status')).toContainText('Audio: running');
    expect(
      (await (await request.get('/api/v1/audio')).json()).controls,
    ).toEqual(savedLive.controls);
    const restarted = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/audio') &&
        response.request().method() === 'POST' &&
        response.request().postDataJSON()?.action.kind === 'restart',
    );
    await audio
      .getByRole('button', { name: 'Restart audio', exact: true })
      .click();
    const restartResponse = await restarted;
    expect(restartResponse.ok(), await restartResponse.text()).toBe(true);
    expect((await restartResponse.json()).controls).toEqual(savedLive.controls);
    await expect(
      audio.getByRole('button', { name: 'Stop audio', exact: true }),
    ).toBeEnabled();
    await expect(audio.getByRole('status')).toContainText('Audio: running');
    await audio
      .getByRole('button', { name: 'Stop audio', exact: true })
      .click();
    await expect(audio.getByRole('status')).toHaveText('Audio: stopped');
    expect((await (await request.get('/api/v1/native')).json()).loaded).toBe(
      saved.loaded,
    );
    expect(
      (await (await request.get('/api/v1/audio')).json()).device_owned,
    ).toBe(false);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    // Start from empty through the shared picker, then extend the actual native rig.
    const originalsBeforeNew = await (
      await request.get('/api/v1/presets')
    ).json();
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await page.getByRole('button', { name: 'New preset', exact: true }).click();
    const newRig = page.getByRole('region', { name: 'Effects authoring' });
    await newRig
      .getByLabel('Preset name', { exact: true })
      .fill(`Created ${test.info().project.name}`);
    await newRig
      .getByRole('button', { name: 'Add effect', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: 'Add effect' })
      .getByRole('button', { name: 'NAM model', exact: true })
      .click();
    await picker.getByRole('button', { name: /Audition fixture/ }).click();
    await picker.getByRole('button', { name: /Prepared A2/ }).click();
    await expect(picker).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/v1/audio')).json()).model_change
            ?.phase,
      )
      .toBe('applied');
    await expect(sounding.locator('.rig-tile')).toHaveCount(1);
    await sounding.getByRole('button', { name: 'Add block' }).click();
    await sounding
      .getByRole('button', { name: 'Add NAM', exact: true })
      .click();
    await sounding
      .getByLabel('Available insertion positions')
      .getByRole('button')
      .first()
      .click();
    await picker.getByRole('button', { name: /Audition fixture/ }).click();
    await picker.getByRole('button', { name: /Prepared A2/ }).click();
    await expect(picker).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/v1/audio')).json()).models.length,
      )
      .toBe(2);
    await expect(sounding.locator('.rig-tile')).toHaveCount(2);
    await sounding.getByRole('button', { name: 'Add block' }).click();
    await sounding.getByRole('button', { name: 'Add IR', exact: true }).click();
    await sounding
      .getByLabel('Available insertion positions')
      .getByRole('button')
      .first()
      .click();
    await expect(
      picker.getByRole('button', { name: 'Cab / IR', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      picker.getByRole('button', { name: /^Audition fixture/ }),
    ).toHaveCount(0);
    await picker.getByRole('button', { name: /IR audition fixture/ }).click();
    await picker.getByRole('button', { name: /Prepared IR/ }).click();
    await expect(picker).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/v1/audio')).json()).models.length,
      )
      .toBe(3);
    await expect(sounding.locator('.rig-tile')).toHaveCount(3);
    const created = await (await request.get('/api/v1/audio')).json();
    expect(created.configured.draft).toBe(true);
    expect(created.saved_copy).toBeNull();
    expect(await (await request.get('/api/v1/presets')).json()).toEqual(
      originalsBeforeNew,
    );
    await expect(page.getByTestId('resource-state')).toHaveText(
      'Audio running',
      { timeout: 12000 },
    );
    for (const [orientation, size] of [
      ['portrait', portrait],
      ['landscape', { width: portrait.height, height: portrait.width }],
    ] as const) {
      await page.setViewportSize(size);
      await expect(
        sounding.getByRole('button', { name: 'Add block' }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      expect(
        await sounding.locator('.live-value-trigger').evaluateAll((buttons) =>
          buttons.flatMap((button) => {
            const box = button.getBoundingClientRect();
            return Array.from(button.children).flatMap((child) => {
              const value = child.getBoundingClientRect();
              return value.bottom <= box.bottom + 1 &&
                value.right <= box.right + 1
                ? []
                : [
                    {
                      text: child.textContent,
                      style: {
                        display: getComputedStyle(button).display,
                        font: getComputedStyle(child).font,
                        sizing: getComputedStyle(
                          document.documentElement,
                        ).getPropertyValue('-webkit-text-size-adjust'),
                      },
                      box: box.toJSON(),
                      value: value.toJSON(),
                    },
                  ];
            });
          }),
        ),
      ).toEqual([]);
      // Compact blocks retain separate, full-size touch targets after rotation.
      const blockGeometry = await sounding
        .locator('.rig-tile')
        .evaluateAll((cards) =>
          cards.map((card) => ({
            height: card.getBoundingClientRect().height,
            buttons: [card].map((button) => {
              const box = button.getBoundingClientRect();
              return { width: box.width, height: box.height };
            }),
          })),
        );
      for (const card of blockGeometry) {
        // BOOX uses heavier borders and larger theme touch targets.
        expect(card.height).toBeLessThanOrEqual(128);
        for (const button of card.buttons) {
          expect(button.width).toBeGreaterThanOrEqual(44);
          expect(button.height).toBeGreaterThanOrEqual(44);
        }
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: test.info().outputPath(`created-native-${orientation}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize(portrait);
    await sounding
      .getByRole('button', { name: 'Save copy', exact: true })
      .click();
    await sounding
      .getByLabel('Name for sounding copy')
      .fill(`New NAM ${test.info().project.name}`);
    await sounding
      .getByRole('button', { name: 'Save sounding copy', exact: true })
      .click();
    await expect(sounding.getByTestId('live-saved')).toBeVisible();
    const createdCopy = await (await request.get('/api/v1/audio')).json();
    const nativeCopies = await (await request.get('/api/v1/native')).json();
    expect(
      nativeCopies.owned.find(
        (copy: { id: string }) => copy.id === createdCopy.saved_copy,
      ).source_sha256,
    ).toBeNull();
  } finally {
    const finalState = await (await request.get('/api/v1/audio')).json();
    if (finalState.device_owned) {
      const stopped = await request.post('/api/v1/audio', {
        data: {
          session: finalState.session,
          expected_revision: finalState.revision,
          action: { kind: 'stop' },
        },
      });
      expect(stopped.ok()).toBe(true);
    }
  }
});

test('asset artwork stays identifiable offline in portrait and landscape', async ({
  page,
}, testInfo) => {
  // Presentation fixture; Rust HTTP tests cover real cache publication/restart/integrity.
  const id = 'a'.repeat(64);
  const amp = 'b'.repeat(64);
  const cab = 'c'.repeat(64);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  await page.route('**/api/v1/presets', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      json: {
        presets: [
          {
            sha256: id,
            name: 'Artwork fixture',
            source_id: 'fixture',
            framing: 'legacy',
            size_bytes: 600,
            parameter_count: 0,
            block_count: 3,
            embedded_bytes: 0,
            playback_available: false,
          },
        ],
      },
    });
  });
  await page.route(`**/api/v1/presets/${id}/artwork**`, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST')
      return route.fulfill({
        status: 502,
        json: { error: 'Artwork source is unavailable' },
      });
    if (url.pathname.endsWith(`/${amp}`))
      return route.fulfill({ contentType: 'image/png', body: png });
    if (url.pathname.endsWith(`/${cab}`)) return route.fulfill({ status: 404 });
    return route.fulfill({
      json: [
        {
          block_id: 'amp-a',
          title: 'Shared name',
          gear: 'amp',
          key: amp,
          cached: true,
        },
        {
          block_id: 'cab-b',
          title: 'Shared name',
          gear: 'cab',
          key: cab,
          cached: false,
        },
        {
          block_id: 'space-c',
          title: 'Room IR',
          gear: 'space',
          key: null,
          cached: false,
        },
      ],
    });
  });
  const external: string[] = [];
  page.on('request', (request) => {
    if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))
      external.push(request.url());
  });
  await page.goto('/');
  if (testInfo.project.name === 'boox-air3c') {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await setDisplayMode(page, 'epaper');
  }
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  const image = page.getByRole('img', {
    name: 'Shared name · amp',
    exact: true,
  });
  await expect(image).toHaveCount(0);
  await page
    .getByRole('group', { name: 'Library view' })
    .getByRole('button', { name: 'Artwork', exact: true })
    .click();
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBe(1);
  await expect(
    page.locator('figcaption').filter({ hasText: 'No image supplied' }),
  ).not.toBeVisible();
  await page.getByText('1 asset without artwork', { exact: true }).click();
  await expect(
    page.locator('figcaption').filter({ hasText: 'No image supplied' }),
  ).toBeVisible();
  const status = await page
    .locator('figcaption > span')
    .filter({ hasText: 'Saved offline' })
    .first()
    .boundingBox();
  expect(status!.height).toBeLessThan(30);
  await page
    .getByRole('button', { name: 'Save artwork offline', exact: true })
    .click();
  await expect(page.getByText(/Audio is unaffected/)).toBeVisible();
  await expect(image).toBeVisible();
  const viewport = page.viewportSize()!;
  await page.setViewportSize({
    width: viewport.height,
    height: viewport.width,
  });
  await expect(image).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('artwork-landscape.png'),
    fullPage: true,
  });
  await page.reload();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(image).toBeVisible();
  expect(external).toEqual([]);
});

async function nativeValue(editor: Locator, value: string) {
  const input = editor.getByLabel('Normalized value (0–1)');
  if (!(await input.isVisible()))
    await editor
      .getByRole('dialog')
      .getByText('Enter value', { exact: true })
      .click();
  await input.fill(value);
}

test('graph authoring creates an installed effect rig and saves live controls', async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    process.env.OXIDAL_GRAPH_QUALIFY_NULL !== '1',
    'Requires the real Linux graph worker and explicit ALSA-null fixture',
  );
  test.setTimeout(90000);
  const endpoint = '/api/v1/graph-audio';
  const read = async () => (await request.get(endpoint)).json();
  const send = async (action: unknown) => {
    const s = await read();
    const response = await request.post(endpoint, {
      data: { session: s.session, expected_revision: s.revision, action },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const input = {
    endpoint: 'hw:CARD=Qualification,DEV=0',
    direction: 'capture',
    sample_rate: 48000,
    channels: 2,
    format: 's16',
    period_frames: 128,
    periods: 3,
  };
  await send({ kind: 'stop' });
  const configured = await send({
    kind: 'configure',
    stream: {
      input,
      output: { ...input, direction: 'playback' },
      input_map: [0, 1],
      output_map: [0, 1],
    },
  });
  expect(configured.device_owned).toBe(false);
  await send({
    kind: 'start',
    settings: { ...configured.configured, name: 'Previous session' },
  });
  await send({ kind: 'stop' });
  await page.goto('/');
  if (testInfo.project.name === 'boox-air3c')
    await setDisplayMode(page, 'epaper');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'New preset', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Effects authoring' });
  const name = `Practice ${testInfo.project.name}`;
  // Wait for the stopped session to arrive; it must not rename a new draft.
  await expect(
    editor.getByRole('button', { name: 'Add effect', exact: true }),
  ).toBeEnabled();
  await expect(editor.getByLabel('Preset name', { exact: true })).toHaveValue(
    'New preset',
  );
  await editor.getByLabel('Preset name', { exact: true }).fill(name);
  await editor.getByRole('button', { name: 'Add effect', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Add effect' });
  await picker
    .getByLabel('Search effects', { exact: true })
    .fill('Simple amplifier');
  const select = picker.getByRole('button', {
    name: 'Simple amplifier',
    exact: true,
  });
  await expect(select).toBeEnabled();
  const viewport = page.viewportSize()!;
  for (const [orientation, size] of [
    [
      'portrait',
      {
        width: Math.min(viewport.width, viewport.height),
        height: Math.max(viewport.width, viewport.height),
      },
    ],
    [
      'landscape',
      {
        width: Math.max(viewport.width, viewport.height),
        height: Math.min(viewport.width, viewport.height),
      },
    ],
  ] as const) {
    await page.setViewportSize(size);
    await expect(select).toBeInViewport();
    expect(
      await picker.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBeTruthy();
    const box = await select.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path: testInfo.outputPath(`effects-picker-${orientation}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize(viewport);
  await select.click();
  await editor
    .getByRole('button', { name: 'Audition preset', exact: true })
    .click();
  await expect(
    editor.getByRole('button', { name: 'Save preset', exact: true }),
  ).toBeVisible();
  const adjust = editor.getByRole('button', {
    name: 'Adjust gain value',
    exact: true,
  });
  await adjust.click();
  const dialog = page.getByRole('dialog', { name: 'gain', exact: true });
  await dialog.getByText('Enter value', { exact: true }).click();
  await dialog.getByLabel('Draft gain', { exact: true }).fill('-35');
  await expect
    .poll(async () => (await read()).native_values[0].value)
    .toBe(-35);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect.poll(async () => (await read()).native_values[0].value).toBe(0);
  await adjust.click();
  await dialog.getByText('Enter value', { exact: true }).click();
  await dialog.getByLabel('Draft gain', { exact: true }).fill('-35');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect
    .poll(async () => (await read()).native_values[0].value)
    .toBe(-35);
  // Audio settings must operate on the sounding effects owner, not native playback.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Audio', exact: true }).click();
  const playback = page.getByRole('region', { name: 'Playback controls' });
  await expect(
    playback.getByRole('heading', { name: 'Effects audio' }),
  ).toBeVisible();
  await playback
    .getByRole('button', { name: 'Use this session on boot', exact: true })
    .click();
  await expect.poll(async () => (await read()).start_on_boot).toBe(true);
  expect(
    (await (await request.get('/api/v1/audio')).json()).start_on_boot,
  ).toBe(false);
  await playback
    .getByRole('button', { name: 'Stop audio', exact: true })
    .click();
  await expect.poll(async () => (await read()).device_owned).toBe(false);
  await expect(
    playback.getByRole('heading', { name: 'Effects audio' }),
  ).toBeVisible();
  await playback
    .getByRole('button', { name: 'Resume session', exact: true })
    .click();
  await expect
    .poll(async () => (await read()).native_values[0]?.value)
    .toBe(-35);
  await playback.getByText('Current device & buffers', { exact: true }).click();
  await playback
    .getByLabel('Session sample rate (Hz)', { exact: true })
    .fill('44100');
  await playback
    .getByLabel('Session buffer (samples)', { exact: true })
    .selectOption('256');
  const apply = playback.getByRole('button', {
    name: 'Apply & restart audio',
    exact: true,
  });
  await apply.click();
  await expect
    .poll(async () => (await read()).configured.stream.input.sample_rate)
    .toBe(44100);
  await expect.poll(async () => (await read()).phase).toBe('running');
  await expect
    .poll(async () => (await read()).native_values[0]?.value)
    .toBe(-35);
  for (const size of [
    viewport,
    { width: viewport.height, height: viewport.width },
  ]) {
    await page.setViewportSize(size);
    await playback.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const buttons = await playback.getByRole('button').all();
    for (const button of buttons) {
      if (await button.isVisible())
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    // Capture from a stable top-of-page position: full-page screenshots otherwise
    // place the sticky meter strip over content from the prior scrolled viewport.
    await expect(page.getByTestId('resource-state')).toHaveText(
      'Audio running',
      { timeout: 12000 },
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath(`effects-settings-${size.width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize(viewport);
  await playback
    .getByRole('button', { name: 'Disable boot playback', exact: true })
    .click();
  await expect.poll(async () => (await read()).start_on_boot).toBe(false);
  await page.getByRole('button', { name: 'Rig', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Save as', { exact: true })).toHaveValue(name);
  await editor
    .getByRole('button', { name: 'Save preset', exact: true })
    .click();
  await expect(editor.getByText('Saved copy', { exact: true })).toBeVisible();
  const saved = (await read()).saved_copy;
  expect(saved).toMatch(/^[a-f0-9]{64}$/);
  await page.getByRole('button', { name: 'Rig', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Effects authoring' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Audio stopped', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByTestId('resource-state')).toHaveText('Audio running', {
    timeout: 12000,
  });
  const effect = page.getByRole('region', {
    name: '1 · Simple amplifier',
    exact: true,
  });
  await expect(effect).toBeVisible();
  await expect(effect.locator('output')).toHaveText('-35');
  await page.screenshot({
    path: testInfo.outputPath('effects-live.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Stop audio', exact: true }).click();
  await expect.poll(async () => (await read()).device_owned).toBe(false);
  await page.reload();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'New preset', exact: true }).click();
  await editor.getByRole('button', { name, exact: true }).click();
  await editor
    .getByRole('button', { name: 'Audition preset', exact: true })
    .click();
  await expect
    .poll(async () => (await read()).native_values[0]?.value)
    .toBe(-35);
  await editor.getByRole('button', { name: 'Stop audio', exact: true }).click();
  await expect.poll(async () => (await read()).device_owned).toBe(false);
});

test('mixed rig authoring presents confirmed controls and recalls isolated offline saves', async ({
  page,
  request,
}, info) => {
  test.skip(
    process.env.OXIDAL_RIG_QUALIFY_NULL !== '1' ||
      !process.env.OXIDAL_MIXED_TEST_ROOT,
    'Maintained Linux native gate supplies the mixed worker and fixture',
  );
  test.setTimeout(120000);
  page.setDefaultTimeout(20000);
  const root = process.env.OXIDAL_MIXED_TEST_ROOT!;
  const revision = readFileSync(
    join(root, 'mixed-preset-revision'),
    'utf8',
  ).trim();
  const folder = join(root, 'worker-rigs', revision);
  const manifest = JSON.parse(
    readFileSync(join(folder, 'manifest.json'), 'utf8'),
  );
  manifest.name = `Browser rig ${info.project.name}`;
  const sources: Record<string, unknown> = {};
  for (const resource of manifest.resources) {
    const imported = await request.post('/api/v1/presets', {
      data: readFileSync(join(folder, resource.path)),
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    expect(imported.ok()).toBe(true);
    sources[resource.id] = {
      kind: 'original',
      preset: (await imported.json()).sha256,
    };
  }
  const published = await request.post('/api/v1/presets/rigs', {
    data: { manifest_json: JSON.stringify(manifest), resources: sources },
  });
  expect(published.ok()).toBe(true);
  const document = await published.json();
  const get = async () => (await request.get('/api/v1/rig-audio')).json();
  const command = async (action: unknown) => {
    const s = await get();
    const r = await request.post('/api/v1/rig-audio', {
      data: { session: s.session, expected_revision: s.revision, action },
    });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  await command({ kind: 'stop' });
  const input = {
    endpoint: 'hw:CARD=Qualification,DEV=0',
    direction: 'capture',
    sample_rate: 48000,
    channels: 2,
    format: 's16',
    period_frames: 128,
    periods: 3,
  };
  await command({
    kind: 'start',
    settings: {
      revision: document.revision,
      stream: {
        input,
        output: { ...input, direction: 'playback' },
        input_map: [0, 1],
        output_map: [0, 1],
      },
      recall: null,
    },
  });
  await expect.poll(async () => (await get()).phase).toBe('running');
  await page.goto('/');
  if (info.project.name === 'boox-air3c') await setDisplayMode(page, 'epaper');
  const rig = page.getByRole('region', { name: 'Sounding mixed rig' });
  await expect(rig).toBeVisible();
  await expect(page.getByTestId('active-preset')).toHaveText(manifest.name);
  await expect(page.getByRole('region', { name: 'Rig playback' })).toHaveCount(
    0,
  );
  await rig.locator('[data-node="fx_l"]').getByRole('button').first().click();
  const target = { kind: 'lv2', node: 'fx_l', symbol: 'gain' };
  const value = async () =>
    (
      (await get()).control.controls as { target: unknown; value: number }[]
    ).find((c) => JSON.stringify(c.target) === JSON.stringify(target))!.value;
  const initial = await value();
  const control = (await get()).control.controls.find(
    (c: { target: unknown }) =>
      JSON.stringify(c.target) === JSON.stringify(target),
  );
  const adjust = rig.getByRole('button', {
    name: `Adjust ${control.label}`,
    exact: true,
  });
  await adjust.click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('slider').focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(value).toBeGreaterThan(initial);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(value).toBe(initial);
  await expect.poll(async () => (await get()).control.modified).toBe(false);
  await adjust.click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('slider').focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(value).toBeGreaterThan(initial);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  const changed = await value();
  await expect(rig.getByRole('status').first()).toHaveText('Session modified');
  await rig.locator('[data-node="tone"]').getByRole('button').first().click();
  await rig
    .getByRole('button', { name: 'Select model 1', exact: true })
    .click();
  const layoutBefore = (await get()).control.authoring[0].status.layout;
  const nativeGain = (await get()).control.controls.find(
    (c: { target: { kind: string; node: string; parameter?: string } }) =>
      c.target.kind === 'native' &&
      c.target.node === 'tone' &&
      c.target.parameter?.endsWith(':outputGain'),
  );
  const nativeValue = async () =>
    (
      (await get()).control.controls as { target: unknown; value: number }[]
    ).find(
      (c) => JSON.stringify(c.target) === JSON.stringify(nativeGain.target),
    )!.value;
  const openingNative = await nativeValue();
  await rig
    .getByRole('button', { name: 'Adjust Output gain', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('slider').press('ArrowRight');
  await dialog.getByRole('slider').press('ArrowRight');
  await expect.poll(nativeValue).toBeGreaterThan(openingNative);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect
    .poll(async () => (await get()).control.authoring[0].status.gesture)
    .toBeNull();
  await rig.getByRole('button', { name: 'Undo change', exact: true }).click();
  await expect.poll(nativeValue).toBe(openingNative);
  await rig.getByRole('button', { name: 'Redo change', exact: true }).click();
  await expect.poll(nativeValue).toBeGreaterThan(openingNative);
  await rig.getByRole('button', { name: 'Undo change', exact: true }).click();
  await expect.poll(nativeValue).toBe(openingNative);
  await rig.getByRole('button', { name: 'Copy block', exact: true }).click();
  await expect
    .poll(async () => (await get()).control.authoring[0].status.can_paste)
    .toBe(true);
  await rig.getByRole('button', { name: 'Paste block', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await get()).control.authoring[0].status.layout.left.filter(
          (b: { insert: boolean }) => !b.insert,
        ).length,
    )
    .toBe(
      layoutBefore.left.filter((b: { insert: boolean }) => !b.insert).length +
        1,
    );
  await rig.getByRole('button', { name: 'Undo change', exact: true }).click();
  await expect
    .poll(async () => (await get()).control.authoring[0].status.layout)
    .toEqual(layoutBefore);
  await rig
    .getByRole('button', { name: 'Duplicate block', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await get()).control.authoring[0].status.layout.left.filter(
          (block: { insert: boolean }) => !block.insert,
        ).length,
    )
    .toBe(
      layoutBefore.left.filter((block: { insert: boolean }) => !block.insert)
        .length + 1,
    );
  await rig.getByRole('button', { name: 'Undo change', exact: true }).click();
  await expect
    .poll(async () => (await get()).control.authoring[0].status.layout)
    .toEqual(layoutBefore);
  await page.getByRole('button', { name: 'Open tuner', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Start tuner', exact: true })
    .click();
  await expect(rig.getByLabel('Tuner reading')).toBeVisible();
  await expect
    .poll(async () => (await get()).control.authoring[0].status.tools.tuner)
    .not.toBeNull();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Stop tuner', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click();
  await expect(rig.getByLabel('Tuner reading')).toHaveCount(0);
  await rig
    .getByRole('button', { name: 'Use stereo chains', exact: true })
    .click();
  await expect
    .poll(async () => (await get()).control.authoring[0].status.layout.stereo)
    .toBe(true);
  const monitoringBefore = (await get()).control.authoring[0].status.working;
  await rig.getByRole('button', { name: 'Solo left', exact: true }).click();
  await expect(
    rig.getByRole('button', { name: 'Solo left', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    rig.getByRole('button', { name: 'Match levels', exact: true }),
  ).toBeDisabled();
  await expect
    .poll(async () => (await get()).control.authoring[0].status.tools.solo)
    .toBe('left');
  expect((await get()).control.authoring[0].status.working).toEqual(
    monitoringBefore,
  );
  await rig.getByRole('button', { name: 'Both chains', exact: true }).click();
  await expect
    .poll(async () => (await get()).control.authoring[0].status.tools.solo)
    .toBe('none');
  await rig.getByRole('button', { name: 'Match levels', exact: true }).click();
  await expect
    .poll(
      async () => (await get()).control.authoring[0].status.tools.balance.state,
    )
    .toBe('listening');
  await rig
    .getByRole('button', { name: 'Cancel measurement', exact: true })
    .click();
  await expect
    .poll(
      async () => (await get()).control.authoring[0].status.tools.balance.state,
    )
    .toBe('idle');
  await rig.getByRole('button', { name: 'Undo change', exact: true }).click();
  await expect
    .poll(async () => (await get()).control.authoring[0].status.layout)
    .toEqual(layoutBefore);
  const modelSize = (await get()).control.authoring[0].status.settings.find(
    (setting: { target: string }) => setting.target.endsWith(':slimSize'),
  );
  expect(modelSize).toBeTruthy();
  await rig.getByRole('button', { name: /NAM size/ }).click();
  const sizeDialog = page.getByRole('dialog');
  await sizeDialog
    .getByRole('slider', { name: 'Prepared setting value' })
    .press(modelSize.value < 0.5 ? 'ArrowRight' : 'ArrowLeft');
  const sizeApplied = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/rig-audio') &&
      response.request().method() === 'POST' &&
      response.request().postDataJSON()?.action?.kind === 'authoring',
  );
  await sizeDialog.getByRole('button', { name: 'Apply', exact: true }).click();
  const sizeReply = await sizeApplied;
  expect(sizeReply.ok(), await sizeReply.text()).toBe(true);
  expect((await sizeReply.json()).phase).toBe('starting');
  await expect.poll(async () => (await get()).phase).toBe('running');
  await expect
    .poll(
      async () =>
        (await get()).control.authoring[0].status.settings.find(
          (setting: { target: string }) => setting.target === modelSize.target,
        ).value,
    )
    .not.toBe(modelSize.value);
  const eq = rig.getByRole('region', { name: 'Block EQ' });
  await expect(eq).toBeVisible();
  const eqBefore = (await get()).control.eq;
  await eq.getByRole('button', { name: 'Adjust EQ Gain', exact: true }).click();
  await page
    .getByRole('slider', { name: 'Adjust EQ Gain' })
    .press('ArrowRight');
  await expect.poll(async () => (await get()).control.eq).not.toEqual(eqBefore);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect.poll(async () => (await get()).control.eq).toEqual(eqBefore);
  await eq.getByRole('button', { name: 'Adjust EQ Gain', exact: true }).click();
  await page
    .getByRole('slider', { name: 'Adjust EQ Gain' })
    .press('ArrowRight');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Done', exact: true })
    .click();
  await expect.poll(async () => (await get()).control.eq).not.toEqual(eqBefore);
  const eqEdited = (await get()).control.eq;
  await rig.getByRole('button', { name: 'Undo change', exact: true }).click();
  await expect.poll(async () => (await get()).control.eq).toEqual(eqBefore);
  await rig.getByRole('button', { name: 'Redo change', exact: true }).click();
  await expect.poll(async () => (await get()).control.eq).toEqual(eqEdited);
  await eq.getByRole('button', { name: 'Reset EQ', exact: true }).click();
  await expect
    .poll(async () => (await get()).control.eq[0].blocks[0].eq.bands[1].gainDb)
    .toBe(0);
  await rig.getByRole('button', { name: 'Undo change', exact: true }).click();
  await expect.poll(async () => (await get()).control.eq).toEqual(eqEdited);
  // Only provider transport is mocked; verified assets, actual live worker,
  // immediate readback, settings recovery and independent export remain real.
  const modelFixtures = await routeProviderModels(
    page,
    process.env.OXIDAL_NATIVE_TEST_MODELS!,
  );
  const change = rig.getByRole('button', { name: 'Change model', exact: true });
  await expect(change).toBeEnabled();
  const beforeModel = await get();
  await change.click();
  let picker = page.getByRole('dialog', { name: 'Choose model' });
  await picker
    .getByRole('button', {
      name: modelFixtures.find((f) => f.metadata.format === 'nam')!.metadata
        .title,
    })
    .click();
  await picker
    .getByLabel('Available models')
    .getByRole('button')
    .first()
    .click();
  await expect(picker.getByRole('status')).toContainText(/Auditioning/);
  await picker.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect
    .poll(async () => (await get()).control.model_change?.progress.phase)
    .toBe('applied');
  expect((await get()).control.session).toBe(beforeModel.control.session);
  expect((await get()).processed_frames).toBeGreaterThan(
    beforeModel.processed_frames,
  );
  const replacement = (await get()).control.models;
  expect(replacement[0].assignments).toHaveLength(1);
  await rig.getByRole('button', { name: 'Add block' }).click();
  await rig.getByRole('button', { name: 'Add NAM', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Add NAM · position' })
    .getByRole('button', { name: /Left chain · position/ })
    .first()
    .click();
  picker = page.getByRole('dialog', { name: 'Choose model' });
  await picker
    .getByRole('button', {
      name: modelFixtures.find((f) => f.metadata.format === 'nam')!.metadata
        .title,
    })
    .click();
  await picker
    .getByLabel('Available models')
    .getByRole('button')
    .first()
    .click();
  await expect(picker).toHaveCount(0);
  await expect
    .poll(async () => (await get()).control.model_change?.progress.phase)
    .toBe('applied');
  expect((await get()).control.models[0].assignments).toHaveLength(2);
  await rig.getByRole('button', { name: 'Add block' }).click();
  await rig.getByRole('button', { name: 'Add IR', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Add IR · position' })
    .getByRole('button', { name: /Left chain · position/ })
    .first()
    .click();
  picker = page.getByRole('dialog', { name: 'Choose model' });
  await picker
    .getByRole('button', {
      name: modelFixtures.find((f) => f.metadata.format === 'ir')!.metadata
        .title,
    })
    .click();
  await picker
    .getByLabel('Available models')
    .getByRole('button')
    .first()
    .click();
  await expect(picker).toHaveCount(0);
  await expect
    .poll(async () => (await get()).control.model_change?.progress.phase)
    .toBe('applied');
  await expect(rig.getByRole('button', { name: 'Add block' })).toBeEnabled();
  const modelSaved = (await get()).control.models;
  expect(modelSaved[0].assignments).toHaveLength(3);
  await expect.poll(value).toBe(changed);
  for (const viewport of [
    page.viewportSize()!,
    { width: page.viewportSize()!.height, height: page.viewportSize()!.width },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await info.attach(`mixed-live-models-${viewport.width}`, {
      body: await rig.screenshot(),
      contentType: 'image/png',
    });
  }
  await page.setViewportSize(info.project.use.viewport!);
  const eqSaved = (await get()).control.eq;
  expect(
    await eq.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await test.info().attach('mixed-eq-controls', {
    body: await eq.screenshot(),
    contentType: 'image/png',
  });
  // Settings must follow this sounding owner, preserving edits before named Save.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const audioSettings = page.getByRole('region', { name: 'Playback controls' });
  await expect(
    audioSettings.getByRole('heading', { name: 'Presets with scenes' }),
  ).toBeVisible();
  await audioSettings
    .getByText('Current device & buffers', { exact: true })
    .click();
  const buffers = audioSettings.getByRole('group', {
    name: 'Adjust current session',
  });
  await expect(
    buffers
      .getByLabel('Session buffer (samples)')
      .locator('option[value="129"]'),
  ).toHaveCount(0);
  await expect(
    buffers.getByRole('button', { name: 'Apply & restart audio', exact: true }),
  ).toBeDisabled();
  await buffers.getByLabel('Session buffer (samples)').selectOption('256');
  await buffers.getByLabel('Session sample rate (Hz)').fill('44100');
  await buffers
    .getByRole('button', { name: 'Apply & restart audio', exact: true })
    .click();
  await expect
    .poll(async () => (await get()).configured.stream.input.period_frames)
    .toBe(256);
  await expect.poll(async () => (await get()).phase).toBe('running');
  await expect.poll(value).toBe(changed);
  await expect
    .poll(async () => (await get()).control.models)
    .toEqual(modelSaved);
  expect((await get()).configured.stream.input.sample_rate).toBe(44100);
  await expect(audioSettings.getByRole('status')).toHaveText('running');
  await audioSettings
    .getByRole('button', { name: 'Use this session on boot' })
    .click();
  await expect(
    audioSettings.getByRole('button', { name: 'Disable boot playback' }),
  ).toBeVisible();
  await expect.poll(async () => (await get()).start_on_boot).toBe(true);
  expect(
    (await (await request.get('/api/v1/audio')).json()).start_on_boot,
  ).toBe(false);
  await expect.poll(value).toBe(changed);
  await audioSettings
    .getByRole('button', { name: 'Disable boot playback' })
    .click();
  await expect.poll(async () => (await get()).start_on_boot).toBe(false);
  await expect(audioSettings.getByRole('status')).toHaveText('running');

  const settingsViewport = page.viewportSize()!;
  for (const viewport of [
    settingsViewport,
    { width: settingsViewport.height, height: settingsViewport.width },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`mixed-audio-settings-${viewport.width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize(settingsViewport);
  // A slow document response must not overwrite a name entered after Settings.
  let releaseDocument = () => {};
  const pendingDocument = new Promise<void>((resolve) => {
    releaseDocument = resolve;
  });
  const documentUrl = `**/api/v1/presets/rigs/${document.revision}`;
  await page.route(documentUrl, async (route) => {
    await pendingDocument;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Rig', exact: true }).click();
  await expect(
    rig.getByRole('button', { name: 'Save copy', exact: true }),
  ).toBeDisabled();
  releaseDocument();
  await rig.getByRole('button', { name: 'Save copy', exact: true }).click();
  const nameInput = rig.getByLabel('Preset name', { exact: true });
  const name = `Offline mixed ${info.project.name}`;
  await nameInput.fill(name);
  await page.unroute(documentUrl);
  await rig.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    rig.getByText('Saved for offline use', { exact: true }),
  ).toBeVisible();
  await expect.poll(async () => (await get()).phase).toBe('running');
  await rig.getByRole('button', { name: 'Stop audio', exact: true }).click();
  await expect.poll(async () => (await get()).phase).toBe('stopped');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  const savedLibrary = page.getByRole('region', {
    name: 'Presets with scenes',
    exact: true,
  });
  await savedLibrary
    .getByRole('button', { name: 'Keep ready', exact: true })
    .click();
  const ready = savedLibrary.getByRole('checkbox', {
    name: `Keep ${manifest.name} ready`,
    exact: true,
  });
  while (!(await ready.count())) {
    const more = savedLibrary.getByRole('button', {
      name: 'Load more',
      exact: true,
    });
    await expect(more).toBeVisible();
    await more.click();
  }
  await ready.check();
  await playSavedRig(page, name);
  await expect(rig).toBeVisible();
  await expect.poll(async () => (await get()).phase).toBe('running');
  await expect.poll(async () => (await get()).control.eq).toEqual(eqSaved);
  await expect.poll(value).toBe(changed);
  await expect.poll(async () => (await get()).control.modified).toBe(false);
  const resident = await get();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('oxidal.prepared-rigs') ?? '[]'),
    ),
  ).toEqual(
    expect.arrayContaining([document.revision, resident.configured.revision]),
  );
  expect(
    resident.control.prepared.some(
      (p: { revision: string }) => p.revision === document.revision,
    ),
  ).toBe(true);
  const preparedControls = rig.getByRole('group', { name: 'Prepared presets' });
  await preparedControls
    .getByRole('button', { name: manifest.name, exact: true })
    .click();
  await expect
    .poll(async () => (await get()).configured.revision)
    .toBe(document.revision);
  await expect.poll(async () => (await get()).phase).toBe('running');
  expect((await get()).processed_frames).toBeGreaterThan(
    resident.processed_frames,
  );
  await preparedControls.getByRole('button', { name, exact: true }).click();
  await expect
    .poll(async () => (await get()).configured.revision)
    .toBe(resident.configured.revision);
  await expect.poll(async () => (await get()).control.eq).toEqual(eqSaved);
  await expect.poll(value).toBe(changed);
  await expect(preparedControls.getByRole('button').first()).toBeEnabled();
  await info.attach('prepared-preset-controls', {
    body: await preparedControls.screenshot(),
    contentType: 'image/png',
  });
  await page.reload();
  await expect(page.getByTestId('active-preset')).toHaveText(name);
  await rig.locator('[data-node="fx_l"]').getByRole('button').first().click();
  for (const mode of info.project.name === 'boox-air3c'
    ? (['epaper'] as const)
    : (['stage'] as const)) {
    await setDisplayMode(page, mode);
    const portrait = page.viewportSize()!;
    for (const viewport of [
      portrait,
      { width: portrait.height, height: portrait.width },
    ]) {
      await page.setViewportSize(viewport);
      await expect(adjust).toBeVisible();
      const cramped = await rig.locator('[data-node]').evaluateAll((rows) =>
        rows.some((row) => {
          const buttons = Array.from(row.querySelectorAll('button'));
          return (
            buttons.some((b) => b.getBoundingClientRect().height < 43.5) ||
            (buttons.length === 2 &&
              buttons[1]!.getBoundingClientRect().left -
                buttons[0]!.getBoundingClientRect().right <
                7.5)
          );
        }),
      );
      expect(cramped).toBe(false);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const audit = await new AxeBuilder({ page })
        .include('[aria-label="Sounding mixed rig"]')
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      expect(audit.violations).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`mixed-${viewport.width}.png`),
        fullPage: true,
      });
    }
  }
  // Real checkpoint failures are covered by rig_playback.rs. Inject only the
  // warning text here to qualify its layout and usable controls on each device.
  const warning =
    'Mixed session recovery could not be saved: /var/lib/oxidal/presets/last-rig-session.tmp is unavailable. Current session remains in memory.';
  await page.route('**/api/v1/rig-audio', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const state = await response.json();
    await route.fulfill({
      response,
      json: { ...state, recovery_error: warning },
    });
  });
  const notice = rig.locator('.recovery-notice');
  await expect(notice.getByRole('alert')).toHaveText(
    'Session recovery unavailable',
  );
  await expect(notice.getByText(warning, { exact: true })).not.toBeVisible();
  await expect(
    rig.getByRole('button', { name: 'Stop audio', exact: true }),
  ).toBeEnabled();
  const recoveryViewport = page.viewportSize()!;
  for (const viewport of [
    recoveryViewport,
    { width: recoveryViewport.height, height: recoveryViewport.width },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await notice.locator('summary').click();
    await expect(notice.getByText(warning, { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await notice.locator('summary').click();
    await page.screenshot({
      path: info.outputPath(`mixed-recovery-warning-${viewport.width}.png`),
      fullPage: true,
    });
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('button', { name: 'Audio', exact: true })
    .click();
  await expect(
    page
      .getByRole('region', { name: 'Playback controls' })
      .getByRole('alert')
      .filter({ hasText: 'Session recovery unavailable' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.unroute('**/api/v1/rig-audio');
  // Library management does not rewrite a portable rig or touch the sounding owner.
  const playingBefore = await get();
  const managedRevision = playingBefore.configured.revision;
  const originalDocument = await (
    await request.get(`/api/v1/presets/rigs/${managedRevision}`)
  ).json();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page
    .getByRole('button', { name: 'Manage library', exact: true })
    .click();
  const management = page.getByRole('region', {
    name: 'Manage library',
    exact: true,
  });
  const row = management.locator(
    `[data-library-kind="rig"][data-library-entry="${managedRevision}"]`,
  );
  const label = `Managed ${info.project.name}`;
  await row.getByRole('button', { name: /^Preset options:/ }).click();
  const naming = page.getByRole('dialog', {
    name: 'Preset options',
    exact: true,
  });
  await naming
    .getByRole('textbox', { name: 'Name on this device' })
    .fill(label);
  await naming.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(
    row.getByRole('heading', { name: label, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Play ${label}`, exact: true }),
  ).toBeVisible();
  await row
    .getByRole('button', { name: `Move ${label} up`, exact: true })
    .click();
  await expect(
    row.getByRole('button', { name: `Remove ${label}`, exact: true }),
  ).toBeEnabled();
  await row
    .getByRole('button', { name: `Remove ${label}`, exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: `Play ${label}`, exact: true }),
  ).toHaveCount(0);
  await management
    .getByRole('button', { name: 'Show removed', exact: true })
    .click();
  await row
    .getByRole('button', { name: `Restore ${label}`, exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await management
    .getByRole('button', { name: 'Show available', exact: true })
    .click();
  await expect(
    row.getByRole('heading', { name: label, exact: true }),
  ).toBeVisible();
  const playingAfter = await get();
  expect(playingAfter.phase).toBe('running');
  expect(playingAfter.control.revision).toBe(playingBefore.control.revision);
  expect(playingAfter.configured).toEqual(playingBefore.configured);
  expect(
    await (await request.get(`/api/v1/presets/rigs/${managedRevision}`)).json(),
  ).toEqual(originalDocument);

  await command({ kind: 'stop' });
});

for (const layout of ['serial', 'scenes'] as const) {
  test(`mixed rig authoring composes ${layout} with native and LV2 effects and offline recall`, async ({
    page,
    request,
  }, info) => {
    test.skip(
      process.env.OXIDAL_RIG_QUALIFY_NULL !== '1' ||
        process.env.OXIDAL_GRAPH_QUALIFY_NULL !== '1' ||
        !process.env.OXIDAL_MIXED_TEST_ROOT,
      'Maintained Linux native gate provides real mixed and graph workers',
    );
    test.setTimeout(120000);
    page.setDefaultTimeout(20000);
    const state = async (path = 'rig-audio') =>
      (await request.get(`/api/v1/${path}`)).json();
    const command = async (path: string, action: unknown) => {
      const s = await state(path);
      const response = await request.post(`/api/v1/${path}`, {
        data: { session: s.session, expected_revision: s.revision, action },
      });
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    };
    await command('rig-audio', { kind: 'stop' });
    await command('graph-audio', { kind: 'stop' });
    const input = {
      endpoint: 'hw:CARD=Qualification,DEV=0',
      direction: 'capture',
      sample_rate: 48000,
      channels: 2,
      format: 's16',
      period_frames: 128,
      periods: 3,
    };
    await command('graph-audio', {
      kind: 'configure',
      stream: {
        input,
        output: { ...input, direction: 'playback' },
        input_map: [0, 1],
        output_map: [0, 1],
      },
    });
    const imported = await request.post('/api/v1/presets', {
      data: readFileSync(
        join(process.env.OXIDAL_MIXED_TEST_ROOT!, 'a2-preset.t3kpreset'),
      ),
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    expect(imported.ok()).toBe(true);
    const tone = await imported.json();
    await page.goto('/');
    if (info.project.name === 'boox-air3c')
      await setDisplayMode(page, 'epaper');
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await page.getByRole('button', { name: 'New preset', exact: true }).click();
    await page
      .getByRole('button', { name: 'Add saved tone', exact: true })
      .click();
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: tone.name, exact: true }).click();
    const composer = page.getByRole('region', { name: 'Compose rig' });
    if (layout === 'scenes') {
      await composer
        .getByRole('button', { name: 'Scenes', exact: true })
        .click();
      await expect(
        composer.getByLabel('Scene tails', { exact: true }),
      ).toHaveValue('preserve');
      await composer
        .getByRole('button', { name: 'Add saved tone', exact: true })
        .click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: tone.name, exact: true })
        .click();
      await composer.getByLabel('Scene 1 name', { exact: true }).fill('Clean');
      await composer.getByLabel('Scene 2 name', { exact: true }).fill('Lead');
    }
    const name = `Composed ${layout} ${info.project.name}`;
    await composer.getByLabel('Preset name', { exact: true }).fill(name);
    await composer
      .getByRole('button', { name: 'Add effect', exact: true })
      .click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Search', { exact: true }).fill('Simple amplifier');
    await dialog
      .getByRole('button', { name: 'Simple amplifier', exact: true })
      .click();
    await composer.getByLabel('Mono input').selectOption('right');
    if (layout === 'serial') {
      await composer
        .getByRole('button', { name: 'Move Simple amplifier earlier' })
        .click();
      await expect(composer.locator('[data-effect]').first()).toContainText(
        'Simple amplifier',
      );
      await composer
        .getByRole('button', { name: 'Move Simple amplifier later' })
        .click();
    } else {
      await expect(
        composer.getByRole('button', { name: 'Move Simple amplifier earlier' }),
      ).toBeDisabled();
    }
    const initialViewport = page.viewportSize()!;
    for (const viewport of [
      initialViewport,
      { width: initialViewport.height, height: initialViewport.width },
    ]) {
      await page.setViewportSize(viewport);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`composer-${viewport.width}.png`),
        fullPage: true,
      });
    }
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    await composer
      .getByRole('button', { name: 'Play draft', exact: true })
      .click();
    await expect.poll(async () => (await state()).phase).toBe('running');
    const running = await state();
    const document = await (
      await request.get(`/api/v1/presets/rigs/${running.configured.revision}`)
    ).json();
    expect(document.manifest.tone3000.instances).toHaveLength(
      layout === 'scenes' ? 2 : 1,
    );
    expect(document.manifest.oxidal.lv2).toHaveLength(1);
    expect(
      document.manifest.oxidal.graph.nodes.find(
        (n: { kind: string }) => n.kind === 'merge',
      ).inputGains,
    ).toEqual([0, 1]);
    expect(
      (await (await request.get('/api/v1/presets/rigs')).json()).presets.some(
        (p: { revision: string }) => p.revision === document.revision,
      ),
    ).toBe(false);
    const rig = page.getByRole('region', { name: 'Sounding mixed rig' });
    // Branch on/off lives in the selected block detail: select the branch tile first.
    const branchToggle = async (name: string) => {
      const id = (await state()).control.branches.find(
        (b: { name: string }) => b.name === name,
      ).id;
      await rig.locator(`.mixed-node[data-node="${id}"] .rig-tile`).click();
      return rig.getByRole('button', {
        name: `Toggle branch ${name}`,
        exact: true,
      });
    };
    await expect(
      rig.getByRole('button', {
        name: `1 · ${layout === 'scenes' ? 'Clean' : tone.name}`,
        exact: true,
      }),
    ).toBeVisible();
    if (layout === 'scenes') {
      const scenes = rig.getByRole('group', { name: 'Scenes' });
      await expect(
        scenes.getByRole('button', { name: /^Scene \d+: Clean$/ }),
      ).toHaveAttribute('aria-pressed', 'true');
      await scenes.getByRole('button', { name: /^Scene \d+: Lead$/ }).click();
      await expect.poll(async () => (await state()).control.scene).toBeTruthy();
      await expect(
        scenes.getByRole('button', { name: /^Scene \d+: Lead$/ }),
      ).toHaveAttribute('aria-pressed', 'true');
      await expect
        .poll(async () => (await state()).control.scene_transitioning)
        .toBe(false);
      await expect(await branchToggle('Clean')).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      await (await branchToggle('Clean')).click();
      await expect
        .poll(async () =>
          (await state()).control.branches.every(
            (b: { enabled: boolean }) => b.enabled,
          ),
        )
        .toBe(true);
      await expect.poll(async () => (await state()).control.scene).toBeNull();
      await page.route('**/api/v1/midi/devices', (route) =>
        route.fulfill({
          json: {
            available: true,
            inputs: [
              { id: 'hw:Unavailable,0,0', name: 'Unavailable test controller' },
            ],
            warnings: [],
          },
        }),
      );
      await rig.getByText('MIDI controls', { exact: true }).click();
      await rig
        .getByLabel('MIDI input', { exact: true })
        .selectOption('hw:Unavailable,0,0');
      await rig.getByLabel('MIDI channel', { exact: true }).selectOption('2');
      await rig
        .getByLabel('MIDI trigger 2', { exact: true })
        .selectOption('control');
      await rig.getByLabel('MIDI number 2', { exact: true }).fill('20');
      await rig
        .getByRole('button', { name: 'Map branch Clean', exact: true })
        .click();
      await rig.getByLabel('Branch Clean CC', { exact: true }).fill('64');
      await rig
        .getByLabel('Branch Clean behavior', { exact: true })
        .selectOption('gate');

      await rig
        .getByRole('button', { name: 'Add parameter mapping', exact: true })
        .click();
      const mappedControl = (await state()).control.controls.find(
        (c: { target: { kind: string; node: string } }) =>
          c.target.kind === 'bypass',
      );
      await rig
        .getByLabel('MIDI parameter 1', { exact: true })
        .selectOption(JSON.stringify(mappedControl.target));
      await rig.getByLabel('Parameter CC 1', { exact: true }).fill('21');
      await rig
        .getByLabel('Parameter behavior 1', { exact: true })
        .selectOption('toggle');

      await rig
        .getByRole('button', { name: 'Apply MIDI', exact: true })
        .click();
      await expect
        .poll(async () => (await state()).configured.midi?.channel)
        .toBe(2);
      await expect
        .poll(async () => (await state()).control.midi.error)
        .toBeTruthy();
      expect((await state()).phase).toBe('running');
      expect((await state()).configured.midi.branch_bindings[0]).toMatchObject({
        controller: 64,
        mode: 'gate',
      });

      expect((await state()).configured.midi.parameter_bindings[0]).toEqual({
        target: mappedControl.target,
        controller: 21,
        mode: 'toggle',
      });
      await expect(rig.getByText(/Waiting for controller/)).toBeVisible();
      for (const viewport of [
        initialViewport,
        { width: initialViewport.height, height: initialViewport.width },
      ]) {
        await page.setViewportSize(viewport);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await expect(
          rig.getByLabel('MIDI channel', { exact: true }),
        ).toHaveValue('2');
        await expect(
          rig.getByLabel('MIDI number 2', { exact: true }),
        ).toHaveValue('20');
        await expect(
          rig.getByLabel('Branch Clean behavior', { exact: true }),
        ).toHaveValue('gate');

        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: info.outputPath(`scene-midi-${viewport.width}.png`),
          fullPage: true,
        });
      }
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations,
      ).toEqual([]);

      await rig
        .getByRole('button', { name: 'Disable MIDI', exact: true })
        .click();
      await expect.poll(async () => (await state()).configured.midi).toBeNull();
      await rig.getByText('MIDI controls', { exact: true }).click();
      for (const viewport of [
        initialViewport,
        { width: initialViewport.height, height: initialViewport.width },
      ]) {
        await page.setViewportSize(viewport);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: info.outputPath(`scenes-${viewport.width}.png`),
          fullPage: true,
        });
      }
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations,
      ).toEqual([]);
    }
    const saved = await saveMixedRig(page, request, rig);
    const savedDoc = await (
      await request.get(`/api/v1/presets/rigs/${saved}`)
    ).json();
    expect(
      savedDoc.manifest.extensions['urn:oxidal:authoring'].draft,
    ).toBeUndefined();
    expect(savedDoc.manifest.extensions['urn:oxidal:authoring'].labels).toEqual(
      document.manifest.extensions['urn:oxidal:authoring'].labels,
    );
    await rig.getByRole('button', { name: 'Stop audio', exact: true }).click();
    await expect.poll(async () => (await state()).phase).toBe('stopped');
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await playSavedRig(page, name);
    await expect
      .poll(async () => {
        const s = await state();
        return { phase: s.phase, revision: s.configured?.revision };
      })
      .toEqual({ phase: 'running', revision: saved });
    if (layout === 'scenes') {
      await expect(await branchToggle('Clean')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(await branchToggle('Lead')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect((await state()).control.scene).toBeNull();
      expect(savedDoc.manifest.requiredExtensions).toContain(
        'urn:oxidal:gain:1',
      );
      expect(
        savedDoc.manifest.extensions['urn:oxidal:authoring'].scene_tails,
      ).toBe('preserve');
      expect(
        savedDoc.manifest.oxidal.graph.nodes.filter(
          (n: { kind: string }) => n.kind === 'gain',
        ),
      ).toHaveLength(4);
      expect(
        savedDoc.manifest.extensions['urn:oxidal:scenes:1'].scenes,
      ).toHaveLength(2);
    }
    await command('rig-audio', { kind: 'stop' });
  });
}

test('mixed rig authoring separates guarded amp/cab stages and saves their live settings', async ({
  page,
  request,
}, info) => {
  test.skip(
    process.env.OXIDAL_RIG_QUALIFY_NULL !== '1' ||
      process.env.OXIDAL_GRAPH_QUALIFY_NULL !== '1' ||
      !process.env.OXIDAL_MIXED_TEST_ROOT,
    'Maintained Linux native gate provides verified stage fixture and actual workers',
  );
  test.setTimeout(150000);
  page.setDefaultTimeout(20000);
  const state = async (path = 'rig-audio') =>
    (await request.get(`/api/v1/${path}`)).json();
  const command = async (path: string, action: unknown) => {
    const s = await state(path);
    const response = await request.post(`/api/v1/${path}`, {
      data: { session: s.session, expected_revision: s.revision, action },
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  await command('rig-audio', { kind: 'stop' });
  await command('graph-audio', { kind: 'stop' });
  const input = {
    endpoint: 'hw:CARD=Qualification,DEV=0',
    direction: 'capture',
    sample_rate: 48000,
    channels: 2,
    format: 's16',
    period_frames: 128,
    periods: 3,
  };
  const stream = {
    input,
    output: { ...input, direction: 'playback' },
    input_map: [0, 1],
    output_map: [0, 1],
  };
  // Set the already configured mixed owner too: it has precedence over graph settings.
  const previous = await state();
  if (previous.configured) {
    await command('rig-audio', { kind: 'reconfigure', stream });
    await expect.poll(async () => (await state()).phase).toBe('running');
    await command('rig-audio', { kind: 'stop' });
  }
  await command('graph-audio', { kind: 'configure', stream });
  const imported = await request.post('/api/v1/presets', {
    data: readFileSync(
      join(process.env.OXIDAL_MIXED_TEST_ROOT!, 'partition-browser.t3kpreset'),
    ),
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  expect(imported.ok(), await imported.text()).toBe(true);
  const tone = await imported.json();
  await page.goto('/');
  if (info.project.name === 'boox-air3c') await setDisplayMode(page, 'epaper');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'New preset', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add saved tone', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: tone.name, exact: true })
    .click();
  const composer = page.getByRole('region', { name: 'Compose rig' });
  const name = `Split ${info.project.name}`;
  await composer.getByLabel('Preset name', { exact: true }).fill(name);
  await composer
    .getByRole('button', { name: 'Separate amp & cab', exact: true })
    .click();
  let dialog = page.getByRole('dialog', { name: 'Separate amp & cab' });
  await expect(dialog.getByLabel('Amp block')).not.toHaveValue('');
  await expect(dialog.getByLabel('Cab / IR block')).not.toHaveValue('');
  await expect(
    dialog.getByRole('button', { name: 'Separate', exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole('combobox', { name: 'Amp input', exact: true })
    .selectOption('right');
  await dialog.getByRole('checkbox').check();
  const viewport = page.viewportSize()!;
  for (const size of [
    viewport,
    { width: viewport.height, height: viewport.width },
  ]) {
    await page.setViewportSize(size);
    await expect(
      dialog.getByRole('button', { name: 'Separate', exact: true }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`split-dialog-${size.width}.png`),
    });
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.setViewportSize(viewport);
  await dialog
    .getByRole('button', { name: 'Keep whole tone', exact: true })
    .click();
  await expect(composer.locator('[data-effect]')).toHaveCount(1);
  await composer
    .getByRole('button', { name: 'Separate amp & cab', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox').check();
  await dialog
    .getByRole('combobox', { name: 'Amp input', exact: true })
    .selectOption('right');
  await dialog.getByRole('button', { name: 'Separate', exact: true }).click();
  await expect(composer.locator('[data-effect]')).toHaveCount(2);
  await expect(
    composer.getByLabel(`Move Amp · ${tone.name} later`),
  ).toBeDisabled();
  await composer
    .getByRole('button', { name: 'Add effect', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Search', { exact: true }).fill('Simple amplifier');
  await dialog
    .getByRole('button', { name: 'Simple amplifier', exact: true })
    .click();
  await composer.getByLabel('Move Simple amplifier earlier').click();
  await expect(composer.locator('[data-effect]').nth(1)).toContainText(
    'Simple amplifier',
  );
  for (const size of [
    viewport,
    { width: viewport.height, height: viewport.width },
  ]) {
    await page.setViewportSize(size);
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`split-chain-${size.width}.png`),
      fullPage: true,
    });
  }
  // Forge a structurally valid but nonexistent source ID in transit. The actual
  // native worker must reject it, and the editor must retain the correct draft.
  const publishUrl = '**/api/v1/presets/rigs';
  await page.route(publishUrl, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = route.request().postDataJSON();
    const manifest = JSON.parse(body.manifest_json);
    for (const instance of manifest.tone3000.instances)
      instance.partition.amp = 'nonexistent-amp';
    body.manifest_json = JSON.stringify(manifest);
    await route.continue({ postData: JSON.stringify(body) });
  });
  await composer
    .getByRole('button', { name: 'Play draft', exact: true })
    .click();
  await expect.poll(async () => (await state()).phase).toBe('failed');
  await expect(composer.getByRole('alert')).toContainText(
    'Choose exactly one NAM amp',
  );
  await expect(composer.locator('[data-effect]')).toHaveCount(3);
  await expect(
    composer.getByRole('button', { name: 'Play draft', exact: true }),
  ).toBeEnabled();
  await expect.poll(async () => (await state()).device_owned).toBe(false);
  await page.unroute(publishUrl);
  await composer
    .getByRole('button', { name: 'Play draft', exact: true })
    .click();
  await expect.poll(async () => (await state()).phase).toBe('running');
  const rig = page.getByRole('region', { name: 'Sounding mixed rig' });
  await expect(rig).toBeVisible();
  const document = await (
    await request.get(
      `/api/v1/presets/rigs/${(await state()).configured.revision}`,
    )
  ).json();
  const [amp, cab] = document.manifest.tone3000.instances;
  expect(amp.processingRole).toBe('amp');
  expect(cab.processingRole).toBe('cab');
  expect(amp.partition.input).toBe('right');
  expect(amp.partition.pair).toBe(cab.partition.pair);
  expect(document.manifest.resources).toHaveLength(1);
  expect(document.manifest.resources[0].sha256).toBe(tone.sha256);
  const modelFixtures = await routeProviderModels(
    page,
    process.env.OXIDAL_NATIVE_TEST_MODELS!,
  );
  const changes: { node: string; parameter: string; value: number }[] = [];
  for (const [node, parameter, forbidden] of [
    [amp.id, 'inputLevel', 'outputLevel'],
    [cab.id, 'outputLevel', 'inputLevel'],
  ]) {
    const controls = (await state()).control.controls;
    expect(
      controls.some(
        (c: { target: { kind: string; node: string; parameter: string } }) =>
          c.target.kind === 'native' &&
          c.target.node === node &&
          c.target.parameter === forbidden,
      ),
    ).toBe(false);
    const selected = controls.find(
      (c: { target: { kind: string; node: string; parameter: string } }) =>
        c.target.kind === 'native' &&
        c.target.node === node &&
        c.target.parameter === parameter,
    );
    const value = async () =>
      (await state()).control.controls.find(
        (c: { target: unknown }) =>
          JSON.stringify(c.target) === JSON.stringify(selected.target),
      ).value;
    await rig
      .locator(`[data-node="${node}"]`)
      .getByRole('button')
      .first()
      .click();
    const format = node === amp.id ? 'nam' : 'ir';
    await expect(
      rig.getByRole('button', { name: 'Add NAM', exact: true }),
    ).toHaveCount(0);
    await rig
      .getByRole('button', {
        name: format === 'nam' ? 'Change amp capture' : 'Change cab IR',
        exact: true,
      })
      .click();
    const picker = page.getByRole('dialog', { name: 'Choose model' });
    await expect(
      picker.getByRole('button', {
        name: format === 'nam' ? 'Cab / IR' : 'NAM',
        exact: true,
      }),
    ).toHaveCount(0);
    await picker
      .getByRole('button', {
        name: modelFixtures.find((f) => f.metadata.format === format)!.metadata
          .title,
      })
      .click();
    await picker
      .getByLabel('Available models')
      .getByRole('button')
      .first()
      .click();
    await expect(picker).toHaveCount(0);
    await expect
      .poll(async () => (await state()).control.model_change?.progress.phase)
      .toBe('applied');
    await expect(
      rig.locator(`[data-node="${node}"]`).getByRole('button').first(),
    ).toContainText(
      modelFixtures.find((f) => f.metadata.format === format)!.metadata.title,
    );

    await expect(
      rig.getByRole('button', {
        name: format === 'nam' ? 'Change amp capture' : 'Change cab IR',
        exact: true,
      }),
    ).toBeEnabled();
    await rig
      .getByRole('button', { name: `Adjust ${selected.label}`, exact: true })
      .click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('slider').focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(value).toBeGreaterThan(selected.value);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    changes.push({ node, parameter, value: await value() });
    await rig
      .getByRole('button', { name: 'Adjust EQ Gain', exact: true })
      .click();
    dialog = page.getByRole('dialog');
    const beforeEq = (await state()).control.eq.find(
      (e: { node: string }) => e.node === node,
    );
    await dialog.getByRole('slider').focus();
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(async () =>
        (await state()).control.eq.find(
          (e: { node: string }) => e.node === node,
        ),
      )
      .not.toEqual(beforeEq);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  }
  for (const size of [
    viewport,
    { width: viewport.height, height: viewport.width },
  ]) {
    await page.setViewportSize(size);
    await rig
      .getByRole('button', { name: 'Change cab IR', exact: true })
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await info.attach(`stage-model-controls-${size.width}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  }
  await page.setViewportSize(viewport);
  const savedEq = (await state()).control.eq;
  const saved = await saveMixedRig(page, request, rig);
  const savedDoc = await (
    await request.get(`/api/v1/presets/rigs/${saved}`)
  ).json();
  expect(
    savedDoc.manifest.resources.some(
      (r: { kind: string; sha256: string }) =>
        r.kind === 'tone3000-source' && r.sha256 === tone.sha256,
    ),
  ).toBe(true);
  expect(
    savedDoc.manifest.tone3000.instances.every(
      (n: { origin?: unknown }) => !!n.origin,
    ),
  ).toBe(true);
  expect(savedDoc.manifest.oxidal.lv2).toHaveLength(1);
  for (const change of changes)
    expect(
      savedDoc.manifest.tone3000.instances.find(
        (n: { id: string }) => n.id === change.node,
      ).partition.controls[change.parameter],
    ).toBe(change.value);
  await rig.getByRole('button', { name: 'Stop audio', exact: true }).click();
  await expect.poll(async () => (await state()).phase).toBe('stopped');
  await page.reload();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await playSavedRig(page, name);
  await expect.poll(async () => (await state()).phase).toBe('running');
  expect((await state()).configured.revision).toBe(saved);
  expect((await state()).control.eq).toEqual(savedEq);
  for (const change of changes)
    expect(
      (await state()).control.controls.find(
        (c: { target: { kind: string; node: string; parameter: string } }) =>
          c.target.kind === 'native' &&
          c.target.node === change.node &&
          c.target.parameter === change.parameter,
      ).value,
    ).toBe(change.value);
  await expect(rig).toBeVisible();
  await expect(
    rig.getByRole('button', { name: 'Stop audio', exact: true }),
  ).toBeVisible();
  // Lifecycle invalidation bypasses the BOOX five-second meter poll.
  await expect(page.getByTestId('resource-state')).toHaveText('Audio running', {
    timeout: 2500,
  });
  for (const size of [
    viewport,
    { width: viewport.height, height: viewport.width },
  ]) {
    await page.setViewportSize(size);
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`split-sounding-${size.width}.png`),
      fullPage: true,
    });
  }
  await command('rig-audio', { kind: 'stop' });
});

test('native editor loads draft structure commands and preserves history', async ({
  page,
  request,
}) => {
  test.skip(
    process.env.OXIDAL_NATIVE_EDITOR !== '1',
    'Explicit native worker required',
  );
  test.setTimeout(60000);
  const imported = await request.post('/api/v1/presets', {
    data: readFileSync(process.env.OXIDAL_NATIVE_TEST_PRESET!),
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  expect(imported.ok()).toBeTruthy();
  const preset = await imported.json();
  await page.goto('/');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Library sections' })
    .getByRole('button', { name: 'Author', exact: true })
    .click();
  const editor = page.getByRole('region', { name: 'Native preset editor' });
  await expect(editor).toBeVisible();
  if (!(await editor.getByLabel('Preset to load').isVisible()))
    await editor.getByTestId('native-preset-loader').locator('summary').click();
  await editor
    .getByLabel('Preset to load')
    .selectOption(`original:${preset.sha256}`);
  await editor.getByRole('button', { name: 'Load draft' }).click();
  await expect(editor.getByRole('status')).toHaveText('Native preset ready');
  const initial = await (await request.get('/api/v1/native')).json();
  const block = initial.block_controls.find(
    (c: { parameter: string }) => c.parameter === 'mix',
  );
  await editor.getByTestId('native-control-browser').locator('summary').click();
  await editor.getByLabel('Native control').selectOption(block.id);
  await editor
    .locator('summary')
    .filter({ hasText: /^Draft structure$/ })
    .click();
  const structure = editor.getByRole('group', { name: 'Draft structure' });
  await structure
    .getByRole('button', { name: 'Duplicate block', exact: true })
    .click();
  await expect(editor.getByRole('status')).toContainText(
    'Unsaved tone changes',
  );
  const duplicated = await (await request.get('/api/v1/native')).json();
  expect(
    duplicated.layout.left.filter((b: { insert: boolean }) => !b.insert),
  ).toHaveLength(2);
  await structure.getByRole('button', { name: 'Later', exact: true }).click();
  await expect
    .poll(
      async () => (await (await request.get('/api/v1/native')).json()).layout,
    )
    .not.toEqual(duplicated.layout);
  await structure
    .getByRole('button', { name: 'Use stereo chains', exact: true })
    .click();
  await expect(
    structure.getByRole('button', { name: 'Use mono chain', exact: true }),
  ).toBeVisible();
  await structure
    .getByRole('button', { name: 'Move to right chain', exact: true })
    .click();
  const moved = await (await request.get('/api/v1/native')).json();
  expect(
    moved.layout.right.some((b: { id: string }) => b.id === block.block_id),
  ).toBe(true);
  await editor.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(async () =>
      (await (await request.get('/api/v1/native')).json()).layout.left.some(
        (b: { id: string }) => b.id === block.block_id,
      ),
    )
    .toBe(true);
  await editor.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect
    .poll(
      async () => (await (await request.get('/api/v1/native')).json()).layout,
    )
    .toEqual(moved.layout);
  await expect(editor.getByRole('alert')).toHaveCount(0);
});

test('playback lifecycle applies live chain edits and prepared DSP settings before Save', async ({
  page,
  request,
}) => {
  test.skip(
    process.env.OXIDAL_AUDIO_QUALIFY_NULL !== '1',
    'Actual native audio worker required',
  );
  test.setTimeout(60000);
  const imported = await request.post('/api/v1/presets', {
    data: readFileSync(process.env.OXIDAL_NATIVE_TEST_PRESET!),
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  expect(imported.ok()).toBe(true);
  const preset = await imported.json();
  let state = await (await request.get('/api/v1/audio')).json();
  const input = {
    endpoint: 'hw:CARD=Qualification,DEV=0',
    direction: 'capture',
    sample_rate: 48000,
    channels: 2,
    format: 's16',
    period_frames: 128,
    periods: 3,
  };
  const started = await request.post('/api/v1/audio', {
    data: {
      session: state.session,
      expected_revision: state.revision,
      action: {
        kind: 'start',
        settings: {
          preset_id: preset.sha256,
          owned: false,
          stream: {
            input,
            output: { ...input, direction: 'playback' },
            input_map: [0, 1],
            output_map: [0, 1],
          },
        },
      },
    },
  });
  expect(started.ok(), await started.text()).toBe(true);
  try {
    await page.goto('/');
    const sounding = page.getByRole('region', { name: 'Sounding rig' });
    await expect(sounding).toBeVisible();
    await page.route('**/api/v1/midi/devices', (route) =>
      route.fulfill({
        json: {
          available: true,
          inputs: [
            { id: 'hw:Unavailable,0,0', name: 'Unavailable test controller' },
          ],
          warnings: [],
        },
      }),
    );
    await sounding.getByText('MIDI controls', { exact: true }).click();
    await sounding
      .getByLabel('MIDI input', { exact: true })
      .selectOption('hw:Unavailable,0,0');
    await sounding
      .getByRole('button', { name: 'Add parameter mapping', exact: true })
      .click();
    await sounding.getByLabel('MIDI parameter 1', { exact: true }).selectOption(
      JSON.stringify({
        kind: 'native',
        node: 'native',
        parameter: 'inputLevel',
      }),
    );
    await sounding.getByLabel('Parameter CC 1', { exact: true }).fill('21');
    await sounding
      .getByLabel('Parameter behavior 1', { exact: true })
      .selectOption('relative_offset64');
    await sounding
      .getByRole('button', { name: 'Apply MIDI', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/v1/audio')).json()).configured.midi
            ?.parameter_bindings[0].controller,
      )
      .toBe(21);
    await expect(sounding.getByText(/Waiting for controller/)).toBeVisible();
    await expect(
      sounding.getByRole('button', { name: 'Learn CC 1', exact: true }),
    ).toBeDisabled();
    await sounding
      .getByRole('button', { name: 'Disable MIDI', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/v1/audio')).json()).configured.midi,
      )
      .toBeUndefined();
    await sounding.getByText('MIDI controls', { exact: true }).click();
    const actions = sounding.getByRole('group', { name: 'Live chain actions' });
    await actions
      .getByRole('button', { name: 'Duplicate block', exact: true })
      .click();
    const count = async () => {
      const current = await (await request.get('/api/v1/audio')).json();
      return current.authoring.layout.left.filter(
        (b: { insert: boolean }) => !b.insert,
      ).length;
    };
    await expect.poll(count).toBe(2);
    await actions
      .getByRole('button', { name: 'Undo change', exact: true })
      .click();
    await expect.poll(count).toBe(1);
    await actions
      .getByRole('button', { name: 'Redo change', exact: true })
      .click();
    await expect.poll(count).toBe(2);
    // Engine settings are unit-wide and live in Settings → Audio.
    await page
      .getByRole('navigation', { name: 'Instrument navigation' })
      .getByRole('button', { name: 'Settings', exact: true })
      .click();
    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('button', { name: 'Audio', exact: true })
      .click();
    const settings = page.getByRole('group', {
      name: 'Prepared DSP settings',
    });
    state = await (await request.get('/api/v1/audio')).json();
    const before = state.authoring.settings.find(
      (p: { target: string }) => p.target === 'osEnabled',
    ).value;
    await settings.getByRole('button', { name: /^Oversampling ·/ }).click();
    const dialog = page.getByRole('dialog', {
      name: 'Oversampling',
      exact: true,
    });
    await expect(dialog.getByRole('slider')).toHaveCount(0);
    await dialog
      .getByRole('switch', { name: 'Oversampling', exact: true })
      .click();
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(async () => {
        const current = await (await request.get('/api/v1/audio')).json();
        return current.authoring.settings.find(
          (p: { target: string }) => p.target === 'osEnabled',
        ).value;
      })
      .toBe(1 - before);
    await expect.poll(count).toBe(2);
    state = await (await request.get('/api/v1/audio')).json();
    expect(state.phase).toBe('running');
    expect(state.modified).toBe(true);
    expect(state.configured.working).toHaveLength(64);
  } finally {
    state = await (await request.get('/api/v1/audio')).json();
    await request.post('/api/v1/audio', {
      data: {
        session: state.session,
        expected_revision: state.revision,
        action: { kind: 'stop' },
      },
    });
  }
});

test('mixed rig authoring: local NAM and IR collections audition without provider login and save offline', async ({
  page,
  request,
}) => {
  test.skip(
    process.env.OXIDAL_RIG_QUALIFY_NULL !== '1' ||
      !process.env.OXIDAL_MIXED_TEST_ROOT,
    'Maintained native gate supplies actual mixed worker fixtures',
  );
  test.setTimeout(120000);
  const root = process.env.OXIDAL_MIXED_TEST_ROOT!;
  const revision = readFileSync(
    join(root, 'mixed-preset-revision'),
    'utf8',
  ).trim();
  const folder = join(root, 'worker-rigs', revision);
  const manifest = JSON.parse(
    readFileSync(join(folder, 'manifest.json'), 'utf8'),
  );
  manifest.name = 'Local file authoring';
  const resources: Record<string, unknown> = {};
  for (const resource of manifest.resources) {
    const imported = await request.post('/api/v1/presets', {
      data: readFileSync(join(folder, resource.path)),
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    expect(imported.ok()).toBe(true);
    resources[resource.id] = {
      kind: 'original',
      preset: (await imported.json()).sha256,
    };
  }
  const published = await request.post('/api/v1/presets/rigs', {
    data: { manifest_json: JSON.stringify(manifest), resources },
  });
  expect(published.ok()).toBe(true);
  const document = await published.json();
  const get = async () => (await request.get('/api/v1/rig-audio')).json();
  const command = async (action: unknown) => {
    const current = await get();
    const response = await request.post('/api/v1/rig-audio', {
      data: {
        session: current.session,
        expected_revision: current.revision,
        action,
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  await command({ kind: 'stop' });
  const input = {
    endpoint: 'hw:CARD=Qualification,DEV=0',
    direction: 'capture',
    sample_rate: 48000,
    channels: 2,
    format: 's16',
    period_frames: 128,
    periods: 3,
  };
  await command({
    kind: 'start',
    settings: {
      revision: document.revision,
      stream: {
        input,
        output: { ...input, direction: 'playback' },
        input_map: [0, 1],
        output_map: [0, 1],
      },
      recall: null,
    },
  });
  await expect.poll(async () => (await get()).phase).toBe('running');
  // Provider transport is unavailable; all local uploads, preparation and Save are real.
  await page.route('**/api/v1/tone3000/**', (route) =>
    route.fulfill({ status: 401, json: { error: 'Provider offline' } }),
  );
  await page.goto('/');
  const rig = page.getByRole('region', { name: 'Sounding mixed rig' });
  await expect(rig).toBeVisible();
  await rig.locator('[data-node="tone"]').getByRole('button').first().click();
  await rig
    .getByRole('button', { name: 'Select model 1', exact: true })
    .click();
  await rig.getByRole('button', { name: 'Change model', exact: true }).click();
  let picker = page.getByRole('dialog', { name: 'Choose model' });
  await picker
    .getByRole('button', { name: 'Local files', exact: true })
    .click();
  const before = (await get()).control;
  await picker.getByLabel('NAM / IR file', { exact: true }).setInputFiles({
    name: 'broken.nam',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('broken'),
  });
  await picker
    .getByRole('button', { name: 'Audition file', exact: true })
    .click();
  await expect(picker.getByRole('alert')).toContainText('not valid JSON');
  expect((await get()).control.revision).toBe(before.revision);
  expect((await get()).phase).toBe('running');
  const modelRoot = process.env.OXIDAL_NATIVE_TEST_MODELS!;
  const id = readdirSync(modelRoot).find(
    (id) =>
      /^[0-9a-f]{64}$/.test(id) &&
      JSON.parse(readFileSync(join(modelRoot, id, 'metadata.json'), 'utf8'))
        .format === 'nam',
  )!;
  await picker.getByLabel('NAM / IR file', { exact: true }).setInputFiles([
    {
      name: 'My local amp.nam',
      mimeType: 'application/octet-stream',
      buffer: readFileSync(join(modelRoot, id, 'model.nam')),
    },
    {
      name: 'My variant 2.nam',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(
        JSON.stringify({
          version: '0.5.4',
          architecture: 'Linear',
          config: { receptive_field: 1, bias: false },
          sample_rate: 48000,
          weights: [0.5],
        }),
      ),
    },
  ]);
  await picker
    .getByRole('button', { name: 'Audition 2 files', exact: true })
    .click();
  await expect(picker.getByRole('status')).toContainText(/Auditioning/);
  await picker.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect
    .poll(async () => (await get()).control.model_change?.progress.phase)
    .toBe('applied');
  const appliedNam = (await get()).control;
  await command({ kind: 'restart' });
  await expect.poll(async () => (await get()).phase).toBe('running');
  await page.reload();
  await expect(rig).toBeVisible();
  await rig.locator('[data-node="tone"]').getByRole('button').first().click();
  await rig.getByRole('button', { name: 'Undo change', exact: true }).click();
  await expect
    .poll(async () => (await get()).control.controls)
    .toEqual(before.controls);
  await rig.getByRole('button', { name: 'Redo change', exact: true }).click();
  await expect
    .poll(async () => (await get()).control.controls)
    .toEqual(appliedNam.controls);
  await rig
    .getByRole('button', { name: 'Select model 1', exact: true })
    .click();
  const variant = rig.getByRole('combobox', {
    name: 'Model variant',
    exact: true,
  });
  await expect(variant.getByRole('option')).toHaveCount(2);
  await rig
    .getByRole('button', { name: 'Next model variant', exact: true })
    .click();
  await expect(variant).toHaveValue(
    (await variant
      .getByRole('option', { name: 'My variant 2', exact: true })
      .getAttribute('value')) ?? '',
  );
  await command({ kind: 'restart' });
  await page.reload();
  await expect(rig).toBeVisible();
  await rig.locator('[data-node="tone"]').getByRole('button').first().click();
  await rig
    .getByRole('button', { name: 'Select model 1', exact: true })
    .click();
  await expect(variant.getByRole('option')).toHaveCount(2);
  await expect(variant.locator('option:checked')).toHaveText('My variant 2');
  const beforeAnalysis = (await get()).control.controls;
  await rig.getByText('Block spectrum', { exact: true }).click();
  await rig
    .getByRole('button', { name: 'Analyze selected block', exact: true })
    .click();
  await expect(
    rig.getByRole('img', {
      name: 'Post-EQ spectrum, 20 Hz to 20 kHz, minus 100 to zero dB',
      exact: true,
    }),
  ).toBeVisible();
  await rig.getByRole('button', { name: 'Stop analysis', exact: true }).click();
  expect((await get()).control.controls).toEqual(beforeAnalysis);
  await rig.getByText('Block spectrum', { exact: true }).click();
  await rig.getByRole('button', { name: 'Add block' }).click();
  await rig.getByRole('button', { name: 'Add IR', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Add IR · position' })
    .getByRole('button', { name: /Left chain · position/ })
    .first()
    .click();
  picker = page.getByRole('dialog', { name: 'Choose model' });
  await picker
    .getByRole('button', { name: 'Local files', exact: true })
    .click();
  await expect(
    picker.getByLabel('Local model files').getByRole('button', {
      name: 'My local amp · NAM Audition',
      exact: true,
    }),
  ).toBeVisible();
  await picker.getByLabel('NAM / IR file', { exact: true }).setInputFiles({
    name: 'My local cab.wav',
    mimeType: 'audio/wav',
    buffer: readFileSync(join(root, 'split-impulse.wav')),
  });
  await picker
    .getByRole('button', { name: 'Audition file', exact: true })
    .click();
  await expect(picker).toHaveCount(0);
  await expect
    .poll(async () => (await get()).control.model_change?.progress.phase)
    .toBe('applied');
  const edited = (await get()).control;
  await rig.getByRole('button', { name: 'Save copy', exact: true }).click();
  await rig
    .getByLabel('Preset name', { exact: true })
    .fill('Offline local NAM and IR');
  await rig.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(async () => (await get()).save?.saved_revision)
    .toBeTruthy();
  const saved = (await get()).save.saved_revision;
  await command({ kind: 'stop' });
  await command({
    kind: 'start',
    settings: { ...(await get()).configured, revision: saved, recall: null },
  });
  await expect.poll(async () => (await get()).phase).toBe('running');
  expect(
    (await get()).control.controls.map(
      (c: { target: unknown; value: number }) => ({
        target: c.target,
        value: c.value,
      }),
    ),
  ).toEqual(
    edited.controls.map((c: { target: unknown; value: number }) => ({
      target: c.target,
      value: c.value,
    })),
  );
  expect((await get()).control.eq).toEqual(edited.eq);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Audio', exact: true }).click();
  const utilities = page.getByRole('region', {
    name: 'Audio monitoring and output test',
    exact: true,
  });
  const beforeHost = (await get()).control.controls;
  await utilities
    .getByRole('button', { name: 'Monitor input', exact: true })
    .click();
  await expect
    .poll(async () => (await get()).configured.stream.hear_yourself)
    .toBe(false);
  await utilities
    .getByRole('button', { name: 'Output test · quiet', exact: true })
    .click();
  expect((await get()).control.controls).toEqual(beforeHost);
  await command({ kind: 'restart' });
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Audio', exact: true }).click();
  await expect(
    utilities.getByRole('button', {
      name: 'Input monitoring off',
      exact: true,
    }),
  ).toBeVisible();
  await utilities
    .getByRole('button', { name: 'Input monitoring off', exact: true })
    .click();
  await expect
    .poll(async () => (await get()).configured.stream.hear_yourself)
    .toBe(true);
  await command({ kind: 'stop' });
});

test('live model comparison stays open, waits for application and rejects a changed session', async ({
  page,
  request,
}) => {
  const baseline = await (await request.get('/api/v1/audio')).json();
  let audio = {
    ...baseline,
    phase: 'running',
    preset_name: 'Comparison rig',
    controls: [
      {
        target: 'block:amp:enabled',
        label: 'Current amp · left · enabled',
        display: 'On',
        value: 1,
        toggle: true,
      },
    ],
    model_change: null,
  };
  let assignments = 0;
  await page.route('**/api/v1/audio', async (route) => {
    if (route.request().method() === 'POST') {
      const command = route.request().postDataJSON();
      expect(command.expected_revision).toBe(audio.revision);
      expect(command.session).toBe(audio.session);
      expect(command.action.kind).toBe('replace_model');
      assignments++;
      audio = {
        ...audio,
        revision: audio.revision + 1,
        model_change: {
          request: assignments,
          assignment: command.action.assignment,
          phase: 'preparing',
          error: null,
        },
      };
    }
    await route.fulfill({ json: audio });
  });
  await page.route('**/api/v1/tone3000/tones?*', (route) =>
    route.fulfill({
      json: {
        page: 1,
        total_pages: 1,
        data: [
          {
            id: 1,
            title: 'Comparison amp',
            format: 'nam',
            gear: 'amp',
            license: 'Fixture',
            models_count: 2,
            a2_models_count: 2,
            url: 'https://www.tone3000.com',
            user: { username: 'fixture' },
          },
        ],
      },
    }),
  );
  await page.route('**/api/v1/tone3000/models?*', (route) =>
    route.fulfill({
      json: {
        page: 1,
        total_pages: 1,
        data: [
          {
            id: 1,
            tone_id: 1,
            name: 'Clean fixture',
            size: null,
            architecture_version: '2',
          },
          {
            id: 2,
            tone_id: 1,
            name: 'Drive fixture',
            size: null,
            architecture_version: '2',
          },
        ],
      },
    }),
  );
  await page.route('**/api/v1/tone3000/stage', (route) => {
    const id = route.request().postDataJSON().model_id;
    return route.fulfill({
      json: {
        id: String(id).repeat(64),
        tone_id: 1,
        model_id: id,
        title: 'Comparison amp',
        name: 'Fixture',
        sha256: String(id).repeat(64),
      },
    });
  });
  await page.goto('/');
  const rig = page.getByRole('region', { name: 'Sounding rig' });
  await rig.getByRole('button', { name: 'Current amp', exact: true }).click();
  await rig.getByRole('button', { name: 'Change model', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Choose model' });
  await picker.getByRole('button', { name: /Comparison amp/ }).click();
  await picker.getByRole('button', { name: /Clean fixture/ }).click();
  await expect.poll(() => assignments).toBe(1);
  await expect(
    picker.getByRole('button', { name: /Drive fixture/ }),
  ).toBeDisabled();
  audio = {
    ...audio,
    revision: audio.revision + 1,
    model_change: { ...audio.model_change, phase: 'applied' },
  };
  await expect(picker.getByRole('status')).toContainText(
    'Auditioning Clean fixture',
  );
  await expect(
    picker.getByRole('button', { name: /Clean fixture/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await picker.getByRole('button', { name: /Drive fixture/ }).click();
  await expect.poll(() => assignments).toBe(2);
  audio = {
    ...audio,
    revision: audio.revision + 1,
    model_change: { ...audio.model_change, phase: 'applied' },
  };
  await expect(picker.getByRole('status')).toContainText(
    'Auditioning Drive fixture',
  );
  await expect(
    picker.getByRole('button', { name: /Drive fixture/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    picker.getByRole('button', { name: /Clean fixture/ }),
  ).toHaveAttribute('aria-pressed', 'false');
  audio = { ...audio, session: 'replacement-session' };
  await expect(
    picker.getByRole('button', { name: /Clean fixture/ }),
  ).toBeDisabled();
  expect(assignments).toBe(2);
  await picker.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(picker).toHaveCount(0);
});

test('mixed rig authoring presents parallel routing and guarded Save on small screens', async ({
  page,
  request,
}, info) => {
  // Presentation/API contract fixture; no DSP qualification is implied.
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
  const ids = ['amp-a', 'amp-b', 'cab'];
  const graph = {
    nodes: ids.map((id) => ({
      id,
      kind: 'lv2',
      instance: id,
      audioInputs: 2,
      audioOutputs: 2,
    })),
    edges: ['amp-a', 'amp-b'].map((id) => ({
      from: { node: id, port: 0 },
      to: { node: 'cab', port: 0 },
    })),
  };
  const document = {
    revision: 'fixture',
    manifest: {
      format: 'oxidal',
      formatVersion: 1,
      id: 'fixture',
      name: 'Parallel sound',
      extensions: {},
      requiredExtensions: [],
      resources: [],
      tone3000: { instances: [] },
      oxidal: {
        graph,
        recall: { tails: 'cut' },
        lv2: ids.map((id) => ({
          id,
          pluginUri: `urn:fixture/${id}`,
          assets: [],
          controls: {},
          requiredFeatures: [],
        })),
      },
    },
  };
  let state = {
    ...baseline,
    phase: 'running',
    device_owned: true,
    configured: {
      revision: 'fixture',
      stream: {
        input,
        output: { ...input, direction: 'playback' },
        input_map: [0, 1],
        output_map: [0, 1],
      },
    },
    control: {
      session: 'sound',
      revision: 1,
      source_revision: 'fixture',
      modified: false,
      buffer_bytes: 1024,
      latency_frames: 0,
      controls: ids.map((node) => ({
        target: { kind: 'bypass', node },
        display: 'Off',
        label: 'Bypass',
        value: 0,
        minimum: 0,
        maximum: 1,
        integer: true,
        toggle: true,
        logarithmic: false,
      })),
    },
  };
  let saves = 0;
  await page.route('**/api/v1/rig-audio', async (route) => {
    if (route.request().method() === 'POST') {
      const action = route.request().postDataJSON().action;
      expect(action.kind).toBe('save');
      expect(action.name).toBe('My parallel sound');
      saves++;
      state = {
        ...state,
        save: {
          running: false,
          source_session: 'sound',
          source_control_revision: state.control.revision,
          saved_revision: 'saved',
        },
      };
    }
    await route.fulfill({ json: state });
  });
  await page.route('**/api/v1/presets/rigs/fixture', (route) =>
    route.fulfill({ json: document }),
  );
  await page.goto('/');
  if (info.project.name === 'boox-air3c') await setDisplayMode(page, 'epaper');
  const rig = page.getByRole('region', { name: 'Sounding mixed rig' });
  await expect(rig.locator('[data-node]')).toHaveCount(3);
  const a = (await rig.locator('[data-node="amp-a"]').boundingBox())!;
  const b = (await rig.locator('[data-node="amp-b"]').boundingBox())!;
  const cab = (await rig.locator('[data-node="cab"]').boundingBox())!;
  expect(a.x).toBe(b.x);
  expect(b.y).toBeGreaterThan(a.y + a.height);
  expect(cab.x).toBeGreaterThan(a.x + a.width);
  await expect(rig.locator('.mixed-routing-lines path')).toHaveCount(2);
  for (const button of await rig.locator('[data-node] button').all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({
    path: info.outputPath('mixed-routing-portrait.png'),
    fullPage: true,
  });
  await rig.getByRole('button', { name: 'Save copy', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save copy' });
  await expect(dialog.getByLabel('Preset name')).toHaveValue('Parallel sound');
  state = { ...state, control: { ...state.control, revision: 2 } };
  await expect(
    dialog.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByRole('status')).toContainText('The rig changed');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await rig.getByRole('button', { name: 'Save copy', exact: true }).click();
  await dialog.getByLabel('Preset name').fill('My parallel sound');
  const viewport = page.viewportSize()!;
  await page.setViewportSize({
    width: viewport.height,
    height: viewport.width,
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => window.document.documentElement.scrollWidth <= innerWidth,
      ),
    )
    .toBe(true);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(saves).toBe(1);
  await page.screenshot({
    path: info.outputPath('mixed-routing-landscape.png'),
    fullPage: true,
  });
});

test('playback lifecycle distinguishes loading and offers readable buffer choices', async ({
  page,
  request,
}, info) => {
  const baseline = await (await request.get('/api/v1/audio')).json();
  const input = {
    endpoint: 'hw:fixture',
    direction: 'capture',
    sample_rate: 48000,
    channels: 2,
    format: 's16',
    period_frames: 64,
    periods: 3,
  };
  const audio = {
    ...baseline,
    phase: 'running',
    device_owned: true,
    preset_name: 'Fixture',
    configured: {
      preset_id: 'a'.repeat(64),
      owned: false,
      stream: {
        input,
        output: { ...input, direction: 'playback' },
        input_map: [0, 1],
        output_map: [0, 1],
      },
    },
  };
  let release = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/audio', async (route) => {
    expect(route.request().method()).toBe('GET');
    await ready;
    await route.fulfill({ json: audio });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByText('Reading audio settings…', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Audio playback is unavailable/)).toHaveCount(0);
  release();
  await expect(
    page.getByRole('button', { name: 'Stop audio', exact: true }),
  ).toBeVisible();
  await page.getByText('Current device & buffers', { exact: true }).click();
  const group = page.getByRole('group', { name: 'Adjust current session' });
  const buffer = group.getByRole('combobox', {
    name: 'Session buffer (samples)',
  });
  await buffer.selectOption('256');
  await expect(group.getByText(/one period 5\.33 ms/)).toBeVisible();
  await expect(
    group.getByRole('button', { name: 'Apply & restart audio' }),
  ).toBeEnabled();
  const left = (await group
    .getByLabel('Session input left channel')
    .boundingBox())!;
  const right = (await group
    .getByLabel('Session input right channel')
    .boundingBox())!;
  expect(Math.abs(left.y - right.y)).toBeLessThan(2);
  expect(right.x).toBeGreaterThan(left.x);
  await group.getByRole('button', { name: 'Reset changes' }).click();
  await expect(buffer).toHaveValue('64');
  await expect(
    group.getByRole('button', { name: 'Apply & restart audio' }),
  ).toBeDisabled();
  await page.screenshot({
    path: info.outputPath('audio-settings-portrait.png'),
    fullPage: true,
  });
  const viewport = page.viewportSize()!;
  await page.setViewportSize({
    width: viewport.height,
    height: viewport.width,
  });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});

test('native preset library keeps originals accessible when saved copies cannot be read', async ({
  page,
}) => {
  let fail = true;
  await page.route('**/api/v1/presets', (route) =>
    route.fulfill({
      json: {
        presets: [
          {
            sha256: 'a'.repeat(64),
            name: 'Available original',
            source_id: 'fixture',
            framing: 'legacy',
            size_bytes: 600,
            embedded_bytes: 0,
            playback_available: false,
            parameter_count: 0,
            block_count: 0,
          },
        ],
      },
    }),
  );
  await page.route('**/api/v1/native', async (route) => {
    if (fail && route.request().method() === 'GET')
      return route.fulfill({
        status: 503,
        json: { error: 'Unavailable fixture' },
      });
    return route.fulfill({
      json: {
        session: 'fixture',
        revision: 0,
        dirty: false,
        parameters: [],
        block_controls: [],
        owned: [],
        state_captures: 0,
        live_audio: false,
        can_undo: false,
        can_redo: false,
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByText('Saved copies could not be read.')).toBeVisible();
  await expect(
    page.getByRole('searchbox', { name: 'Search presets' }),
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Load Available original' }),
  ).toBeEnabled();
  fail = false;
  await page.getByRole('button', { name: 'Retry saved copies' }).click();
  await expect(page.getByText('Saved copies could not be read.')).toHaveCount(
    0,
  );
});

test('device portrait shared NAM and IR libraries import, search and page independently', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const prefix = `IR library ${info.project.name}`;
  const endpoint = '/api/v1/models/local';
  for (let i = 0; i < 66; i++) {
    const response = await page.request.post(
      `${endpoint}?name=${encodeURIComponent(`${prefix} ${i}.wav`)}`,
      {
        data: Buffer.from('RIFF\x04\x00\x00\x00WAVE', 'binary'),
        headers: { 'Content-Type': 'application/octet-stream' },
      },
    );
    expect(response.status()).toBe(201);
  }
  await page.goto('/');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'IRs', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search IRs' }).fill(prefix);
  await expect(page.getByRole('heading', { level: 4 })).toHaveCount(64);
  await page.screenshot({
    path: `test-results/model-library-list-${info.project.name}.png`,
  });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { level: 4 })).toHaveCount(2);
  await page
    .getByRole('searchbox', { name: 'Search IRs' })
    .fill(`${prefix} 65.wav`);
  await expect(page.getByRole('heading', { level: 4 })).toHaveCount(1);
  await expect(
    page.getByRole('heading', { name: `${prefix} 65`, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'IRs pages' })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'NAM models', exact: true }).click();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.screenshot({
    path: `test-results/model-library-import-${info.project.name}.png`,
  });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose files', exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: `${prefix}.nam`,
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('{"architecture":"Linear","weights":[1]}'),
  });
  await expect(page.getByText(/Import complete: 1 of 1 files/)).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search NAM models' }).fill(prefix);
  await expect(
    page.getByRole('button', { name: `Preview ${prefix}`, exact: true }),
  ).toBeVisible();
  const audioBeforePreview = await (
    await page.request.get('/api/v1/audio')
  ).json();
  await page
    .getByRole('button', { name: `Preview ${prefix}`, exact: true })
    .click();
  const preview = page.getByRole('dialog', {
    name: 'Model preview',
    exact: true,
  });
  await expect(preview).toBeVisible();
  await expect(
    preview.getByText(/No TONE3000 reference in this file/),
  ).toBeVisible();
  await expect(
    preview.getByText('Start a native or mixed rig to audition this model.'),
  ).toBeVisible();
  const previewAccessibility = await new AxeBuilder({ page })
    .include('.library-model-preview')
    .analyze();
  expect(previewAccessibility.violations).toEqual([]);
  await page.screenshot({
    path: `test-results/model-library-preview-${info.project.name}.png`,
  });
  await preview
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click();
  expect(await (await page.request.get('/api/v1/audio')).json()).toEqual(
    audioBeforePreview,
  );
  await page.getByRole('button', { name: 'IRs', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search IRs' })).toHaveValue(
    `${prefix} 65.wav`,
  );
  await expect(page.getByRole('heading', { level: 4 })).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    )
    .toBe(true);
  if (info.project.name === 'boox-air3c') await setDisplayMode(page, 'epaper');
  await expect(
    page.getByRole('button', { name: 'Presets', exact: true }),
  ).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .include('.asset-library')
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({
    path: `test-results/model-library-${info.project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole('searchbox', { name: 'Search IRs' })
    .fill('unmatched-library-query');
  await expect(page.getByText('No matching files')).toBeVisible();
  await page.screenshot({
    path: `test-results/model-library-empty-${info.project.name}.png`,
  });
});

test('device portrait permanent deletion previews a disposable preset and keeps independent files', async ({
  page,
  request,
}, info) => {
  const bytes = Buffer.from(
    readFileSync(new URL('authored-legacy.t3kpreset', fixtures)),
  );
  const offset = bytes.indexOf(Buffer.from('Fixture'));
  expect(offset).toBeGreaterThan(0);
  bytes.write('DelTest', offset, 'utf8');
  const imported = await request.post('/api/v1/presets', {
    data: bytes,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  expect(imported.ok()).toBe(true);
  const preset = await imported.json();
  const independent = await request.post(
    '/api/v1/models/local?name=keep-delete-test.nam',
    {
      data: Buffer.from('{"architecture":"Linear","weights":[1,2,3]}'),
      headers: { 'Content-Type': 'application/octet-stream' },
    },
  );
  expect(independent.ok()).toBe(true);
  const asset = await independent.json();
  await page.goto('/#library');
  await page
    .getByRole('button', { name: 'Manage library', exact: true })
    .click();
  const row = page.locator(
    `[data-library-kind="original"][data-library-entry="${preset.sha256}"]`,
  );
  await row.getByRole('button', { name: /^Preset options:/ }).click();
  await page
    .getByRole('button', { name: 'Review deletion', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Delete preset',
    exact: true,
  });
  await expect(
    dialog.getByText('Separate NAM and IR files stay in Library.'),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Delete permanently', exact: true }),
  ).toBeEnabled();
  const before = await request.get(`/api/v1/presets/${preset.sha256}/original`);
  expect(before.ok()).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    (await new AxeBuilder({ page }).include('dialog[open]').analyze())
      .violations,
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath('permanent-delete-preview.png'),
    fullPage: true,
  });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(
    (await request.get(`/api/v1/presets/${preset.sha256}/original`)).ok(),
  ).toBe(true);
  await row.getByRole('button', { name: /^Preset options:/ }).click();
  await page
    .getByRole('button', { name: 'Review deletion', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Delete permanently', exact: true })
    .click();
  await expect(
    dialog.getByText('Preset deleted.', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(row).toHaveCount(0);
  const models = await (
    await request.get('/api/v1/models/local?all=true')
  ).json();
  expect(models.data.some((m: { id: string }) => m.id === asset.id)).toBe(true);
});
