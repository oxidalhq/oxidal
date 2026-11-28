import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { ChainBarRigSample } from './rig-chain-bar.demo';

/**
 * Layout A with the chain bar: the map tools leave the corner of the chain
 * and sit in one slim bar between the chain and the panel under it. Drag the
 * grip on its top edge (or its empty space) to give the chain more or less
 * room, double-click the grip to reset, or press Hide so the chain fills the
 * screen. Each story opens at one of the owner's screens. Design sample with
 * fixed example data; nothing is saved.
 */
const meta: Meta = {
  title: 'Rig layouts/Layout A - Chain bar',
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
        tabletPortrait: {
          name: 'Tablet, portrait 768 × 1024',
          styles: { width: '768px', height: '1024px' },
        },
        iphoneXr: {
          name: 'iPhone XR',
          styles: { width: '414px', height: '896px' },
        },
        foldCoverChain: {
          name: 'Galaxy Z Fold 4, folded 374 × 882',
          styles: { width: '374px', height: '882px' },
        },
        foldInnerChain: {
          name: 'Galaxy Z Fold 4, unfolded 673 × 841',
          styles: { width: '673px', height: '841px' },
        },
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof ChainBarRigSample>;

const at = (value: string) => ({ viewport: { value, isRotated: false } });

/** Laptop or desktop: the whole bar in one row, the panel open under it. */
export const DesktopExpanded: Story = {
  globals: at('chainDesktop'),
  render: () => <ChainBarRigSample />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    const grip = await page.findByRole('separator', { name: 'Chain height' });
    const before = Number(grip.getAttribute('aria-valuenow'));
    grip.focus();
    await userEvent.keyboard('{ArrowUp}');
    await waitFor(() =>
      expect(Number(grip.getAttribute('aria-valuenow'))).toBe(before - 24),
    );
    await userEvent.dblClick(grip);
    await waitFor(() =>
      expect(Number(grip.getAttribute('aria-valuenow'))).toBe(before),
    );

    await userEvent.click(page.getByRole('button', { name: 'Hide panel' }));
    expect(page.queryByRole('region', { name: /selected block/ })).toBeNull();
    const bar = page.getByRole('toolbar', { name: 'Chain tools' });
    expect(within(bar).getByText('Fender Super Reverb 1977')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: /^Show panel/ }));
    expect(
      page.getByRole('region', { name: /selected block/ }),
    ).toBeInTheDocument();

    const zoomIn = page.queryByRole('button', { name: 'Zoom in' });
    if (zoomIn) {
      const shown = () =>
        page.getByRole('toolbar', { name: 'Chain tools' }).textContent ?? '';
      const zoom = shown().match(/(\d+)%/)?.[1];
      await userEvent.click(zoomIn);
      await waitFor(() => expect(shown().match(/(\d+)%/)?.[1]).not.toBe(zoom));
    }
    // Leave the map as it opened.
    await userEvent.click(
      page.getByRole('button', { name: 'Fit the whole chain' }),
    );
    (document.activeElement as HTMLElement | null)?.blur();
  },
};

/** The panel hidden: the chain fills the screen and the bar names the selected block. */
export const DesktopCollapsed: Story = {
  globals: at('chainDesktop'),
  render: () => <ChainBarRigSample collapsed />,
};

/** iPad-sized, landscape. */
export const TabletLandscape: Story = {
  globals: at('tabletLandscape'),
  render: () => <ChainBarRigSample />,
};

/** iPad-sized or BOOX, portrait. */
export const TabletPortrait: Story = {
  globals: at('tabletPortrait'),
  render: () => <ChainBarRigSample />,
};

/** Phone: one row. Pinch zooms, so the zoom buttons and the minimap go. */
export const IPhoneXrExpanded: Story = {
  name: 'iPhone XR expanded',
  globals: at('iphoneXr'),
  render: () => <ChainBarRigSample />,
};

/** Phone with the panel hidden. */
export const IPhoneXrCollapsed: Story = {
  name: 'iPhone XR collapsed',
  globals: at('iphoneXr'),
  render: () => <ChainBarRigSample collapsed />,
};

/** Galaxy Z Fold 4 folded: the narrow cover screen. */
export const FoldCover: Story = {
  name: 'Z Fold 4 folded (cover screen)',
  globals: at('foldCoverChain'),
  render: () => <ChainBarRigSample />,
};

/** Galaxy Z Fold 4 unfolded: the inner screen, wide enough for the whole bar. */
export const FoldInner: Story = {
  name: 'Z Fold 4 unfolded (inner screen)',
  globals: at('foldInnerChain'),
  render: () => <ChainBarRigSample />,
};
