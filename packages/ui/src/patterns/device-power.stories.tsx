import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { DevicePower, PowerReceipt } from './device-power';

const meta: Meta = {
  title: 'Patterns/Device power',
  parameters: { layout: 'padded' },
};
export default meta;

function Demo() {
  const [action, setAction] = useState<'reboot' | 'shutdown' | null>(null);
  const [receipt, setReceipt] = useState<'reboot' | 'shutdown' | null>(null);
  return (
    <DevicePower
      action={action}
      disabled={Boolean(receipt)}
      notice={receipt && <PowerReceipt action={receipt} />}
      onRequest={setAction}
      onCancel={() => setAction(null)}
      onConfirm={() => {
        setReceipt(action);
        setAction(null);
      }}
    />
  );
}

export const ReviewBeforePower: StoryObj = {
  name: 'Review, cancel, then confirm shutdown',
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Restart device' }),
    );
    const reboot = within(
      await page.findByRole('dialog', { name: 'Restart device?' }),
    );
    await expect(canvas.queryByRole('status')).toBeNull();
    await userEvent.click(reboot.getByRole('button', { name: 'Cancel' }));
    await expect(page.queryByRole('dialog')).toBeNull();
    await expect(canvas.queryByRole('status')).toBeNull();
    await userEvent.click(
      canvas.getByRole('button', { name: 'Shut down device' }),
    );
    const shutdown = within(
      await page.findByRole('dialog', { name: 'Shut down device?' }),
    );
    await userEvent.click(
      shutdown.getByRole('button', { name: 'Confirm shutdown' }),
    );
    await expect(await canvas.findByRole('status')).toHaveTextContent(
      'Shutdown requested.',
    );
    await expect(
      canvas.getByRole('button', { name: 'Restart device' }),
    ).toBeDisabled();
  },
};
