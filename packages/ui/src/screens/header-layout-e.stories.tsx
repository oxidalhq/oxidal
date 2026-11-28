import type { Meta, StoryObj } from '@storybook/react-vite';

import { OptionE } from './header-layouts.demo';

/**
 * Header layout E - One row for everything. One 48 px row: compact menu tabs next to the wordmark, the playing preset with previous and next in the centre, and Tuner, Mute, Perform and health on the right, on every screen. No separate preset row, so the chain starts right under it. Works: the most chain height with everything visible, and Mute never moves. Watch: the row is busy and needs a desktop; on a phone the tabs move to the bottom.
 */
const meta: Meta = {
  title: 'Header layouts/E - One row for everything',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'One 48 px row: compact menu tabs next to the wordmark, the playing preset with previous and next in the centre, and Tuner, Mute, Perform and health on the right, on every screen. No separate preset row, so the chain starts right under it. Works: the most chain height with everything visible, and Mute never moves. Watch: the row is busy and needs a desktop; on a phone the tabs move to the bottom.',
      },
    },
    viewport: {
      options: {
        chainDesktop: {
          name: 'Desktop 1440 × 900',
          styles: { width: '1440px', height: '900px' },
        },
        iphoneXr: {
          name: 'iPhone XR',
          styles: { width: '414px', height: '896px' },
        },
      },
    },
  },
};
export default meta;
type Story = StoryObj;

const at = (value: string) => ({ viewport: { value, isRotated: false } });

/** The Rig on a desktop: chain map, chain bar and panel. */
export const RigDesktop: Story = {
  globals: at('chainDesktop'),
  parameters: {
    docs: { description: { story: 'The Rig at 1440 × 900.' } },
  },
  render: () => <OptionE view="rig" />,
};

/** Settings › Audio on a desktop. */
export const SettingsDesktop: Story = {
  globals: at('chainDesktop'),
  parameters: {
    docs: { description: { story: 'Settings › Audio at 1440 × 900.' } },
  },
  render: () => <OptionE view="settings" />,
};

/** Library › Mine on a desktop. */
export const LibraryDesktop: Story = {
  globals: at('chainDesktop'),
  parameters: {
    docs: { description: { story: 'Library › Mine at 1440 × 900.' } },
  },
  render: () => <OptionE view="library" />,
};

/** The Rig on an iPhone XR. */
export const RigPhone: Story = {
  name: 'Rig on iPhone XR',
  globals: at('iphoneXr'),
  parameters: {
    docs: { description: { story: 'The Rig at 414 × 896.' } },
  },
  render: () => <OptionE view="rig" />,
};
