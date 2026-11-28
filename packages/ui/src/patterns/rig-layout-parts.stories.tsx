import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  CommandPaletteSample,
  SceneOverviewSample,
  TopBarOptionsSample,
} from './rig-samples-2';

/**
 * Pieces any layout can use: three top bar designs, a scene overview, and one search for everything. Design samples with fixed example data; nothing is saved.
 */
const meta: Meta = {
  title: 'Rig layouts/Parts - Top bar, scenes, search',
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj;

/** Three top bar designs. Navigation lives in the menu. */
export const TopBarOptions: Story = { render: () => <TopBarOptionsSample /> };

/** Every block against every scene. */
export const SceneOverview: Story = { render: () => <SceneOverviewSample /> };

/** One search for presets, songs, blocks and scenes. Press ⌘K. */
export const CommandPalette: Story = { render: () => <CommandPaletteSample /> };
