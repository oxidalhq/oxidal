import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { NetworkSettingsDemo } from './network-settings.demo';

/** Settings › Network: join a network and confirm it from the new connection. */
const meta: Meta = {
  title: 'Patterns/Network',
  parameters: { layout: 'padded' },
};
export default meta;

export const JoinAndKeep: StoryObj = {
  name: 'Join a saved network and keep it',
  render: () => <NetworkSettingsDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Join Rehearsal Room' }),
    );
    const dialog = within(
      await page.findByRole('dialog', { name: 'Keep Rehearsal Room?' }),
    );
    await expect(
      canvas.getByText('Joined · waiting for you to keep it'),
    ).toBeVisible();
    await userEvent.click(
      dialog.getByRole('button', { name: 'Keep Rehearsal Room' }),
    );
    await expect(canvas.getByText('Connected · 192.168.1.169')).toBeVisible();
  },
};
