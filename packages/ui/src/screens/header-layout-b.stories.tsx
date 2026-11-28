import type { Meta, StoryObj } from '@storybook/react-vite';

import { OptionB } from './header-layouts.demo';

/**
 * Header layout B - Side rail. No menu across the top. A slim icon rail on the left holds the menu (names on hover and focus), with search, Mute, the peaks and health at its foot, so Mute is in the same place on every screen. The Rig keeps only the floating preset at the top and the chain gets the full height. Phones keep the bottom tabs. Works: most room for the chain, familiar from editors. Watch: icons alone are harder for new players, and the rail costs width on a tablet.
 */
const meta: Meta = {
  title: 'Header layouts/B - Side rail',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'No menu across the top. A slim icon rail on the left holds the menu (names on hover and focus), with search, Mute, the peaks and health at its foot, so Mute is in the same place on every screen. The Rig keeps only the floating preset at the top and the chain gets the full height. Phones keep the bottom tabs. Works: most room for the chain, familiar from editors. Watch: icons alone are harder for new players, and the rail costs width on a tablet.',
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
  render: () => <OptionB view="rig" />,
};

/** Settings › Audio on a desktop. */
export const SettingsDesktop: Story = {
  globals: at('chainDesktop'),
  parameters: {
    docs: { description: { story: 'Settings › Audio at 1440 × 900.' } },
  },
  render: () => <OptionB view="settings" />,
};

/** Library › Mine on a desktop. */
export const LibraryDesktop: Story = {
  globals: at('chainDesktop'),
  parameters: {
    docs: { description: { story: 'Library › Mine at 1440 × 900.' } },
  },
  render: () => <OptionB view="library" />,
};

/** The Rig on an iPhone XR. */
export const RigPhone: Story = {
  name: 'Rig on iPhone XR',
  globals: at('iphoneXr'),
  parameters: {
    docs: { description: { story: 'The Rig at 414 × 896.' } },
  },
  render: () => <OptionB view="rig" />,
};
