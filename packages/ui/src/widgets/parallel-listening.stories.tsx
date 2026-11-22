import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { ParallelListeningDemo } from './parallel-listening.demo';

export default {
  title: 'Rig/Parallel path audition',
  parameters: { layout: 'padded' },
} satisfies Meta;

export const ParallelAmps: StoryObj = {
  render: () => <ParallelListeningDemo />,
  play: async ({ canvasElement }) => {
    const ui = within(canvasElement);
    const before = ui.getByRole('status').textContent;
    await userEvent.click(ui.getByRole('radio', { name: 'Solo Plexi 50' }));
    await userEvent.click(
      ui.getByRole('switch', { name: 'Level-matched mono' }),
    );
    await expect(ui.getByRole('status')).toHaveTextContent('Mono');
    await userEvent.click(ui.getByRole('radio', { name: 'Both' }));
    await userEvent.click(
      ui.getByRole('switch', { name: 'Invert path B polarity' }),
    );
    await userEvent.click(
      ui.getByRole('button', { name: 'Return to original stereo' }),
    );
    await expect(ui.getByRole('status')).toHaveTextContent(before!);
    await expect(
      ui.getByRole('switch', { name: 'Invert path B polarity' }),
    ).not.toBeChecked();
  },
};

export const ParallelCabinets: StoryObj = {
  render: () => <ParallelListeningDemo names={['Greenback IR', 'Blue IR']} />,
  play: async ({ canvasElement }) => {
    const ui = within(canvasElement);
    const blend = ui.getByRole('slider', { name: 'Blend toward path B' });
    blend.focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(blend).toHaveAttribute('aria-valuenow', '51');
    await userEvent.click(ui.getByRole('radio', { name: 'Solo Blue IR' }));
    await userEvent.click(
      ui.getByRole('switch', { name: 'Level-matched mono' }),
    );
    await expect(ui.getByRole('status')).toHaveTextContent(
      '3.0 dB listening trim',
    );
    await userEvent.click(
      ui.getByRole('button', { name: 'Return to original stereo' }),
    );
    await expect(blend).toHaveAttribute('aria-valuenow', '50');
  },
};
