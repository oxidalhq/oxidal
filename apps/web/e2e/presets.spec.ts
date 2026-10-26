import { setDisplayMode } from './display';
import { test, expect, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const fixtures = new URL(
  '../../../crates/oxidal-presets/tests/fixtures/',
  import.meta.url,
);

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
  await editor
    .getByLabel('Preset to load')
    .selectOption(`original:${preset.sha256}`);
  await editor.getByRole('button', { name: 'Load into native editor' }).click();
  await expect(editor.getByRole('status')).toHaveText('Native preset ready');
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
  await editor
    .getByLabel('Preset to load')
    .selectOption(`original:${preset.sha256}`);
  await editor.getByRole('button', { name: 'Load into native editor' }).click();
  await expect(editor.getByRole('status')).toHaveText('Native preset ready');
  await editor.getByLabel('Native control').selectOption('toneBass');
  await expect(editor.getByTestId('native-readback')).toHaveText(before!);
  await page.reload();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Library sections' })
    .getByRole('button', { name: 'Author', exact: true })
    .click();
  await editor.getByLabel('Preset to load').selectOption(`owned:${owned.id}`);
  await editor.getByRole('button', { name: 'Load into native editor' }).click();
  await expect(editor.getByRole('status')).toHaveText('Native preset ready');
  await expect(editor.getByTestId('native-readback')).toHaveText(edited!);
  const restored = await (await request.get('/api/v1/native')).json();
  expect(
    restored.block_controls.find(
      (p: { parameter: string }) => p.parameter === 'slimSize',
    ).value,
  ).toBe(0.75);
  const restoredMix = restored.block_controls.find(
    (p: { parameter: string }) => p.parameter === 'mix',
  );
  await editor.getByLabel('Native control').selectOption(restoredMix.id);
  await expect(editor.getByTestId('native-readback')).toContainText(
    'normalized 0.375',
  );
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
    await expect(art.first()).toBeVisible();
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
    expect(savedLive.controls).toEqual(live.controls);
    expect(savedLive.saved_copy).toMatch(/^[0-9a-f]{64}$/);
    expect((await (await request.get('/api/v1/native')).json()).revision).toBe(
      nativeBefore.revision,
    );
    await page.screenshot({
      path: test.info().outputPath('sounding-rig.png'),
      fullPage: true,
    });

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const audio = page.getByRole('region', { name: 'Playback controls' });
    await expect(audio.getByRole('status')).toContainText('Audio: running');
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
    await editor
      .getByLabel('Preset to load')
      .selectOption(`original:${preset.sha256}`);
    await editor
      .getByRole('button', { name: 'Load into native editor' })
      .click();
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
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await audio.getByRole('button', { name: 'Resume saved session' }).click();
    await expect(audio.getByRole('status')).toContainText('Audio: running');
    await audio
      .getByRole('button', { name: 'Restart audio', exact: true })
      .click();
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
    page.getByText('No image supplied', { exact: true }),
  ).toBeVisible();
  const status = await page
    .getByText('Saved offline', { exact: true })
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
