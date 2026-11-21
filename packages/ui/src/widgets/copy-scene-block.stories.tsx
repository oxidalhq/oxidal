import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Button } from '../components/ui/button';
import {
  CopySceneBlockDialog,
  type SceneBlockCopySelection,
} from './copy-scene-block';

export default {
  title: 'Rig/Copy block settings',
  parameters: { layout: 'padded' },
} satisfies Meta;

const lead = { id: 'lead-eq', name: 'Lead EQ' };
const dirt = { id: 'dirt-eq', name: 'Dirt EQ' };
const capture = { id: 'dirt-capture', name: 'Dirt capture' };
const initial = {
  sourceBlock: lead.id,
  destinationScene: '',
  destinationBlock: lead.id,
  version: 'main',
};
const eqRows = [80, 150, 300, 600, 1200, 2400, 4800, 9600].map(
  (frequency, index) => ({
    id: String(frequency),
    label: `${frequency.toLocaleString('en-US')} Hz`,
    before: '0 dB',
    after: `${index % 2 ? '-' : '+'}${(index + 1) / 2} dB`,
  }),
);
function Rig() {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<SceneBlockCopySelection>(initial);
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid max-w-lg gap-3">
      <Button
        variant="outline"
        onClick={() => {
          setSelection(initial);
          setOpen(true);
        }}
      >
        Copy Lead’s block settings
      </Button>
      <p role="status">
        {copied ? 'Dirt EQ saved to Main.' : 'Lead is playing.'}
      </p>
      {open && (
        <CopySceneBlockDialog
          sourceScene="Lead"
          sourceBlocks={[lead]}
          destinationScenes={[{ id: 'dirt', name: 'Dirt' }]}
          destinationBlocks={[lead, dirt, capture]}
          versions={[{ id: 'main', name: 'Main' }]}
          selection={selection}
          preview={
            !selection.destinationScene
              ? null
              : selection.destinationBlock === capture.id
                ? {
                    refusal:
                      'Choose a destination block that uses the same effect plugin.',
                  }
                : { rows: eqRows }
          }
          onChange={setSelection}
          onCancel={() => setOpen(false)}
          onCopy={() => {
            setCopied(true);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

export const PreviewAndCancel: StoryObj = {
  render: () => <Rig />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    const open = canvas.getByRole('button', {
      name: 'Copy Lead’s block settings',
    });
    await userEvent.click(open);
    const dialog = within(await page.findByRole('dialog'));
    await userEvent.selectOptions(
      dialog.getByLabelText('Destination scene'),
      'dirt',
    );
    await userEvent.selectOptions(
      dialog.getByLabelText('Destination block'),
      capture.id,
    );
    const save = dialog.getByRole('button', { name: 'Copy and save' });
    await expect(save).toBeDisabled();
    await expect(dialog.getByRole('status')).toHaveTextContent(
      'same effect plugin',
    );
    await userEvent.selectOptions(
      dialog.getByLabelText('Destination block'),
      dirt.id,
    );
    const preview = within(
      dialog.getByRole('table', { name: 'Settings to copy' }),
    );
    await expect(preview.getAllByRole('row')).toHaveLength(9);
    await expect(
      preview.getByRole('row', { name: '80 Hz 0 dB +0.5 dB' }),
    ).toBeVisible();
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Lead is playing.',
    );
    await userEvent.click(open);
    const reopened = within(await page.findByRole('dialog'));
    await userEvent.selectOptions(
      reopened.getByLabelText('Destination scene'),
      'dirt',
    );
    await userEvent.selectOptions(
      reopened.getByLabelText('Destination block'),
      dirt.id,
    );
    await userEvent.click(
      reopened.getByRole('button', { name: 'Copy and save' }),
    );
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Dirt EQ saved to Main.',
    );
  },
};
