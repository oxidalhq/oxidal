import type { Meta, StoryObj } from '@storybook/react-vite';

import { PedalboardSample } from './rig-samples';

/**
 * Large tiles that wrap into rows; the editor slides in from the right. Design samples with fixed example data; nothing is saved.
 */
const meta: Meta = {
  title: 'Rig layouts/Layout C - Pedalboard',
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj;

/** Blocks wrap into rows; the editor slides over from the right. */
export const Pedalboard: Story = { render: () => <PedalboardSample /> };
