import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import {
  BlockEq,
  BootPlayback,
  DebugConsole,
  DiReamps,
  StorageLock,
} from './device-flows';

/** Block EQ, DI and reamps, startup playback, storage lock and the debug console. */
const meta: Meta = {
  title: 'Patterns/Device and block tools',
  parameters: { layout: 'padded' },
};
export default meta;

export const Eq: StoryObj = {
  name: 'Block EQ: hear it, then cancel',
  render: () => <BlockEq />,
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
  render: () => <DiReamps />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Record DI' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Record DI' }));
    await expect(canvas.getByText('Take 3')).toBeVisible();
  },
};

export const Startup: StoryObj = {
  name: 'When Oxidal starts',
  render: () => <BootPlayback />,
};
export const Storage: StoryObj = {
  name: 'System storage lock',
  render: () => <StorageLock />,
};
export const Debug: StoryObj = {
  name: 'Debug console',
  render: () => <DebugConsole />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Turn on for 15 minutes' }),
    );
    await expect(canvas.getByLabelText('Console')).toBeVisible();
  },
};
