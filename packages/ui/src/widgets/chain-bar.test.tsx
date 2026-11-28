import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { ChainCanvasControl } from '../lib/chain-canvas-control';
import { ChainBar } from './chain-bar';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function control(extra: Partial<ChainCanvasControl> = {}): ChainCanvasControl {
  return {
    zoom: 0.9,
    follow: true,
    setFollow: vi.fn(),
    minimap: false,
    setMinimap: vi.fn(),
    list: false,
    setList: vi.fn(),
    reportZoom: vi.fn(),
    drawingTop: 0,
    reportTop: vi.fn(),
    attach: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    fit: vi.fn(),
    centre: vi.fn(),
    panBy: vi.fn(),
    ...extra,
  };
}

function Bar({
  canvas = control(),
  compact,
  startCollapsed = false,
}: {
  canvas?: ChainCanvasControl;
  compact?: boolean;
  startCollapsed?: boolean;
}) {
  const [height, setHeight] = useState(300);
  const [collapsed, setCollapsed] = useState(startCollapsed);
  return (
    <>
      <ChainBar
        canvas={canvas}
        chainView="map"
        onChainView={() => undefined}
        height={height}
        minHeight={120}
        maxHeight={500}
        defaultHeight={300}
        onHeight={setHeight}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        selected={{ name: 'Fender Super Reverb 1977', on: true }}
        compact={compact}
      />
      {!collapsed && <section aria-label="Panel">Scene tabs</section>}
    </>
  );
}

it('steps the chain height 24 px with the arrow keys on the grip, within its range', async () => {
  const user = userEvent.setup();
  render(<Bar />);
  const grip = screen.getByRole('separator', { name: 'Chain height' });
  expect(grip).toHaveAttribute('aria-orientation', 'horizontal');
  expect(grip).toHaveAttribute('aria-valuenow', '300');
  expect(grip).toHaveAttribute('aria-valuemin', '120');
  expect(grip).toHaveAttribute('aria-valuemax', '500');
  grip.focus();
  await user.keyboard('{ArrowDown}');
  expect(grip).toHaveAttribute('aria-valuenow', '324');
  await user.keyboard('{ArrowUp}{ArrowUp}');
  expect(grip).toHaveAttribute('aria-valuenow', '276');
  await user.keyboard('{End}');
  expect(grip).toHaveAttribute('aria-valuenow', '500');
  await user.keyboard('{ArrowDown}');
  expect(grip).toHaveAttribute('aria-valuenow', '500');
  await user.dblClick(grip);
  expect(grip).toHaveAttribute('aria-valuenow', '300');
});

it('hides the panel, then names the selected block and shows it again', async () => {
  const user = userEvent.setup();
  render(<Bar />);
  expect(screen.queryByText(/· On/)).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Hide panel' }));
  expect(screen.queryByRole('region', { name: 'Panel' })).toBeNull();
  expect(screen.getByText('Fender Super Reverb 1977')).toBeInTheDocument();
  expect(screen.getByText(/· On/)).toBeInTheDocument();
  // Nothing to resize while the chain fills the screen.
  expect(screen.queryByRole('separator', { name: 'Chain height' })).toBeNull();
  await user.click(screen.getByRole('button', { name: /^Show panel/ }));
  expect(screen.getByRole('region', { name: 'Panel' })).toBeInTheDocument();
});

it('drives the map: zoom, fit, list, minimap and Follow', async () => {
  const user = userEvent.setup();
  const canvas = control();
  render(<Bar canvas={canvas} />);
  expect(screen.getByText('90%')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Zoom in' }));
  await user.click(screen.getByRole('button', { name: 'Zoom out' }));
  await user.click(screen.getByRole('button', { name: 'Fit the whole chain' }));
  await user.click(
    screen.getByRole('button', { name: 'Centre on the selected block' }),
  );
  await user.click(
    screen.getByRole('button', { name: 'Show the chain as a list' }),
  );
  await user.click(screen.getByRole('button', { name: 'Show the minimap' }));
  await user.click(
    screen.getByRole('switch', { name: 'Follow the selected block' }),
  );
  expect(canvas.zoomIn).toHaveBeenCalledOnce();
  expect(canvas.zoomOut).toHaveBeenCalledOnce();
  expect(canvas.fit).toHaveBeenCalledOnce();
  expect(canvas.centre).toHaveBeenCalledOnce();
  expect(canvas.setList).toHaveBeenCalledWith(true);
  expect(canvas.setMinimap).toHaveBeenCalledWith(true);
  expect(canvas.setFollow).toHaveBeenCalledWith(false);
});

it('keeps one row on a phone: no zoom buttons, zoom readout or minimap', () => {
  render(<Bar compact />);
  expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Zoom out' })).toBeNull();
  expect(screen.queryByText('90%')).toBeNull();
  expect(screen.queryByRole('button', { name: /minimap/ })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Fit the whole chain' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Map' })).toBeInTheDocument();
  expect(
    screen.getByRole('switch', { name: 'Follow the selected block' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Follow')).toHaveClass('sr-only');
  expect(
    screen.getByRole('button', { name: 'Hide panel' }),
  ).toBeInTheDocument();
});

function EditBar({ count, compact }: { count: number; compact?: boolean }) {
  return (
    <ChainBar
      canvas={control()}
      chainView="map"
      onChainView={() => undefined}
      height={300}
      minHeight={120}
      maxHeight={500}
      defaultHeight={300}
      onHeight={() => undefined}
      collapsed={false}
      onCollapsedChange={() => undefined}
      selected={{ name: 'Fender Super Reverb 1977', on: true }}
      compact={compact}
      onAdd={() => undefined}
      edits={{
        count,
        list: <p>Treble 5 → 6.5</p>,
        compare: 'edited',
        onCompare: () => undefined,
        scope: <button type="button">Changes: Lead only</button>,
        onSave: () => undefined,
      }}
    />
  );
}

it('hides the change count, compare and scope until something changes, and Save waits', () => {
  render(<EditBar count={0} />);
  expect(screen.queryByRole('button', { name: /changes?$/ })).toBeNull();
  expect(screen.queryByRole('radiogroup', { name: 'Compare' })).toBeNull();
  expect(screen.queryByText('Changes: Lead only')).toBeNull();
  expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
  expect(
    screen.getByRole('button', {
      name: 'Add a block after Fender Super Reverb 1977',
    }),
  ).toBeInTheDocument();
});

it('shows the count, compare, scope and Save once there are changes, and the count opens the list', async () => {
  const user = userEvent.setup();
  render(<EditBar count={3} />);
  expect(
    screen.getByRole('radiogroup', { name: 'Compare' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Changes: Lead only')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Save/ })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: '3 changes' }));
  expect(await screen.findByText('Treble 5 → 6.5')).toBeInTheDocument();
});

it('on a phone drops Add, the compare and the scope, and keeps the count and Save', () => {
  render(<EditBar count={3} compact />);
  expect(screen.queryByRole('radiogroup', { name: 'Compare' })).toBeNull();
  expect(screen.queryByText('Changes: Lead only')).toBeNull();
  expect(screen.queryByRole('button', { name: /^Add/ })).toBeNull();
  expect(screen.queryByRole('switch')).toBeNull();
  expect(screen.getByRole('button', { name: '3 changes' })).toHaveTextContent(
    '3',
  );
  expect(screen.getByRole('button', { name: /Save/ })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Map' })).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Fit the whole chain' }),
  ).toBeInTheDocument();
});
