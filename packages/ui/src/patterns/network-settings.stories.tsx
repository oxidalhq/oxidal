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

export const ReachAndCertificate: StoryObj = {
  name: 'Reach the device and install its certificate',
  render: () => <NetworkSettingsDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole('link', { name: 'https://oxidal.local' }),
    ).toBeVisible();
    await expect(
      canvas.getByRole('link', { name: 'https://192.168.1.169' }),
    ).toBeVisible();
    await expect(
      canvas.getByRole('link', { name: 'https://10.42.0.1' }),
    ).toBeVisible();
    await expect(
      canvas.getByRole('link', { name: 'Download certificate' }),
    ).toHaveAttribute('download', 'oxidal-ca.crt');
    await userEvent.click(canvas.getByRole('radio', { name: 'Windows' }));
    await expect(
      canvas.getByText(/Trusted Root Certification Authorities/),
    ).toBeVisible();
  },
};
