import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { TopBarRigSample } from './rig-top-bar.demo';

/**
 * The top of the Rig split by job, with the fuller chain bar. The dark bar is
 * navigation and status only; the light preset row holds the preset and the
 * actions every screen needs (Mute never moves); the chain bar under the
 * chain carries Add, the changes since saving, Edited or Saved, where
 * changes apply, and Save. The count, the compare and the scope appear once
 * something changes: move a value in the block box to see them. Design
 * sample with fixed example data; nothing is saved.
 */
const meta: Meta = {
  title: 'Rig layouts/Layout A - Top bar and chain bar',
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
type Story = StoryObj<typeof TopBarRigSample>;

const at = (value: string) => ({ viewport: { value, isRotated: false } });

/** Desktop with three changes: count, compare, scope and Save in the bar. */
export const DesktopEdited: Story = {
  globals: at('chainDesktop'),
  render: () => <TopBarRigSample edits="edited" />,
};

/** Desktop with nothing changed: Save waits, the count, compare and scope are hidden. */
export const DesktopUnchanged: Story = {
  globals: at('chainDesktop'),
  render: () => <TopBarRigSample edits="unchanged" />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    const bar = page.getByRole('toolbar', { name: 'Chain tools' });
    const save = within(bar).getByRole('button', { name: /Save/ });
    // Nothing changed: Save waits; no count, compare or scope.
    expect(save).toBeDisabled();
    expect(within(bar).queryByRole('button', { name: /changes?$/ })).toBeNull();
    expect(
      within(bar).queryByRole('radiogroup', { name: 'Compare' }),
    ).toBeNull();
    // Move a value in the block box: the change shows up in the bar.
    const field = page.getByRole('slider', {
      name: 'Fender Super Reverb 1977 Input gain',
    });
    field.focus();
    await userEvent.keyboard('{ArrowUp}');
    await waitFor(() =>
      expect(
        within(bar).getByRole('button', { name: '1 change' }),
      ).toBeInTheDocument(),
    );
    expect(save).toBeEnabled();
    // Saving clears it again.
    await userEvent.click(save);
    await waitFor(() => expect(save).toBeDisabled());
    expect(within(bar).queryByRole('button', { name: /change$/ })).toBeNull();
    (document.activeElement as HTMLElement | null)?.blur();
  },
};

/** Desktop with the panel hidden: the bar sits at the bottom, Save still in it. */
export const DesktopPanelHidden: Story = {
  globals: at('chainDesktop'),
  render: () => <TopBarRigSample edits="edited" collapsed />,
};

/** iPad-sized, landscape: the zoom, minimap, compare and scope step out of the bar. */
export const TabletLandscape: Story = {
  globals: at('tabletLandscape'),
  render: () => <TopBarRigSample edits="edited" />,
};

/** iPad-sized or BOOX, portrait. */
export const TabletPortrait: Story = {
  globals: at('tabletPortrait'),
  render: () => <TopBarRigSample edits="edited" />,
};

/** Phone: one preset row, the bar keeps fit, centre, Map or Tree, the count, Save and Hide. */
export const IPhoneXr: Story = {
  name: 'iPhone XR',
  globals: at('iphoneXr'),
  render: () => <TopBarRigSample edits="edited" />,
};

/** Galaxy Z Fold 4 folded: the narrow cover screen. */
export const FoldCover: Story = {
  name: 'Z Fold 4 folded (cover screen)',
  globals: at('foldCoverChain'),
  render: () => <TopBarRigSample edits="edited" />,
};

/** Galaxy Z Fold 4 unfolded: the inner screen. */
export const FoldInner: Story = {
  name: 'Z Fold 4 unfolded (inner screen)',
  globals: at('foldInnerChain'),
  render: () => <TopBarRigSample edits="edited" />,
};
