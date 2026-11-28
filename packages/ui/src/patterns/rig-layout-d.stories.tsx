import type { Meta, StoryObj } from '@storybook/react-vite';

import { ConsoleSample } from './rig-samples';

/**
 * Every block is a channel strip, so the main control needs no editor. Design samples with fixed example data; nothing is saved.
 */
const meta: Meta = {
  title: 'Rig layouts/Layout D - Console',
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj;

/** One vertical strip per block. */
export const Console: Story = { render: () => <ConsoleSample /> };
