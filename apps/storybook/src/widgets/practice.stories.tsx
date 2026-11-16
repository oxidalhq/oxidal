import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { PracticePanel } from './practice';

/**
 * Practice tools from the backing player: drag across the waveform for a
 * loop or set A and B, slow it down without changing the pitch, and add a
 * click that follows the song's own beats or a steady tempo.
 */
const meta: Meta<typeof PracticePanel> = {
  title: 'Widgets/Practice',
  component: PracticePanel,
  args: { duration: 222, position: 64, bpm: 118 },
  parameters: { layout: 'padded' },
};
export default meta;

export const Loop: StoryObj<typeof PracticePanel> = {
  name: 'Loop a part at three-quarter speed with a click',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Set A' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Set B' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Loop' }));
    await expect(canvas.getByRole('button', { name: 'Loop' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(
      canvas.getByRole('radio', { name: '0.75 times speed' }),
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Click' }));
    await userEvent.click(canvas.getByRole('radio', { name: 'Steady tempo' }));
    await expect(
      canvas.getByRole('slider', { name: 'Click BPM' }),
    ).toBeVisible();
  },
};

export const UncertainTempo: StoryObj<typeof PracticePanel> = {
  name: 'Tempo not found',
  args: { bpm: undefined },
};
