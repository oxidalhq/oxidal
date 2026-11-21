import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { type RehearsalEntry, RehearsalSet } from './rehearsal-set';
export default {
  title: 'Patterns/Rehearsal set',
  parameters: { layout: 'padded' },
} satisfies Meta;
const entries: RehearsalEntry[] = [
  {
    id: 'clean',
    name: 'Clean',
    status: 'prepared',
    sound: [],
    sheet: [],
    accompaniment: [],
  },
  {
    id: 'lead',
    name: 'Lead',
    status: 'prepared',
    sound: [],
    sheet: [],
    accompaniment: [],
  },
  {
    id: 'dirt',
    name: 'Dirt',
    status: 'blocked',
    sound: ['Protect allows only prepared switches.'],
    sheet: [],
    accompaniment: [],
  },
];
function PendingRecall() {
  const [pending, setPending] = useState('');
  const [reason, setReason] = useState('');
  return (
    <RehearsalSet
      entries={entries}
      playing="Clean"
      pending={pending}
      refusal={reason}
      onRecall={(id) => {
        const target = entries.find((row) => row.id === id);
        if (!target) return;
        setReason('');
        setPending(target.name);
        window.setTimeout(() => {
          setPending('');
          setReason('The requested branch could not be prepared.');
        }, 600);
      }}
    />
  );
}
export const ProtectedStage: StoryObj = {
  name: 'Prepared recall refused with Clean still playing',
  render: () => <PendingRecall />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole('button', { name: 'Recall Dirt, position 3' }),
    ).toBeDisabled();
    await userEvent.click(
      canvas.getByRole('button', { name: 'Recall Lead, position 2' }),
    );
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Preparing Lead',
    );
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'could not be prepared',
    );
    await expect(canvas.getByText('Clean', { exact: true })).toBeVisible();
  },
};
export const Library: StoryObj = {
  name: 'Stored and prepared sounds in Library',
  render: () => (
    <RehearsalSet
      entries={entries.map((e) =>
        e.id === 'dirt' ? { ...e, status: 'loads_on_recall', sound: [] } : e,
      )}
    />
  ),
};
