import type { Meta, StoryObj } from '@storybook/react-vite';

import { OneLineSample } from './rig-samples';

/**
 * One large row of blocks, scene pills, and a wide editor strip along the bottom. The calmest layout. Design samples with fixed example data; nothing is saved.
 */
const meta: Meta = {
  title: 'Rig layouts/Layout B - One line',
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj;

/** One large row of blocks, scene pills, wide editor strip. */
export const OneLine: Story = { render: () => <OneLineSample /> };
