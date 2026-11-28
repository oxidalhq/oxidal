import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { ChainCanvasControl } from '../lib/chain-canvas-control';
import { ChainWorkspace } from './chain-workspace';

const canvas: ChainCanvasControl = {
  zoom: 1,
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
};

// The work area measures itself; give it a laptop-sized space.
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(
        private readonly report: (entries: ResizeObserverEntry[]) => void,
      ) {}
      observe() {
        this.report([
          { contentRect: { width: 1200, height: 900 } },
        ] as unknown as ResizeObserverEntry[]);
      }
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Held({ onHeight }: { onHeight: (h: number) => void }) {
  const [height, setHeight] = useState<number | null>(300);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <ChainWorkspace
      canvas={canvas}
      chain={<p>Chain</p>}
      chainMin={260}
      chainHeight={height}
      onChainHeight={(h) => {
        setHeight(h);
        onHeight(h);
      }}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
    >
      <p>Panel</p>
    </ChainWorkspace>
  );
}

it('starts at the height the screen holds, grows from the keyboard and keeps its least height', () => {
  const onHeight = vi.fn();
  render(<Held onHeight={onHeight} />);
  const grip = screen.getByRole('separator', { name: 'Chain height' });
  expect(grip).toHaveAttribute('aria-valuenow', '300');
  expect(grip).toHaveAttribute('aria-valuemin', '260');
  fireEvent.keyDown(grip, { key: 'ArrowDown' });
  expect(onHeight).toHaveBeenLastCalledWith(324);
  expect(grip).toHaveAttribute('aria-valuenow', '324');
  fireEvent.keyDown(grip, { key: 'Home' });
  expect(onHeight).toHaveBeenLastCalledWith(260);
});

it('hides the panel through the screen that holds the choice', () => {
  render(<Held onHeight={() => undefined} />);
  expect(screen.getByText('Panel')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Hide panel' }));
  expect(screen.queryByText('Panel')).toBeNull();
  expect(screen.queryByRole('separator', { name: 'Chain height' })).toBeNull();
});
