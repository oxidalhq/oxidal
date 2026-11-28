import type { Meta, StoryObj } from '@storybook/react-vite';

import { OptionC } from './header-layouts.demo';

/**
 * Header layout C - Floating capsule. The menu is a pill floating at the top centre, like a dock; a second small pill at the top right holds search, Mute and health. Everything else is the page. On the Rig both float over the chain on a solid soft surface, with the preset under them. Works: playful and modern, the chain stays edge to edge. Watch: the pills cover part of the chain, and the centred pill needs a wide screen (tablets and phones fall back to the bottom tabs).
 */
const meta: Meta = {
  title: 'Header layouts/C - Floating capsule',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The menu is a pill floating at the top centre, like a dock; a second small pill at the top right holds search, Mute and health. Everything else is the page. On the Rig both float over the chain on a solid soft surface, with the preset under them. Works: playful and modern, the chain stays edge to edge. Watch: the pills cover part of the chain, and the centred pill needs a wide screen (tablets and phones fall back to the bottom tabs).',
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
  render: () => <OptionC view="rig" />,
};

/** Settings › Audio on a desktop. */
export const SettingsDesktop: Story = {
  globals: at('chainDesktop'),
  parameters: {
    docs: { description: { story: 'Settings › Audio at 1440 × 900.' } },
  },
  render: () => <OptionC view="settings" />,
};

/** Library › Mine on a desktop. */
export const LibraryDesktop: Story = {
  globals: at('chainDesktop'),
  parameters: {
    docs: { description: { story: 'Library › Mine at 1440 × 900.' } },
  },
  render: () => <OptionC view="library" />,
};

/** The Rig on an iPhone XR. */
export const RigPhone: Story = {
  name: 'Rig on iPhone XR',
  globals: at('iphoneXr'),
  parameters: {
    docs: { description: { story: 'The Rig at 414 × 896.' } },
  },
  render: () => <OptionC view="rig" />,
};
