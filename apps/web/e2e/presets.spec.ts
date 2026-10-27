import { setDisplayMode } from './display';
import { test, expect, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const fixtures = new URL(
  '../../../crates/oxidal-presets/tests/fixtures/',
  import.meta.url,
);

test('rig controls follow the actual session without example effects', async ({
  page,
  request,
}) => {
  // Presentation contract fixture; the real worker lifecycle below verifies the same boundary.
  const baseline = await (await request.get('/api/v1/audio')).json();
  let audio = {
    ...baseline,
    phase: 'stopped',
    controls: [],
    configured: null,
    preset_name: null,
  };
  await page.route('**/api/v1/audio', (route) =>
    route.fulfill({ json: audio }),
  );
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
    page.getByRole('heading', { name: 'Preset library', exact: true }),
  ).toBeVisible();
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
  await expect(rig.locator('.live-effect')).toHaveCount(1);
  await rig.getByRole('button', { name: 'My amp', exact: true }).click();
  await expect(
    rig.getByRole('button', {
      name: 'Adjust sounding My amp level',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(/delay|reverb/i)).toHaveCount(0);
  // A recalled session may not contain the previously selected block.
  audio = {
    ...audio,
    session: 'replacement-session',
    preset_name: 'Output only',
    controls: [audio.controls[0]],
  };
  await expect(page.getByTestId('active-preset')).toHaveText('Output only');
  await expect(rig.locator('.live-effect')).toHaveCount(0);
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
  await expect(page.getByText('Device connected')).toBeVisible();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
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
  const current = rows.filter({ hasText: 'Current format' });
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
  expect(
    catalog.parameters.filter((p: { writable: boolean }) => p.writable),
  ).toHaveLength(14);
  for (const [id, label] of [
    ['toneMid', 'Middle'],
    ['toneTreble', 'Treble'],
    ['gateThreshold', 'Gate threshold'],
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
    const power = sounding.locator('.effect-power').first();
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
      const cards = await sounding
        .locator('.live-effect')
        .evaluateAll((items) =>
          items.map((item) => ({
            top: item.getBoundingClientRect().top,
            buttonBottom: item
              .querySelector('.effect-power')!
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
    await expect(sounding.getByTestId('live-status')).toHaveText(
      'Session modified',
    );
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
    // Only provider transport is a fixture. Selection, verified local asset, native
    // worker preparation, live readback and Save use the real daemon/processes.
    const modelRoot = process.env.OXIDAL_NATIVE_TEST_MODELS!;
    const fixtures = readdirSync(modelRoot)
      .filter((id) => /^[0-9a-f]{64}$/.test(id))
      .map((id) => ({
        id,
        metadata: JSON.parse(
          readFileSync(join(modelRoot, id, 'metadata.json'), 'utf8'),
        ),
      }));
    const irFixture = fixtures.find((f) => f.metadata.format === 'ir')!;
    expect(irFixture).toBeTruthy();
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
    let holdDownload = true;
    await page.route('**/api/v1/tone3000/stage', async (route) => {
      const selected = route.request().postDataJSON();
      const fixture = fixtures.find(
        (f) =>
          f.metadata.tone_id === selected.tone_id &&
          f.metadata.model_id === selected.model_id,
      )!;
      expect(fixture).toBeTruthy();
      const m = fixture.metadata;
      if (holdDownload)
        await new Promise((resolve) => setTimeout(resolve, 1500));
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
    const beforeModel = await (await request.get('/api/v1/audio')).json();
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
    await expect(picker).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/v1/audio')).json()).model_change
            ?.phase,
      )
      .toBe('applied');
    await expect(sounding.locator('.live-effect').first()).toContainText(
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
    await sounding.getByText('Save copy', { exact: true }).click();
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
    await currentBuffers.getByLabel('Session buffer (samples)').fill('256');
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
    await expect(page.getByText('Device connected')).toBeVisible();
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
    await expect(sounding.locator('.live-effect')).toHaveCount(1);
    await sounding
      .getByRole('button', { name: 'Add NAM', exact: true })
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
    await expect(sounding.locator('.live-effect')).toHaveCount(2);
    await sounding.getByRole('button', { name: 'Add IR', exact: true }).click();
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
    await expect(sounding.locator('.live-effect')).toHaveCount(3);
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
        sounding.getByRole('button', { name: 'Add NAM', exact: true }),
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
        .locator('.live-effect')
        .evaluateAll((cards) =>
          cards.map((card) => ({
            height: card.getBoundingClientRect().height,
            buttons: Array.from(card.querySelectorAll('button')).map(
              (button) => {
                const box = button.getBoundingClientRect();
                return { width: box.width, height: box.height };
              },
            ),
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
    await sounding.getByText('Save copy', { exact: true }).click();
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
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBe(1);
  await expect(
    page.getByText('space · No image supplied', { exact: true }),
  ).not.toBeVisible();
  await page.getByText('1 asset without artwork', { exact: true }).click();
  await expect(
    page.getByText('space · No image supplied', { exact: true }),
  ).toBeVisible();
  const status = await page
    .getByText('amp · Saved offline', { exact: true })
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
  await page.goto('/');
  if (testInfo.project.name === 'boox-air3c')
    await setDisplayMode(page, 'epaper');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'New preset', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Effects authoring' });
  const name = `Practice ${testInfo.project.name}`;
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
    .getByRole('button', { name: 'Audition rig', exact: true })
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
    .getByRole('button', { name: 'Audition rig', exact: true })
    .click();
  await expect
    .poll(async () => (await read()).native_values[0]?.value)
    .toBe(-35);
  await editor.getByRole('button', { name: 'Stop audio', exact: true }).click();
  await expect.poll(async () => (await read()).device_owned).toBe(false);
});
