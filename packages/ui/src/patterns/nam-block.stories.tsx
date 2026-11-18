import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { NamBlockToolsDemo } from './nam-block.demo';

/** A NAM amp block's own tools, from its full editor. */
const meta: Meta = {
  title: 'Patterns/NAM block tools',
  parameters: { layout: 'padded' },
};
export default meta;

export const FromTone3000: StoryObj = {
  name: 'A TONE3000 capture: size, own copy, separate',
  render: () => <NamBlockToolsDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole('radio', { name: 'Lite' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Apply' }));
    await expect(canvas.queryByRole('button', { name: 'Apply' })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Save a copy' }));
    await expect(canvas.getByText('Mine')).toBeVisible();
    await userEvent.click(
      canvas.getByRole('button', { name: 'Separate amp and cab…' }),
    );
    await userEvent.click(
      await page.findByRole('button', { name: 'Separate' }),
    );
    await expect(
      canvas.getByText(/Separated: this block is the amp/),
    ).toBeVisible();
  },
};
