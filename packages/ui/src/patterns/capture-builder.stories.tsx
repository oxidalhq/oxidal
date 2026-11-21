import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { CaptureBuilderDemo } from './capture-builder.demo';
import { models } from './capture-builder.fixtures';
export default {
  title: 'Patterns/Build a rig from captures',
  parameters: { layout: 'padded' },
} satisfies Meta;
export const AssignScenes: StoryObj = {
  render: () => <CaptureBuilderDemo />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(
      c.getByRole('button', { name: 'Build a rig from captures' }),
    );
    await userEvent.type(c.getByLabelText('Rig name'), 'Friday four');
    for (const [i, scene] of ['Clean', 'Crunch', 'Lead', 'Dirt'].entries()) {
      await userEvent.click(
        c.getByRole('button', { name: scene + ' · Choose capture' }),
      );
      await userEvent.click(c.getByRole('button', { name: models[i]!.name }));
    }
    await expect(c.getByRole('button', { name: 'Save rig' })).toBeDisabled();
    await userEvent.selectOptions(c.getByLabelText('Dirt capture type'), 'amp');
    await userEvent.selectOptions(
      c.getByLabelText('Shared cabinet for amp-only scenes'),
      'cab1',
    );
    await userEvent.click(c.getByRole('button', { name: 'Save rig' }));
    await expect(c.getByRole('status')).toHaveTextContent('Saved Friday four');
  },
};
export const Cancel: StoryObj = {
  render: () => <CaptureBuilderDemo />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(
      c.getByRole('button', { name: 'Build a rig from captures' }),
    );
    await userEvent.click(c.getByRole('button', { name: 'Clean combo' }));
    await userEvent.click(c.getByRole('button', { name: 'Cancel' }));
    await expect(c.queryByRole('status')).toBeNull();
    await userEvent.click(
      c.getByRole('button', { name: 'Build a rig from captures' }),
    );
    await expect(
      c.getByRole('button', { name: 'Clean · Choose capture' }),
    ).toBeVisible();
  },
};
