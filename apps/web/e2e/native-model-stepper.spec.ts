import { expect, test } from '@playwright/test';

import type { AudioState, LocalModel } from '../src/api';

const origin = 'a'.repeat(64);
const second = 'b'.repeat(64);
const third = 'c'.repeat(64);
const excluded = 'd'.repeat(64);

const file = (
  id: string,
  title: string,
  format: 'nam' | 'ir',
  gear?: string,
): LocalModel => ({ id, title, format, gear, name: title, sha256: id });

for (const format of ['nam', 'ir'] as const) {
  test(`native ${format} model stepper waits for readback and restores the starting local capture`, async ({
    page,
    request,
  }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, 'Desktop panel');
    const baseline: AudioState = await (
      await request.get('/api/v1/audio')
    ).json();
    const gear = format === 'nam' ? 'amp' : 'cab';
    const choices = [
      file(origin, 'Starting capture', format, gear),
      file(second, 'Second capture', format),
      file(third, 'Third capture', format, gear),
      file(excluded, 'Other format', format === 'nam' ? 'ir' : 'nam'),
      file(
        'e'.repeat(64),
        'Other gear',
        format,
        format === 'nam' ? 'pedal' : 'space',
      ),
    ];
    const titleControl = {
      target: 'block:capture:enabled',
      label: 'Starting capture · left · enabled',
      display: 'On',
      value: 1,
      toggle: true,
    };
    let audio: AudioState = {
      ...baseline,
      phase: 'running',
      preset_name: 'Local capture rig',
      controls: [titleControl],
      models: [{ target: 'capture', asset: origin }],
      model_change: null,
    };
    let conflict = false;
    const orders: string[] = [];
    await page.route('**/api/v1/models/local?*', (route) => {
      const more = new URL(route.request().url()).searchParams.has('after');
      return route.fulfill({
        json: {
          data: more ? choices.slice(2) : choices.slice(0, 2),
          next: more ? null : second,
        },
      });
    });
    await page.route('**/api/v1/audio', async (route) => {
      if (route.request().method() === 'POST') {
        const command = route.request().postDataJSON();
        expect(command.action.kind).toBe('replace_model');
        expect(command.expected_revision).toBe(audio.revision);
        expect(command.session).toBe(audio.session);
        expect(command.action.assignment.target).toBe('capture');
        if (conflict) {
          audio = { ...audio, revision: audio.revision + 1 };
          return route.fulfill({
            status: 409,
            json: { error: 'audio_state_conflict' },
          });
        }
        orders.push(command.action.assignment.asset);
        audio = {
          ...audio,
          revision: audio.revision + 1,
          model_change: {
            request: orders.length,
            assignment: command.action.assignment,
            phase: 'preparing',
            error: null,
          },
        };
      }
      await route.fulfill({ json: audio });
    });
    function confirm(asset: string, title: string) {
      audio = {
        ...audio,
        revision: audio.revision + 1,
        controls: [{ ...titleControl, label: `${title} · left · enabled` }],
        models: [{ target: 'capture', asset }],
        model_change: { ...audio.model_change!, phase: 'applied' },
      };
    }
    await page.goto('/#rig');
    await page
      .getByRole('button', { name: /^Starting capture Tone block/ })
      .click();
    const stepper = page.getByRole('group', {
      name: `Try another ${gear} model`,
    });
    const next = stepper.getByRole('button', { name: 'Next model' });
    const previous = stepper.getByRole('button', { name: 'Previous model' });
    await expect(stepper).toContainText('1 of 3');
    await previous.click();
    await expect.poll(() => orders).toEqual([third]);
    await expect(next).toBeDisabled();
    await expect(stepper).toContainText('Starting capture');
    confirm(third, 'Third capture');
    await expect(stepper).toContainText('3 of 3');
    await previous.click();
    await expect.poll(() => orders).toEqual([third, second]);
    confirm(second, 'Second capture');
    await expect(stepper).toContainText('2 of 3');
    await stepper
      .getByRole('button', { name: 'Back to Starting capture' })
      .click();
    await expect.poll(() => orders).toEqual([third, second, origin]);
    confirm(origin, 'Starting capture');
    await expect(stepper).toContainText('1 of 3');
    await expect(
      stepper.getByRole('button', { name: 'Back to Starting capture' }),
    ).toBeDisabled();
    conflict = true;
    await next.click();
    await expect(stepper.locator('..').getByRole('alert')).toBeVisible();
    expect(orders).toEqual([third, second, origin]);
    expect(audio.models?.[0]?.asset).toBe(origin);
  });
}

test('native model stepper identifies the embedded starting capture it cannot restore', async ({
  page,
  request,
}) => {
  test.skip((page.viewportSize()?.width ?? 0) < 768, 'Desktop panel');
  const baseline: AudioState = await (
    await request.get('/api/v1/audio')
  ).json();
  const capture = {
    target: 'block:capture:enabled',
    label: 'Embedded amp · left · enabled',
    display: 'On',
    value: 1,
    toggle: true,
  };
  const modelSize = {
    ...capture,
    target: 'block:capture:slimSize',
    toggle: false,
  };
  let audio: AudioState = {
    ...baseline,
    phase: 'running',
    preset_name: 'Embedded capture rig',
    controls: [capture, modelSize],
    models: [],
  };
  await page.route('**/api/v1/models/local?*', (route) =>
    route.fulfill({
      json: { data: [file(second, 'Local amp', 'nam')], next: null },
    }),
  );
  await page.route('**/api/v1/audio', async (route) => {
    if (route.request().method() === 'POST') {
      const { action } = route.request().postDataJSON();
      expect(action.assignment).toEqual({ target: 'capture', asset: second });
      audio = {
        ...audio,
        revision: audio.revision + 1,
        controls: [
          { ...capture, label: 'Local amp · left · enabled' },
          modelSize,
        ],
        models: [action.assignment],
        model_change: {
          request: 1,
          assignment: action.assignment,
          phase: 'applied',
          error: null,
        },
      };
    }
    await route.fulfill({ json: audio });
  });
  await page.goto('/#rig');
  await page.getByRole('button', { name: /^Embedded amp Tone block/ }).click();
  const stepper = page.getByRole('group', {
    name: 'Try another capture model',
  });
  const back = stepper.getByRole('button', {
    name: /starting capture is embedded/i,
  });
  await expect(back).toBeDisabled();
  await stepper.getByRole('button', { name: 'Next model' }).click();
  await expect(stepper).toContainText('Local amp');
  await expect(back).toBeDisabled();
});
