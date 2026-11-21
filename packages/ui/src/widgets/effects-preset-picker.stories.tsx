import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
} from '../components/ui/dialog';
import {
  type EffectsPresetOption,
  EffectsPresetPicker,
} from './effects-preset-picker';

export default {
  title: 'Rig/Effects preset switching',
  parameters: { layout: 'padded' },
} satisfies Meta;

const presets = [
  { id: 'dry', name: 'Clean chorus' },
  { id: 'echo', name: 'Warm echo' },
  {
    id: 'room',
    name: 'Room reverb',
    unavailable: 'Uses 44100 Hz · device is set to 48000 Hz',
  },
];

function EffectsRig() {
  const [current, setCurrent] = useState<EffectsPresetOption>(presets[0]!);
  const [edited, setEdited] = useState(true);
  const [pending, setPending] = useState<EffectsPresetOption | null>(null);
  function play(next: EffectsPresetOption) {
    setCurrent(next);
    setEdited(false);
    setPending(null);
  }
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Effects rig</CardTitle>
      </CardHeader>
      <EffectsPresetPicker
        name={current.name}
        current={current.id}
        items={presets}
        edited={edited}
        onOpen={() => {}}
        onChoose={(item) => (edited ? setPending(item) : play(item))}
      />
      <p role="status">
        {edited ? 'Effects preset · unsaved session' : 'Effects preset · saved'}
      </p>
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <DialogContent>
          <DialogHeader title="Switch effects preset?" closeLabel="Close" />
          <DialogBody className="grid gap-3">
            <p>
              Save the current effects sound first to keep these changes, or
              switch to {pending?.name} without saving.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setPending(null)}>
                Keep current sound
              </Button>
              <Button
                onClick={() => {
                  if (pending) play(pending);
                }}
              >
                Switch without saving
              </Button>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export const SwitchEffectsPreset: StoryObj = {
  render: () => <EffectsRig />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      canvas.getByRole('button', { name: /Playing preset: Clean chorus/ }),
    );
    const list = within(
      await page.findByRole('dialog', { name: 'Choose an effects preset' }),
    );
    await expect(
      list.getByRole('button', { name: 'Room reverb' }),
    ).toBeDisabled();
    await userEvent.click(list.getByRole('button', { name: 'Warm echo' }));
    let confirm = within(
      await page.findByRole('dialog', { name: 'Switch effects preset?' }),
    );
    await userEvent.click(
      confirm.getByRole('button', { name: 'Keep current sound' }),
    );
    await expect(
      canvas.getByRole('button', { name: /Playing preset: Clean chorus/ }),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole('button', { name: 'Next preset: Warm echo' }),
    );
    confirm = within(
      await page.findByRole('dialog', { name: 'Switch effects preset?' }),
    );
    await userEvent.click(
      confirm.getByRole('button', { name: 'Switch without saving' }),
    );
    await expect(
      canvas.getByRole('button', { name: /Playing preset: Warm echo/ }),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole('button', { name: 'Previous preset: Clean chorus' }),
    );
    await expect(
      canvas.getByRole('button', { name: /Playing preset: Clean chorus/ }),
    ).toBeVisible();
  },
};
