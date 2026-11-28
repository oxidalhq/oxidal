import type { Meta, StoryObj } from '@storybook/react-vite';

import { CanvasRigSample } from './rig-canvas';
import { WorkbenchSample } from './rig-samples';
import { InstrumentSample, PanelsSample } from './rig-samples-2';

/**
 * Chain in the middle, scene tabs between it and the docked editor, side panels that minimise, peek and pin. Instrument adds the display bar and footswitch badges. Design samples with fixed example data; nothing is saved.
 */
const meta: Meta = {
  title: 'Rig layouts/Layout A - Workbench',
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj;

/** Chain, scene tabs and a docked editor in one viewport, with side panels. */
export const Workbench: Story = { render: () => <WorkbenchSample /> };

/** Display bar, chain with footswitch badges, scene tabs, docked editor, minimised panels. */
export const Instrument: Story = { render: () => <InstrumentSample /> };

/** Tablet and Fold: side panels peek over the chain and pin to dock. */
export const PanelsPeekAndPin: Story = { render: () => <PanelsSample /> };

/** Seven parallel paths on a canvas you pan and zoom like a map. Select a block and the view follows. */
export const BigRigPanAndZoom: Story = {
  render: () => <CanvasRigSample lanes={7} />,
};

/** A small rig fits and stays still: pan and zoom only matter when the chain is bigger than the space. */
export const SmallRigFits: Story = {
  render: () => <CanvasRigSample lanes={2} />,
};
