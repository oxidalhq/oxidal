import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';

import { OpenPageSample, OpenRigSample } from './open-header.demo';

/**
 * The open header: no dark band. The wordmark, the menu as small-caps labels
 * with a short bar under each (oxide under the page you are on), and search,
 * peaks and health on the right, all over the page itself. On the Rig the
 * chain map runs from the top of the window under the header and the preset
 * floats over it like a product title. Pan or zoom the chain, or scroll a
 * page, and the header takes the page colour with a soft blur and one
 * hairline. Design samples with fixed example data; nothing is saved.
 */
const meta: Meta = {
  title: 'Rig layouts/Layout A - Open header',
  parameters: {
    layout: 'fullscreen',
    viewport: {
      options: {
        chainDesktop: {
          name: 'Desktop 1440 × 900',
          styles: { width: '1440px', height: '900px' },
        },
        tabletLandscape: {
          name: 'Tablet, landscape 1024 × 768',
          styles: { width: '1024px', height: '768px' },
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

/** The Rig: the chain fits below the header and the floating preset. */
export const Rig: Story = {
  globals: at('chainDesktop'),
  render: () => <OpenRigSample />,
};

/** The chain zoomed so blocks pass under the header: it takes the page colour, a blur and a hairline. */
export const RigPanned: Story = {
  name: 'Rig, chain under the header',
  globals: at('chainDesktop'),
  render: () => <OpenRigSample panned />,
  play: async ({ canvasElement }) => {
    const header = canvasElement.querySelector('[data-slot=open-header]');
    await waitFor(() => expect(header).toHaveAttribute('data-solid'), {
      timeout: 4000,
    });
    // The preset stays a heading over the map.
    await expect(
      within(canvasElement).getByRole('heading', {
        name: /Harmonic Tremolo/,
      }),
    ).toBeInTheDocument();
  },
};

/** Settings › Audio under the same header. */
export const Settings: Story = {
  globals: at('chainDesktop'),
  render: () => <OpenPageSample page="settings" />,
};

/** Library › Mine. */
export const Library: Story = {
  globals: at('chainDesktop'),
  render: () => <OpenPageSample page="library" />,
};

/** Levels › Overview. */
export const Levels: Story = {
  globals: at('chainDesktop'),
  render: () => <OpenPageSample page="levels" />,
};

/** Guitars. */
export const Guitars: Story = {
  globals: at('chainDesktop'),
  render: () => <OpenPageSample page="guitars" />,
};

/** Tablet, landscape. */
export const RigTablet: Story = {
  name: 'Rig on a tablet',
  globals: at('tabletLandscape'),
  render: () => <OpenRigSample />,
};

/** Phone: wordmark, search and health; the bottom tabs keep the menu. */
export const RigPhone: Story = {
  name: 'Rig on iPhone XR',
  globals: at('iphoneXr'),
  render: () => <OpenRigSample />,
};

/** Settings on a phone. */
export const SettingsPhone: Story = {
  name: 'Settings on iPhone XR',
  globals: at('iphoneXr'),
  render: () => <OpenPageSample page="settings" />,
};

/** E-paper: the header always sits on solid paper, with no blur. */
export const RigEpaper: Story = {
  name: 'Rig in E-paper',
  globals: at('chainDesktop'),
  render: () => (
    <div className="display-sample" data-display="epaper">
      <OpenRigSample />
    </div>
  ),
};
