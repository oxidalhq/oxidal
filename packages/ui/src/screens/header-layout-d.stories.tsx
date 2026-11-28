import type { Meta, StoryObj } from '@storybook/react-vite';

import { OptionD } from './header-layouts.demo';

/**
 * Header layout D - Breadcrumb and search. A minimal row: the wordmark, where you are as a menu (Rig, or Settings › Audio) that opens every destination, and a wide search field as the main way around, then Mute and status. The Rig adds the slim preset row under it. Works: fast for players who type, and the place is always named. Watch: the destinations are one click further away, and the Rig has two rows above the chain.
 */
const meta: Meta = {
  title: 'Header layouts/D - Breadcrumb and search',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'A minimal row: the wordmark, where you are as a menu (Rig, or Settings › Audio) that opens every destination, and a wide search field as the main way around, then Mute and status. The Rig adds the slim preset row under it. Works: fast for players who type, and the place is always named. Watch: the destinations are one click further away, and the Rig has two rows above the chain.',
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
  render: () => <OptionD view="rig" />,
};

/** Settings › Audio on a desktop. */
export const SettingsDesktop: Story = {
  globals: at('chainDesktop'),
  parameters: {
    docs: { description: { story: 'Settings › Audio at 1440 × 900.' } },
  },
  render: () => <OptionD view="settings" />,
};

/** Library › Mine on a desktop. */
export const LibraryDesktop: Story = {
  globals: at('chainDesktop'),
  parameters: {
    docs: { description: { story: 'Library › Mine at 1440 × 900.' } },
  },
  render: () => <OptionD view="library" />,
};

/** The Rig on an iPhone XR. */
export const RigPhone: Story = {
  name: 'Rig on iPhone XR',
  globals: at('iphoneXr'),
  parameters: {
    docs: { description: { story: 'The Rig at 414 × 896.' } },
  },
  render: () => <OptionD view="rig" />,
};
