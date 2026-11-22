import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import {
  BlockEqDemo,
  BootPlaybackDemo,
  DebugConsoleDemo,
  DiReampsDemo,
  StorageLockDemo,
} from './device-flows.demo';

/** Block EQ, DI and reamps, startup playback, storage lock and the debug console. */
const meta: Meta = {
  title: 'Patterns/Device and block tools',
  parameters: { layout: 'padded' },
};
export default meta;

export const Eq: StoryObj = {
  name: 'Block EQ: hear it, then cancel',
  render: () => <BlockEqDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const low = canvas.getAllByRole('slider')[0]!;
    low.focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'You are hearing it now.',
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Cancelled. Nothing was saved.',
    );
  },
};

export const Di: StoryObj = {
  name: 'Record a DI',
  render: () => <DiReampsDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Record DI', pressed: false }),
    );
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Record DI', pressed: true }),
    );
    await expect(await canvas.findByText('Take 3')).toBeVisible();
  },
};

export const Startup: StoryObj = {
  name: 'When Oxidal starts',
  render: () => <BootPlaybackDemo />,
};
export const Storage: StoryObj = {
  name: 'System storage lock',
  render: () => <StorageLockDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await expect(canvas.getByText('Locked now')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: /^Unlocked/ }));
    await expect(canvas.getByText('Locked now')).toBeVisible();
    await expect(canvas.getByText('Next boot: Unlocked.')).toBeVisible();
    await userEvent.click(
      canvas.getByRole('button', { name: 'Restart into Unlocked mode…' }),
    );
    let review = within(
      await page.findByRole('dialog', { name: 'Restart into Unlocked mode?' }),
    );
    await userEvent.click(review.getByRole('button', { name: 'Cancel' }));
    await expect(canvas.getByText('Locked now')).toBeVisible();
    await userEvent.click(
      canvas.getByRole('button', { name: 'Restart into Unlocked mode…' }),
    );
    review = within(
      await page.findByRole('dialog', { name: 'Restart into Unlocked mode?' }),
    );
    await userEvent.click(
      review.getByRole('button', { name: 'Confirm restart' }),
    );
    await expect(canvas.getByText('Unlocked now')).toBeVisible();
  },
};
export const Debug: StoryObj = {
  name: 'Debug console',
  render: () => <DebugConsoleDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Turn on for 15 minutes' }),
    );
    await expect(canvas.getByLabelText('Console')).toBeVisible();
  },
};
