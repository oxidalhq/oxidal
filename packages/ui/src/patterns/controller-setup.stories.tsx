import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import {
  ControllerSetupDemo,
  ExtraControllersDemo,
} from './controller-setup.demo';

/** Settings › MIDI: set up a foot controller step by step. */
const meta: Meta = {
  title: 'Patterns/Controller setup',
  parameters: { layout: 'padded' },
};
export default meta;

export const FourSwitches: StoryObj = {
  name: 'Set up a 4-switch controller',
  render: () => <ControllerSetupDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Next' }));
    await userEvent.click(canvas.getByRole('radio', { name: 'Scenes' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Next' }));
    await userEvent.click(
      canvas.getByRole('button', { name: /^A Not heard yet/ }),
    );
    await expect(canvas.getByText(/1\/4 switches checked/)).toBeVisible();
    await expect(
      canvas.getByRole('button', { name: /^A CC 16 · ch 1/ }),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole('button', { name: 'Skip the rest' }),
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Save layout' }));
    await expect(canvas.getByText(/Saved. Every preset/)).toBeVisible();
  },
};

export const TwoControllers: StoryObj = {
  name: 'Two controllers at once',
  render: () => <ExtraControllersDemo />,
};
