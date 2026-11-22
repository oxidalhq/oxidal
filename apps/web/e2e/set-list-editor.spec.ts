import { type APIRequestContext, expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type {
  LibraryCatalog,
  MediaAsset,
  SavedSongMix,
  SetOrder,
  VersionView,
} from '../src/api';

const catalogUrl = '/api/v1/presets/catalog';
const orderUrl = '/api/v1/presets/set-list';
const names = [
  'Rhythm section',
  'Ambient swell',
  'Lead boost',
  'Brown Crunch',
  'Neon Clean',
  'Cold Cathedral',
];

async function catalog(request: APIRequestContext): Promise<LibraryCatalog> {
  return (await request.get(catalogUrl)).json();
}

async function order(request: APIRequestContext): Promise<SetOrder> {
  return (await request.get(orderUrl)).json();
}

async function saveRig(request: APIRequestContext, name: string) {
  const lead = name === 'Lead boost';
  const manifest = {
    format: 'oxidal.preset',
    formatVersion: 1,
    id: randomUUID(),
    name,
    tone3000: { instances: [] },
    oxidal: {
      graph: {
        nodes: [
          { id: 'in', kind: 'input', audioInputs: 0, audioOutputs: 1 },
          {
            id: 'gain',
            kind: 'gain',
            audioInputs: 1,
            audioOutputs: 1,
            inputGains: [1],
          },
          { id: 'out', kind: 'output', audioInputs: 1, audioOutputs: 0 },
        ],
        edges: [
          { from: { node: 'in', port: 0 }, to: { node: 'gain', port: 0 } },
          { from: { node: 'gain', port: 0 }, to: { node: 'out', port: 0 } },
        ],
      },
      lv2: [],
      recall: { tails: 'cut' },
    },
    resources: [],
    extensions: {
      'urn:oxidal:gain:1': {},
      'urn:oxidal:authoring': { origin: lead ? 'mine' : 'oxidal_example' },
      'urn:oxidal:scenes:1': {
        fade_ms: 10,
        scenes: [
          {
            id: 'rhythm',
            name: 'Rhythm',
            gains: [{ node: 'gain', port: 0, value: 1 }],
          },
          {
            id: 'lead',
            name: 'Lead',
            gains: [{ node: 'gain', port: 0, value: 0.7 }],
          },
        ],
      },
    },
    requiredExtensions: ['urn:oxidal:gain:1', 'urn:oxidal:scenes:1'],
  };
  const response = await request.post('/api/v1/presets/rigs', {
    data: { manifest_json: JSON.stringify(manifest), resources: {} },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const { revision: id } = await response.json();
  return { kind: 'rig' as const, id: id as string };
}

async function saveBacking(request: APIRequestContext) {
  const bytes = await readFile(
    new URL(
      '../../../crates/oxidal-api/tests/fixtures/media/tone-44k-mono-vbr.mp3',
      import.meta.url,
    ),
  );
  const uploads = '/api/v1/media/uploads';
  const started = await request.post(uploads, {
    data: { name: 'Friday bass.mp3', size: bytes.length, stem: true },
  });
  expect(started.ok(), await started.text()).toBe(true);
  const { id: upload } = await started.json();
  const written = await request.put(`${uploads}/${upload}?offset=0`, {
    data: bytes,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  expect(written.ok(), await written.text()).toBe(true);
  const imported = await request.post('/api/v1/media/songs/import-stems', {
    data: {
      title: `Friday backing ${randomUUID()}`,
      stems: [{ role: 'bass', upload }],
    },
  });
  expect(imported.ok(), await imported.text()).toBe(true);
  const track: MediaAsset = await imported.json();
  const mixes = `/api/v1/media/songs/${track.id}/mixes`;
  const levels = { gain_tenths_db: 0, muted: false, solo: false };
  const mixed = await request.post(mixes, {
    data: {
      title: 'Friday rehearsal mix',
      split: track.id,
      recipe: {
        mode: 'four',
        vocals: levels,
        drums: levels,
        bass: levels,
        other: levels,
      },
    },
  });
  expect(mixed.ok(), await mixed.text()).toBe(true);
  const mix: SavedSongMix = await mixed.json();
  return { track, mix, mixes };
}

async function removeFixtures(request: APIRequestContext, ids: string[]) {
  let current = await order(request);
  for (const row of current.entries.filter(({ entry }) =>
    ids.includes(entry.preset.id),
  )) {
    const removed = await request.post(orderUrl, {
      data: {
        expected_revision: current.revision,
        entry: row.entry.id,
        action: { kind: 'remove' },
      },
    });
    expect(removed.ok(), await removed.text()).toBe(true);
    current = await removed.json();
  }
  for (const id of ids) {
    const preview = await request.get(
      `/api/v1/presets/removal?kind=rig&id=${id}`,
    );
    if (!preview.ok()) continue;
    const { token, blocked } = await preview.json();
    if (blocked) {
      const archived = await request.post(catalogUrl, {
        data: {
          expected_revision: (await catalog(request)).revision,
          entry_kind: 'rig',
          id,
          action: { kind: 'visibility', archived: true },
        },
      });
      expect(archived.ok(), await archived.text()).toBe(true);
    } else {
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
}

test('set-list editor replays the empty set and Friday set journeys', async ({
  page,
  request,
}) => {
  const initial = await order(request);
  const fixtures: string[] = [];
  let backing: Awaited<ReturnType<typeof saveBacking>> | undefined;
  let sheetId: string | undefined;
  try {
    for (const name of names) {
      const item = await saveRig(request, name);
      fixtures.push(item.id);
    }
    const preset = fixtures[2]!;
    const versionsUrl = `${catalogUrl}/rig/${preset}/versions`;
    const family: VersionView = await (await request.get(versionsUrl)).json();
    const versionResponse = await request.post(versionsUrl, {
      data: {
        request_id: randomUUID(),
        expected_revision: family.catalog_revision,
        expected_content: preset,
        version: 'main',
        action: { action: 'create', name: 'Rehearsal room' },
      },
    });
    expect(versionResponse.ok(), await versionResponse.text()).toBe(true);
    const editedFamily: VersionView = await versionResponse.json();
    const rehearsal = editedFamily.preset.versions.find(
      (version) => version.name === 'Rehearsal room',
    )!;
    const excluded = await request.post(catalogUrl, {
      data: {
        expected_revision: (await catalog(request)).revision,
        entry_kind: 'rig',
        id: preset,
        action: { kind: 'set_list', member: false },
      },
    });
    expect(excluded.ok(), await excluded.text()).toBe(true);

    await page.goto('/#library/setlist');
    const editor = page.locator('[data-slot="set-list-editor"]');
    const rows = editor
      .getByRole('list', { name: 'Songs in order' })
      .locator('li');
    const titles = () =>
      rows.locator('button span.truncate.font-semibold').allTextContents();
    const play = editor.getByRole('button', { name: 'Play this set' });
    if (initial.entries.length === 0) {
      await expect(editor.getByText('No songs in this set yet')).toBeVisible();
      await expect(editor.getByText('How a set list works')).toBeVisible();
      await expect(play).toBeDisabled();
      await expect(
        editor.getByRole('button', { name: 'Add presets' }),
      ).toHaveCount(2);
    }

    async function pick(presets: string[]) {
      await editor.getByRole('button', { name: 'Add presets' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Add to Set list' });
      const add = dialog.getByRole('button', { name: /to the set$/ });
      await expect(add).toBeDisabled();
      for (const name of presets) {
        await dialog
          .getByRole('searchbox', { name: 'Find a preset' })
          .fill(name);
        const fixture = fixtures[names.indexOf(name)];
        await dialog
          .getByRole('checkbox', { name, exact: true })
          .and(dialog.locator(`[id="pick-rig:${fixture}"]`))
          .click();
      }
      await expect(add).toHaveText(`Add ${presets.length} to the set`);
      await add.click();
      await expect(dialog).toHaveCount(0);
    }
    await pick(names.slice(0, 4));
    const base = initial.entries.map((row) => row.name);
    await expect.poll(titles).toEqual([...base, ...names.slice(0, 4)]);
    await expect(play).toBeEnabled();

    const move = editor.getByRole('button', { name: /^Move Lead boost/ });
    await move.focus();
    await page.keyboard.press('ArrowUp');
    const reordered = [
      'Rhythm section',
      'Lead boost',
      'Ambient swell',
      'Brown Crunch',
    ];
    await expect.poll(titles).toEqual([...base, ...reordered]);

    // Scroll the two starter rows together and drag the handle, then restore order.
    const rhythm = editor.getByRole('button', { name: /^Move Rhythm section/ });
    await rhythm.scrollIntoViewIfNeeded();
    await move.scrollIntoViewIfNeeded();
    const rhythmBox = (await rhythm.boundingBox())!;
    const leadBox = (await move.boundingBox())!;
    await page.mouse.move(
      leadBox.x + leadBox.width / 2,
      leadBox.y + leadBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      rhythmBox.x + rhythmBox.width / 2,
      rhythmBox.y + rhythmBox.height / 4,
      { steps: 7 },
    );
    await page.mouse.up();
    await expect
      .poll(titles)
      .toEqual([
        ...base,
        'Lead boost',
        'Rhythm section',
        ...reordered.slice(2),
      ]);
    await move.focus();
    await page.keyboard.press('ArrowDown');
    await expect.poll(titles).toEqual([...base, ...reordered]);

    const sheetList = await (await request.get('/api/v1/media/sheets')).json();
    const addedSheet = await request.post('/api/v1/media/sheets', {
      data: {
        expected: sheetList.registry_revision,
        title: `Friday lyrics ${randomUUID()}`,
        format: 'text',
        source: 'Words for the set',
      },
    });
    expect(addedSheet.ok(), await addedSheet.text()).toBe(true);
    const { sheet: chord } = await addedSheet.json();
    sheetId = chord.id;
    backing = await saveBacking(request);
    const { track, mix } = backing;
    await page.reload();
    await rows.getByRole('button', { name: /^Lead boost/ }).click();
    const edit = page.getByRole('dialog', {
      name: `${base.length + 2} · Lead boost`,
    });
    await edit.getByRole('radio', { name: 'Rehearsal room' }).click();
    await edit.getByRole('radio', { name: 'Lead', exact: true }).click();
    await edit.getByRole('combobox', { name: 'Backing track' }).click();
    await page.getByRole('option', { name: track.title }).click();
    await expect(
      edit.getByRole('combobox', { name: 'Saved mix' }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        await edit.getByRole('combobox', { name: 'Saved mix' }).click();
        const ready = await page
          .getByRole('option', { name: mix.title })
          .isVisible();
        if (!ready) await page.keyboard.press('Escape');
        return ready;
      })
      .toBe(true);
    await page.getByRole('option', { name: mix.title }).click();
    await edit.getByRole('combobox', { name: 'Chord sheet' }).click();
    await page.getByRole('option', { name: chord.title }).click();
    const current = await order(request);
    const competitor = current.entries.find(
      (row) => row.entry.preset.id === fixtures[3],
    )!;
    const concurrent = await request.post(orderUrl, {
      data: {
        expected_revision: current.revision,
        entry: competitor.entry.id,
        action: {
          kind: 'change',
          settings: { ...competitor.entry.settings, own_media: true },
        },
      },
    });
    expect(concurrent.ok(), await concurrent.text()).toBe(true);
    await edit.getByRole('button', { name: 'Done' }).click();
    await expect(edit.getByRole('alert')).toContainText('Set list changed');
    await expect(
      edit.getByRole('radio', { name: 'Lead', exact: true }),
    ).toBeChecked();
    await edit.getByRole('button', { name: 'Reload set list' }).click();
    await expect(edit.getByRole('alert')).toHaveCount(0);
    await edit.getByRole('button', { name: 'Done' }).click();
    await expect(edit).toHaveCount(0);
    await expect(
      editor.getByText(/Rehearsal room version · starts on Lead/),
    ).toBeVisible();
    const saved = (await order(request)).entries.find(
      (row) => row.entry.preset.id === preset,
    )!;
    expect(saved.entry.settings).toMatchObject({
      version: rehearsal.id,
      scene: 'lead',
      track: track.id,
      mix: mix.id,
      sheet: chord.id,
    });

    await pick(names.slice(4));
    await expect
      .poll(titles)
      .toEqual([...base, ...reordered, ...names.slice(4)]);
    await editor.getByRole('button', { name: 'Edit Ambient swell' }).click();
    await page.getByRole('button', { name: 'Remove from set' }).click();
    await expect
      .poll(titles)
      .toEqual([
        ...base,
        'Rhythm section',
        'Lead boost',
        'Brown Crunch',
        ...names.slice(4),
      ]);
    expect(
      (await catalog(request)).items.some(
        (item) => item.name === 'Ambient swell',
      ),
    ).toBe(true);

    await editor.getByRole('button', { name: 'Edit Lead boost' }).click();
    await page.getByRole('button', { name: 'Play it twice' }).click();
    await expect
      .poll(
        async () =>
          (await order(request)).entries.filter(
            (row) => row.entry.preset.id === preset,
          ).length,
      )
      .toBe(2);
    await page.getByRole('button', { name: 'Done' }).click();
    await page.reload();
    const repeated = (await order(request)).entries.filter(
      (row) => row.entry.preset.id === preset,
    );
    expect(repeated[0]?.entry.id).not.toEqual(repeated[1]?.entry.id);
    expect(repeated[1]?.entry.settings).toEqual(saved.entry.settings);
    await expect(
      editor.getByText(/Rehearsal room version · starts on Lead/),
    ).toHaveCount(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    const beforePlay = await order(request);
    const neon = beforePlay.entries.find(
      (row) => row.entry.preset.id === fixtures[4],
    )!;
    const recallResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `${orderUrl}/${encodeURIComponent(neon.entry.id)}/recall` &&
        response.request().method() === 'POST',
    );
    await editor.getByRole('button', { name: 'Play from Neon Clean' }).click();
    const recalled = await recallResponse;
    expect(recalled.request().postDataJSON()).toEqual({
      expected_revision: beforePlay.revision,
    });
    if (recalled.ok()) {
      await expect(page).toHaveURL(/#rig$/);
      await expect(
        page.getByText('Neon Clean', { exact: true }).first(),
      ).toBeVisible();
    } else {
      expect(recalled.status()).toBe(409);
      await expect(editor.getByRole('alert')).toContainText(
        'Could not play this set entry',
      );
      await expect(page).toHaveURL(/#library\/setlist$/);
    }
  } finally {
    await removeFixtures(request, fixtures);
    if (sheetId) {
      const url = `/api/v1/media/sheets/${sheetId}`;
      const references = await request.get(`${url}/references`);
      expect(references.ok(), await references.text()).toBe(true);
      const { sheet_revision, registry_revision } = await references.json();
      const removed = await request.delete(url, {
        data: { expected: sheet_revision, registry_revision },
      });
      expect(removed.ok(), await removed.text()).toBe(true);
    }
    if (backing) {
      await request.delete(backing.mixes, {
        data: { id: backing.mix.id, revision: backing.mix.revision },
      });
      await request.delete(`/api/v1/media/assets/${backing.track.id}`);
    }
  }
});

test('set-list editor retries a failed first read', async ({ page }) => {
  let unavailable = true;
  await page.route('**/api/v1/presets/set-list', async (route) => {
    if (!unavailable || route.request().method() !== 'GET')
      return route.continue();
    await route.fulfill({
      status: 503,
      json: { message: 'Set list unavailable' },
    });
  });
  await page.goto('/#library/setlist');
  const retry = page.getByRole('button', { name: 'Reload set list' });
  await expect(retry).toBeVisible();
  unavailable = false;
  await retry.click();
  await expect(page.locator('[data-slot="set-list-editor"]')).toBeVisible();
});
