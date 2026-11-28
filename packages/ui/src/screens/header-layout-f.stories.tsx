import type { Meta, StoryObj } from '@storybook/react-vite';

import { OptionF } from './header-layouts.demo';

/**
 * Header layout F - Stage title. The playing preset's name set very large across the top of the Rig, readable from a metre away, with the menu as a small line above it and the scene and version under it. Other pages use the same large title for the page name. Mute and health sit on the menu line on every screen. Works: strong on a music stand and on stage. Watch: the title takes height from the chain, and long names have to shrink on smaller screens.
 */
const meta: Meta = {
  title: 'Header layouts/F - Stage title',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "The playing preset's name set very large across the top of the Rig, readable from a metre away, with the menu as a small line above it and the scene and version under it. Other pages use the same large title for the page name. Mute and health sit on the menu line on every screen. Works: strong on a music stand and on stage. Watch: the title takes height from the chain, and long names have to shrink on smaller screens.",
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
  render: () => <OptionF view="rig" />,
};

/** Settings › Audio on a desktop. */
export const SettingsDesktop: Story = {
  globals: at('chainDesktop'),
  parameters: {
    docs: { description: { story: 'Settings › Audio at 1440 × 900.' } },
  },
  render: () => <OptionF view="settings" />,
};

/** Library › Mine on a desktop. */
export const LibraryDesktop: Story = {
  globals: at('chainDesktop'),
  parameters: {
    docs: { description: { story: 'Library › Mine at 1440 × 900.' } },
  },
  render: () => <OptionF view="library" />,
};

/** The Rig on an iPhone XR. */
export const RigPhone: Story = {
  name: 'Rig on iPhone XR',
  globals: at('iphoneXr'),
  parameters: {
    docs: { description: { story: 'The Rig at 414 × 896.' } },
  },
  render: () => <OptionF view="rig" />,
};
