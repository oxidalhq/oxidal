import type { Meta, StoryObj } from '@storybook/react-vite';

import { OptionA } from './header-layouts.demo';

/**
 * Header layout A - Open header. The header has no band of its own: wordmark left, the menu centred as small-caps labels with a short bar under each, search, peaks and health on the right. On the Rig the chain runs under it and the preset floats over the chain like a product title. Works: light and calm, the chain gets the most room. Watch: the header needs a fade or a solid state to stay readable over the chain; Mute sits in the preset row, so it is only on the Rig.
 */
const meta: Meta = {
  title: 'Header layouts/A - Open header',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The header has no band of its own: wordmark left, the menu centred as small-caps labels with a short bar under each, search, peaks and health on the right. On the Rig the chain runs under it and the preset floats over the chain like a product title. Works: light and calm, the chain gets the most room. Watch: the header needs a fade or a solid state to stay readable over the chain; Mute sits in the preset row, so it is only on the Rig.',
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
  render: () => <OptionA view="rig" />,
};

/** Settings › Audio on a desktop. */
export const SettingsDesktop: Story = {
  globals: at('chainDesktop'),
  parameters: {
    docs: { description: { story: 'Settings › Audio at 1440 × 900.' } },
  },
  render: () => <OptionA view="settings" />,
};

/** Library › Mine on a desktop. */
export const LibraryDesktop: Story = {
  globals: at('chainDesktop'),
  parameters: {
    docs: { description: { story: 'Library › Mine at 1440 × 900.' } },
  },
  render: () => <OptionA view="library" />,
};

/** The Rig on an iPhone XR. */
export const RigPhone: Story = {
  name: 'Rig on iPhone XR',
  globals: at('iphoneXr'),
  parameters: {
    docs: { description: { story: 'The Rig at 414 × 896.' } },
  },
  render: () => <OptionA view="rig" />,
};
