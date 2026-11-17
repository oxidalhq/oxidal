import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Button } from '../components/ui/button';
import { GetTonesDemo, Tone3000AccountDemo } from './tone3000.demo';

/** Sign in to TONE3000 on the device, and get tones with plain-word failures. */
const meta: Meta = {
  title: 'Patterns/TONE3000',
  parameters: { layout: 'padded' },
};
export default meta;

export const SignIn: StoryObj = {
  name: 'Sign in with a code',
  render: () => <Tone3000AccountDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Sign in to TONE3000' }),
    );
    await expect(await canvas.findByText('WXKD-4821')).toBeVisible();
    await expect(
      await canvas.findByText(
        /Signed in as jane.capture/,
        {},
        { timeout: 4000 },
      ),
    ).toBeVisible();
  },
};

function Get() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Get tones…</Button>
      <GetTonesDemo open={open} onOpenChange={setOpen} />
    </>
  );
}

export const GetWithAFailure: StoryObj = {
  name: 'Get tones, one fails, try again',
  render: () => <Get />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await page.findByRole('button', { name: 'Download all' }),
    );
    await expect(
      await page.findByRole('alert', {}, { timeout: 4000 }),
    ).toHaveTextContent('TONE3000 is busy');
    await userEvent.click(page.getByRole('button', { name: 'Try again' }));
    await expect(
      await page.findByText(/Ready\. The tones are in/, {}, { timeout: 4000 }),
    ).toBeVisible();
  },
};
