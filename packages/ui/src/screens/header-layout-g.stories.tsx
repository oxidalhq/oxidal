import type { Meta, StoryObj } from '@storybook/react-vite';

import { OptionG } from './header-layouts.demo';

/**
 * Header layout G - Bottom dock everywhere. The menu lives in a slim dock along the bottom on every screen size, as the phone's tabs already do, with Mute, the peaks and health at its right. The top holds only the floating preset on the Rig, or the page title elsewhere, so nothing is fixed across the top of the chain. Works: one layout for every device, and a thumb reaches it on a tablet. Watch: the dock sits next to the chain bar on the Rig, and desktop users expect the menu at the top.
 */
const meta: Meta = {
  title: 'Header layouts/G - Bottom dock everywhere',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "The menu lives in a slim dock along the bottom on every screen size, as the phone's tabs already do, with Mute, the peaks and health at its right. The top holds only the floating preset on the Rig, or the page title elsewhere, so nothing is fixed across the top of the chain. Works: one layout for every device, and a thumb reaches it on a tablet. Watch: the dock sits next to the chain bar on the Rig, and desktop users expect the menu at the top.",
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
  render: () => <OptionG view="rig" />,
};

/** Settings › Audio on a desktop. */
export const SettingsDesktop: Story = {
  globals: at('chainDesktop'),
  parameters: {
    docs: { description: { story: 'Settings › Audio at 1440 × 900.' } },
  },
  render: () => <OptionG view="settings" />,
};

/** Library › Mine on a desktop. */
export const LibraryDesktop: Story = {
  globals: at('chainDesktop'),
  parameters: {
    docs: { description: { story: 'Library › Mine at 1440 × 900.' } },
  },
  render: () => <OptionG view="library" />,
};

/** The Rig on an iPhone XR. */
export const RigPhone: Story = {
  name: 'Rig on iPhone XR',
  globals: at('iphoneXr'),
  parameters: {
    docs: { description: { story: 'The Rig at 414 × 896.' } },
  },
  render: () => <OptionG view="rig" />,
};
