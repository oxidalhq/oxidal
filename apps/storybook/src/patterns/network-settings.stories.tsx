import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { NetworkSettings } from './network-settings';

/** Settings › Network: join a network and confirm it from the new connection. */
const meta: Meta = {
  title: 'Patterns/Network',
  parameters: { layout: 'padded' },
};
export default meta;

export const JoinAndKeep: StoryObj = {
  name: 'Join a saved network and keep it',
  render: () => <NetworkSettings />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Join Rehearsal Room' }),
    );
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Can you still see this screen?',
    );
    await userEvent.click(
      canvas.getByRole('button', { name: 'Keep Rehearsal Room' }),
    );
    await expect(canvas.getByText('Connected · 192.168.1.169')).toBeVisible();
  },
};
