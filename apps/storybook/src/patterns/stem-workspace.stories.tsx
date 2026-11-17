import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { StemWorkspaceDemo } from './stem-workspace.demo';

/**
 * Library › Stems › a song: split it on the device, shape a mix from the
 * stems while they play, and save it as a backing track.
 */
const meta: Meta = {
  title: 'Patterns/Stems',
  parameters: { layout: 'padded' },
};
export default meta;

export const SplitAndMix: StoryObj = {
  name: 'Split a song, then save a mix',
  render: () => <StemWorkspaceDemo split={false} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Split into stems' }),
    );
    await waitFor(
      () =>
        expect(
          canvas.getByText('6 stems · split on this device'),
        ).toBeVisible(),
      { timeout: 4000 },
    );
    await userEvent.click(
      canvas.getByRole('radio', { name: 'Drums and bass' }),
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Undo' }));
    await expect(canvas.getByRole('button', { name: 'Redo' })).toBeEnabled();
    await userEvent.click(
      canvas.getByRole('button', { name: 'Save as backing track' }),
    );
    await expect(canvas.getByText('No guitar, for the gig')).toBeVisible();
  },
};

export const Mixing: StoryObj = {
  name: 'A song with stems',
  render: () => <StemWorkspaceDemo />,
};
