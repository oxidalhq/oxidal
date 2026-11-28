import type { Meta, StoryObj } from '@storybook/react-vite';

import { PhoneSample } from './rig-samples';

/**
 * Phone: scene chips pinned above a bottom sheet, chain scrolls sideways. Design samples with fixed example data; nothing is saved.
 */
const meta: Meta = {
  title: 'Rig layouts/Layout E - Phone',
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj;

/** Phone frame with a bottom sheet. */
export const Phone: Story = { render: () => <PhoneSample /> };
