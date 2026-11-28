import type { Meta, StoryObj } from '@storybook/react-vite';

import { ChainEditSample } from './rig-song';

/**
 * Add a block anywhere, move, duplicate, bypass, delete, or make two blocks parallel, from a toolbar on the selected block. Design samples with fixed example data; nothing is saved.
 */
const meta: Meta = {
  title: 'Rig layouts/Layout G - Chain editing',
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj;

/** Tap a block for its actions; tap + to add a block. */
export const Editing: Story = { render: () => <ChainEditSample /> };
