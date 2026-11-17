import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { AudioChangeDemo } from './audio-change.demo';

/**
 * Settings › Audio: change the buffer or rate of the running session, keep
 * it once it proves itself, or let the buffer finder pick the smallest
 * setting that plays without dropouts.
 */
const meta: Meta = {
  title: 'Patterns/Audio change',
  parameters: { layout: 'padded' },
};
export default meta;

export const ApplyAndKeep: StoryObj = {
  name: 'Apply a smaller buffer, then keep it',
  render: () => <AudioChangeDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('radio', { name: '96' }));
    await userEvent.click(
      canvas.getByRole('button', { name: 'Apply and restart audio' }),
    );
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Keep' }, { timeout: 3000 }),
    );
    await expect(canvas.getByText(/96 × 3 · 48 kHz/)).toBeVisible();
  },
};

export const Finder: StoryObj = {
  name: 'Find the smallest safe buffer',
  render: () => <AudioChangeDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      canvas.getByRole('button', { name: /Find the smallest safe buffer/ }),
    );
    await userEvent.click(await page.findByRole('button', { name: 'Start' }));
    await userEvent.click(
      await page.findByRole(
        'button',
        { name: 'Use 96 × 2' },
        { timeout: 6000 },
      ),
    );
    await expect(
      await canvas.findByRole('button', { name: 'Keep' }, { timeout: 3000 }),
    ).toBeVisible();
  },
};
